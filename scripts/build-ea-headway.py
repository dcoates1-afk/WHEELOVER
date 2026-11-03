#!/usr/bin/env python3
"""Build the Environment Agency headway dataset for WHEELOVER bridge cards.

Fetches the four EA gov.uk guidance pages (Thames, Great Ouse, Nene,
Welland & Glen), extracts the bridge headway tables (metres), and writes
public/bridge-clearances/ea-headway.json plus a human-readable review file.

Reference level for every row: standard water level, stated approximate
on the pages. These figures carry NO tidal datum and must never drive a
tide calculation -- the card and disclaimer say so.

Rows dropped, never guessed:
  - no parseable metres figure ('-' means the EA publishes none);
  - utility crossings that are not bridges (a pipeline in the table).
Generic-only names ('Road Bridge', 'Footbridge') ship in the dataset but
are marked ineligible by the joiner in src/lib/clearances.ts: without
coordinates, a generic name cannot be attributed to one bridge safely.

Usage: python3 scripts/build-ea-headway.py
Writes: public/bridge-clearances/ea-headway.json (and updates
  public/bridge-clearances/manifest.json), ~/workspace/ea-headway/review.txt
"""
import json
import re
import sys
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = Path.home() / 'workspace' / 'ea-headway'
UA = 'WHEELOVER-research (bridge headway dataset build)'

PAGES = [
    {
        'key': 'thames',
        'label': 'River Thames',
        'url': 'https://www.gov.uk/guidance/river-thames-distances-and-measurements-for-boaters',
        'waterway': 'River Thames',
        'reach': None,
    },
    {
        'key': 'great-ouse',
        'label': 'River Great Ouse',
        'url': 'https://www.gov.uk/guidance/river-great-ouse-bridge-heights-locks-and-facilities',
        'waterway': None,  # per reach, see REACHES
        'reach': 'reach',
    },
    {
        'key': 'nene',
        'label': 'River Nene',
        'url': 'https://www.gov.uk/guidance/river-nene-bridge-heights-locks-and-facilities',
        'waterway': 'River Nene',
        'reach': None,
    },
    {
        'key': 'welland-glen',
        'label': 'Rivers Welland and Glen',
        'url': 'https://www.gov.uk/guidance/rivers-welland-and-glen-locks-and-facilities',
        'waterway': 'River Welland and River Glen',
        'reach': None,
    },
]

# Great Ouse reach heading (part before ':') -> (OSM waterway, reach note).
REACHES = {
    'Bedford Ouse': ('River Great Ouse', 'Bedford Ouse'),
    'Old West': ('Old West', 'Old West'),
    'Ely Ouse': ('River Great Ouse', 'Ely Ouse'),
    'River Cam': ('River Cam', 'River Cam'),
    'The Lodes': (None, 'The Lodes'),  # per-row lode, see LODE_FROM_NAME
    'River Lark': ('River Lark', 'River Lark'),
    'Little Ouse': ('River Little Ouse', 'Little Ouse'),
    'River Wissey': ('River Wissey', 'River Wissey'),
}

UTILITY_RE = re.compile(r'pipe\s*line|pipeline|\bcable\b|conveyor', re.I)


def lode_from_name(name):
    """The Lodes table names its lode inside the row name, e.g.
    'Upware Lock and Road Bridge, Reach Lode' or 'Wicken Lode Foot Bridge'."""
    m = re.search(r',\s*([A-Za-z]+ Lode)\s*$', name)
    if m:
        return m.group(1)
    m = re.match(r'([A-Za-z]+ Lode)\b', name)
    if m:
        return m.group(1)
    if 'Burwell' in name:
        return 'Burwell Lode'
    return 'The Lodes'


class TableParser(HTMLParser):
    """Collects (heading, table) pairs: heading = nearest preceding h2/h3."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.heading = ''
        self.in_heading = False
        self.heading_buf = []
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.cell_buf = []
        self.current_rows = []
        self.tables = []  # (heading, rows)

    def handle_starttag(self, tag, attrs):
        if tag in ('h2', 'h3'):
            self.in_heading = True
            self.heading_buf = []
        elif tag == 'table':
            self.in_table = True
            self.current_rows = []
        elif tag == 'tr' and self.in_table:
            self.in_row = True
            self.current_rows.append([])
        elif tag in ('th', 'td') and self.in_row:
            self.in_cell = True
            self.cell_buf = []

    def handle_endtag(self, tag):
        if tag in ('h2', 'h3'):
            self.in_heading = False
            text = ' '.join(''.join(self.heading_buf).split())
            if text:
                self.heading = text
        elif tag == 'table':
            self.in_table = False
            self.tables.append((self.heading, self.current_rows))
        elif tag == 'tr':
            self.in_row = False
        elif tag in ('th', 'td') and self.in_cell:
            self.in_cell = False
            if self.current_rows:
                self.current_rows[-1].append(' '.join(''.join(self.cell_buf).split()))

    def handle_data(self, data):
        if self.in_heading:
            self.heading_buf.append(data)
        elif self.in_cell:
            self.cell_buf.append(data)


def fetch(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    dest.write_bytes(data)
    return data.decode('utf-8', errors='replace')


def parse_metres(cell):
    cell = cell.strip()
    if cell in ('', '-'):
        return None
    m = re.match(r'^\d+(?:\.\d+)?$', cell)
    return float(cell) if m else None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    kept_lines = []
    dropped_lines = []
    seen = set()
    for page in PAGES:
        html_path = OUT_DIR / f"{page['key']}.html"
        html = fetch(page['url'], html_path)
        parser = TableParser()
        parser.feed(html)
        for heading, rows in parser.tables:
            if not rows:
                continue
            header = ' '.join(rows[0])
            if 'Headway (metres)' not in header:
                continue
            reach_key = heading.split(':')[0].strip() if page['reach'] == 'reach' else None
            waterway, note = REACHES.get(reach_key, (None, None)) if reach_key else (None, None)
            for row in rows[1:]:
                if len(row) < 2:
                    continue
                name, metres_cell = row[0], row[1]
                value = parse_metres(metres_cell)
                if value is None:
                    dropped_lines.append(
                        f"{page['label']} | NO FIGURE | {name} | metres cell {metres_cell!r}")
                    continue
                if UTILITY_RE.search(name) and 'bridge' not in name.lower():
                    dropped_lines.append(
                        f"{page['label']} | NOT A BRIDGE | {name} | {value} m")
                    continue
                w = page['waterway']
                n = note
                if page['reach'] == 'reach':
                    if reach_key == 'The Lodes':
                        w = lode_from_name(name)
                    else:
                        w = waterway
                    n = note
                key = (name, w, value)
                if key in seen:
                    dropped_lines.append(
                        f"{page['label']} | EXACT DUPLICATE | {name} | {value} m | {w}")
                    continue
                seen.add(key)
                records.append({
                    'n': name,
                    'w': w,
                    'v': [value],
                    'c': True,
                    'd': 'standard water level (approximate)',
                    'note': n,
                    'pg': page['label'],
                })
                kept_lines.append(
                    f"{page['label']} | {name} | {value} m | w={w} | note={n}")
    out_json = REPO / 'public' / 'bridge-clearances' / 'ea-headway.json'
    out_json.write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    manifest_path = REPO / 'public' / 'bridge-clearances' / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    today = date.today().isoformat()
    manifest['generatedAt'] = today
    manifest.setdefault('sources', {})['eaheadway'] = {
        'label': 'Environment Agency',
        'datum': 'standard water level (approximate)',
        'count': len(records),
        'retrieved': today,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    review = OUT_DIR / 'review.txt'
    review.write_text(
        f"EA headway build: {len(records)} kept, {len(dropped_lines)} dropped\n\n"
        "== KEPT ==\n" + '\n'.join(kept_lines) + "\n\n"
        "== DROPPED ==\n" + '\n'.join(dropped_lines) + "\n",
        encoding='utf-8')
    print(f"kept={len(records)} dropped={len(dropped_lines)}")
    print(f"wrote {out_json} and {review}")


if __name__ == '__main__':
    sys.exit(main())
