/**
 * The boat log: logbook, pre-departure checklist, maintenance, and fuel.
 * All four live on this device only, in localStorage — the synced,
 * account-backed version waits on the accounts project. Maintenance is
 * date-based in this version: the app does not track engine hours, so a
 * task repeats every N days from when it was last done.
 */

export interface LogEntry {
  id: string;
  date: string;
  title: string;
  notes: string;
}

export interface MaintenanceTask {
  id: string;
  title: string;
  /** Days between services; null means no repeating schedule. */
  intervalDays: number | null;
  /** ISO date the task was last done; null means never. */
  lastDone: string | null;
  notes: string;
}

export interface FuelFill {
  id: string;
  date: string;
  litres: number;
  /** Total cost in the navigator's currency; null when unknown. */
  totalCost: number | null;
  /** Tank level in litres just after this fill; null when not recorded. */
  levelAfterL: number | null;
  note: string;
}

export type MaintenanceStatus = 'overdue' | 'due-soon' | 'ok' | 'unscheduled';

export const LOGBOOK_KEY = 'wheel-over:logbook';
export const CHECKLIST_KEY = 'wheel-over:checklist';
export const MAINTENANCE_KEY = 'wheel-over:maintenance';
export const FUEL_KEY = 'wheel-over:fuel';

export interface ChecklistItem {
  id: string;
  label: string;
}

export interface ChecklistGroup {
  group: string;
  items: ChecklistItem[];
}

/** The pre-departure list, grouped the way a skipper walks the boat. */
export const CHECKLIST: ChecklistGroup[] = [
  {
    group: 'Before leaving',
    items: [
      { id: 'weather', label: 'Weather and tides checked' },
      { id: 'fuel-level', label: 'Fuel level checked' },
      { id: 'engine-oil', label: 'Engine oil level checked' },
      { id: 'coolant', label: 'Coolant level checked' },
      { id: 'bilge', label: 'Bilge dry and pump working' },
      { id: 'battery', label: 'Batteries charged' },
      { id: 'safety-gear', label: 'Safety gear aboard and in date' },
      { id: 'lifejackets', label: 'Lifejackets for everyone aboard' },
      { id: 'flares', label: 'Flares in date' },
      { id: 'radio', label: 'VHF radio check' },
      { id: 'nav-lights', label: 'Navigation lights working' },
      { id: 'anchor', label: 'Anchor and rode ready' },
      { id: 'lines', label: 'Lines and fenders ready' },
      { id: 'crew-brief', label: 'Crew briefed' },
    ],
  },
  {
    group: 'Under way',
    items: [
      { id: 'course', label: 'Course and waypoints set' },
      { id: 'ais', label: 'AIS traffic checked' },
      { id: 'watch', label: 'Anchor watch set where needed' },
    ],
  },
  {
    group: 'After return',
    items: [
      { id: 'washdown', label: 'Boat washed down' },
      { id: 'engine-off', label: 'Engine flushed and off' },
      { id: 'shore-power', label: 'Shore power connected' },
      { id: 'log', label: 'Trip written in the logbook' },
    ],
  },
];

export const CHECKLIST_IDS = new Set(CHECKLIST.flatMap((group) => group.items.map((item) => item.id)));

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

function readArray<T>(storage: Storage | null, key: string, valid: (value: unknown) => value is T): T[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(valid);
  } catch {
    return [];
  }
}

function writeArray(storage: Storage | null, key: string, value: unknown[]): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or unavailable store just means this section does not persist.
  }
}

function isLogEntry(value: unknown): value is LogEntry {
  const entry = value as Partial<LogEntry>;
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.notes === 'string'
  );
}

function isMaintenanceTask(value: unknown): value is MaintenanceTask {
  const task = value as Partial<MaintenanceTask>;
  return (
    !!task &&
    typeof task === 'object' &&
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    (task.intervalDays === null || (typeof task.intervalDays === 'number' && task.intervalDays > 0)) &&
    (task.lastDone === null || typeof task.lastDone === 'string') &&
    typeof task.notes === 'string'
  );
}

function isFuelFill(value: unknown): value is FuelFill {
  const fill = value as Partial<FuelFill>;
  return (
    !!fill &&
    typeof fill === 'object' &&
    typeof fill.id === 'string' &&
    typeof fill.date === 'string' &&
    typeof fill.litres === 'number' &&
    Number.isFinite(fill.litres) &&
    fill.litres > 0 &&
    (fill.totalCost === null || (typeof fill.totalCost === 'number' && Number.isFinite(fill.totalCost))) &&
    (fill.levelAfterL === null ||
      fill.levelAfterL === undefined ||
      (typeof fill.levelAfterL === 'number' && Number.isFinite(fill.levelAfterL) && fill.levelAfterL >= 0)) &&
    typeof fill.note === 'string'
  );
}

export function createLogEntry(date: string, title: string, notes: string): LogEntry {
  return { id: makeId('log'), date, title, notes };
}

export function loadLogbook(storage: Storage | null): LogEntry[] {
  return readArray(storage, LOGBOOK_KEY, isLogEntry).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function writeLogbook(storage: Storage | null, entries: LogEntry[]): void {
  writeArray(storage, LOGBOOK_KEY, entries);
}

export function createMaintenanceTask(
  title: string,
  intervalDays: number | null,
  notes: string,
): MaintenanceTask {
  return { id: makeId('maint'), title, intervalDays, lastDone: null, notes };
}

export function loadMaintenance(storage: Storage | null): MaintenanceTask[] {
  return readArray(storage, MAINTENANCE_KEY, isMaintenanceTask);
}

export function writeMaintenance(storage: Storage | null, tasks: MaintenanceTask[]): void {
  writeArray(storage, MAINTENANCE_KEY, tasks);
}

/** Days from today until a task is due; null when it has no schedule. */
export function daysUntilDue(task: MaintenanceTask, today: Date): number | null {
  if (task.intervalDays === null) return null;
  const base = task.lastDone ? new Date(`${task.lastDone}T00:00:00Z`) : new Date('1970-01-01T00:00:00Z');
  const due = new Date(base.getTime() + task.intervalDays * 24 * 60 * 60 * 1000);
  const startOfToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.round((due.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
}

export function maintenanceStatus(task: MaintenanceTask, today: Date): MaintenanceStatus {
  const days = daysUntilDue(task, today);
  if (days === null) return 'unscheduled';
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due-soon';
  return 'ok';
}

export function loadChecklist(storage: Storage | null): Record<string, boolean> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CHECKLIST_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const checked: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (CHECKLIST_IDS.has(id) && value === true) checked[id] = true;
    }
    return checked;
  } catch {
    return {};
  }
}

export function writeChecklist(storage: Storage | null, checked: Record<string, boolean>): void {
  if (!storage) return;
  try {
    storage.setItem(CHECKLIST_KEY, JSON.stringify(checked));
  } catch {
    // A full or unavailable store just means ticks do not persist.
  }
}

export function createFuelFill(
  date: string,
  litres: number,
  totalCost: number | null,
  note: string,
  levelAfterL: number | null = null,
): FuelFill {
  return { id: makeId('fuel'), date, litres, totalCost, levelAfterL, note };
}

export function loadFuel(storage: Storage | null): FuelFill[] {
  return readArray(storage, FUEL_KEY, isFuelFill).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function writeFuel(storage: Storage | null, fills: FuelFill[]): void {
  writeArray(storage, FUEL_KEY, fills);
}

export function fuelTotals(fills: FuelFill[]): {
  litres: number;
  cost: number;
  pricedFills: number;
  pricedLitres: number;
  avgCostPerLitre: number | null;
} {
  let litres = 0;
  let cost = 0;
  let pricedFills = 0;
  let pricedLitres = 0;
  for (const fill of fills) {
    litres += fill.litres;
    if (fill.totalCost !== null) {
      cost += fill.totalCost;
      pricedFills += 1;
      pricedLitres += fill.litres;
    }
  }
  return {
    litres,
    cost,
    pricedFills,
    pricedLitres,
    avgCostPerLitre: pricedLitres > 0 ? cost / pricedLitres : null,
  };
}

/** Tank capacity in litres, stored on its own; null when never set. */
export const FUEL_TANK_KEY = 'wheel-over:fuel-tank-capacity';

export function loadFuelTankCapacity(storage: Storage | null): number | null {
  if (!storage) return null;
  try {
    const parsed = Number(storage.getItem(FUEL_TANK_KEY));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeFuelTankCapacity(storage: Storage | null, litres: number | null): void {
  if (!storage) return;
  try {
    if (litres === null) storage.removeItem(FUEL_TANK_KEY);
    else storage.setItem(FUEL_TANK_KEY, String(litres));
  } catch {
    // A full or unavailable store must not break the log.
  }
}

/**
 * Latest recorded tank level: fills load newest first, so the first fill
 * carrying a level wins. Null when no fill recorded one.
 */
export function lastRecordedLevel(fills: FuelFill[]): number | null {
  for (const fill of fills) {
    if (fill.levelAfterL !== null) return fill.levelAfterL;
  }
  return null;
}

/** Tank level as a percent of capacity; null when either is unknown. */
export function tankPercent(levelL: number | null, capacityL: number | null): number | null {
  if (levelL === null || capacityL === null || capacityL <= 0) return null;
  return (levelL / capacityL) * 100;
}
