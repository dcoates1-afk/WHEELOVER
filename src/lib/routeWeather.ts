import type { WeatherReport } from './weather';

/**
 * Route weather verdict. It FLAGS conditions against the confirmed bands;
 * it never certifies a route safe. The worst factor wins, and the verdict
 * names the factors driving a Caution or No-go. A factor with no usable
 * data is excluded and named — never assumed calm.
 *
 * Confirmed bands (Doug, Nov 4):
 *   Go:      wind <15 kn, gusts <20 kn, waves <1 m, visibility >5 NM.
 *   Caution: wind <=25 kn, gusts <=30 kn, waves <=2 m, visibility >=2 NM.
 *   No-go:   anything beyond Caution.
 */

export type WeatherVerdictLevel = 'go' | 'caution' | 'nogo';

export interface WeatherVerdictFactor {
  name: 'Wind' | 'Gusts' | 'Waves' | 'Visibility';
  level: WeatherVerdictLevel | 'unknown';
  /** Display value, already in verdict units, or null when no data. */
  display: string | null;
}

export interface WeatherVerdict {
  level: WeatherVerdictLevel;
  /** Factors at the worst level — the ones driving a Caution or No-go. */
  drivers: string[];
  /** Factors with no usable data; excluded from the verdict. */
  unknown: string[];
  factors: WeatherVerdictFactor[];
}

export const METRES_PER_NAUTICAL_MILE = 1852;

function windLevel(kn: number): WeatherVerdictLevel {
  if (kn < 15) return 'go';
  if (kn <= 25) return 'caution';
  return 'nogo';
}

function gustLevel(kn: number): WeatherVerdictLevel {
  if (kn < 20) return 'go';
  if (kn <= 30) return 'caution';
  return 'nogo';
}

function waveLevel(metres: number): WeatherVerdictLevel {
  if (metres < 1) return 'go';
  if (metres <= 2) return 'caution';
  return 'nogo';
}

function visibilityLevel(nm: number): WeatherVerdictLevel {
  if (nm > 5) return 'go';
  if (nm >= 2) return 'caution';
  return 'nogo';
}

export interface VerdictConditions {
  windKn: number | null;
  gustsKn: number | null;
  wavesM: number | null;
  visibilityNm: number | null;
}

const RANK: Record<WeatherVerdictLevel, number> = { go: 0, caution: 1, nogo: 2 };

export function verdictForConditions(conditions: VerdictConditions): WeatherVerdict {
  const factors: WeatherVerdictFactor[] = [
    {
      name: 'Wind',
      level: conditions.windKn === null ? 'unknown' : windLevel(conditions.windKn),
      display: conditions.windKn === null ? null : `${Math.round(conditions.windKn)} kn`,
    },
    {
      name: 'Gusts',
      level: conditions.gustsKn === null ? 'unknown' : gustLevel(conditions.gustsKn),
      display: conditions.gustsKn === null ? null : `${Math.round(conditions.gustsKn)} kn`,
    },
    {
      name: 'Waves',
      level: conditions.wavesM === null ? 'unknown' : waveLevel(conditions.wavesM),
      display: conditions.wavesM === null ? null : `${conditions.wavesM.toFixed(1)} m`,
    },
    {
      name: 'Visibility',
      level: conditions.visibilityNm === null ? 'unknown' : visibilityLevel(conditions.visibilityNm),
      display: conditions.visibilityNm === null ? null : `${conditions.visibilityNm.toFixed(1)} NM`,
    },
  ];
  const known = factors.filter((factor) => factor.level !== 'unknown');
  let level: WeatherVerdictLevel = 'go';
  for (const factor of known) {
    if (factor.level !== 'unknown' && RANK[factor.level] > RANK[level]) level = factor.level;
  }
  // No usable data at all: never claim Go on nothing.
  if (known.length === 0) level = 'caution';
  // Drivers only exist for Caution and No-go: a Go verdict has no drivers.
  const drivers =
    level === 'go' ? [] : factors.filter((factor) => factor.level === level).map((factor) => factor.name);
  const unknown = factors.filter((factor) => factor.level === 'unknown').map((factor) => factor.name);
  return { level, drivers, unknown, factors };
}

/**
 * Verdict from a fetched report, using current-hour conditions (the first
 * point of each series) — the same convention the weather panel shows.
 * Visibility arrives in metres and is converted to nautical miles here.
 */
export function verdictForReport(report: WeatherReport): WeatherVerdict {
  const first = (series: { value: number }[]): number | null => series[0]?.value ?? null;
  const visibilityM = first(report.visibility);
  return verdictForConditions({
    windKn: first(report.wind),
    gustsKn: first(report.gusts),
    wavesM: first(report.waves),
    visibilityNm: visibilityM === null ? null : visibilityM / METRES_PER_NAUTICAL_MILE,
  });
}
