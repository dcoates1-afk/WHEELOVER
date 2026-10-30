import { normalizePoi } from '../../shared/poi-core.mjs';
import type { Poi, PoiGroupId } from '../../shared/poi-core';
import type { Bounds } from './navaidDb';
import { POI_GROUPS, hiddenPoiGroupSet, poiGroup } from './poiGroups';

export type { Poi, PoiGroupId } from '../../shared/poi-core';
export { POI_GROUPS } from './poiGroups';

/** Places only make sense once a harbour and its approaches fill the chart. */
export const POI_MIN_ZOOM = 11;

export interface PoiQueryResult {
  pois: Poi[];
  cached: boolean;
  fetchedAt: number;
}

const memory = new Map<string, { pois: Poi[]; at: number }>();
const TTL_MS = 5 * 60 * 1000;

function keyFor(bounds: Bounds): string {
  return bounds.map((value) => value.toFixed(3)).join(',');
}

/**
 * Public places for the current viewport, from the same Overpass proxy the
 * NAVAIDs use. The proxy caches on disk, so panning back over a harbour does
 * not hit the mirrors again.
 */
export async function queryPois(
  bounds: Bounds,
  options: { signal?: AbortSignal; force?: boolean } = {},
): Promise<PoiQueryResult> {
  const key = keyFor(bounds);
  const cached = memory.get(key);
  if (!options.force && cached && Date.now() - cached.at < TTL_MS) {
    return { pois: cached.pois, cached: true, fetchedAt: cached.at };
  }

  const [south, west, north, east] = bounds;
  const response = await fetch(`/api/overpass?kind=pois&bbox=${south},${west},${north},${east}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Places unavailable (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as {
    elements?: unknown[];
    meta?: { cached?: boolean };
  };
  const seen = new Set<string>();
  const pois: Poi[] = [];
  for (const element of payload.elements ?? []) {
    const poi = normalizePoi(element) as Poi | null;
    if (!poi || seen.has(poi.id)) continue;
    seen.add(poi.id);
    pois.push(poi);
  }

  memory.set(key, { pois, at: Date.now() });
  return { pois, cached: Boolean(payload.meta?.cached), fetchedAt: Date.now() };
}

export function clearPoiMemory(): void {
  memory.clear();
}

/**
 * Apply the menu filters and the per-group zoom threshold. A marina appears on
 * approach; restaurants and shops wait until the harbour is actually in view so
 * a town does not bury the channel.
 */
export function visiblePois(pois: Poi[], zoom: number, hiddenGroups: unknown): Poi[] {
  const hidden = hiddenPoiGroupSet(hiddenGroups);
  return pois.filter((poi) => {
    if (hidden.has(poi.group)) return false;
    const group = poiGroup(poi.group);
    return zoom >= (group?.minZoom ?? POI_MIN_ZOOM);
  });
}

const GLYPHS: Record<PoiGroupId, string> = {
  marina:
    '<circle cx="12" cy="4.8" r="1.9" fill="none" stroke="#fff" stroke-width="1.7"/>' +
    '<path d="M12 6.7v12M8.4 10h7.2M6 15a6 6 0 0 0 12 0" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>',
  fuel_water:
    '<path d="M12 3.2s5.3 6 5.3 9.4a5.3 5.3 0 0 1-10.6 0C6.7 9.2 12 3.2 12 3.2Z" fill="#fff"/>',
  boatyard:
    '<path d="M19.6 3.4a4.3 4.3 0 0 1-5.4 5.4l-7.5 7.5 2.6 2.6 7.5-7.5a4.3 4.3 0 0 1 5.4-5.4l-2.8 2.8-2.6-2.6 2.8-2.8Z" fill="#fff"/>',
  ramp:
    '<path d="M4 19h16M7 19l5-10 5 10M9.2 14h5.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  transport:
    '<rect x="5.6" y="3.4" width="12.8" height="12.6" rx="2.6" fill="none" stroke="#fff" stroke-width="1.7"/>' +
    '<path d="M5.6 9.2h12.8M9 19.4l-1.8 2M15 19.4l1.8 2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>' +
    '<circle cx="9.2" cy="12.9" r="1" fill="#fff"/><circle cx="14.8" cy="12.9" r="1" fill="#fff"/>',
  food:
    '<path d="M8.2 3v6.2M5.8 3v4.1a2.4 2.4 0 0 0 4.8 0V3M8.2 9.2V21M16.2 3v18M16.2 3c3.2 0 3.2 6.1 0 7.2" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>',
  shops:
    '<path d="M4.2 9h15.6l-1.6 10.2H5.8L4.2 9Z" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M8.4 9 12 3.4 15.6 9" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>',
  facilities:
    '<circle cx="12" cy="12" r="8.6" fill="none" stroke="#fff" stroke-width="1.7"/>' +
    '<path d="M12 10.8V17M12 7.5v.2" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
};

/** White glyph for the category, drawn on the group's coloured pin. */
export function poiIconSvg(group: PoiGroupId, size = 16): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false">${
    GLYPHS[group] ?? GLYPHS.facilities
  }</svg>`;
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Popup body, built as DOM so OSM text is never interpreted as markup. */
export function poiPopupContent(poi: Poi): HTMLElement {
  const root = document.createElement('div');
  root.className = 'poi-popup';

  const title = document.createElement('strong');
  title.textContent = poi.name ?? poi.kind;
  root.append(title);

  const kind = document.createElement('span');
  kind.className = 'poi-popup-kind';
  const groupLabel = POI_GROUPS.find((group) => group.id === poi.group)?.label;
  kind.textContent = poi.name ? `${poi.kind} · ${groupLabel ?? ''}`.trim() : groupLabel ?? poi.kind;
  root.append(kind);

  const rows: [string, string | null][] = [
    ['Opening', poi.opening],
    ['Operator', poi.operator],
    ['Phone', poi.phone],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const row = document.createElement('p');
    row.className = 'poi-popup-row';
    const key = document.createElement('span');
    key.textContent = `${label} `;
    row.append(key);
    if (label === 'Phone') {
      const link = document.createElement('a');
      link.href = `tel:${value.replace(/[^\d+]/g, '')}`;
      link.textContent = value;
      row.append(link);
    } else {
      row.append(document.createTextNode(value));
    }
    root.append(row);
  }

  if (poi.website) {
    const href = httpUrl(poi.website);
    if (href) {
      const row = document.createElement('p');
      row.className = 'poi-popup-row';
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Website';
      row.append(link);
      root.append(row);
    }
  }

  if (poi.description) {
    const note = document.createElement('p');
    note.className = 'poi-popup-row';
    note.textContent = poi.description;
    root.append(note);
  }

  return root;
}
