import { useState } from 'react';
import {
  CHECKLIST,
  createFuelFill,
  createLogEntry,
  createMaintenanceTask,
  fuelTotals,
  maintenanceStatus,
  type FuelFill,
  type LogEntry,
  type MaintenanceTask,
} from '../lib/boatLog';
import {
  formatTrackDate,
  formatTrackDuration,
  trackDistanceKm,
  type Track,
} from '../lib/tracks';

type Tab = 'log' | 'checklist' | 'maintenance' | 'fuel' | 'tracks';

interface BoatPanelProps {
  logbook: LogEntry[];
  onAddLog: (entry: LogEntry) => void;
  onDeleteLog: (id: string) => void;
  checked: Record<string, boolean>;
  onToggleCheck: (id: string) => void;
  onResetChecklist: () => void;
  maintenance: MaintenanceTask[];
  onAddMaintenance: (task: MaintenanceTask) => void;
  onDoneMaintenance: (id: string, date: string) => void;
  onDeleteMaintenance: (id: string) => void;
  fuel: FuelFill[];
  onAddFuel: (fill: FuelFill) => void;
  onDeleteFuel: (id: string) => void;
  tracks: Track[];
  recording: Track | null;
  hasFix: boolean;
  shownTrackId: string | null;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onShowTrack: (id: string | null) => void;
  onDeleteTrack: (id: string) => void;
  onClose: () => void;
}

function todayLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'log', label: 'Logbook' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'tracks', label: 'Tracks' },
];

/**
 * The boat's own records, kept on this device only: trips, the
 * pre-departure checklist, date-based maintenance, and fuel fills.
 * Maintenance repeats by days here — the app does not track engine
 * hours, so hour-based servicing is not part of this version.
 */
export function BoatPanel(props: BoatPanelProps) {
  const [tab, setTab] = useState<Tab>('log');
  const [logDate, setLogDate] = useState(todayLocal());
  const [logTitle, setLogTitle] = useState('');
  const [logNotes, setLogNotes] = useState('');
  const [maintTitle, setMaintTitle] = useState('');
  const [maintInterval, setMaintInterval] = useState('');
  const [maintNotes, setMaintNotes] = useState('');
  const [fuelDate, setFuelDate] = useState(todayLocal());
  const [fuelLitres, setFuelLitres] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const [fuelNote, setFuelNote] = useState('');

  const checkedCount = CHECKLIST.flatMap((group) => group.items).filter(
    (item) => props.checked[item.id],
  ).length;
  const checklistTotal = CHECKLIST.flatMap((group) => group.items).length;
  const totals = fuelTotals(props.fuel);
  const today = new Date();

  return (
    <section className="boat-panel" aria-label="Boat log">
      <div className="boat-panel-head">
        <h2>Boat log</h2>
        <button type="button" className="boat-close" onClick={props.onClose} aria-label="Close boat log">
          ×
        </button>
      </div>
      <p className="boat-note">Saved on this device only. Synced records need accounts, coming later.</p>
      <div className="boat-tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'active' : ''}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'log' && (
        <div className="boat-section">
          <form
            className="boat-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!logTitle.trim()) return;
              props.onAddLog(createLogEntry(logDate, logTitle.trim(), logNotes.trim()));
              setLogTitle('');
              setLogNotes('');
            }}
          >
            <label>
              Date
              <input type="date" value={logDate} onChange={(event) => setLogDate(event.target.value)} />
            </label>
            <label>
              Trip
              <input
                value={logTitle}
                onChange={(event) => setLogTitle(event.target.value)}
                placeholder="e.g. Cowes to Yarmouth"
                aria-label="Trip title"
              />
            </label>
            <label>
              Notes
              <textarea
                value={logNotes}
                onChange={(event) => setLogNotes(event.target.value)}
                rows={3}
                placeholder="Weather, crew, anything worth remembering"
              />
            </label>
            <button type="submit" className="boat-submit">
              Add log entry
            </button>
          </form>
          {props.logbook.length === 0 ? (
            <p className="boat-empty">No trips logged yet.</p>
          ) : (
            <ul className="boat-list">
              {props.logbook.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>{entry.title}</strong>
                    <span>{entry.date}</span>
                    {entry.notes && <p>{entry.notes}</p>}
                  </div>
                  <button type="button" className="boat-delete" onClick={() => props.onDeleteLog(entry.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'checklist' && (
        <div className="boat-section">
          <p className="boat-progress">
            {checkedCount} of {checklistTotal} checked
            <button type="button" onClick={props.onResetChecklist}>
              Reset for next trip
            </button>
          </p>
          {CHECKLIST.map((group) => (
            <div key={group.group} className="boat-check-group">
              <h3>{group.group}</h3>
              {group.items.map((item) => (
                <label key={item.id} className="boat-check-item">
                  <input
                    type="checkbox"
                    checked={Boolean(props.checked[item.id])}
                    onChange={() => props.onToggleCheck(item.id)}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'maintenance' && (
        <div className="boat-section">
          <p className="boat-note">Date-based: a task repeats every N days from when it was last done.</p>
          <form
            className="boat-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!maintTitle.trim()) return;
              const interval = maintInterval.trim() === '' ? null : Number(maintInterval);
              if (interval !== null && (!Number.isFinite(interval) || interval <= 0)) return;
              props.onAddMaintenance(createMaintenanceTask(maintTitle.trim(), interval, maintNotes.trim()));
              setMaintTitle('');
              setMaintInterval('');
              setMaintNotes('');
            }}
          >
            <label>
              Task
              <input
                value={maintTitle}
                onChange={(event) => setMaintTitle(event.target.value)}
                placeholder="e.g. Engine oil change"
                aria-label="Maintenance task"
              />
            </label>
            <label>
              Repeat every (days, blank for no schedule)
              <input
                type="number"
                min={1}
                value={maintInterval}
                onChange={(event) => setMaintInterval(event.target.value)}
                placeholder="e.g. 90"
              />
            </label>
            <label>
              Notes
              <input
                value={maintNotes}
                onChange={(event) => setMaintNotes(event.target.value)}
                placeholder="Parts, oil grade, anything useful"
              />
            </label>
            <button type="submit" className="boat-submit">
              Add task
            </button>
          </form>
          {props.maintenance.length === 0 ? (
            <p className="boat-empty">No maintenance tasks yet.</p>
          ) : (
            <ul className="boat-list">
              {props.maintenance.map((task) => {
                const status = maintenanceStatus(task, today);
                return (
                  <li key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <span className={`maint-pill maint-${status}`}>
                        {status === 'overdue'
                          ? 'Overdue'
                          : status === 'due-soon'
                            ? 'Due soon'
                            : status === 'ok'
                              ? 'On schedule'
                              : 'No schedule'}
                      </span>
                      <span>
                        {task.lastDone ? `Last done ${task.lastDone}` : 'Never done'}
                        {task.intervalDays !== null ? ` · every ${task.intervalDays} days` : ''}
                      </span>
                      {task.notes && <p>{task.notes}</p>}
                    </div>
                    <div className="boat-row-actions">
                      <button type="button" onClick={() => props.onDoneMaintenance(task.id, todayLocal())}>
                        Mark done
                      </button>
                      <button
                        type="button"
                        className="boat-delete"
                        onClick={() => props.onDeleteMaintenance(task.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'fuel' && (
        <div className="boat-section">
          <p className="boat-progress">
            {totals.litres.toFixed(1)} L total
            {totals.pricedFills > 0 ? ` · ${totals.cost.toFixed(2)} across ${totals.pricedFills} priced fills` : ''}
          </p>
          <form
            className="boat-form"
            onSubmit={(event) => {
              event.preventDefault();
              const litres = Number(fuelLitres);
              if (!Number.isFinite(litres) || litres <= 0) return;
              const cost = fuelCost.trim() === '' ? null : Number(fuelCost);
              if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return;
              props.onAddFuel(createFuelFill(fuelDate, litres, cost, fuelNote.trim()));
              setFuelLitres('');
              setFuelCost('');
              setFuelNote('');
            }}
          >
            <label>
              Date
              <input type="date" value={fuelDate} onChange={(event) => setFuelDate(event.target.value)} />
            </label>
            <label>
              Litres
              <input
                type="number"
                min={0}
                step="any"
                value={fuelLitres}
                onChange={(event) => setFuelLitres(event.target.value)}
                placeholder="e.g. 40"
              />
            </label>
            <label>
              Total cost (optional)
              <input
                type="number"
                min={0}
                step="any"
                value={fuelCost}
                onChange={(event) => setFuelCost(event.target.value)}
                placeholder="e.g. 80"
              />
            </label>
            <label>
              Note
              <input
                value={fuelNote}
                onChange={(event) => setFuelNote(event.target.value)}
                placeholder="e.g. Diesel, Town Quay"
              />
            </label>
            <button type="submit" className="boat-submit">
              Add fill
            </button>
          </form>
          {props.fuel.length === 0 ? (
            <p className="boat-empty">No fuel fills logged yet.</p>
          ) : (
            <ul className="boat-list">
              {props.fuel.map((fill) => (
                <li key={fill.id}>
                  <div>
                    <strong>
                      {fill.litres} L · {fill.date}
                    </strong>
                    <span>
                      {fill.totalCost !== null ? `Cost ${fill.totalCost.toFixed(2)}` : 'Cost unknown'}
                      {fill.note ? ` · ${fill.note}` : ''}
                    </span>
                  </div>
                  <button type="button" className="boat-delete" onClick={() => props.onDeleteFuel(fill.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'tracks' && (
        <div className="boat-section">
          <p className="boat-note">
            Your own track, recorded from GPS and saved on this device only. A point is added
            once you have moved 25 m, so sitting at anchor does not fill the track with jitter.
          </p>
          {props.recording ? (
            <div className="track-recording">
              <p>
                <strong>Recording</strong> · {props.recording.points.length} points ·{' '}
                {trackDistanceKm(props.recording).toFixed(1)} km ·{' '}
                {formatTrackDuration(props.recording)}
              </p>
              <button type="button" className="boat-submit" onClick={props.onStopRecording}>
                Stop and save track
              </button>
            </div>
          ) : (
            <div className="track-recording">
              {!props.hasFix && (
                <p className="boat-note">
                  No GPS fix yet — turn GPS on and wait for a fix before recording.
                </p>
              )}
              <button
                type="button"
                className="boat-submit"
                disabled={!props.hasFix}
                onClick={props.onStartRecording}
              >
                Start recording
              </button>
            </div>
          )}
          {props.tracks.length === 0 ? (
            <p className="boat-empty">No saved tracks yet.</p>
          ) : (
            <ul className="boat-list">
              {props.tracks.map((track) => (
                <li key={track.id}>
                  <div>
                    <strong>{formatTrackDate(track)}</strong>
                    <span>
                      {track.points.length} points · {trackDistanceKm(track).toFixed(1)} km ·{' '}
                      {formatTrackDuration(track)}
                    </span>
                  </div>
                  <div className="boat-row-actions">
                    <button
                      type="button"
                      onClick={() =>
                        props.onShowTrack(props.shownTrackId === track.id ? null : track.id)
                      }
                    >
                      {props.shownTrackId === track.id ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      className="boat-delete"
                      onClick={() => props.onDeleteTrack(track.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
