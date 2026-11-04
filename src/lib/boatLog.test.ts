import { describe, expect, it } from 'vitest';
import {
  CHECKLIST,
  createFuelFill,
  createLogEntry,
  createMaintenanceTask,
  daysUntilDue,
  fuelTotals,
  lastRecordedLevel,
  loadChecklist,
  loadFuel,
  loadFuelTankCapacity,
  loadLogbook,
  loadMaintenance,
  maintenanceStatus,
  tankPercent,
  writeChecklist,
  writeFuel,
  writeFuelTankCapacity,
  writeLogbook,
  writeMaintenance,
  type FuelFill,
  type MaintenanceTask,
} from './boatLog';

function memoryStorage(initial?: Record<string, string>): Storage {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  } as Storage;
}

const today = new Date('2026-11-03T12:00:00Z');

describe('logbook round trip', () => {
  it('writes and loads newest first, dropping bad rows', () => {
    const storage = memoryStorage();
    writeLogbook(storage, [
      createLogEntry('2026-11-01', 'Solent day', 'Calm'),
      createLogEntry('2026-11-03', 'Cowes run', 'Windy'),
    ]);
    const loaded = loadLogbook(storage);
    expect(loaded.map((entry) => entry.title)).toEqual(['Cowes run', 'Solent day']);
    const dirty = memoryStorage({ 'wheel-over:logbook': JSON.stringify([{ id: 'x' }, loaded[0]]) });
    expect(loadLogbook(dirty).map((entry) => entry.title)).toEqual(['Cowes run']);
  });
});

describe('maintenance status', () => {
  const task = (overrides: Partial<MaintenanceTask>): MaintenanceTask => ({
    id: 'm1',
    title: 'Oil change',
    intervalDays: 90,
    lastDone: '2026-10-01',
    notes: '',
    ...overrides,
  });

  it('computes days until due from last done', () => {
    expect(daysUntilDue(task({ lastDone: '2026-10-01' }), today)).toBe(57);
    expect(daysUntilDue(task({ lastDone: '2026-08-01' }), today)).toBe(-4);
    expect(daysUntilDue(task({ intervalDays: null }), today)).toBe(null);
  });

  it('treats a never-done scheduled task as overdue', () => {
    expect(maintenanceStatus(task({ lastDone: null }), today)).toBe('overdue');
  });

  it('classifies the bands', () => {
    expect(maintenanceStatus(task({ lastDone: '2026-08-04' }), today)).toBe('overdue');
    expect(maintenanceStatus(task({ lastDone: '2026-08-07' }), today)).toBe('due-soon');
    expect(maintenanceStatus(task({ lastDone: '2026-10-01' }), today)).toBe('ok');
    expect(maintenanceStatus(task({ intervalDays: null }), today)).toBe('unscheduled');
  });
});

describe('maintenance round trip', () => {
  it('writes and loads tasks', () => {
    const storage = memoryStorage();
    writeMaintenance(storage, [createMaintenanceTask('Impeller', 365, '')]);
    const loaded = loadMaintenance(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.title).toBe('Impeller');
    expect(loaded[0]?.lastDone).toBe(null);
  });
});

describe('checklist', () => {
  it('keeps only known items ticked', () => {
    const storage = memoryStorage({
      'wheel-over:checklist': JSON.stringify({ weather: true, bogus: true, 'fuel-level': false }),
    });
    expect(loadChecklist(storage)).toEqual({ weather: true });
    const target = memoryStorage();
    writeChecklist(target, { weather: true });
    expect(loadChecklist(target)).toEqual({ weather: true });
  });

  it('covers every group with unique ids', () => {
    const ids = CHECKLIST.flatMap((group) => group.items.map((item) => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
  });
});

describe('fuel', () => {
  it('totals litres and priced cost, newest first', () => {
    const storage = memoryStorage();
    writeFuel(storage, [
      createFuelFill('2026-11-01', 40, 80, 'Diesel'),
      createFuelFill('2026-11-03', 25, null, ''),
    ]);
    const loaded = loadFuel(storage);
    expect(loaded.map((fill) => fill.litres)).toEqual([25, 40]);
    expect(fuelTotals(loaded)).toEqual({
      litres: 65,
      cost: 80,
      pricedFills: 1,
      pricedLitres: 40,
      avgCostPerLitre: 2,
    });
  });

  it('keeps old fills without a recorded level, and reports the latest level', () => {
    const storage = memoryStorage();
    const legacy = { id: 'fuel-old', date: '2026-10-01', litres: 30, totalCost: null, note: '' };
    writeFuel(storage, [
      legacy as FuelFill,
      createFuelFill('2026-11-03', 25, null, '', 120),
    ]);
    const loaded = loadFuel(storage);
    expect(loaded).toHaveLength(2);
    expect(lastRecordedLevel(loaded)).toBe(120);
    expect(lastRecordedLevel([])).toBeNull();
  });

  it('stores tank capacity and computes percent only when both are known', () => {
    const storage = memoryStorage();
    expect(loadFuelTankCapacity(storage)).toBeNull();
    writeFuelTankCapacity(storage, 200);
    expect(loadFuelTankCapacity(storage)).toBe(200);
    expect(tankPercent(120, 200)).toBe(60);
    expect(tankPercent(null, 200)).toBeNull();
    expect(tankPercent(120, null)).toBeNull();
    writeFuelTankCapacity(storage, null);
    expect(loadFuelTankCapacity(storage)).toBeNull();
  });
});
