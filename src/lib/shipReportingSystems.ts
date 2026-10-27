import source from '../data/shipReportingSystems.json';

export interface ShipReportingFeature {
  type: 'Feature';
  id: string;
  properties: {
    systemId: string;
    system: string;
    label: string;
    role: 'outer_boundary' | 'inner_atba_boundary' | 'reporting_line' | 'partial_boundary';
    areaName: string;
    sourceCitation: string;
    sourceUrl: string;
    datum: string;
    verifiedAsOf: string;
    geometryNote: string;
  };
  geometry: {
    type: 'LineString';
    /** GeoJSON coordinate order: longitude, latitude. */
    coordinates: [number, number][];
  };
}

export interface ShipReportingDataset {
  schema: 1;
  title: string;
  features: ShipReportingFeature[];
  coverageNotes: {
    systemId: string;
    system: string;
    status: string;
    sourceCitation: string;
    sourceUrl: string;
    datum: string;
    verifiedAsOf: string;
    note: string;
  }[];
}

// Add a new system only alongside its exact authoritative geometry and reviewed
// provenance; a plausible name alone is never enough to make it drawable.
const SUPPORTED_SYSTEM_IDS = new Set(['coral_shiprep', 'gofrep', 'whalesnorth', 'whalessouth', 'gdanrep', 'soundrep', 'mancherep', 'straitrep', 'reef_rep', 'beltrep', 'caldovrep', 'coprep', 'wetrep', 'nordreg', 'ecareg']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Reject incomplete provenance or malformed coordinates instead of drawing guessed data. */
export function validateShipReportingDataset(value: unknown): ShipReportingDataset | null {
  if (!isRecord(value) || value.schema !== 1 || typeof value.title !== 'string' || !Array.isArray(value.features)) {
    return null;
  }
  if (!Array.isArray(value.coverageNotes)) return null;
  const noteIds = new Set<string>();
  for (const note of value.coverageNotes) {
    if (!isRecord(note) || typeof note.systemId !== 'string' || noteIds.has(note.systemId) || typeof note.system !== 'string' || typeof note.status !== 'string' || typeof note.sourceCitation !== 'string' || typeof note.sourceUrl !== 'string' || !note.sourceUrl.startsWith('https://') || typeof note.datum !== 'string' || typeof note.verifiedAsOf !== 'string' || !isCalendarDate(note.verifiedAsOf) || typeof note.note !== 'string') return null;
    noteIds.add(note.systemId);
  }
  const ids = new Set<string>();
  for (const feature of value.features) {
    if (!isRecord(feature) || feature.type !== 'Feature' || typeof feature.id !== 'string' || ids.has(feature.id)) {
      return null;
    }
    ids.add(feature.id);
    const properties = feature.properties;
    if (
      !isRecord(properties) ||
      typeof properties.systemId !== 'string' ||
      !SUPPORTED_SYSTEM_IDS.has(properties.systemId) ||
      typeof properties.system !== 'string' ||
      typeof properties.label !== 'string' ||
      !['outer_boundary', 'inner_atba_boundary', 'reporting_line', 'partial_boundary'].includes(String(properties.role)) ||
      typeof properties.areaName !== 'string' ||
      typeof properties.sourceCitation !== 'string' ||
      typeof properties.sourceUrl !== 'string' ||
      !properties.sourceUrl.startsWith('https://') ||
      typeof properties.datum !== 'string' ||
      typeof properties.verifiedAsOf !== 'string' ||
      !isCalendarDate(properties.verifiedAsOf) ||
      typeof properties.geometryNote !== 'string'
    ) {
      return null;
    }
    const geometry = feature.geometry;
    if (!isRecord(geometry) || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2) {
      return null;
    }
    for (const coordinate of geometry.coordinates) {
      if (
        !Array.isArray(coordinate) ||
        coordinate.length !== 2 ||
        !coordinate.every((number) => typeof number === 'number' && Number.isFinite(number)) ||
        coordinate[0] < -180 || coordinate[0] > 180 ||
        coordinate[1] < -90 || coordinate[1] > 90
      ) {
        return null;
      }
    }
  }
  return value as unknown as ShipReportingDataset;
}

const validated = validateShipReportingDataset(source);
if (!validated) throw new Error('Invalid curated ship-reporting geometry dataset');

export const SHIP_REPORTING_SYSTEMS = validated;
