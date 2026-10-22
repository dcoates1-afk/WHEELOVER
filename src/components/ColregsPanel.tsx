import { useMemo, useState } from 'react';
import { COLREGS, REGIONAL_NOTES } from '../data/colregs';
import { ALL_PARTS, partNames, searchColregs } from '../lib/colregsSearch';

export function ColregsPanel() {
  const [query, setQuery] = useState('');
  const [part, setPart] = useState(ALL_PARTS);
  const parts = useMemo(() => partNames(), []);
  const results = useMemo(() => searchColregs(query, part), [query, part]);

  return (
    <div className="station-body">
      <label className="search-field">
        <span className="sr-only">Search the collision regulations</span>
        <input
          type="search"
          value={query}
          placeholder="Search rules, e.g. overtaking, fog, anchor…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="chip-row" role="tablist" aria-label="Rule parts">
        {parts.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={part === entry}
            className={`chip ${part === entry ? 'active' : ''}`}
            onClick={() => setPart(entry)}
          >
            {entry.replace('Part', '').trim() || ALL_PARTS}
          </button>
        ))}
      </div>

      <p className="menu-note">
        {results.length} rule{results.length === 1 ? '' : 's'} · summaries, not the legal text
      </p>

      <ul className="rule-list">
        {results.map((rule) => (
          <li key={rule.id}>
            <details>
              <summary>
                <span>
                  <strong>{rule.rule}</strong> {rule.title}
                </span>
                <span className="chevron" aria-hidden="true">›</span>
              </summary>
              <p>{rule.summary}</p>
              <p className="rule-part">{rule.part}</p>
            </details>
          </li>
        ))}
        {results.length === 0 && <li className="empty-state">No rules match “{query}”.</li>}
      </ul>

      <h3 className="section-title">Regional modifications</h3>
      <p className="menu-note">
        The COLREGs are the baseline; these are the differences that matter in the US, Canada and European waters.
      </p>
      <ul className="rule-list regional-list">
        {REGIONAL_NOTES.map((note) => (
          <li key={note.id}>
            <details>
              <summary>
                <span>{note.title}</span>
                <span className="chevron" aria-hidden="true">›</span>
              </summary>
              <p className="rule-part">{note.authority}</p>
              <ul className="note-points">
                {note.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <a className="text-link" href={note.source} target="_blank" rel="noreferrer noopener">
                Official source
              </a>
            </details>
          </li>
        ))}
      </ul>

      <p className="menu-note disclaimer">
        This guide is a study aid bundled offline with WHEELOVER ({COLREGS.length} entries). It is not a substitute for the
        official convention or local notices to mariners. UK mariners rely on MGN 335 for COLREGs guidance.
      </p>
    </div>
  );
}
