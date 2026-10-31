import { describe, expect, it } from 'vitest';
import type { AisVessel } from './ais';
import {
  VESSEL_KIND_COLOURS,
  courseLabel,
  dimensionsLabel,
  draughtLabel,
  navStatusLabel,
  selectedVesselLabelHtml,
  speedLabel,
  vesselIconSize,
  vesselIconSvg,
  vesselIsMoving,
  vesselKind,
  vesselMotion,
  vesselStatusColour,
  vesselTooltipHtml,
} from './aisVessel';

function vessel(overrides: Partial<AisVessel> = {}): AisVessel {
  return {
    mmsi: 232001234,
    name: 'RED JET 6',
    lat: 50.795,
    lon: -1.29,
    sog: 21.4,
    cog: 205,
    heading: 203,
    shipType: 'Passenger',
    typeCode: 60,
    destination: 'PORTSMOUTH',
    navStatus: 0,
    callSign: 'MABC1',
    imo: 9_123_456,
    draught: 2.4,
    length: 40,
    beam: 10,
    eta: '14 Jun 22:00 UTC',
    transponder: 'A',
    lastSeen: Date.now() - 45_000,
    staticAt: Date.now() - 600_000,
    simulated: false,
    ...overrides,
  };
}

describe('AIS vessel presentation', () => {
  it('classifies by AIS type code', () => {
    const cases: [number, ReturnType<typeof vesselKind>][] = [
      [70, 'cargo'],
      [80, 'tanker'],
      [60, 'passenger'],
      [40, 'highspeed'],
      [30, 'fishing'],
      [52, 'tug'],
      [36, 'sailing'],
      [37, 'pleasure'],
      [55, 'law'],
      [35, 'military'],
      [90, 'other'],
    ];
    for (const [code, kind] of cases) {
      expect(vesselKind(vessel({ typeCode: code, shipType: null }))).toBe(kind);
    }
  });

  it('falls back to the reported label when no type code arrived', () => {
    expect(vesselKind(vessel({ typeCode: null, shipType: 'Cargo' }))).toBe('cargo');
    expect(vesselKind(vessel({ typeCode: null, shipType: 'Towing (large)' }))).toBe('tug');
    expect(vesselKind(vessel({ typeCode: null, shipType: null }))).toBe('unknown');
  });

  it('gives the main classes distinct colours', () => {
    const colours = ['cargo', 'tanker', 'passenger', 'fishing', 'sailing'] as const;
    const used = colours.map((kind) => VESSEL_KIND_COLOURS[kind]);
    expect(new Set(used).size).toBe(used.length);
  });

  it('names the navigational status, falling back to speed', () => {
    expect(navStatusLabel(0)).toBe('Under way using engine');
    expect(navStatusLabel(1)).toBe('At anchor');
    expect(navStatusLabel(5)).toBe('Moored');
    expect(navStatusLabel(15)).toBe('Undefined');
    expect(navStatusLabel(null, 8)).toBe('Under way');
    expect(navStatusLabel(null, 0)).toBe('Stationary');
    expect(navStatusLabel(null, null)).toBe('Status not reported');
  });

  it('separates moored, anchored and under-way motion', () => {
    expect(vesselMotion(vessel({ navStatus: 1 }))).toBe('anchored');
    expect(vesselMotion(vessel({ navStatus: 5 }))).toBe('moored');
    expect(vesselMotion(vessel({ navStatus: 2 }))).toBe('restricted');
    expect(vesselMotion(vessel({ navStatus: null, sog: 0 }))).toBe('stopped');
    expect(vesselMotion(vessel({ navStatus: 0 }))).toBe('underway');
    expect(vesselIsMoving(vessel({ navStatus: 5, sog: 0 }))).toBe(false);
    expect(vesselIsMoving(vessel({ navStatus: 0 }))).toBe(true);
  });

  it('draws a turning hull when moving and a disc when stopped', () => {
    const moving = vesselIconSvg(vessel({ typeCode: 70, navStatus: 0 }), 26);
    expect(moving).toContain('width="26"');
    expect(moving).toContain(VESSEL_KIND_COLOURS.cargo);
    expect(moving).toContain(vesselStatusColour(vessel({ navStatus: 0 })));
    expect(moving).toContain('<path d="M16 2.4');

    const stopped = vesselIconSvg(vessel({ navStatus: 5 }), 26);
    expect(stopped).toContain('<circle cx="16" cy="16" r="8.8"');
    expect(stopped).not.toContain('<path d="M16 2.4');
  });

  it('scales the marker with zoom and hull length', () => {
    const small = vesselIconSize(vessel({ length: 12 }), 16);
    const large = vesselIconSize(vessel({ length: 200 }), 16);
    const zoomedOut = vesselIconSize(vessel({ length: 200 }), 8);
    expect(large).toBeGreaterThan(small);
    expect(zoomedOut).toBeLessThan(large);
  });

  it('builds a tracking-style hover card with identity, status and numbers', () => {
    const html = vesselTooltipHtml(vessel(), Date.now());
    expect(html).toContain('Vessel details');
    expect(html).toContain('RED JET 6');
    expect(html).toContain('Passenger · Class A');
    expect(html).toContain('<dt>Status</dt><dd>Under way using engine</dd>');
    expect(html).toContain('<dt>Speed</dt><dd>21.4 kn</dd>');
    expect(html).toContain('<dt>Course</dt><dd>205°</dd>');
    expect(html).toContain('<dt>MMSI</dt><dd>232001234</dd>');
    expect(html).toContain('<dt>IMO</dt><dd>9123456</dd>');
    expect(html).toContain('<dt>Call sign</dt><dd>MABC1</dd>');
  });

  it('labels the picked target with its name and course', () => {
    const html = selectedVesselLabelHtml(vessel());
    expect(html).toContain('<span class="ais-label-name">RED JET 6</span>');
    expect(html).toContain('<span class="ais-label-course">COG 205°</span>');
    // A target that has not reported a course says so rather than showing 000°.
    expect(selectedVesselLabelHtml(vessel({ cog: null }))).toContain('COG —');
    // A name is untrusted radio text, and an unnamed target falls back to MMSI.
    expect(selectedVesselLabelHtml(vessel({ name: '<b>x</b>' }))).not.toContain('<b>');
    expect(selectedVesselLabelHtml(vessel({ name: null, cog: 7.4 }))).toContain('MMSI 232001234');
    expect(selectedVesselLabelHtml(vessel({ cog: 7.4 }))).toContain('COG 007°');
    // No fix means no range line rather than a made-up one.
    expect(html).not.toContain('brg');
  });

  it('adds range and bearing off this boat to the picked label', () => {
    // Just over 30 m due west of the target, so the bearing reads close to 090°
    // and the short range is written in the feet of the nm/ft pair.
    const from = { lat: 50.795, lon: -1.2905 };
    const html = selectedVesselLabelHtml(vessel(), from, 'nm-ft');
    expect(html).toContain('class="ais-label-range"');
    expect(html).toMatch(/brg 0?9\d°/);
    expect(html).toMatch(/\d+ ft · brg/);
    // The unit setting reaches the label.
    expect(selectedVesselLabelHtml(vessel(), from, 'm-nm')).toMatch(/\d+ m · brg/);
  });

  it('groups the card into particulars and voyage, as a tracking card does', () => {
    const html = vesselTooltipHtml(vessel(), Date.now(), 'nm-ft', 'ft');
    expect(html).toContain('vessel-tip-block-title">Particulars');
    expect(html).toContain('vessel-tip-block-title">Voyage and position');
    expect(html).toContain('<dt>Destination</dt><dd>PORTSMOUTH</dd>');
    expect(html).toContain('<dt>ETA</dt><dd>14 Jun 22:00 UTC</dd>');
    // The flag and the transponder class complete the card's identity block.
    expect(html).toContain('vessel-flagcode');
    expect(html).toContain('Click the target for its full vessel record');
  });

  it('shows hull size on the hover card in the chosen distance unit', () => {
    const ship = vessel({ length: 40, beam: 10 });
    expect(vesselTooltipHtml(ship, Date.now(), 'nm-ft')).toContain(
      '<dt>Size (L × B)</dt><dd>131 ft × 32.8 ft</dd>',
    );
    expect(vesselTooltipHtml(ship, Date.now(), 'm-nm')).toContain(
      '<dt>Size (L × B)</dt><dd>40 m × 10 m</dd>',
    );
    // A target that has not reported dimensions keeps the row as a placeholder.
    const unknown = vesselTooltipHtml(vessel({ length: null, beam: null }), Date.now(), 'nm-ft');
    expect(unknown).toContain('<dt>Size (L × B)</dt><dd class="missing">---</dd>');
  });

  it('shows the reported draught on the hover card in the chosen depth unit', () => {
    const ship = vessel({ draught: 6.5 });
    expect(vesselTooltipHtml(ship, Date.now(), 'nm-ft', 'ft')).toContain(
      '<dt>Draught</dt><dd>21 ft</dd>',
    );
    expect(vesselTooltipHtml(ship, Date.now(), 'nm-ft', 'fathoms')).toContain(
      '<dt>Draught</dt><dd>3.6 fm</dd>',
    );
    expect(vesselTooltipHtml(ship)).toContain('<dt>Draught</dt><dd>6.5 m</dd>');
    // Targets that have not reported a draught show a placeholder, not a blank.
    expect(vesselTooltipHtml(vessel({ draught: null }), Date.now(), 'nm-ft', 'ft')).toContain(
      '<dt>Draught</dt><dd class="missing">---</dd>',
    );
  });

  it('escapes AIS text and explains a missing name', () => {
    const html = vesselTooltipHtml(
      vessel({ name: '<img src=x onerror=alert(1)>', destination: 'A & B' }),
      Date.now(),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('A &amp; B');

    const unnamed = vesselTooltipHtml(vessel({ name: null }), Date.now());
    expect(unnamed).toContain('<dt>MMSI</dt><dd>232001234</dd>');
    expect(unnamed).toContain('no static report yet');
  });

  it('formats speed, course and dimensions', () => {
    expect(speedLabel(vessel({ sog: 0.04 }))).toBe('0.0 kn');
    expect(speedLabel(vessel({ sog: null }))).toBe('—');
    expect(courseLabel(vessel({ cog: 7.4 }))).toBe('007°');
    expect(courseLabel(vessel({ cog: null }))).toBe('—');
    expect(dimensionsLabel(vessel({ length: 112.4, beam: 18.2 }))).toBe('112 m × 18.2 m');
    expect(dimensionsLabel(vessel({ length: null, beam: null }))).toBeNull();
  });

  it('prints target size and draught in the chosen units', () => {
    // Same figure as the boat settings: feet for the imperial distance pairs,
    // yards when the pair asks for them, and the depth unit for draught.
    const ship = vessel({ length: 112.4, beam: 18.2, draught: 6.5 });
    expect(dimensionsLabel(ship, 'nm-ft')).toBe('369 ft × 59.7 ft');
    expect(dimensionsLabel(ship, 'nm-yd')).toBe('123 yd × 19.9 yd');
    expect(dimensionsLabel(ship, 'm-km')).toBe('112 m × 18.2 m');
    expect(draughtLabel(ship, 'ft')).toBe('21 ft');
    expect(draughtLabel(ship, 'fathoms')).toBe('3.6 fm');
    expect(draughtLabel(ship)).toBe('6.5 m');
    expect(draughtLabel(vessel({ draught: null }), 'ft')).toBeNull();
  });
});
