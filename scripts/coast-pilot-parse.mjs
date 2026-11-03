/**
 * Coast Pilot bridge-clearance passage parser (pure functions, no I/O).
 *
 * Coast Pilot publishes bridge clearances as narrative prose, not tables:
 *   "Golden Gate Bridge, crossing the Golden Gate (strait) from Fort Point
 *    to Lime Point, has a clearance of 231 feet at the center of the
 *    4,028-foot-wide channel span ..."
 *   "The three highway drawbridges across Tidal Canal have a least
 *    clearance of 15 feet. The vertical lift railroad bridge across Tidal
 *    Canal has a clearance of 13 feet down and 135 feet up."
 *
 * This module turns such passages into dataset records. Anything ambiguous
 * is dropped, never guessed: a wrong clearance on a card is worse than a
 * blank one. Every kept record carries the source sentence so the review
 * file can be checked by eye.
 */

export const FT_TO_M = 0.3048;

export function ftToM(feet) {
  return Math.round(feet * FT_TO_M * 10) / 10;
}

/** Volume datum defaults: MHW everywhere except the Great Lakes volume. */
export function volumeDatum(volume) {
  return volume === 'cp6' ? 'LWD' : 'MHW';
}

const DATUM_PHRASES = [
  [/low water datum/i, 'LWD'],
  [/normal pool level/i, 'normal pool'],
  [/mean sea level/i, 'MSL'],
  [/mean high water/i, 'MHW'],
  [/mean low water/i, 'MLW'],
];

export function detectDatum(text, fallback) {
  for (const [pattern, datum] of DATUM_PHRASES) {
    if (pattern.test(text)) return datum;
  }
  return fallback;
}

/**
 * Coast Pilot positions come in two forms: degrees and decimal minutes
 * ("37°46.3'N 122°14.2'W") and degrees-minutes-seconds
 * ("38°03'55"N., 121°47'09"W."). Returns { lat, lon } or null.
 */
export function parseCoordinate(text) {
  const dms = text.match(
    /(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([NS])[^0-9A-Za-z]{0,12}?(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([EW])/,
  );
  if (dms) {
    const lat = Number(dms[1]) + Number(dms[2]) / 60 + Number(dms[3]) / 3600;
    const lon = Number(dms[5]) + Number(dms[6]) / 60 + Number(dms[7]) / 3600;
    return {
      lat: Math.round((dms[4] === 'S' ? -lat : lat) * 10000) / 10000,
      lon: Math.round((dms[8] === 'W' ? -lon : lon) * 10000) / 10000,
    };
  }
  const match = text.match(
    /(\d{1,3})°\s*(\d{1,2}(?:\.\d+)?)['′]\s*([NS])[^0-9A-Za-z]{0,12}?(\d{1,3})°\s*(\d{1,2}(?:\.\d+)?)['′]\s*([EW])/,
  );
  if (!match) return null;
  const lat = Number(match[1]) + Number(match[2]) / 60;
  const lon = Number(match[4]) + Number(match[5]) / 60;
  return {
    lat: Math.round((match[3] === 'S' ? -lat : lat) * 10000) / 10000,
    lon: Math.round((match[6] === 'W' ? -lon : lon) * 10000) / 10000,
  };
}

const TYPE_WORDS = [
  [/bascule/i, 'bascule'],
  [/vertical lift/i, 'lift'],
  [/lift bridge/i, 'lift'],
  [/swing/i, 'swing'],
  [/transporter/i, 'transporter'],
  [/pontoon/i, 'pontoon'],
  [/fixed/i, 'fixed'],
  [/drawbridge/i, 'drawbridge'],
];

/** Bridge kind wording in a passage, or null when the passage says none. */
export function parseBridgeType(text) {
  for (const [pattern, type] of TYPE_WORDS) {
    if (pattern.test(text)) return type;
  }
  return null;
}

const NUMBER = '[\\d,]+(?:\\.\\d+)?';
const FEET = '(?:feet|foot)';
const CLEARANCE_RE = new RegExp(
  `clearance[s]? of (?:about |approximately |at least |a least )?(${NUMBER})\\s*${FEET}`,
  'i',
);
// A sentence can list the horizontal figure first ("a horizontal
// clearance of 40 feet and a vertical clearance of 7 feet"). The bare
// pattern above would take the horizontal figure as the vertical one,
// so an explicit vertical phrase always wins, and a bare phrase that
// turns out to be horizontal counts as no vertical figure at all.
const VERTICAL_RE = new RegExp(
  `vertical clearance[s]? of (?:about |approximately |at least |a least )?(${NUMBER})\\s*${FEET}`,
  'i',
);
const LEAST_RE = new RegExp(`least clearance of (${NUMBER})\\s*${FEET}`, 'i');
const DOWN_UP_RE = new RegExp(
  `clearance of (${NUMBER})\\s*${FEET} down and (${NUMBER})\\s*${FEET} up`,
  'i',
);
// Lift bridges are sometimes described with three positions: down,
// partially open, and fully open. The fully open figure is the maximum
// when open, matching the open figure's meaning elsewhere.
const DOWN_PARTIAL_UP_RE = new RegExp(
  `clearance of (${NUMBER})\\s*${FEET} down, (${NUMBER})\\s*${FEET} partially open and (${NUMBER})\\s*${FEET} fully open`,
  'i',
);
const HORIZONTAL_RE = new RegExp(`horizontal clearance of (${NUMBER})\\s*${FEET}`, 'i');
const GROUP_RE = new RegExp(
  `(?:The )?([A-Za-z]+) (highway |railroad |railway )?(drawbridges|bridges) across ([A-Z][A-Za-z0-9'&.\\- ]+?) have a least clearance of (${NUMBER})\\s*feet`,
  'i',
);
const NAME_RE = /(?:The )?([A-Z][A-Za-z0-9'&.\- ]+? (?:Bridge|bridge|Drawbridge|drawbridge))\b/;

/**
 * The water a passage crosses: "across Tidal Canal", "crossing the lower
 * part of San Francisco Bay", "over the Napa River". The name must be
 * capitalised and end in a water word, so generic phrases like "the main
 * channel" do not count.
 */
const WATER_WORDS =
  'Bay|River|Canal|Channel|Strait|Creek|Slough|Harbor|Harbour|Lake|Sound|Passage|Inlet|Estuary|Fork|Branch|Reach|Arm';
const WATERWAY_RE = new RegExp(
  `(?:[Cc]rossing|[Aa]cross|[Oo]ver|[Ss]panning) (?:the )?(?:[a-z ]*?)((?:[A-Z][A-Za-z'&.-]* )+?(?:${WATER_WORDS}))\\b`,
);

function num(text) {
  return Number(text.replace(/,/g, ''));
}

function splitSentences(paragraph) {
  return paragraph
    .split(/(?<=[a-z0-9])\.\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract records from one chapter's pdftotext -layout output.
 * Returns { records, dropped } where each record carries its source
 * sentence for the review file. `volume` is 'cp1'..'cp10' for the datum
 * default; `chapter` is a label like 'CP7 Ch.7'.
 */
export function extractRecords(chapterText, volume, chapter) {
  const records = [];
  const dropped = [];
  const fallbackDatum = volumeDatum(volume);
  const paragraphs = chapterText.split(/\n\s*\n/);
  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.replace(/\s+/g, ' ').trim();
    if (!paragraph || paragraph.length < 40) continue;
    const paragraphCoords = parseCoordinate(paragraph);
    let lastName = null;
    for (const sentence of splitSentences(paragraph)) {
      if (!/clearance/i.test(sentence)) continue;
      // A sentence's own position beats the paragraph's: one paragraph
      // can mention two bridges at two positions, and giving both the
      // paragraph's first position would misplace the second.
      const coords = parseCoordinate(sentence) ?? paragraphCoords;
      // Group statement first: it names a waterway, not one bridge.
      const group = sentence.match(GROUP_RE);
      if (group) {
        const [, countWord, kindWord, , waterway, feet] = group;
        records.push({
          n: null,
          w: waterway.trim(),
          la: coords?.lat ?? null,
          lo: coords?.lon ?? null,
          v: [ftToM(num(feet))],
          c: true,
          o: null,
          h: null,
          d: detectDatum(sentence, fallbackDatum),
          least: true,
          g: `${countWord} ${kindWord ? kindWord.trim() + ' ' : ''}drawbridges across ${waterway.trim()}`,
          t: 'drawbridge',
          ch: chapter,
          src: sentence.slice(0, 300),
        });
        continue;
      }
      const downUpPartial = sentence.match(DOWN_PARTIAL_UP_RE);
      const downUp = downUpPartial ? null : sentence.match(DOWN_UP_RE);
      const least = sentence.match(LEAST_RE);
      const vertical = downUpPartial ?? downUp ?? least ? null : sentence.match(VERTICAL_RE);
      const plainRaw = downUpPartial ?? downUp ?? least ?? vertical ? null : sentence.match(CLEARANCE_RE);
      const plain =
        plainRaw && sentence.slice(Math.max(0, plainRaw.index - 11), plainRaw.index).toLowerCase() === 'horizontal '
          ? null
          : plainRaw;
      const figure = downUpPartial ?? downUp ?? least ?? vertical ?? plain;
      if (!figure) continue;
      // Name: this sentence's bridge, else the paragraph's running bridge
      // when the sentence refers back to it ("The bridge has ...").
      let name = null;
      const named = sentence.match(NAME_RE);
      if (named) {
        name = named[1].trim().replace(/^The /, '');
        // A heading can run into the next sentence ("Bridges The Peace
        // Bridge"): the true name starts at the last sentence-start.
        const theIdx = name.lastIndexOf(' The ');
        if (theIdx >= 0) name = name.slice(theIdx + 5);
        lastName = name;
      } else if (/the (bridge|drawbridge|structure) has/i.test(sentence) && lastName) {
        name = lastName;
      }
      if (!name) {
        dropped.push({ reason: 'no bridge name', sentence: sentence.slice(0, 200), ch: chapter });
        continue;
      }
      // A clearance can belong to something that is not a bridge at all —
      // a power cable east of a bridge, a pipeline, a conveyor. The name
      // matcher will happily call it a bridge; the subject words give it
      // away. A real bridge sentence that merely mentions a cable keeps
      // its real name, so this guard only fires on the name itself. (A
      // real bridge actually named Cable Bridge would be dropped too;
      // that costs a row, never a wrong figure, so the trade stands.)
      const NON_BRIDGE_SUBJECTS = ['cable', 'power line', 'transmission', 'pipeline', 'conveyor'];
      if (NON_BRIDGE_SUBJECTS.some((word) => name.toLowerCase().includes(word))) {
        dropped.push({ reason: 'clearance subject is not a bridge', sentence: sentence.slice(0, 200), ch: chapter });
        continue;
      }
      // A named passage often states the water it crosses ("across Tidal
      // Canal", "crossing the lower part of San Francisco Bay"), which is
      // what the on-device join uses when the passage carries no coordinates.
      // Failing that, the paragraph's own crossing phrase will do: it can
      // only add a join where the name and the waterway both match one
      // real feature, so a wrong paragraph waterway costs a missed join,
      // never a false one.
      const across = sentence.match(WATERWAY_RE) ?? paragraph.match(WATERWAY_RE);
      const horizontal = sentence.match(HORIZONTAL_RE) ?? paragraph.match(HORIZONTAL_RE);
      const closed = downUpPartial
        ? ftToM(num(downUpPartial[1]))
        : downUp
          ? ftToM(num(downUp[1]))
          : ftToM(num(figure[1]));
      const open = downUpPartial
        ? ftToM(num(downUpPartial[3]))
        : downUp
          ? ftToM(num(downUp[2]))
          : null;
      records.push({
        n: name,
        w: across ? across[1].trim() : null,
        la: coords?.lat ?? null,
        lo: coords?.lon ?? null,
        v: [closed],
        c: true,
        o: open ? [open] : null,
        h: horizontal ? ftToM(num(horizontal[1])) : null,
        d: detectDatum(sentence, detectDatum(paragraph, fallbackDatum)),
        least: Boolean(least),
        g: null,
        t: parseBridgeType(sentence),
        ch: chapter,
        src: sentence.slice(0, 300),
      });
    }
  }
  return { records, dropped };
}
