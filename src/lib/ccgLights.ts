import type { Navaid } from './navaidTypes';
import { priorityFor } from '../../shared/navaid-core.mjs';
import { classifyOfficialMark } from './officialMarkClassification';

/** One row of the CCG List of Lights dataset (public/ccg-lights.json). */
export interface CcgLightRecord {
  volume: string;
  no: string;
  intlNo: string | null;
  name: string;
  racon: string | null;
  location: string | null;
  lat: number;
  lon: number;
  character: string | null;
  colour: string | null;
  period: string | null;
  light: string;
  focalHeight: string | null;
  range: string | null;
  description: string | null;
  structureHeight: string | null;
  remarks: string | null;
  sourceUrl: string;
}

interface CcgLightsFile {
  records: CcgLightRecord[];
}

/** A CCG light as a chart mark: official source, merged downstream by id/position. */
export function ccgRecordToNavaid(record: CcgLightRecord): Navaid {
  const description = [record.location, record.description].filter(Boolean).join(' · ') || null;
  // The name and structure text say what the aid physically is; a buoy
  // named as one must not render as a minor light standing on nothing.
  const markClass = classifyOfficialMark({
    name: record.name,
    description: record.description,
    lightColour: record.colour,
    lit: Boolean(record.colour || record.character || record.light),
  });
  return {
    id: `ccg:${record.volume}:${record.no}`,
    lat: record.lat,
    lon: record.lon,
    category: markClass.category,
    form: markClass.form,
    name: record.name,
    light: record.light,
    lightCharacter: record.character,
    lightColour: record.colour,
    lightPeriod: record.period,
    colour: markClass.colour,
    shape: markClass.shape,
    height: record.focalHeight,
    range: record.range,
    description,
    lit: true,
    priority: priorityFor(markClass.category),
    source: 'ccg',
    sourceCitation: 'CCG List of Lights, Buoys and Fog Signals',
    sourceUrl: record.sourceUrl,
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

let cache: Promise<CcgLightRecord[]> | null = null;

/** Fetch the CCG dataset once; the supplement is optional, so a failed load yields []. */
export function loadCcgLights(): Promise<CcgLightRecord[]> {
  if (!cache) {
    cache = fetch('/ccg-lights.json')
      .then((res) => {
        if (!res.ok) throw new Error(`CCG lights HTTP ${res.status}`);
        return res.json() as Promise<CcgLightsFile>;
      })
      .then((file) => file.records ?? [])
      .catch(() => []);
  }
  return cache;
}
