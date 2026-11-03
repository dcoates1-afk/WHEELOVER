import { createPin, type Pin } from './pins';
import { createTrack, type Track, type TrackPoint } from './tracks';

/**
 * GPX 1.1 export/import for the device's own data: pins become waypoints,
 * tracks become tracks. Planned routes are NOT handled — the app has no
 * route builder yet, so imported <rte> blocks are counted and skipped,
 * never silently turned into tracks. No server is involved either way.
 */

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

/** Six decimals is ~0.1 m — finer precision is noise in a GPX file. */
export function formatCoord(value: number): string {
  return value.toFixed(6);
}

export function gpxFileName(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `wheel-over-${year}-${month}-${day}.gpx`;
}

export function exportGpx(pins: Pin[], tracks: Track[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="@ Wheel-over" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>@ Wheel-over export</name><time>${new Date().toISOString()}</time></metadata>`,
  ];
  for (const pin of pins) {
    lines.push(`  <wpt lat="${formatCoord(pin.lat)}" lon="${formatCoord(pin.lon)}">`);
    lines.push(`    <name>${escapeXml(pin.title)}</name>`);
    if (pin.note) lines.push(`    <desc>${escapeXml(pin.note)}</desc>`);
    lines.push('  </wpt>');
  }
  for (const track of tracks) {
    lines.push('  <trk>');
    lines.push(`    <name>${escapeXml(new Date(track.startedAt).toISOString())}</name>`);
    lines.push('    <trkseg>');
    for (const point of track.points) {
      lines.push(`      <trkpt lat="${formatCoord(point.lat)}" lon="${formatCoord(point.lon)}">`);
      lines.push(`        <time>${new Date(point.at).toISOString()}</time>`);
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
    lines.push('  </trk>');
  }
  lines.push('</gpx>');
  return lines.join('\n');
}

export interface GpxImportResult {
  pins: Pin[];
  tracks: Track[];
  skippedRows: number;
  skippedRoutes: number;
}

function parseAttr(attrs: string, name: 'lat' | 'lon'): number | null {
  const match = attrs.match(new RegExp(`${name}=["']([^"']*)["']`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseChild(body: string, tag: 'name' | 'desc' | 'time'): string | null {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!match) return null;
  return decodeXmlEntities(stripTags(match[1] ?? '').trim());
}

/**
 * Parse a GPX document. One bad row never kills the file: it is counted in
 * skippedRows and the rest imports. Every imported record gets a fresh id,
 * so a file can never overwrite or collide with existing pins or tracks.
 */
export function parseGpx(xmlText: string, now = Date.now()): GpxImportResult {
  const result: GpxImportResult = { pins: [], tracks: [], skippedRows: 0, skippedRoutes: 0 };

  // Waypoints live at the top level; a <wpt> inside a track or route block
  // is not a thing in GPX, so scanning the whole document is safe here.
  const wptPattern = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g;
  for (const match of xmlText.matchAll(wptPattern)) {
    const lat = parseAttr(match[1] ?? '', 'lat');
    const lon = parseAttr(match[1] ?? '', 'lon');
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      result.skippedRows += 1;
      continue;
    }
    const pin = createPin(lat, lon);
    pin.title = parseChild(match[2] ?? '', 'name') || 'Pinned place';
    pin.note = parseChild(match[2] ?? '', 'desc') || '';
    pin.createdAt = now;
    result.pins.push(pin);
  }

  const trkPattern = /<trk\b[^>]*>([\s\S]*?)<\/trk>/g;
  for (const trkMatch of xmlText.matchAll(trkPattern)) {
    const points: TrackPoint[] = [];
    const ptPattern = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g;
    for (const ptMatch of trkMatch[1]?.matchAll(ptPattern) ?? []) {
      const lat = parseAttr(ptMatch[1] ?? '', 'lat');
      const lon = parseAttr(ptMatch[1] ?? '', 'lon');
      if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        result.skippedRows += 1;
        continue;
      }
      const timeText = parseChild(ptMatch[2] ?? '', 'time');
      const parsed = timeText ? Date.parse(timeText) : NaN;
      points.push({ lat, lon, at: Number.isFinite(parsed) ? parsed : 0 });
    }
    if (points.length === 0) continue;
    const track = createTrack(points[0]!.at || now);
    track.startedAt = points[0]!.at || now;
    track.points = points.map((point, index) => ({
      ...point,
      at: point.at || track.startedAt + index * 1000,
    }));
    track.endedAt = track.points[track.points.length - 1]!.at;
    result.tracks.push(track);
  }

  const rtePattern = /<rte\b[^>]*>([\s\S]*?)<\/rte>/g;
  for (const _rteMatch of xmlText.matchAll(rtePattern)) {
    result.skippedRoutes += 1;
  }

  return result;
}
