import { describe, expect, it } from 'vitest';
import { createPin } from './pins';
import { createTrack } from './tracks';
import { exportGpx, formatCoord, gpxFileName, parseGpx } from './gpx';

describe('exportGpx', () => {
  it('writes waypoints and tracks with escaped names and 6-decimal coords', () => {
    const pin = createPin(48.0, -126.0);
    pin.title = 'Fish & Chips <Bay>';
    pin.note = 'Good "anchorage"';
    const track = createTrack(1000);
    track.points = [
      { lat: 48.0, lon: -126.0, at: 1000 },
      { lat: 48.001, lon: -125.999, at: 2000 },
    ];
    const xml = exportGpx([pin], [track]);
    expect(xml).toContain('<wpt lat="48.000000" lon="-126.000000">');
    expect(xml).toContain('<name>Fish &amp; Chips &lt;Bay&gt;</name>');
    expect(xml).toContain('<desc>Good &quot;anchorage&quot;</desc>');
    expect(xml).toContain('<trkpt lat="48.001000" lon="-125.999000">');
    expect(xml).toContain('<time>1970-01-01T00:00:01.000Z</time>');
  });

  it('still produces a valid file with no data', () => {
    const xml = exportGpx([], []);
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('</gpx>');
    expect(xml).not.toContain('<wpt');
    expect(xml).not.toContain('<trk>');
  });

  it('names the file with the local date', () => {
    expect(gpxFileName(new Date(2026, 10, 3))).toBe('wheel-over-2026-11-03.gpx');
  });

  it('formats coords to six decimals', () => {
    expect(formatCoord(48.123456789)).toBe('48.123457');
  });
});

const SAMPLE = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <wpt lat="48.000000" lon="-126.000000"><name>Cowes &amp; co</name><desc>Harbour</desc></wpt>
  <wpt lat="95.000000" lon="0.000000"><name>Bad lat</name></wpt>
  <wpt lon="-126.000000"><name>No lat</name></wpt>
  <trk><name>Morning run</name><trkseg>
    <trkpt lat="48.000000" lon="-126.000000"><time>2026-11-03T10:00:00Z</time></trkpt>
    <trkpt lat="48.001000" lon="-125.999000"><time>2026-11-03T10:01:00Z</time></trkpt>
    <trkpt lat="48.002000" lon="-125.998000"></trkpt>
  </trkseg></trk>
  <rte><name>Planned route</name><rtept lat="48.000000" lon="-126.000000"/></rte>
</gpx>`;

describe('parseGpx', () => {
  it('imports waypoints and tracks, skips bad rows, counts routes', () => {
    const result = parseGpx(SAMPLE, 5000);
    expect(result.pins).toHaveLength(1);
    expect(result.pins[0]?.title).toBe('Cowes & co');
    expect(result.pins[0]?.note).toBe('Harbour');
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.points).toHaveLength(3);
    expect(result.tracks[0]?.startedAt).toBe(Date.parse('2026-11-03T10:00:00Z'));
    // The timeless third point falls back to startedAt + 2 s.
    expect(result.tracks[0]?.points[2]?.at).toBe(
      Date.parse('2026-11-03T10:00:00Z') + 2000,
    );
    expect(result.skippedRows).toBe(2);
    expect(result.skippedRoutes).toBe(1);
  });

  it('assigns fresh ids that never match the file', () => {
    const result = parseGpx(SAMPLE, 5000);
    expect(result.pins[0]?.id).toMatch(/^pin-/);
    expect(result.tracks[0]?.id).toMatch(/^track-/);
  });

  it('round-trips export back through import', () => {
    const pin = createPin(48.5, -125.5);
    pin.title = 'Round trip';
    const track = createTrack(1000);
    track.points = [
      { lat: 48.5, lon: -125.5, at: 1000 },
      { lat: 48.6, lon: -125.4, at: 2000 },
    ];
    const result = parseGpx(exportGpx([pin], [track]));
    expect(result.pins.map((entry) => entry.title)).toEqual(['Round trip']);
    expect(result.tracks[0]?.points).toHaveLength(2);
    expect(result.skippedRows).toBe(0);
    expect(result.skippedRoutes).toBe(0);
  });
});
