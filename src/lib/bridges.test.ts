import { describe, expect, it } from 'vitest';
import { describeBridge, measuredMetres } from './bridges';

const johnsonStreet = {
  name: 'Johnson Street',
  sourceUrl: 'https://www.openstreetmap.org/way/1234',
  properties: {
    'bridge:name': 'Johnson Street Bridge',
    'water crossed': 'Gorge Waterway',
    bridge: 'movable',
    'bridge:movable': 'bascule',
    'seamark:bridge:clearance_height': '4.5',
    'seamark:bridge:clearance_width': '30',
    highway: 'primary',
    operator: 'City of Victoria',
    maxweight: '20',
    wikidata: 'Q123456',
    wikipedia: 'en:Johnson Street Bridge',
    surface: 'asphalt',
  },
};

describe('bridge card', () => {
  it('shows lights mapped on the bridge itself', () => {
    const card = describeBridge({
      name: 'Lit Bridge',
      properties: {
        bridge: 'yes',
        highway: 'footway',
        'seamark:light:character': 'Fl',
        'seamark:light:colour': 'R',
        'seamark:light:period': '4',
        'seamark:light:1:character': 'Oc',
        'seamark:light:1:colour': 'G',
        'seamark:light:1:period': '6',
      },
    }, { depth: 'm', distance: 'm-nm' });
    const lights = card.sections.find((section) => section.title === 'Lights');
    expect(lights?.rows).toContainEqual({ label: 'Light', value: 'Fl R 4s; Oc G 6s' });
    // Light keys are shown, so they must not also spill into Other detail.
    const other = card.sections.find((section) => section.title === 'Other mapped detail');
    expect(other?.rows.some((row) => row.label.startsWith('Seamark light'))).toBe(false);
  });

  it('names the bridge and the water it crosses', () => {
    const card = describeBridge(johnsonStreet, { depth: 'm', distance: 'm-nm' });
    expect(card.title).toBe('Johnson Street Bridge');
    expect(card.subtitle).toBe('Bascule bridge');
    expect(card.facts).toContainEqual({ label: 'Crosses', value: 'Gorge Waterway' });
    expect(card.facts).toContainEqual({ label: 'Operation', value: 'Raising' });
  });

  it('reads the operation as Fixed, Raising, Rotating or Movable', () => {
    const operation = (properties: Record<string, string>) =>
      describeBridge({ name: 'Bridge', properties }, { depth: 'm', distance: 'm-nm' }).facts.find(
        (row) => row.label === 'Operation',
      )?.value;
    expect(operation({ 'bridge:movable': 'bascule' })).toBe('Raising');
    expect(operation({ 'bridge:movable': 'lift' })).toBe('Raising');
    expect(operation({ 'bridge:movable': 'swing' })).toBe('Rotating');
    expect(operation({ 'bridge:movable': 'transporter' })).toBe('Movable');
    expect(operation({ bridge: 'viaduct' })).toBe('Fixed');
    expect(operation({})).toBe('Fixed');
  });

  it('puts the clearances in the units chosen in Settings', () => {
    const card = describeBridge(johnsonStreet, { depth: 'ft', distance: 'nm-ft' });
    expect(card.facts).toContainEqual({ label: 'Vertical clearance', value: '15 ft (datum not stated)' });
    expect(card.facts).toContainEqual({ label: 'Horizontal clearance', value: '98 ft' });
  });

  it('groups the record into sections instead of a raw tag dump', () => {
    const card = describeBridge(johnsonStreet, { depth: 'm', distance: 'm-nm' });
    const titles = card.sections.map((section) => section.title);
    expect(titles).toEqual([
      'Structure and operator',
      'Carrying',
      'Restrictions and access',
      'Other mapped detail',
    ]);
    const structure = card.sections[0].rows.map((row) => `${row.label}=${row.value}`);
    expect(structure).toContain('Operator=City of Victoria');
    expect(structure).toContain('Movable type=bascule');
    const restrictions = card.sections[2].rows.map((row) => `${row.label}=${row.value}`);
    expect(restrictions).toContain('Max weight=20');
  });

  it('links the record and its encyclopaedia entries', () => {
    const card = describeBridge(johnsonStreet, { depth: 'm', distance: 'm-nm' });
    expect(card.links.map((link) => link.url)).toEqual([
      'https://www.openstreetmap.org/way/1234',
      'https://www.wikidata.org/wiki/Q123456',
      'https://en.wikipedia.org/wiki/Johnson_Street_Bridge',
    ]);
  });

  it('links every mapped record folded into one card', () => {
    const card = describeBridge(
      {
        name: 'Test Bridge',
        sourceUrl: 'https://www.openstreetmap.org/way/1',
        sourceUrls: ['https://www.openstreetmap.org/way/1', 'https://www.openstreetmap.org/way/2'],
        properties: {},
      },
      { depth: 'm', distance: 'm-nm' },
    );
    expect(card.links.map((link) => link.url)).toEqual([
      'https://www.openstreetmap.org/way/1',
      'https://www.openstreetmap.org/way/2',
    ]);
  });

  it('shows every distinct clearance when records disagree', () => {
    const card = describeBridge(
      {
        name: 'Test Bridge',
        properties: { 'seamark:bridge:clearance_height': '5.2 / 4.8' },
      },
      { depth: 'm', distance: 'm-nm' },
    );
    expect(card.facts).toContainEqual({ label: 'Vertical clearance', value: '5.2 m / 4.8 m (datum not stated)' });
  });

  it('shows authority clearances with their datum first', () => {
    const card = describeBridge(
      {
        name: 'Test Bridge',
        properties: {},
        clearances: [
          { source: 'NOAA ENC', values: [62.1, 67.0], closed: false, openValues: [], horizontal: null, datum: 'MHW', datumNote: null, retrieved: '2026-11-02' },
          { source: 'USACE Inland ENC', values: [13.9], closed: false, openValues: [], horizontal: 120.3, datum: null, datumNote: null, retrieved: '2026-11-02' },
          { source: 'EuRIS', values: [9], closed: true, openValues: [], horizontal: null, datum: null, datumNote: null, retrieved: '2026-11-02' },
        ],
      },
      { depth: 'm', distance: 'm-nm' },
    );
    const charted = card.sections.find((section) => section.title === 'Charted clearances');
    expect(charted?.rows).toContainEqual({ label: 'NOAA ENC', value: '62 m / 67 m above MHW' });
    expect(charted?.rows).toContainEqual({ label: 'USACE Inland ENC', value: '14 m (datum not stated) · width 120 m' });
    expect(charted?.rows).toContainEqual({ label: 'EuRIS', value: '9.0 m (datum not stated), closed' });
    expect(charted?.rows).toContainEqual({ label: 'Dataset', value: 'Retrieved 2026-11-02' });
    expect(card.links.map((link) => link.label)).toContain('Clearance disclaimer');
  });

  it('keeps a bridge with no extra tags readable', () => {
    const card = describeBridge({ name: 'Bridge', properties: {} }, { depth: 'm', distance: 'm-nm' });
    expect(card.title).toBe('Bridge');
    expect(card.subtitle).toBe('Bridge');
    expect(card.facts).toEqual([
      { label: 'Vertical clearance', value: 'No charted clearance on record — check the chart' },
      { label: 'Operation', value: 'Fixed' },
    ]);
    expect(card.sections).toEqual([]);
  });

  it('reads maxheight as a road-vehicle limit in Restrictions, never as a clearance', () => {
    // The MacKay/Macdonald bug: maxheight is the height of road vehicles
    // allowed ON the deck, not the space under the bridge.
    const card = describeBridge({
      name: 'Macdonald Bridge',
      properties: { bridge: 'suspension', highway: 'primary', maxheight: '4', maxweight: '3.2' },
    }, { depth: 'm', distance: 'm-nm' });
    const restrictions = card.sections.find((section) => section.title === 'Restrictions and access');
    expect(restrictions?.rows).toContainEqual({
      label: 'Road vehicle height limit',
      value: '4.0 m — height of vehicles allowed on the bridge, not the space under it',
    });
    // It must not appear in the clearance section (which is absent entirely
    // for this bridge, since it has no clearance rows at all).
    const clearance = card.sections.find((section) => section.title === 'Air and water draught');
    expect(clearance?.rows.some((row) => row.label === 'Maximum height' || row.label === 'Road vehicle height limit') ?? false).toBe(false);
    expect(card.facts.some((row) => row.label === 'Vertical clearance' && row.value.includes('4 m'))).toBe(false);
  });

  it('reads the OSM height tag as Structure height', () => {
    const card = describeBridge({
      name: 'Bridge',
      properties: { bridge: 'suspension', height: '102.9' },
    }, { depth: 'm', distance: 'm-nm' });
    const structure = card.sections.find((section) => section.title === 'Structure and operator');
    expect(structure?.rows).toContainEqual({ label: 'Structure height', value: '103 m' });
    expect(structure?.rows.some((row) => row.label === 'Height')).toBe(false);
  });

  it('shows an explicit no-clearance state when no clearance is on record', () => {
    const card = describeBridge({
      name: 'Macdonald Bridge',
      properties: { bridge: 'suspension', highway: 'primary', maxheight: '4' },
    }, { depth: 'm', distance: 'm-nm' });
    expect(card.facts).toContainEqual({
      label: 'Vertical clearance',
      value: 'No charted clearance on record — check the chart',
    });
  });

  it('does not show the no-clearance state when a seamark clearance exists', () => {
    const card = describeBridge({
      name: 'Bridge',
      properties: { bridge: 'yes', 'seamark:bridge:clearance_height': '4.5' },
    }, { depth: 'm', distance: 'm-nm' });
    expect(card.facts).toContainEqual({ label: 'Vertical clearance', value: '4.5 m (datum not stated)' });
    expect(card.facts.some((row) => row.value.includes('No charted clearance'))).toBe(false);
  });

  it('reads imperial measurements as feet and metres as metres', () => {
    expect(measuredMetres('4.5')).toBeCloseTo(4.5);
    expect(measuredMetres("16'6\"")).toBeCloseTo(5.03, 1);
    expect(measuredMetres('20 ft')).toBeCloseTo(6.096);
    expect(measuredMetres('unmapped')).toBeNull();
    expect(measuredMetres(undefined)).toBeNull();
  });
});
