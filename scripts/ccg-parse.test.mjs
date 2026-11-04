import { describe, expect, it } from 'vitest';
import { composeLight, dmsToDecimal, parseSectionHtml } from './ccg-parse.mjs';

const SECTION_HTML = `<table>
<tr><th rowspan="2">No.<br /> -----<br /> Intl No.</th><th rowspan="2">Name<br /> -----<br /> RACON</th><th rowspan="2" /><th rowspan="2">Location<br /> -----<br /> Latitude N.<br /> Longitude W.</th><th colspan="3">Light Characteristics</th><th rowspan="2">Focal Height Above Water (m)</th><th rowspan="2">Nominal Range (NM)</th><th rowspan="2">Description</th><th rowspan="2">Remarks</th></tr>
<tr style="display:none"><th /><th /><th /></tr>
<tr><td>1025</td><td>Mission Lake</td><td /><td>Chesterfield Inlet.<br /> &nbsp; 63 20 36.8<br /> 090 41 13.9</td><td>Fl</td><td>W</td><td>6s</td><td>21.7</td><td>7</td><td>Square skeleton tower, orange rectangular daymark.<br /><center>9.7</center></td><td>Seasonal (in place year round).<br />Flash 1 s; eclipse 5 s.<br />Radar reflector.<br /><br /></td></tr>
<tr><td>1030<br />G 1234</td><td>Test Point<br />Racon T</td><td /><td>Some Bay.<br />48 25 10.0<br />123 22 30.5</td><td>F</td><td>R</td><td></td><td>12.0</td><td>9</td><td>Steel tower.</td><td></td></tr>
<tr><td>1040</td><td>Unlit Buoy</td><td /><td>Some Bay.<br />48 26 00.0<br />123 23 00.0</td><td></td><td></td><td></td><td></td><td></td><td>Red spar buoy.</td><td></td></tr>
<tr><td>bad</td><td>No Position</td><td /><td>Nowhere.</td><td>Fl</td><td>W</td><td>4s</td><td>5</td><td>3</td><td>Tower.</td><td></td></tr>
<tr><td><p>5 - 230</p></td><td><p>Great Slave Lake</p></td><td></td></tr>
<tr><td>205</td><td>Range Front</td><td /><td>Some Narrows.<br />48 27 00.0<br />123 24 00.0</td><td>F</td><td>G</td><td>.....</td><td>10</td><td>5</td><td>Range tower.</td><td></td></tr>
</table>`;

describe('dmsToDecimal', () => {
  it('converts degrees-minutes-seconds with decimals', () => {
    expect(dmsToDecimal('63 20 36.8')).toBeCloseTo(63.343556, 5);
    expect(dmsToDecimal('090 41 13.9')).toBeCloseTo(90.687194, 5);
  });

  it('rejects non-DMS cells', () => {
    expect(dmsToDecimal('')).toBeNull();
    expect(dmsToDecimal('north')).toBeNull();
    expect(dmsToDecimal('48 25')).toBeNull();
  });
});

describe('composeLight', () => {
  it('joins character, colour and period, dropping empties', () => {
    expect(composeLight('Fl', 'W', '6s')).toBe('Fl W 6s');
    expect(composeLight('F', 'R', '')).toBe('F R');
    expect(composeLight('', '', '')).toBeNull();
  });
});

describe('parseSectionHtml', () => {
  it('parses the real Mission Lake row with W longitude negative', () => {
    const { rows, skippedUnlit, malformed } = parseSectionHtml(SECTION_HTML, 'arc', 'https://example/arc1025-en.php');
    expect(rows).toHaveLength(3);
    const mission = rows[0];
    expect(mission.no).toBe('1025');
    expect(mission.name).toBe('Mission Lake');
    expect(mission.location).toBe('Chesterfield Inlet.');
    expect(mission.lat).toBeCloseTo(63.343556, 5);
    expect(mission.lon).toBeCloseTo(-90.687194, 5);
    expect(mission.light).toBe('Fl W 6s');
    expect(mission.character).toBe('Fl');
    expect(mission.colour).toBe('W');
    expect(mission.period).toBe('6s');
    expect(mission.focalHeight).toBe('21.7');
    expect(mission.range).toBe('7');
    expect(mission.description).toBe('Square skeleton tower, orange rectangular daymark.');
    expect(mission.structureHeight).toBe('9.7');
    expect(mission.volume).toBe('arc');
  });

  it('reads second-line Intl No. and RACON, and keeps a steady light', () => {
    const { rows } = parseSectionHtml(SECTION_HTML, 'arc', 'https://example/arc1025-en.php');
    expect(rows[1].intlNo).toBe('G 1234');
    expect(rows[1].racon).toBe('Racon T');
    expect(rows[1].light).toBe('F R');
    expect(rows[1].lat).toBeCloseTo(48.419444, 5);
    expect(rows[1].lon).toBeCloseTo(-123.375139, 5);
  });

  it('counts unlit and position-less rows instead of hiding them', () => {
    const { skippedUnlit, malformed } = parseSectionHtml(SECTION_HTML, 'arc', 'https://example/arc1025-en.php');
    expect(skippedUnlit).toBe(1);
    expect(malformed).toBe(1);
  });

  it('counts volume index rows separately from malformed aids', () => {
    const { rows, skippedIndex, malformed } = parseSectionHtml(SECTION_HTML, 'arc', 'https://example/arc1025-en.php');
    expect(rows).toHaveLength(3);
    expect(skippedIndex).toBe(1);
    expect(malformed).toBe(1);
  });

  it('normalises a dots-only period to no period', () => {
    const { rows } = parseSectionHtml(SECTION_HTML, 'arc', 'https://example/arc1025-en.php');
    const range = rows.find((r) => r.no === '205');
    expect(range.light).toBe('F G');
    expect(range.period).toBeNull();
  });
});
