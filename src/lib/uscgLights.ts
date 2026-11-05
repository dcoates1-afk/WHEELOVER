import type { Navaid } from './navaidTypes';
import { priorityFor } from '../../shared/navaid-core.mjs';

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
  return {
    id: `uscg:${record.v}:${record.no}`,
    lat: record.lat,
    lon: record.lon,
    category: 'light',
    form: 'light',
    name: record.name,
    light: record.light,
    lightCharacter: record.character,
    lightColour: record.colour,
    lightPeriod: record.period,
    lightGroup: record.group,
    colour: null,
    shape: null,
    height: record.focal,
    range: record.range,
    description: record.desc,
    lit: true,
    priority: priorityFor('light'),
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

let cache: Promise<UscgLightRecord[]> | null = null;

/** The seven Light List volumes, each served as its own dataset file. */
export const USCG_VOLUMES = ['01', '02', '03', '04', '05', '06', '07'];

/**
 * Fetch the USCG datasets once and combine them. The supplement is optional,
 * so a failed volume is skipped (the rest still load) and a total failure
 * yields [].
 */
export function loadUscgLights(): Promise<UscgLightRecord[]> {
  if (!cache) {
    cache = Promise.all(
      USCG_VOLUMES.map((volume) =>
        fetch(`/uscg-lights-${volume}.json`)
          .then((res) => {
            if (!res.ok) throw new Error(`USCG lights ${volume} HTTP ${res.status}`);
            return res.json() as Promise<UscgLightsFile>;
          })
          .then((file) => file.records ?? [])
          .catch(() => [] as UscgLightRecord[]),
      ),
    ).then((volumes) => volumes.flat());
  }
  return cache;
}
