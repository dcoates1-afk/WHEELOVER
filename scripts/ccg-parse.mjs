/**
 * Pure parser for CCG List of Lights section pages (notmar.gc.ca).
 * No network, no filesystem: the build script fetches and caches pages,
 * this module turns one section page's HTML table into light records.
 *
 * Table shape (verified against the Arctic Chesterfield Inlet page):
 * one table; header rows use <th> and one hidden spacer row; each data
 * row has 11 <td>s: No. (+ Intl No. second line) | Name (+ RACON second
 * line) | spacer | Location + latitude DMS + longitude DMS | light
 * character | light colour | light period | focal height (m) |
 * nominal range (NM) | description + centred structure height (m) |
 * remarks. Positions are DMS, latitude N, longitude W.
 */

const DMS_RE = /^(\d{1,3})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)$/;

/** "63 20 36.8" -> 63.34355...; returns null when the cell is not DMS. */
export function dmsToDecimal(dms) {
  const match = String(dms ?? '').trim().match(DMS_RE);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60 + Number(match[3]) / 3600;
}

/** "Fl" + "W" + "6s" -> "Fl W 6s"; empty parts drop out, all empty -> null. */
export function composeLight(character, colour, period) {
  const light = [character, colour, period]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return light === '' ? null : light;
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Split a cell on <br>, strip remaining tags, return non-empty lines. */
function cellLines(cellHtml) {
  return decodeEntities(String(cellHtml ?? ''))
    .split(/<br\s*\/?>/i)
    .map((line) => line.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '' && line !== '-----');
}

function cellText(cellHtml) {
  return cellLines(cellHtml).join(' ');
}

/**
 * Parse one section page. Returns { rows, skippedUnlit, skippedIndex, malformed }.
 * v1 keeps lighted aids only: unlit rows (buoys, fog-signal-only entries)
 * are counted and skipped, not silently dropped from the stats. Rows with
 * fewer than 11 cells are the volume's index rows (page ranges + waterway
 * names, never aids) and are counted separately, not as malformed.
 */
export function parseSectionHtml(html, volume, pageUrl) {
  const rows = [];
  let skippedUnlit = 0;
  let skippedIndex = 0;
  let malformed = 0;
  const tables = String(html ?? '').match(/<table[\s\S]*?<\/table>/gi) ?? [];
  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    for (const tr of trs) {
      if (/<th/i.test(tr)) continue;
      if (/display\s*:\s*none/i.test(tr)) continue;
      // The spacer column is a self-closing <td /> with no </td>; expand
      // it first, or the cell matcher swallows the following location cell.
      const rowHtml = tr.replace(/<td\s*\/>/gi, '<td></td>');
      const cells = [...rowHtml.matchAll(/<td[\s\S]*?>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
      if (cells.length < 11) {
        skippedIndex += 1;
        continue;
      }
      const noLines = cellLines(cells[0]);
      const nameLines = cellLines(cells[1]);
      const locLines = cellLines(cells[3]);
      const dmsLines = locLines.filter((line) => DMS_RE.test(line));
      const lat = dmsLines.length >= 1 ? dmsToDecimal(dmsLines[0]) : null;
      const lon = dmsLines.length >= 2 ? dmsToDecimal(dmsLines[1]) : null;
      if (noLines.length === 0 || nameLines.length === 0 || lat === null || lon === null) {
        malformed += 1;
        continue;
      }
      const character = cellText(cells[4]);
      const colour = cellText(cells[5]);
      // A period of only dots is the source's notation for "no fixed
      // period", not data; normalising it to empty keeps the composed
      // light ("F G") matchable against OSM's rendering of the same aid.
      const periodRaw = cellText(cells[6]);
      const period = /^\.+$/.test(periodRaw) ? '' : periodRaw;
      const light = composeLight(character, colour, period);
      if (!light) {
        skippedUnlit += 1;
        continue;
      }
      const descCell = cells[9];
      const structureMatch = descCell.match(/<center[^>]*>([\s\S]*?)<\/center>/i);
      const description = cellText(descCell.replace(/<center[^>]*>[\s\S]*?<\/center>/gi, ' '));
      const structureHeight = structureMatch ? cellText(structureMatch[1]) : null;
      const location = locLines.filter((line) => !DMS_RE.test(line)).join(' ');
      rows.push({
        volume,
        no: noLines[0],
        intlNo: noLines[1] ?? null,
        name: nameLines[0],
        racon: nameLines[1] ?? null,
        location: location === '' ? null : location,
        lat,
        lon: -lon,
        character: character === '' ? null : character,
        colour: colour === '' ? null : colour,
        period: period === '' ? null : period,
        light,
        focalHeight: cellText(cells[7]) || null,
        range: cellText(cells[8]) || null,
        description: description === '' ? null : description,
        structureHeight: structureHeight === '' ? null : structureHeight,
        remarks: cellText(cells[10]) || null,
        sourceUrl: pageUrl,
      });
    }
  }
  return { rows, skippedUnlit, skippedIndex, malformed };
}
