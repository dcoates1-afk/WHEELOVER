import { describe, expect, it } from 'vitest';
import type { AisVessel } from './ais';
import {
  trackingFields,
  trackingSubtitle,
  trackingTargets,
  trackingTitle,
} from './tracking';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

function vessel(overrides: Partial<AisVessel> = {}): AisVessel {
  return {
    mmsi: 232001234,
    name: 'RED JET 6',
    lat: 50.795,
    lon: -1.29,
    sog: 21.4,
    cog: 205,
    heading: 203,
    shipType: 'Passenger',
    typeCode: 60,
    destination: 'PORTSMOUTH',
    navStatus: 0,
    callSign: 'MABC1',
    imo: 9_123_456,
    draught: 2.4,
    length: 40,
    beam: 10,
    eta: '14 Jun 22:00 UTC',
    transponder: 'A',
    lastSeen: NOW - 45_000,
    staticAt: NOW - 600_000,
    simulated: false,
    ...overrides,
  };
}

const CENTRE: [number, number] = [50.75, -1.21];

function field(
  page: 'overview' | 'particulars' | 'voyage',
  label: string,
  target = vessel(),
): string | null | undefined {
  return trackingFields(page, target, {
    centre: CENTRE,
    distanceUnit: 'nm-ft',
    depthUnit: 'm',
    now: NOW,
  }).find((entry) => entry.label === label)?.value;
}

describe('tracking info', () => {
  it('leads with what the target is doing now', () => {
    expect(field('overview', 'Status')).toBe('Under way using engine');
    expect(field('overview', 'Speed over ground')).toBe('21.4 kn');
    expect(field('overview', 'Course over ground')).toBe('205°');
    expect(field('overview', 'Heading')).toBe('203°');
    expect(field('overview', 'Position')).toBe('50° 47.700′ N  01° 17.400′ W');
  });

  it('measures the range from the chart centre', () => {
    const range = field('overview', 'From chart centre');
    expect(range).toMatch(/^(4\.\d|5\.\d) nm · bearing \d{3}°$/);
  });

  it('dates both reports', () => {
    expect(field('overview', 'Position report')).toBe('45s ago');
    expect(field('particulars', 'Static report')).toBe('10m ago');
  });

  it('lists the particulars in the chosen units', () => {
    expect(field('particulars', 'Type')).toBe('Passenger');
    expect(field('particulars', 'MMSI')).toBe('232001234');
    expect(field('particulars', 'IMO')).toBe('9123456');
    expect(field('particulars', 'Call sign')).toBe('MABC1');
    expect(field('particulars', 'Flag')).toBe('GB · United Kingdom');
    expect(field('particulars', 'Size (L × B)')).toBe('131 ft × 32.8 ft');
    expect(field('particulars', 'Draught')).toBe('2.4 m');
    expect(field('particulars', 'Transponder')).toBe('Class A');
  });

  it('leaves an unreported field empty rather than guessing', () => {
    const silent = vessel({ imo: null, callSign: null, destination: null, eta: null, draught: null });
    expect(field('particulars', 'IMO', silent)).toBeNull();
    expect(field('particulars', 'Call sign', silent)).toBeNull();
    expect(field('particulars', 'Draught', silent)).toBeNull();
    expect(field('voyage', 'Destination', silent)).toBeNull();
    expect(field('voyage', 'ETA (reported)', silent)).toBeNull();
  });

  it('reads the voyage page from the AIS voyage message', () => {
    expect(field('voyage', 'Destination')).toBe('PORTSMOUTH');
    expect(field('voyage', 'ETA (reported)')).toBe('14 Jun 22:00 UTC');
    expect(field('voyage', 'Reported draught')).toBe('2.4 m');
    expect(field('voyage', 'Course over ground')).toBe('205°');
  });

  it('prefers the reported type over the colour class', () => {
    expect(field('particulars', 'Type', vessel({ shipType: 'High speed craft' }))).toBe(
      'High speed craft · Passenger',
    );
    expect(field('particulars', 'Type', vessel({ shipType: null }))).toBe('Passenger');
  });

  it('names a target that has not sent its name yet', () => {
    const unnamed = vessel({ name: null });
    expect(trackingTitle(unnamed)).toBe('MMSI 232001234');
    expect(trackingSubtitle(unnamed)).toBe('Passenger · Under way using engine · Class A');
  });

  it('orders the picker by range and caps the list', () => {
    const near = vessel({ mmsi: 1, lat: 50.751, lon: -1.211 });
    const far = vessel({ mmsi: 2, lat: 51.2, lon: -1.3 });
    const middle = vessel({ mmsi: 3, lat: 50.9, lon: -1.25 });
    const targets = trackingTargets([far, middle, near], CENTRE);
    expect(targets.map((entry) => entry.vessel.mmsi)).toEqual([1, 3, 2]);
    expect(targets[0].metres).toBeLessThan(targets[1].metres);
    expect(trackingTargets([near, far], CENTRE, 1)).toHaveLength(1);
  });
});
