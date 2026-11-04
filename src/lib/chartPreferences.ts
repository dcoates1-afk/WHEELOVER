import { sanitizeHiddenGroups } from './navaidGroups';
import { sanitizeHiddenPoiGroups } from './poiGroups';
import { sanitizeHiddenAreaGroups, type MarineAreaGroup } from './marineAreas';

export type BaseLayerId = 'osm' | 'satellite' | 'nautical' | 'relief' | 'noaa' | 'rnc';
export type ThemeId = 'day' | 'night' | 'red';
export interface OverlayPreferences {
  openseamap: boolean;
  ferries: boolean;
  tss: boolean;
  ais: boolean;
  contours: boolean;
  soundings: boolean;
  depthLabels: boolean;
  pois: boolean;
  bridges: boolean;
  warnings: boolean;
  tideStations: boolean;
}

export interface ChartPreferences {
  base: BaseLayerId;
  overlays: OverlayPreferences;
  showPosition: boolean;
  theme: ThemeId;
  /** NAVAID legend groups the user switched off. */
  hiddenGroups: string[];
  /** Public-place groups the user switched off. */
  hiddenPoiGroups: string[];
  /** Marine-area groups the user switched off. */
  hiddenAreaGroups: MarineAreaGroup[];
}

export const CHART_STORAGE_KEY = 'wheel-over:chart-prefs';
const CHART_PREFERENCES_SCHEMA = 2;
/** Preferences from earlier LEEWARD/MARNAV builds remain available after the rename. */
const LEGACY_CHART_STORAGE_KEYS = ['leeward:chart-prefs', 'marnav:chart-prefs'] as const;

export const DEFAULT_PREFERENCES: ChartPreferences = {
  base: 'osm',
  overlays: {
    openseamap: false,
    ferries: true,
    tss: true,
    ais: true,
    contours: false,
    soundings: false,
    depthLabels: false,
    pois: false,
    // Bridges are chart context a navigator expects to see, so they start
    // on. A saved record keeps whatever this device chose: only a device
    // with no stored value for the key inherits these defaults. Navaids and
    // marine areas have no master switch any more: they are always drawn,
    // filtered per type in the Legend & mark filters.
    bridges: true,
    // Warnings start off: the feed is ~200 KB and draws hundreds of
    // markers, so it loads on the navigator's say-so, not on first paint.
    warnings: false,
    // Tide stations start off: 3,500 stations worldwide, drawn only for
    // the current view at harbour zoom and above, on the same say-so.
    tideStations: false,
  },
  showPosition: false,
  theme: 'day',
  hiddenGroups: [],
  hiddenPoiGroups: [],
  hiddenAreaGroups: [],
};

const BASE_IDS: BaseLayerId[] = ['osm', 'satellite', 'nautical', 'relief', 'noaa', 'rnc'];
const THEME_IDS: ThemeId[] = ['day', 'night', 'red'];

function defaults(): ChartPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    overlays: { ...DEFAULT_PREFERENCES.overlays },
    hiddenGroups: [...DEFAULT_PREFERENCES.hiddenGroups],
    hiddenPoiGroups: [...DEFAULT_PREFERENCES.hiddenPoiGroups],
    hiddenAreaGroups: [...DEFAULT_PREFERENCES.hiddenAreaGroups],
  };
}

export function sanitizePreferences(value: unknown): ChartPreferences {
  if (!value || typeof value !== 'object') return defaults();
  const input = value as Partial<ChartPreferences>;
  const base = BASE_IDS.includes(input.base as BaseLayerId) ? (input.base as BaseLayerId) : DEFAULT_PREFERENCES.base;
  const overlays = { ...DEFAULT_PREFERENCES.overlays };
  if (input.overlays && typeof input.overlays === 'object') {
    for (const key of Object.keys(overlays) as (keyof OverlayPreferences)[]) {
      const candidate = (input.overlays as unknown as Record<string, unknown>)[key];
      if (typeof candidate === 'boolean') overlays[key] = candidate;
    }
  }
  const theme = THEME_IDS.includes(input.theme as ThemeId) ? (input.theme as ThemeId) : DEFAULT_PREFERENCES.theme;
  return {
    base,
    overlays,
    showPosition: input.showPosition === true,
    theme,
    hiddenGroups: sanitizeHiddenGroups(input.hiddenGroups),
    hiddenPoiGroups: sanitizeHiddenPoiGroups(input.hiddenPoiGroups),
    hiddenAreaGroups: sanitizeHiddenAreaGroups(input.hiddenAreaGroups),
  };
}

export function readChartPreferences(storage: Pick<Storage, 'getItem'> | null | undefined): ChartPreferences {
  if (!storage) return defaults();
  try {
    const raw =
      storage.getItem(CHART_STORAGE_KEY) ??
      LEGACY_CHART_STORAGE_KEYS.map((key) => storage.getItem(key)).find((value) => value !== null);
    if (!raw) return defaults();
    const saved: unknown = JSON.parse(raw);
    const preferences = sanitizePreferences(saved);
    const schema = saved && typeof saved === 'object' ? (saved as { schema?: unknown }).schema : undefined;
    if (typeof schema !== 'number' || schema < CHART_PREFERENCES_SCHEMA) {
      // Older builds saved the overlays off by default, so those stored false
      // values were not an intentional choice. Show both route layers once;
      // schema 2 preferences preserve explicit on/off choices from then on.
      preferences.overlays.ferries = true;
      preferences.overlays.tss = true;
    }
    return preferences;
  } catch {
    return defaults();
  }
}

export function writeChartPreferences(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  preferences: ChartPreferences,
): void {
  if (!storage) return;
  try {
    storage.setItem(CHART_STORAGE_KEY, JSON.stringify({ ...preferences, schema: CHART_PREFERENCES_SCHEMA }));
  } catch {
    // Storage blocked: preferences still apply for this session.
  }
}
