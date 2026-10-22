import { sanitizeHiddenGroups } from './navaidGroups';
import { sanitizeHiddenPoiGroups } from './poiGroups';

export type BaseLayerId = 'osm' | 'satellite' | 'nautical' | 'relief' | 'noaa' | 'rnc';
export type ThemeId = 'day' | 'night' | 'red';
export interface OverlayPreferences {
  openseamap: boolean;
  navaids: boolean;
  ferries: boolean;
  tss: boolean;
  ais: boolean;
  contours: boolean;
  soundings: boolean;
  depthLabels: boolean;
  pois: boolean;
}

export interface ChartPreferences {
  base: BaseLayerId;
  overlays: OverlayPreferences;
  showAllMarks: boolean;
  showPosition: boolean;
  theme: ThemeId;
  /** NAVAID legend groups the user switched off. */
  hiddenGroups: string[];
  /** Public-place groups the user switched off. */
  hiddenPoiGroups: string[];
}

export const CHART_STORAGE_KEY = 'wheel-over:chart-prefs';
/** Preferences from earlier LEEWARD/MARNAV builds remain available after the rename. */
const LEGACY_CHART_STORAGE_KEYS = ['leeward:chart-prefs', 'marnav:chart-prefs'] as const;

export const DEFAULT_PREFERENCES: ChartPreferences = {
  base: 'osm',
  overlays: {
    openseamap: true,
    navaids: true,
    ferries: false,
    tss: false,
    ais: true,
    contours: false,
    soundings: false,
    depthLabels: false,
    pois: false,
  },
  showAllMarks: false,
  showPosition: false,
  theme: 'day',
  hiddenGroups: [],
  hiddenPoiGroups: [],
};

const BASE_IDS: BaseLayerId[] = ['osm', 'satellite', 'nautical', 'relief', 'noaa', 'rnc'];
const THEME_IDS: ThemeId[] = ['day', 'night', 'red'];

function defaults(): ChartPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    overlays: { ...DEFAULT_PREFERENCES.overlays },
    hiddenGroups: [...DEFAULT_PREFERENCES.hiddenGroups],
    hiddenPoiGroups: [...DEFAULT_PREFERENCES.hiddenPoiGroups],
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
    showAllMarks: input.showAllMarks === true,
    showPosition: input.showPosition === true,
    theme,
    hiddenGroups: sanitizeHiddenGroups(input.hiddenGroups),
    hiddenPoiGroups: sanitizeHiddenPoiGroups(input.hiddenPoiGroups),
  };
}

export function readChartPreferences(storage: Pick<Storage, 'getItem'> | null | undefined): ChartPreferences {
  if (!storage) return defaults();
  try {
    const raw =
      storage.getItem(CHART_STORAGE_KEY) ??
      LEGACY_CHART_STORAGE_KEYS.map((key) => storage.getItem(key)).find((value) => value !== null);
    if (!raw) return defaults();
    return sanitizePreferences(JSON.parse(raw));
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
    storage.setItem(CHART_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Storage blocked: preferences still apply for this session.
  }
}
