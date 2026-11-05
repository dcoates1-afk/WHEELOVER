// Regression tests for the worldwide bridge fix (Nov 5, 2026): phantom
// bridges reported in two Halifax screenshots. The fixtures are the saved
// Overpass cell dumps for those views — no live fetch in tests, the
// mirrors are flaky. The eight cards across the two views must resolve to
// one: the Angus L. MacDonald Bridge stays, the other seven go.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bridgeCrossesWater, chartFeaturesFromElements } from './overpass';

const load = (name: string): any[] => JSON.parse(readFileSync(`src/lib/__fixtures__/${name}`, 'utf8'));
const elements = [...load('halifax-cell-south.json'), ...load('halifax-cell-north.json')];
const byId = new Map(elements.map((e: any) => [`${e.type}/${e.id}`, e] as [string, any]));
const el = (id: string): any => byId.get(`way/${id}`);

describe('Halifax phantom bridges', () => {
  it('resolves the 8 cards to 1: MacDonald stays, the other 7 go', () => {
    const { bridges } = chartFeaturesFromElements(elements as never);
    expect(bridges).toHaveLength(1);
    expect(bridges[0].id).toBe('osm:way/1449662840');
    expect(bridges[0].name).toBe('Angus L. MacDonald Bridge');
    // None of the phantom elements may produce a card.
    const cardIds = new Set(bridges.map((b) => b.id));
    for (const phantom of [
      'osm:way/4794155', 'osm:way/1431572723', 'osm:way/1181389003',
      'osm:way/1545275868', 'osm:way/1102749789', 'osm:way/84186286',
      'osm:way/511172150', 'osm:way/922255632',
    ]) {
      expect(cardIds.has(phantom)).toBe(false);
    }
  }, 30000);

  it('fails the water test for every phantom element', () => {
    // 1. Salter Boardwalk: a 207 m boardwalk weaving in/out of the harbour
    //    (penetration 31 m, ~15% of its run). 2-3. Dockyard steps and the
    //    Halifax Link steps: steps get the strict span test. 4. Purdy's
    //    named man_made=bridge outline: no carrying way, strict. 5. The
    //    Dartmouth Subdivision rail way: a chord across the tip of Dartmouth
    //    Cove, not a channel. 6. The Telford Bridge: the same tip chord.
    //    7. Bridge of Courage: spans a dammed reach the straight-line
    //    tidal test used to count.
    for (const id of [
      '4794155', '1431572723', '1181389003', '1545275868',
      '84186286', '511172150', '922255632',
    ]) {
      expect(bridgeCrossesWater(el(id), elements as never)).toBe(false);
    }
    // The rail's bare outline (1102749789) DOES cross the Sawmill River
    // outlet, so it passes the water test on its own — but it is a bare
    // outline (no name, no carrying way), so the evidenced filter drops
    // it and no card is produced. That is covered by the 8-to-1 test above.
    // The real bridge still passes.
    expect(bridgeCrossesWater(el('1449662840'), elements as never)).toBe(true);
  });

  it('keeps the two unnamed goods_conveyor outlines dropped', () => {
    const { bridges } = chartFeaturesFromElements(elements as never);
    const cardIds = new Set(bridges.map((b) => b.id));
    expect(cardIds.has('osm:way/1006902273')).toBe(false);
    expect(cardIds.has('osm:way/1448116815')).toBe(false);
  });

  it('keeps the Telford siblings, the dam bridge and all 12 Halifax Link footways dropped', () => {
    const halifaxLinkFootways = elements
      .filter((e: any) => e.tags?.name === 'Halifax Link' && e.tags?.highway === 'footway')
      .map((e: any) => String(e.id));
    expect(halifaxLinkFootways).toHaveLength(12);
    for (const id of [...halifaxLinkFootways, '1102749787', '1102749788', '266860025']) {
      expect(bridgeCrossesWater(el(id), elements as never)).toBe(false);
    }
  });
});

describe('real bridges survive the strict test', () => {
  it('keeps a real stepped footbridge over a river', () => {
    // A steps way crossing a tidal river centreline squarely: it genuinely
    // spans, so fix 1 (steps get the strict test) must not drop it.
    expect(bridgeCrossesWater(
      { type: 'way', tags: { bridge: 'yes', highway: 'steps' }, geometry: [{ lat: 51.0005, lon: -1.001 }, { lat: 51.0005, lon: -0.9996 }] },
      [{ type: 'way', tags: { waterway: 'river', tidal: 'yes' }, geometry: [{ lat: 51, lon: -1.0003 }, { lat: 51.001, lon: -1.0003 }] }],
    )).toBe(true);
  });

  it('keeps a real outline-only bridge that genuinely spans', () => {
    // A named man_made=bridge outline as a long thin deck rectangle from
    // one shore of a bay to the other: it genuinely spans, so fix 3 (no
    // carrying way, strict) must not drop it.
    const bay = {
      type: 'way' as const,
      tags: { natural: 'bay', name: 'Test Bay' },
      geometry: [
        { lat: 50.0, lon: -1.002 }, { lat: 50.0, lon: -1.0 },
        { lat: 50.002, lon: -1.0 }, { lat: 50.002, lon: -1.002 }, { lat: 50.0, lon: -1.002 },
      ],
    };
    expect(bridgeCrossesWater(
      {
        type: 'way', tags: { man_made: 'bridge', layer: '1', name: 'Test Bridge' },
        geometry: [
          { lat: 50.0009, lon: -1.0025 }, { lat: 50.0009, lon: -0.9995 },
          { lat: 50.0011, lon: -0.9995 }, { lat: 50.0011, lon: -1.0025 }, { lat: 50.0009, lon: -1.0025 },
        ],
      },
      [bay],
    )).toBe(true);
  });
});
