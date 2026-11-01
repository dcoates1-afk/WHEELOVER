import { describe, expect, it } from 'vitest';
import type { Navaid } from './navaidTypes';
import {
  applyMarkSignals,
  signalCellsForBounds,
  validateSignalCell,
  validateSignalManifest,
  type SignalEntry,
  type SignalManifest,
} from './markSignals';

const manifest: SignalManifest = {
  schema: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
  sourceTimestamp: '2026-11-01T17:34:36Z',
  count: 2,
  fogSignals: 1,
  racons: 1,
  cells: [
    { path: 'signals/51_70.json', bounds: [50, -10, 55, -5], count: 1 },
    { path: 'signals/10_21.json', bounds: [-40, -75, -35, -70], count: 1 },
  ],
};

function mark(overrides: Partial<Navaid> = {}): Navaid {
  return {
    id: 'osm:node/1',
    lat: 50.7,
    lon: -1.55,
    category: 'lateral_port',
    form: 'buoy',
    name: 'Test buoy',
    light: null,
    colour: 'red',
    shape: null,
    height: null,
    range: null,
    path: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    description: null,
    lit: false,
    priority: 60,
    source: 'osm',
    updated: null,
    region: null,
    ...overrides,
  };
}

const bell: SignalEntry = {
  fogSignal: true,
  fogSignalCategory: 'bell',
  fogSignalGroup: '2',
  fogSignalPeriod: '20',
  radarTransponderCategory: 'racon',
  radarTransponderGroup: 'G',
  radarTransponderPeriod: '30',
  lat: 50.7,
  lon: -1.55,
  type: 'buoy_lateral',
};

describe('mark-signal manifest', () => {
  it('accepts a shaped manifest and rejects other schemas', () => {
    expect(validateSignalManifest(manifest)?.cells).toHaveLength(2);
    expect(validateSignalManifest({ ...manifest, schema: 2 })).toBeNull();
    expect(validateSignalManifest({ ...manifest, cells: [] })).toBeNull();
  });

  it('selects only the cells that meet the viewport', () => {
    const cells = signalCellsForBounds(validateSignalManifest(manifest)!, [48, -7, 52, -4])
      .map((cell) => cell.path);
    expect(cells).toEqual(['signals/51_70.json']);
  });
});

describe('mark-signal cell', () => {
  it('keeps a sound signal, keeps a racon, and drops a signal-free entry', () => {
    const cells = validateSignalCell({
      marks: {
        'osm:node/1': { fogSignal: true, fogSignalCategory: 'bell' },
        'osm:node/2': { radarTransponderCategory: 'racon', radarTransponderGroup: 'G' },
        'osm:node/3': { type: 'buoy_lateral' },
      },
    });
    expect([...cells?.keys() ?? []]).toEqual(['osm:node/1', 'osm:node/2']);
    expect(cells?.get('osm:node/2')?.radarTransponderGroup).toBe('G');
  });

  it('rejects a payload without marks', () => {
    expect(validateSignalCell({})).toBeNull();
    expect(validateSignalCell(null)).toBeNull();
  });
});

describe('applying mark signals', () => {
  it('gives a buoy its bell and racon without touching its class', () => {
    const [next] = applyMarkSignals([mark()], new Map([['osm:node/1', bell]]));
    expect(next.category).toBe('lateral_port');
    expect(next.priority).toBe(60);
    expect(next.fogSignal).toBe(true);
    expect(next.fogSignalCategory).toBe('bell');
    expect(next.radarTransponderCategory).toBe('racon');
    expect(next.radarTransponderPeriod).toBe('30');
  });

  it('keeps a mark’s own signal details', () => {
    const own = mark({ fogSignal: true, fogSignalCategory: 'horn', radarTransponderGroup: 'X' });
    const [next] = applyMarkSignals([own], new Map([['osm:node/1', bell]]));
    expect(next.fogSignalCategory).toBe('horn');
    expect(next.radarTransponderGroup).toBe('X');
  });

  it('returns the same array when nothing is missing or nothing matches', () => {
    const marks = [mark({ fogSignal: true, radarTransponderCategory: 'racon' })];
    expect(applyMarkSignals(marks, new Map([['osm:node/1', bell]]))).toBe(marks);
    expect(applyMarkSignals(marks, new Map())).toBe(marks);
    expect(applyMarkSignals([mark()], new Map([['osm:node/9', bell]]))[0]).toEqual(mark());
  });
});
