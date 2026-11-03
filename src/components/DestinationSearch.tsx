import { useEffect, useRef, useState } from 'react';
import { searchDestinations, type DestinationResult } from '../lib/destinationSearch';

interface DestinationSearchProps {
  hidden: boolean;
  onSelect: (result: DestinationResult) => void;
}

/**
 * Destination search, sitting under the weather button in the top-left
 * corner. Typing is debounced so Nominatim sees at most about one request
 * per second; picking a result flies the chart there and pins the place.
 * The list stays open until a result is picked, Escape is pressed, or the
 * query is cleared, so taps on results are never lost to a blur race.
 */
export function DestinationSearch({ hidden, onSelect }: DestinationSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DestinationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setResults([]);
      setSearching(false);
      setFailed(false);
      setSearched(false);
      return;
    }
    setSearching(true);
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchDestinations(text, controller.signal)
        .then((found) => {
          if (requestRef.current !== requestId) return;
          setResults(found);
          setFailed(false);
          setSearched(true);
          setOpen(true);
        })
        .catch((error: unknown) => {
          if (requestRef.current !== requestId) return;
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResults([]);
          setFailed(true);
          setSearched(true);
          setOpen(true);
        })
        .finally(() => {
          if (requestRef.current === requestId) setSearching(false);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const clear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
    setFailed(false);
    setSearched(false);
  };

  return (
    <div className={`destination-search ${hidden ? 'is-hidden' : ''}`}>
      <div className="destination-search-box">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (results.length > 0 || failed || searched) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          placeholder="Search destinations…"
          aria-label="Search destinations"
          autoComplete="off"
          spellCheck={false}
        />
        {searching && <span className="destination-search-spin" aria-hidden="true" />}
        {query && (
          <button type="button" className="destination-search-clear" onClick={clear} aria-label="Clear search">
            ×
          </button>
        )}
      </div>
      {open && !searching && results.length > 0 && (
        <ul className="destination-search-results" role="listbox" aria-label="Destination results">
          {results.map((result) => (
            <li key={`${result.lat},${result.lon},${result.name}`}>
              <button
                type="button"
                onClick={() => {
                  onSelect(result);
                  setOpen(false);
                }}
              >
                <strong>{result.name}</strong>
                {result.detail && <span>{result.detail}</span>}
              </button>
            </li>
          ))}
          <li className="destination-search-attribution">Search © OpenStreetMap contributors</li>
        </ul>
      )}
      {open && !searching && failed && (
        <p className="destination-search-note" role="status">
          Search failed — check your connection and try again.
        </p>
      )}
      {open && !searching && !failed && searched && results.length === 0 && (
        <p className="destination-search-note" role="status">
          No places found for that search.
        </p>
      )}
    </div>
  );
}
