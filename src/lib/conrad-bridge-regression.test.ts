// Regression tests for the Conrad Bridge fix (Nov 5, 2026): the G. Fraser
// Conrad Bridge (way/382466711, cable-stayed cycleway over Lake Banook) is a
// real bridge the app did not show at all, because Lake Banook's polygon
// (water=lake) was never fetched by the bridge water selector and never kept
// by the water filter. The fixture is the live cell response for the 0.05
// degree cell around the bridge, fetched with the app's own post-fix query —
// no live fetch in tests, the mirrors are flaky.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chartFeaturesFromElements } from './overpass';

const load = (name: string): any[] => JSON.parse(readFileSync(`src/lib/__fixtures__/${name}`, 'utf8'));
const elements = load('conrad-lake-banook.json');

describe('Conrad Bridge over Lake Banook', () => {
  it('shows the four real bridges in the cell, and only those four', () => {
    const { bridges } = chartFeaturesFromElements(elements as never);
    expect(bridges).toHaveLength(4);
    const byId = new Map(bridges.map((b) => [b.id, b]));
    // The Angus L. MacDonald Bridge stays, over the harbour.
    expect(byId.get('osm:way/1449662840')?.name).toBe('Angus L. MacDonald Bridge');
    expect(byId.get('osm:way/1449662840')?.properties['water crossed']).toBe('Halifax Harbour');
    // The Conrad Bridge itself, over Lake Banook.
    expect(byId.get('osm:way/382466711')?.name).toBe('G. Fraser Conrad Bridge');
    expect(byId.get('osm:way/382466711')?.properties['water crossed']).toBe('Lake Banook');
    // Highway 111's bridge over the lake's north arm, by its outline's name.
    expect(byId.get('osm:way/24962203')?.name).toBe('Lake Micmac Bridge');
    expect(byId.get('osm:way/24962203')?.properties['water crossed']).toBe('Lake Banook');
    // The Banook Pedestrian Bridge over the dam at the lake's south end.
    expect(byId.get('osm:way/266860025')?.properties['water crossed']).toBe('Lake Banook');
  }, 30000);

  it('shows one card per bridge, not one per mapped record', () => {
    // The Conrad Bridge is mapped twice — the trail way and the structure
    // outline — and so is the Highway 111 bridge. Each pair must fold to a
    // single card titled for the bridge, not two cards for one crossing.
    const { bridges } = chartFeaturesFromElements(elements as never);
    const ids = new Set(bridges.map((b) => b.id));
    expect(ids.has('osm:way/557834445')).toBe(false);
    expect(ids.has('osm:way/557827810')).toBe(false);
    const conrad = bridges.filter((b) => b.name === 'G. Fraser Conrad Bridge');
    expect(conrad).toHaveLength(1);
    const micmac = bridges.filter((b) => b.name === 'Lake Micmac Bridge');
    expect(micmac).toHaveLength(1);
  }, 30000);

  it('keeps the Halifax phantoms in this cell dropped', () => {
    // The lake must not resurrect anything the November fix dropped: the
    // dockyard steps, the Halifax Link steps, Purdy's outline, the rail
    // chord, the Telford tip chord and the Bridge of Courage all stay out,
    // and so does the unnamed trail way by the dam, which does not span
    // the lake.
    const { bridges } = chartFeaturesFromElements(elements as never);
    const cardIds = new Set(bridges.map((b) => b.id));
    for (const phantom of [
      'osm:way/1431572723', 'osm:way/1181389003', 'osm:way/1545275868',
      'osm:way/1102749789', 'osm:way/84186286', 'osm:way/511172150',
      'osm:way/922255632', 'osm:way/1346941371',
    ]) {
      expect(cardIds.has(phantom)).toBe(false);
    }
  }, 30000);
});
