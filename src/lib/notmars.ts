/**
 * NAVAREA broadcast warnings (NOTMARs/NAVWARNs) from NGA Maritime Safety
 * Information, via the app's own /api/notmars relay — the NGA API sends no
 * CORS headers, so the browser cannot fetch it directly.
 *
 * Positions are NOT structured fields in the feed: they are embedded in the
 * warning prose as degrees-decimal-minutes pairs (e.g. '14-51.78N
 * 061-18.18W'). Measured on the live feed (2026-11-03): 361 of 386 active
 * records carry at least one parseable pair. Records without a pair are
 * kept as list-only entries — their positions are never guessed.
 */

export interface NotmarPosition {
  lat: number;
  lon: number;
}

export interface NotmarWarning {
  id: string;
  navArea: string;
  subregion: string;
  issueDate: string;
  text: string;
  positions: NotmarPosition[];
}

/** One marker per pair, at most this many per warning (MODU lists are long). */
export const NOTMAR_MAX_POSITIONS = 50;

export const NOTMAR_AREA_NAMES: Record<string, string> = {
  '4': 'NAVAREA IV',
  '12': 'NAVAREA XII',
  A: 'HYDROLANT',
  P: 'HYDROPAC',
  C: 'HYDROARC',
};

export function notmarAreaName(navArea: string): string {
  return NOTMAR_AREA_NAMES[navArea] ?? `Area ${navArea}`;
}

const PAIR_PATTERN = /(\d{1,2})-(\d{2}\.\d+)([NS])\s+(\d{1,3})-(\d{2}\.\d+)([EW])/g;

export function parseNotmarPositions(text: string, maxPairs = NOTMAR_MAX_POSITIONS): NotmarPosition[] {
  const positions: NotmarPosition[] = [];
  for (const match of text.matchAll(PAIR_PATTERN)) {
    const latDeg = Number(match[1]);
    const latMin = Number(match[2]);
    const latHem = match[3];
    const lonDeg = Number(match[4]);
    const lonMin = Number(match[5]);
    const lonHem = match[6];
    if (
      !Number.isFinite(latDeg) ||
      !Number.isFinite(latMin) ||
      !Number.isFinite(lonDeg) ||
      !Number.isFinite(lonMin)
    ) {
      continue;
    }
    let lat = latDeg + latMin / 60;
    let lon = lonDeg + lonMin / 60;
    if (latHem === 'S') lat = -lat;
    if (lonHem === 'W') lon = -lon;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    positions.push({ lat, lon });
    if (positions.length >= maxPairs) break;
  }
  return positions;
}

interface NotmarRaw {
  msgYear?: unknown;
  msgNumber?: unknown;
  navArea?: unknown;
  subregion?: unknown;
  issueDate?: unknown;
  text?: unknown;
}

export function parseNotmarWarnings(payload: unknown): NotmarWarning[] {
  const body = payload as { 'broadcast-warn'?: unknown };
  const raw = Array.isArray(body?.['broadcast-warn']) ? (body['broadcast-warn'] as NotmarRaw[]) : [];
  const warnings: NotmarWarning[] = [];
  for (const record of raw) {
    const navArea = String(record.navArea ?? '');
    const msgNumber = String(record.msgNumber ?? '');
    const msgYear = String(record.msgYear ?? '');
    const text = typeof record.text === 'string' ? record.text : '';
    if (!navArea || !msgNumber || !msgYear) continue;
    warnings.push({
      id: `${navArea} ${msgNumber}/${msgYear}`,
      navArea,
      subregion: typeof record.subregion === 'string' ? record.subregion : '',
      issueDate: typeof record.issueDate === 'string' ? record.issueDate : '',
      text,
      positions: parseNotmarPositions(text),
    });
  }
  return warnings;
}

export interface NotmarWarningsResult {
  warnings: NotmarWarning[];
  /** True when the relay served its last good copy because NGA could not be reached. */
  stale: boolean;
  fetchedAt: string | null;
}

export async function fetchNotmarWarnings(signal?: AbortSignal): Promise<NotmarWarningsResult> {
  const response = await fetch('/api/notmars', { signal });
  if (!response.ok) throw new Error(`NOTMARs HTTP ${response.status}`);
  const payload = (await response.json()) as { fetchedAt?: unknown; stale?: unknown };
  return {
    warnings: parseNotmarWarnings(payload),
    stale: payload.stale === true,
    fetchedAt: typeof payload.fetchedAt === 'string' ? payload.fetchedAt : null,
  };
}
