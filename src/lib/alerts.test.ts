import { describe, expect, it } from 'vitest';
import {
  PROXIMITY_RADIUS_M,
  anchorDriftAlert,
  chartAlerts,
  nearestTraffic,
  offCourseAlert,
  parseDraught,
  proximityAlert,
  shallowWaterAlert,
} from './alerts';
import type { AisVessel } from './ais';

function vessel(overrides: Partial<AisVessel> = {}): AisVessel {
  return {
    mmsi: 232000001,
    name: 'Test Trader',
    lat: 50.76,
    lon: -1.2,
    sog: 8,
    cog: 180,
    heading: 180,
    shipType: 'Cargo',
    typeCode: 70,
    destination: null,
    navStatus: 0,
    callSign: null,
    imo: null,
    draught: null,
    length: null,
    beam: null,
    eta: null,
    transponder: 'A',
    lastSeen: Date.now(),
    staticAt: null,
    simulated: false,
    ...overrides,
  };
}

describe('boat draught', () => {
  it('parses the figure entered in Boat settings', () => {
    expect(parseDraught('1.6')).toBe(1.6);
    expect(parseDraught(' 2,1 ')).toBe(2.1);
    expect(parseDraught('3')).toBe(3);
  });

  it('rejects anything that is not a plausible draught', () => {
    expect(parseDraught('')).toBeNull();
    expect(parseDraught(null)).toBeNull();
    expect(parseDraught('deep')).toBeNull();
    expect(parseDraught('0')).toBeNull();
    expect(parseDraught('-2')).toBeNull();
    expect(parseDraught('40')).toBeNull();
  });
});

describe('shallow water', () => {
  it('warns when the modelled depth leaves no water under the keel', () => {
    const alert = shallowWaterAlert(1.2, 1.6);
    expect(alert?.level).toBe('danger');
    expect(alert?.id).toBe('shallow');
    expect(alert?.detail).toContain('no water left under the keel');
  });

  it('warns when the margin under the keel is thin', () => {
    const alert = shallowWaterAlert(2.2, 1.6);
    expect(alert?.level).toBe('caution');
    expect(alert?.detail).toContain('under the keel');
  });

  it('stays quiet with comfortable water below', () => {
    expect(shallowWaterAlert(8, 1.6)).toBeNull();
  });

  it('stays quiet without a depth sample or a draught', () => {
    expect(shallowWaterAlert(null, 1.6)).toBeNull();
    expect(shallowWaterAlert(2, null)).toBeNull();
    expect(shallowWaterAlert(0, 1.6)).toBeNull();
  });

  it('writes the depth in the chosen units', () => {
    const alert = shallowWaterAlert(2.2, 1.6, { unit: 'ft' });
    expect(alert?.detail).toContain('ft');
    expect(alert?.detail).not.toContain(' m against');
  });
});

describe('traffic proximity', () => {
  const fix = { lat: 50.76, lon: -1.2 };

  it('finds the nearest vessel inside the radius', () => {
    const near = vessel({ mmsi: 1, lat: 50.762, lon: -1.2, cog: 180 });
    const far = vessel({ mmsi: 2, lat: 50.9, lon: -1.2 });
    const threat = nearestTraffic(fix, [far, near]);
    expect(threat?.vessel.mmsi).toBe(1);
    expect(threat?.distanceM).toBeLessThan(PROXIMITY_RADIUS_M);
    expect(threat?.distanceM).toBeGreaterThan(0);
  });

  it('ignores traffic outside the radius', () => {
    const distant = vessel({ lat: 51.2, lon: -1.2 });
    expect(nearestTraffic(fix, [distant])).toBeNull();
  });

  it('reports a target steering at the vessel as closing', () => {
    // Due north of the fix and steering south, straight at it.
    const oncoming = vessel({ lat: 50.764, lon: -1.2, cog: 180, sog: 9 });
    const threat = nearestTraffic(fix, [oncoming]);
    expect(threat?.closing).toBe(true);
    const alert = proximityAlert(threat);
    expect(alert?.detail).toContain('closing');
    expect(alert?.detail).toContain('°');
  });

  it('does not call a target crossing away closing', () => {
    const away = vessel({ lat: 50.764, lon: -1.2, cog: 0, sog: 9 });
    expect(nearestTraffic(fix, [away])?.closing).toBe(false);
  });

  it('labels a stopped target and uses its MMSI when unnamed', () => {
    const stopped = vessel({ name: null, sog: 0, lat: 50.761, lon: -1.2 });
    const alert = proximityAlert(nearestTraffic(fix, [stopped]));
    expect(alert?.title).toContain('232000001');
    expect(alert?.detail).toContain('stopped');
  });

  it('escalates very close traffic', () => {
    const veryClose = vessel({ lat: 50.7605, lon: -1.2 });
    expect(proximityAlert(nearestTraffic(fix, [veryClose]))?.level).toBe('danger');
  });

  it('reports the range in the distance unit chosen in settings', () => {
    const near = vessel({ lat: 50.7605, lon: -1.2 });
    const detail = proximityAlert(nearestTraffic(fix, [near]), PROXIMITY_RADIUS_M, {
      distanceUnit: 'nm-ft',
    })?.detail;
    expect(detail).toMatch(/^\d+ ft away/);
    expect(proximityAlert(nearestTraffic(fix, [near]))?.detail).toMatch(/^\d+ m away/);
  });
});

describe('anchor drift', () => {
  const droppedAt = 1_700_000_000_000;
  const anchor = { lat: 50.76, lon: -1.2, radiusM: 30, droppedAt };
  const at = (metresNorth: number) => ({ lat: 50.76 + metresNorth / 111_320, lon: -1.2 });

  it('stays quiet inside the swing circle', () => {
    expect(anchorDriftAlert(at(20), anchor)).toBeNull();
  });

  it('cautions just outside the circle', () => {
    const alert = anchorDriftAlert(at(45), anchor, { now: droppedAt + 24 * 60_000 });
    expect(alert?.level).toBe('caution');
    expect(alert?.id).toBe('anchor-drift');
    expect(alert?.detail).toContain('30 m circle');
    expect(alert?.detail).toContain('24 min ago');
    expect(alert?.detail).toContain('bearing 180°');
  });

  it('writes the swing radius in the distance unit chosen in settings', () => {
    const alert = anchorDriftAlert(at(45), anchor, { distanceUnit: 'nm-ft' });
    expect(alert?.detail).toContain('outside the 98 ft circle');
    expect(alert?.detail).not.toContain('30 m');
  });

  it('turns into a danger past twice the circle', () => {
    expect(anchorDriftAlert(at(120), anchor)?.level).toBe('danger');
  });

  it('reports the bearing back to the anchor, not away from it', () => {
    const south = { lat: 50.76 - 120 / 111_320, lon: -1.2 };
    expect(anchorDriftAlert(south, anchor)?.detail).toContain('bearing 0°');
  });

  it('says nothing without an anchor or a fix', () => {
    expect(anchorDriftAlert(null, anchor)).toBeNull();
    expect(anchorDriftAlert(at(500), null)).toBeNull();
  });
});

describe('off course', () => {
  const course = { bearingDeg: 42, toleranceDeg: 15 };
  const steaming = (heading: number, sog = 6) => ({ lat: 50.76, lon: -1.2, heading, sog });

  it('stays quiet inside the tolerance', () => {
    expect(offCourseAlert(steaming(50), course)).toBeNull();
  });

  it('cautions past the tolerance and reports which side', () => {
    const alert = offCourseAlert(steaming(70), course);
    expect(alert?.level).toBe('caution');
    expect(alert?.id).toBe('off-course');
    expect(alert?.detail).toContain('70° against 42°');
    expect(alert?.detail).toContain('28° to starboard');
  });

  it('reads port when the heading falls short of the course', () => {
    expect(offCourseAlert(steaming(10), course)?.detail).toContain('to port');
  });

  it('escalates well off the course', () => {
    expect(offCourseAlert(steaming(80), course)?.level).toBe('danger');
  });

  it('accepts a compass heading when the device reports no heading', () => {
    expect(offCourseAlert({ lat: 50.76, lon: -1.2, heading: null, compass: 120, sog: 5 }, course)?.level).toBe(
      'danger',
    );
  });

  it('does not judge a stopped vessel', () => {
    expect(offCourseAlert(steaming(120, 0.2), course)).toBeNull();
  });

  it('still judges the heading when the device reports no speed', () => {
    expect(offCourseAlert({ lat: 50.76, lon: -1.2, heading: 120, sog: null }, course)?.level).toBe(
      'danger',
    );
  });

  it('says nothing without a course or a heading', () => {
    expect(offCourseAlert(steaming(120), null)).toBeNull();
    expect(offCourseAlert({ lat: 50.76, lon: -1.2, heading: null, sog: 6 }, course)).toBeNull();
  });
});

describe('chart alerts', () => {
  const fix = { lat: 50.76, lon: -1.2 };
  const noWatch = { anchor: null, course: null };
  const off = { shallowEnabled: false, trafficEnabled: false, anchorEnabled: false, courseEnabled: false };

  it('follows the notification switches', () => {
    const input = { fix, vessels: [], watch: noWatch, depthM: 1.2, draughtM: 1.6 };
    expect(chartAlerts({ ...input, ...off })).toEqual([]);
    expect(chartAlerts({ ...input, ...off, shallowEnabled: true })).toHaveLength(1);
  });

  it('shows nothing without a fix', () => {
    expect(
      chartAlerts({
        fix: null,
        vessels: [vessel({ lat: 50.7605 })],
        watch: noWatch,
        depthM: 0.5,
        draughtM: 1.6,
        shallowEnabled: true,
        trafficEnabled: true,
        anchorEnabled: true,
        courseEnabled: true,
      }),
    ).toEqual([]);
  });

  it('puts the danger above the caution and keeps both ids stable', () => {
    const close = vessel({ lat: 50.7605, lon: -1.2 });
    const alerts = chartAlerts({
      fix,
      vessels: [close],
      watch: noWatch,
      depthM: 2.2,
      draughtM: 1.6,
      shallowEnabled: true,
      trafficEnabled: true,
      anchorEnabled: false,
      courseEnabled: false,
    });
    expect(alerts.map((alert) => alert.level)).toEqual(['danger', 'caution']);
    expect(alerts.map((alert) => alert.id)).toEqual(['proximity:232000001', 'shallow']);
  });

  it('raises the anchor and course cards only when their switches are on', () => {
    const watch = {
      anchor: { lat: 50.76, lon: -1.2, radiusM: 30, droppedAt: Date.now() },
      course: { bearingDeg: 42, toleranceDeg: 15 },
    };
    const drifting = { ...fix, lat: 50.762, heading: 110, sog: 5 };
    const base = { fix: drifting, vessels: [], watch, depthM: null, draughtM: null };
    expect(chartAlerts({ ...base, ...off })).toEqual([]);
    expect(chartAlerts({ ...base, ...off, anchorEnabled: true }).map((alert) => alert.kind)).toEqual([
      'anchor',
    ]);
    expect(chartAlerts({ ...base, ...off, courseEnabled: true }).map((alert) => alert.kind)).toEqual([
      'course',
    ]);
    expect(
      chartAlerts({ ...base, ...off, anchorEnabled: true, courseEnabled: true }).map((alert) => alert.kind),
    ).toEqual(['anchor', 'course']);
  });
});
