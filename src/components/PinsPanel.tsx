import { formatLatLon } from '../lib/coordinates';
import type { Pin } from '../lib/pins';

interface PinsPanelProps {
  pins: Pin[];
  selectedId: string | null;
  placing: boolean;
  onClose: () => void;
  onAdd: () => void;
  onCancelPlacing: () => void;
  onSelect: (pin: Pin) => void;
  onUpdate: (id: string, patch: Partial<Pick<Pin, 'title' | 'note'>>) => void;
  onDelete: (id: string) => void;
}

/**
 * The navigator's own pins, kept on this device only. Adding is a two-step
 * tap: "Add pin" arms placement, then a tap on the chart drops the pin.
 * That keeps map taps unambiguous — a tap never both clears a selection
 * and drops a pin.
 */
export function PinsPanel({
  pins,
  selectedId,
  placing,
  onClose,
  onAdd,
  onCancelPlacing,
  onSelect,
  onUpdate,
  onDelete,
}: PinsPanelProps) {
  const selected = pins.find((pin) => pin.id === selectedId) ?? null;
  return (
    <section className="pins-panel" aria-label="Place pins">
      <div className="pins-panel-head">
        <h2>Pins</h2>
        <span className="pins-count">{pins.length}</span>
        <button type="button" className="pins-close" onClick={onClose} aria-label="Close pins">
          ×
        </button>
      </div>
      <p className="pins-note">Saved on this device only. Shared pins need accounts, coming later.</p>
      {placing ? (
        <div className="pins-placing" role="status">
          <span>Tap the chart to place a pin.</span>
          <button type="button" onClick={onCancelPlacing}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="pins-add" onClick={onAdd}>
          + Add pin
        </button>
      )}
      {pins.length === 0 ? (
        <p className="pins-empty">No pins yet. Add one to mark an anchorage, a fuel dock, or anywhere you want to find again.</p>
      ) : (
        <ul className="pins-list">
          {pins.map((pin) => (
            <li key={pin.id}>
              <button
                type="button"
                className={pin.id === selectedId ? 'selected' : ''}
                onClick={() => onSelect(pin)}
              >
                <strong>{pin.title}</strong>
                <span>{formatLatLon(pin.lat, pin.lon)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="pins-editor">
          <label>
            Name
            <input
              value={selected.title}
              onChange={(event) => onUpdate(selected.id, { title: event.target.value })}
              aria-label="Pin name"
            />
          </label>
          <label>
            Notes
            <textarea
              value={selected.note}
              onChange={(event) => onUpdate(selected.id, { note: event.target.value })}
              aria-label="Pin notes"
              rows={3}
            />
          </label>
          <button type="button" className="pins-delete" onClick={() => onDelete(selected.id)}>
            Delete pin
          </button>
        </div>
      )}
    </section>
  );
}
