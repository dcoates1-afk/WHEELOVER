/**
 * AIS relay.
 *
 * The browser never sees the AISStream key: one server-side upstream feeds every
 * connected client. The relay reconnects with backoff, keeps a rolling vessel
 * table, and falls back to clearly-labelled simulated traffic when no key is
 * configured so the station still demonstrates its layout offline.
 */
import { WebSocket } from 'ws';
import {
  AIS_GLOBAL_BOX,
  boxContains,
  boxesChanged,
  boxesContain,
  normalizeBounds,
  subscriptionBox,
  subscriptionBoxes,
} from '../shared/ais-scope.mjs';

export interface AisVessel {
  mmsi: number;
  name: string | null;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  shipType: string | null;
  /** Raw AIS ship-and-cargo code, kept so the chart can colour by class. */
  typeCode: number | null;
  destination: string | null;
  /** AIS navigational status 0-15, as broadcast. */
  navStatus: number | null;
  callSign: string | null;
  imo: number | null;
  draught: number | null;
  length: number | null;
  beam: number | null;
  eta: string | null;
  /** Class A or Class B transponder, when a message says which. */
  transponder: 'A' | 'B' | null;
  lastSeen: number;
  /** When the last static report (name, type, dimensions) arrived. */
  staticAt: number | null;
  simulated: boolean;
}

interface AisStaticInfo {
  name: string | null;
  shipType: string | null;
  typeCode: number | null;
  destination: string | null;
  callSign: string | null;
  imo: number | null;
  draught: number | null;
  length: number | null;
  beam: number | null;
  eta: string | null;
  transponder: 'A' | 'B' | null;
  updatedAt: number;
}

export type RelayState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'demo' | 'error';

export interface RelayStatus {
  type: 'status';
  state: RelayState;
  note: string | null;
  scope: number[][] | null;
}

export interface RelaySnapshot {
  type: 'snapshot';
  state: RelayState;
  note: string | null;
  scope: number[][] | null;
  vessels: AisVessel[];
}

const UPSTREAM = 'wss://stream.aisstream.io/v0/stream';
const SNAPSHOT_MS = 2500;
const DEMO_MS = 4000;
const MAX_VESSELS = 800;
// Static reports arrive minutes apart (Class B static every six minutes), so
// they are held separately from positions: pruned by scope, never by silence.
const MAX_STATICS = 6000;
const IDLE_CLOSE_MS = 90_000;

/**
 * Position reports and the two Class B variants, plus both static formats.
 * Without the Class B static report a small craft never sends a name, which is
 * why so many targets used to read as a bare MMSI.
 */
const SUBSCRIBED_MESSAGES = [
  'PositionReport',
  'ExtendedClassBPositionReport',
  'StandardClassBPositionReport',
  'LongRangeAisBroadcastMessage',
  'ShipStaticData',
  'StaticDataReport',
];

const DEMO_SEED = [
  { mmsi: 232001234, name: 'RED JET 6', lat: 50.795, lon: -1.29, cog: 205, sog: 21.4, shipType: 'Passenger', typeCode: 60 },
  { mmsi: 232004321, name: 'WIGHT RYDER 1', lat: 50.732, lon: -1.16, cog: 12, sog: 9.8, shipType: 'Passenger', typeCode: 60 },
  { mmsi: 235098765, name: 'NAUTI YETI', lat: 50.842, lon: -1.32, cog: 88, sog: 5.2, shipType: 'Sailing', typeCode: 36 },
  { mmsi: 235011223, name: 'LIDA SUZANNA', lat: 50.881, lon: -1.1, cog: 274, sog: 7.6, shipType: 'Cargo', typeCode: 70 },
  { mmsi: 232556677, name: 'SOLENT GUARDIAN', lat: 50.78, lon: -1.02, cog: 145, sog: 11.9, shipType: 'Tug', typeCode: 52 },
  { mmsi: 235445566, name: 'ARABESQUE', lat: 50.708, lon: -1.42, cog: 332, sog: 4.1, shipType: 'Pleasure craft', typeCode: 37 },
];

function shipTypeLabel(type: unknown): string | null {
  const code = typeof type === 'number' ? type : Number(type);
  if (!Number.isFinite(code) || code <= 0) return null;
  if (code >= 20 && code <= 29) return 'Wing in ground';
  if (code === 30) return 'Fishing';
  if (code === 31) return 'Towing';
  if (code === 32) return 'Towing (large)';
  if (code === 33) return 'Dredging';
  if (code === 34) return 'Diving';
  if (code === 35) return 'Military';
  if (code === 36) return 'Sailing';
  if (code === 37) return 'Pleasure craft';
  if (code >= 40 && code <= 49) return 'High-speed craft';
  if (code === 50) return 'Pilot vessel';
  if (code === 51) return 'Search and rescue';
  if (code === 52) return 'Tug';
  if (code === 53) return 'Port tender';
  if (code === 54) return 'Anti-pollution';
  if (code === 55) return 'Law enforcement';
  if (code === 58) return 'Medical transport';
  if (code === 59) return 'Special craft';
  if (code >= 60 && code <= 69) return 'Passenger';
  if (code >= 70 && code <= 79) return 'Cargo';
  if (code >= 80 && code <= 89) return 'Tanker';
  if (code >= 90 && code <= 99) return 'Other';
  return `Type ${code}`;
}

/** AIS pads names with '@' and sometimes underscores; strip both. */
function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/@+/g, ' ')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

function finite(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** AIS ETA carries no year: month, day, hour and minute are the whole report. */
function etaText(value: unknown): string | null {
  const eta = value as { Month?: unknown; Day?: unknown; Hour?: unknown; Minute?: unknown } | undefined;
  const month = finite(eta?.Month, 1, 12);
  const day = finite(eta?.Day, 1, 31);
  if (month === null || day === null) return null;
  const hour = finite(eta?.Hour, 0, 23);
  const minute = finite(eta?.Minute, 0, 59);
  const clock =
    hour === null ? '--:--' : `${String(hour).padStart(2, '0')}:${minute === null ? '--' : String(minute).padStart(2, '0')}`;
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${clock} UTC`;
}

function dimensionsOf(value: unknown): { length: number | null; beam: number | null } {
  const dimension = value as { A?: unknown; B?: unknown; C?: unknown; D?: unknown } | undefined;
  const a = finite(dimension?.A, 0, 2000);
  const b = finite(dimension?.B, 0, 2000);
  const c = finite(dimension?.C, 0, 200);
  const d = finite(dimension?.D, 0, 200);
  return {
    length: a !== null && b !== null && a + b > 0 ? a + b : null,
    beam: c !== null && d !== null && c + d > 0 ? c + d : null,
  };
}

function mergeStatic(vessel: AisVessel, info: AisStaticInfo | undefined): AisVessel {
  if (!info) return vessel;
  return {
    ...vessel,
    name: vessel.name ?? info.name,
    shipType: vessel.shipType ?? info.shipType,
    typeCode: vessel.typeCode ?? info.typeCode,
    destination: vessel.destination ?? info.destination,
    callSign: vessel.callSign ?? info.callSign,
    imo: vessel.imo ?? info.imo,
    draught: vessel.draught ?? info.draught,
    length: vessel.length ?? info.length,
    beam: vessel.beam ?? info.beam,
    eta: vessel.eta ?? info.eta,
    transponder: vessel.transponder ?? info.transponder,
    staticAt: vessel.staticAt ?? info.updatedAt,
  };
}

export function createAisRelay(options: { apiKey: string; log?: (message: string) => void }) {
  const log = options.log ?? (() => {});
  const vessels = new Map<number, AisVessel>();
  const statics = new Map<number, AisStaticInfo>();
  const clients = new Map<WebSocket, number[] | null>();

  let upstream: WebSocket | null = null;
  let state: RelayState = 'idle';
  let note: string | null = null;
  let attempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshotTimer: ReturnType<typeof setInterval> | null = null;
  let demoTimer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;
  let subscribedBoxes: number[][][] = [AIS_GLOBAL_BOX.map((pair) => [...pair]) as number[][]];
  let pendingBoxes: number[][][] | null = null;
  let resubscribing = false;
  let scopeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Each client is told about the area covering its own chart, not the whole
   * shared subscription, so the panel's "Feed covers …" stays honest when
   * several devices watch different waters.
   */
  const scopeFor = (ws: WebSocket): number[][] | null => {
    const bounds = clients.get(ws);
    return (bounds ? subscriptionBox(bounds) : null) ?? subscribedBoxes[0] ?? null;
  };

  /** The shared table holds every chart's traffic; a client only gets its own. */
  const vesselsFor = (ws: WebSocket): AisVessel[] => {
    const sorted = [...vessels.values()]
      .map((vessel) => mergeStatic(vessel, statics.get(vessel.mmsi)))
      .sort((a, b) => b.lastSeen - a.lastSeen);
    const scope = scopeFor(ws);
    if (!clients.get(ws) || !scope) return sorted;
    return sorted.filter((vessel) => boxContains(scope, vessel.lat, vessel.lon));
  };

  const status = (ws: WebSocket): RelayStatus => ({ type: 'status', state, note, scope: scopeFor(ws) });
  const snapshot = (ws: WebSocket): RelaySnapshot => ({
    type: 'snapshot',
    state,
    note,
    scope: scopeFor(ws),
    vessels: vesselsFor(ws),
  });

  function send(ws: WebSocket, payload: unknown) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }

  function setState(next: RelayState, message: string | null = null) {
    state = next;
    note = message;
    for (const client of clients.keys()) send(client, status(client));
  }

  function broadcastSnapshots() {
    for (const client of clients.keys()) send(client, snapshot(client));
  }

  function ensureSnapshotTimer() {
    if (snapshotTimer) return;
    snapshotTimer = setInterval(() => {
      if (clients.size > 0) broadcastSnapshots();
    }, SNAPSHOT_MS);
    snapshotTimer.unref?.();
  }

  /** One box per distinct chart on screen, nevers a union across an ocean. */
  function currentBoxes(): number[][][] {
    const views = [...clients.values()].filter((bounds): bounds is number[] => Array.isArray(bounds));
    const global = [AIS_GLOBAL_BOX.map((pair) => [...pair]) as number[][]];
    if (views.length === 0) return global;
    const boxes = subscriptionBoxes(views);
    return boxes.length > 0 ? boxes : global;
  }

  function applyScope() {
    if (clients.size === 0 || resubscribing) return;
    const next = currentBoxes();
    if (!boxesChanged(subscribedBoxes, next, 0.2)) return;
    pendingBoxes = next;
    if (!upstream) {
      connect();
      return;
    }
    if (upstream.readyState === WebSocket.CONNECTING) return;
    resubscribing = true;
    log('AIS chart area changed — resubscribing upstream');
    upstream.close();
  }

  function scheduleScopeUpdate() {
    if (scopeTimer) return;
    scopeTimer = setTimeout(() => {
      scopeTimer = null;
      applyScope();
    }, 1200);
    scopeTimer.unref?.();
  }

  /** Forget targets from the previous chart so a moved view is not polluted. */
  function pruneOutsideScope() {
    let dropped = 0;
    for (const [mmsi, vessel] of vessels) {
      if (!boxesContain(subscribedBoxes, vessel.lat, vessel.lon)) {
        vessels.delete(mmsi);
        dropped += 1;
      }
    }
    if (dropped > 0) log(`AIS scope moved — dropped ${dropped} out-of-area targets`);
  }

  function prune() {
    const cutoff = Date.now() - 12 * 60_000;
    for (const [mmsi, vessel] of vessels) {
      if (vessel.lastSeen < cutoff) vessels.delete(mmsi);
    }
    if (vessels.size > MAX_VESSELS) {
      const oldest = [...vessels.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      for (const [mmsi] of oldest.slice(0, vessels.size - MAX_VESSELS)) vessels.delete(mmsi);
    }
    if (statics.size > MAX_STATICS) {
      const oldest = [...statics.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      for (const [mmsi] of oldest.slice(0, statics.size - MAX_STATICS)) statics.delete(mmsi);
    }
  }

  /**
   * Apply a static report to both stores: a target already on the chart gains
   * its name immediately, and the record is kept for when it next transmits a
   * position, even if the chart has moved away in the meantime.
   */
  function rememberStatic(mmsi: number, patch: Partial<AisStaticInfo>) {
    const previous = statics.get(mmsi);
    const next: AisStaticInfo = {
      name: null,
      shipType: null,
      typeCode: null,
      destination: null,
      callSign: null,
      imo: null,
      draught: null,
      length: null,
      beam: null,
      eta: null,
      transponder: null,
      ...previous,
      ...patch,
      updatedAt: Date.now(),
    };
    statics.set(mmsi, next);
    const vessel = vessels.get(mmsi);
    if (!vessel) return;
    // Static is authoritative: a corrected name or a type heard on Part B
    // replaces whatever an earlier report or a name-bearing position carried.
    vessels.set(mmsi, {
      ...vessel,
      name: next.name ?? vessel.name,
      shipType: next.shipType ?? vessel.shipType,
      typeCode: next.typeCode ?? vessel.typeCode,
      destination: next.destination ?? vessel.destination,
      callSign: next.callSign ?? vessel.callSign,
      imo: next.imo ?? vessel.imo,
      draught: next.draught ?? vessel.draught,
      length: next.length ?? vessel.length,
      beam: next.beam ?? vessel.beam,
      eta: next.eta ?? vessel.eta,
      transponder: next.transponder ?? vessel.transponder,
      staticAt: next.updatedAt,
    });
  }

  function handleMessage(raw: WebSocket.RawData) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const messageType = payload.MessageType;
    const message = (payload.Message ?? {}) as Record<string, Record<string, unknown>>;
    const meta = (payload.MetaData ?? {}) as Record<string, unknown>;

    // Class A static: name, type, callsign, dimensions, destination and ETA.
    if (messageType === 'ShipStaticData') {
      const data = message.ShipStaticData ?? {};
      const mmsi = Number(data.UserID ?? meta.MMSI);
      if (!Number.isFinite(mmsi)) return;
      const patch: Partial<AisStaticInfo> = { transponder: 'A' };
      const name = cleanText(data.Name);
      const destination = cleanText(data.Destination);
      const typeCode = finite(data.Type, 1, 99);
      const callSign = cleanText(data.CallSign);
      const imo = finite(data.ImoNumber, 1, 9_999_999);
      const draught = finite(data.MaximumStaticDraught, 0.1, 40);
      const eta = etaText(data.Eta);
      const { length, beam } = dimensionsOf(data.Dimension);
      if (name) patch.name = name;
      if (destination) patch.destination = destination;
      if (typeCode !== null) {
        patch.typeCode = typeCode;
        patch.shipType = shipTypeLabel(typeCode);
      }
      if (callSign) patch.callSign = callSign;
      if (imo !== null) patch.imo = imo;
      if (draught !== null) patch.draught = draught;
      if (eta) patch.eta = eta;
      if (length !== null) patch.length = length;
      if (beam !== null) patch.beam = beam;
      rememberStatic(mmsi, patch);
      return;
    }

    // Class B static: Part A carries the name, Part B the type and dimensions.
    if (messageType === 'StaticDataReport') {
      const data = message.StaticDataReport ?? {};
      const mmsi = Number(data.UserID ?? meta.MMSI);
      if (!Number.isFinite(mmsi)) return;
      const reportA = (data.ReportA ?? {}) as Record<string, unknown>;
      const reportB = (data.ReportB ?? {}) as Record<string, unknown>;
      const patch: Partial<AisStaticInfo> = { transponder: 'B' };
      const name = cleanText(reportA.Name) ?? cleanText(data.Name);
      const typeCode = finite(reportB.ShipType ?? data.ShipType, 1, 99);
      const callSign = cleanText(reportB.CallSign);
      const { length, beam } = dimensionsOf(reportB.Dimension ?? data.Dimension);
      if (name) patch.name = name;
      if (typeCode !== null) {
        patch.typeCode = typeCode;
        patch.shipType = shipTypeLabel(typeCode);
      }
      if (callSign) patch.callSign = callSign;
      if (length !== null) patch.length = length;
      if (beam !== null) patch.beam = beam;
      rememberStatic(mmsi, patch);
      return;
    }

    const report =
      messageType === 'PositionReport'
        ? message.PositionReport
        : messageType === 'ExtendedClassBPositionReport'
          ? message.ExtendedClassBPositionReport
          : messageType === 'StandardClassBPositionReport'
            ? message.StandardClassBPositionReport
            : messageType === 'LongRangeAisBroadcastMessage'
              ? message.LongRangeAisBroadcastMessage
              : null;
    if (!report) return;

    const mmsi = Number(report.UserID ?? meta.MMSI);
    const lat = Number(report.Latitude);
    const lon = Number(report.Longitude);
    if (!Number.isFinite(mmsi) || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const existing = vessels.get(mmsi);
    const speed = finite(report.Sog, 0, 102.2);
    const course = finite(report.Cog, 0, 359.9);
    const heading = finite(report.TrueHeading, 0, 359);
    const navStatus = finite(report.NavigationalStatus, 0, 14);
    // The extended Class B position report repeats the name, type and size.
    const reportName = cleanText(report.Name);
    const reportType = finite(report.Type, 1, 99);
    const { length, beam } = dimensionsOf(report.Dimension);
    const transponder =
      messageType === 'PositionReport'
        ? 'A'
        : messageType === 'ExtendedClassBPositionReport' || messageType === 'StandardClassBPositionReport'
          ? 'B'
          : existing?.transponder ?? null;

    const next: AisVessel = {
      mmsi,
      name: reportName ?? existing?.name ?? null,
      lat,
      lon,
      sog: speed ?? existing?.sog ?? null,
      cog: course ?? existing?.cog ?? null,
      heading: heading ?? existing?.heading ?? null,
      shipType: shipTypeLabel(reportType) ?? existing?.shipType ?? null,
      typeCode: reportType ?? existing?.typeCode ?? null,
      destination: existing?.destination ?? null,
      navStatus: navStatus ?? existing?.navStatus ?? null,
      callSign: existing?.callSign ?? null,
      imo: existing?.imo ?? null,
      draught: existing?.draught ?? null,
      length: length ?? existing?.length ?? null,
      beam: beam ?? existing?.beam ?? null,
      eta: existing?.eta ?? null,
      transponder,
      lastSeen: Date.now(),
      staticAt: existing?.staticAt ?? null,
      simulated: false,
    };
    vessels.set(mmsi, mergeStatic(next, statics.get(mmsi)));
    prune();
  }

  function stopDemo() {
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
  }

  function startDemo(reason: string) {
    stopDemo();
    vessels.clear();
    const t = Date.now();
    for (const seed of DEMO_SEED) {
      vessels.set(seed.mmsi, {
        ...seed,
        heading: seed.cog,
        destination: 'SOLENT DEMO',
        navStatus: 0,
        callSign: null,
        imo: null,
        draught: null,
        length: seed.typeCode === 60 ? 40 : 18,
        beam: seed.typeCode === 60 ? 10 : 6,
        eta: null,
        transponder: 'A',
        lastSeen: t,
        staticAt: t,
        simulated: true,
      });
    }
    setState('demo', reason);
    demoTimer = setInterval(() => {
      const now = Date.now();
      for (const vessel of vessels.values()) {
        const rad = ((vessel.cog ?? 0) * Math.PI) / 180;
        const step = (vessel.sog ?? 5) * 0.00018;
        vessel.lat += Math.cos(rad) * step;
        vessel.lon += Math.sin(rad) * step * 1.6;
        vessel.lastSeen = now;
      }
      if (clients.size > 0) broadcastSnapshots();
    }, DEMO_MS);
    demoTimer.unref?.();
  }

  function scheduleReconnect() {
    if (reconnectTimer || clients.size === 0) return;
    attempts += 1;
    if (attempts > 6) {
      setState('error', 'AISStream unreachable — showing simulated traffic');
      startDemo('AISStream unreachable — simulated traffic');
      return;
    }
    const delay = Math.min(30_000, 1000 * 2 ** attempts) + Math.random() * 400;
    setState('reconnecting', `Upstream dropped — retry ${attempts} in ${Math.round(delay / 1000)} s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (!options.apiKey) {
      startDemo('No AISStream key configured — simulated traffic');
      return;
    }
    if (upstream) return;

    setState('connecting');
    const socket = new WebSocket(UPSTREAM, { handshakeTimeout: 15_000 });
    upstream = socket;

    socket.on('open', () => {
      attempts = 0;
      if (pendingBoxes) {
        subscribedBoxes = pendingBoxes;
        pendingBoxes = null;
      }
      socket.send(
        JSON.stringify({
          APIKey: options.apiKey,
          BoundingBoxes: subscribedBoxes,
          FilterMessageTypes: SUBSCRIBED_MESSAGES,
        }),
      );
      log(`AIS upstream connected (${subscribedBoxes.length} area${subscribedBoxes.length > 1 ? 's' : ''}: ${JSON.stringify(subscribedBoxes)})`);
      pruneOutsideScope();
      broadcastSnapshots();
      setState('live');
    });

    socket.on('message', handleMessage);

    socket.on('close', (code) => {
      upstream = null;
      if (clients.size === 0) {
        setState('idle');
        return;
      }
      if (resubscribing) {
        resubscribing = false;
        log('AIS upstream closed for resubscribe — reconnecting on the new area');
        connect();
        return;
      }
      log(`AIS upstream closed (${code})`);
      scheduleReconnect();
    });

    socket.on('error', (error) => {
      log(`AIS upstream error: ${error.message}`);
    });
  }

  function attach(ws: WebSocket) {
    clients.set(ws, null);
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    ensureSnapshotTimer();
    send(ws, status(ws));
    send(ws, snapshot(ws));

    ws.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as { type?: string; bounds?: unknown };
        if (payload?.type !== 'bounds') return;
        const bounds = normalizeBounds(payload.bounds);
        if (!bounds) return;
        clients.set(ws, bounds);
        scheduleScopeUpdate();
      } catch {
        // Ignore malformed client frames.
      }
    });

    if (!upstream && state !== 'demo') connect();
    else if (state === 'live' && upstream) setState('live');

    ws.on('close', () => {
      clients.delete(ws);
      if (clients.size === 0) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          upstream?.close();
          upstream = null;
          setState('idle');
        }, IDLE_CLOSE_MS);
        idleTimer.unref?.();
      }
      scheduleScopeUpdate();
    });
    ws.on('error', () => clients.delete(ws));
  }

  function start() {
    if (started) return;
    started = true;
    ensureSnapshotTimer();
    if (!options.apiKey) startDemo('No AISStream key configured — simulated traffic');
  }

  function stop() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (scopeTimer) clearTimeout(scopeTimer);
    stopDemo();
    reconnectTimer = null;
    snapshotTimer = null;
    idleTimer = null;
    scopeTimer = null;
    resubscribing = false;
    pendingBoxes = null;
    subscribedBoxes = [AIS_GLOBAL_BOX.map((pair) => [...pair]) as number[][]];
    upstream?.close();
    upstream = null;
    vessels.clear();
    statics.clear();
    for (const client of clients.keys()) client.close();
    clients.clear();
    started = false;
  }

  return { attach, start, stop };
}
