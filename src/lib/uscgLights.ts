import type { Navaid } from './navaidTypes';
import { boundsIntersect, type Bounds } from './geo';
import { USCG_VOLUMES, USCG_VOLUME_BOUNDS } from './lightCoverage.generated';
import { priorityFor } from '../../shared/navaid-core.mjs';
import { classifyOfficialMark } from './officialMarkClassification';

/** One row of a USCG Light List dataset file (public/uscg-lights-<volume>.json). */
export interface UscgLightRecord {
  v: string;
  no: number;
  name: string | null;
  lat: number;
  lon: number;
  light: string;
  character: string | null;
  colour: string | null;
  period: string | null;
  group: string | null;
  range: string | null;
  focal: string | null;
  desc: string | null;
  src: string;
}

interface UscgLightsFile {
  records: UscgLightRecord[];
}

/** A USCG light as a chart mark: official source, merged downstream by id/position. */
export function uscgRecordToNavaid(record: UscgLightRecord): Navaid {
  // The name and desc text say what the aid physically is; a buoy named
  // as one must not render as a minor light standing on nothing.
  const markClass = classifyOfficialMark({
    name: record.name,
    description: record.desc,
    lightColour: record.colour,
    lit: Boolean(record.colour || record.character || record.light),
  });
  return {
    id: `uscg:${record.v}:${record.no}`,
    lat: record.lat,
    lon: record.lon,
    category: markClass.category,
    form: markClass.form,
    name: record.name,
    light: record.light,
    lightCharacter: record.character,
    lightColour: record.colour,
    lightPeriod: record.period,
    lightGroup: record.group,
    colour: markClass.colour,
    shape: markClass.shape,
    height: record.focal,
    range: record.range,
    description: record.desc,
    lit: true,
    priority: priorityFor(markClass.category),
    source: 'uscg',
    sourceCitation: 'USCG Light List',
    sourceUrl: `https://navcen.uscg.gov/sites/default/files/msi/${record.src}`,
    path: null,
    paths: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    updated: null,
    region: null,
  };
}

// The volume list and coverage boxes are derived from the shipped datasets by
// scripts/build-light-bounds.mjs, so a rebuilt dataset cannot leave the gate
// pointing at the geography it used to have. src/lib/uscgLights.test.ts still
// re-derives them, which catches a stale generated file.
export { USCG_VOLUMES, USCG_VOLUME_BOUNDS };

/** Load a volume just before its marks scroll in, rather than while they do. */
const VOLUME_PAD_DEG = 0.5;

/** The volumes that can contribute a mark to this view. */
export function uscgVolumesForBounds(view: Bounds, pad = VOLUME_PAD_DEG): string[] {
  const padded: Bounds = [view[0] - pad, view[1] - pad, view[2] + pad, view[3] + pad];
  return USCG_VOLUMES.filter((volume) =>
    (USCG_VOLUME_BOUNDS[volume] ?? []).some((box) => boundsIntersect(padded, box)),
  );
}

/** One in-flight or settled request per volume, so panning back costs nothing. */
const cache = new Map<string, Promise<UscgLightRecord[]>>();

function loadUscgVolume(volume: string): Promise<UscgLightRecord[]> {
  const pending = cache.get(volume);
  if (pending) return pending;
  const request = fetch(`/uscg-lights-${volume}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`USCG lights ${volume} HTTP ${res.status}`);
      return res.json() as Promise<UscgLightsFile>;
    })
    .then((file) => file.records ?? [])
    .catch(() => [] as UscgLightRecord[]);
  cache.set(volume, request);
  return request;
}

/**
 * Fetch the requested volumes and combine them, defaulting to all seven. The
 * supplement is optional, so a failed volume is skipped (the rest still load)
 * and a total failure yields [].
 */
export function loadUscgLights(volumes: string[] = USCG_VOLUMES): Promise<UscgLightRecord[]> {
  return Promise.all(volumes.map(loadUscgVolume)).then((batches) => batches.flat());
}
