import { useEffect, useMemo, useRef, useState } from 'react';
import { distanceMeters } from '../../shared/navaid-core.mjs';
import type { AisVessel } from '../lib/ais';
import type { AppSettings } from '../lib/settings';
import { chartAlerts, parseDraught } from '../lib/alerts';
import type { ChartAlert } from '../lib/alerts';
import { fetchDepthSamples } from '../lib/depthLabels';
import type { VoyageWatch } from '../lib/voyageWatch';
import type { GeoFix } from './useGeolocation';

/** Re-probe the seabed after this much movement, or this long at rest. */
const PROBE_DISTANCE_M = 150;
const PROBE_INTERVAL_MS = 5 * 60 * 1000;

export interface ChartAlertInput {
  fix: GeoFix | null;
  vessels: AisVessel[];
  settings: AppSettings;
  watch: VoyageWatch;
}

/**
 * The alerts the chart is currently showing: modelled depth under the keel, the
 * nearest AIS traffic, a dragging anchor and a heading off the course to steer.
 * All four are driven by the switches in Settings, so turning a switch off stops
 * the work as well as the card.
 */
export function useChartAlerts({ fix, vessels, settings, watch }: ChartAlertInput): ChartAlert[] {
  const draughtM = parseDraught(settings.boat.draughtM);
  const shallowEnabled = settings.notifications.shallowWater && draughtM !== null;
  const [depthM, setDepthM] = useState<number | null>(null);
  const lastProbe = useRef<{ lat: number; lon: number; at: number } | null>(null);
  // A fix arrives every second or so. The probe is kept out of that effect's
  // cleanup, otherwise each new fix aborts the request before it answers and a
  // boat sitting still never gets a depth at all.
  const activeProbe = useRef<AbortController | null>(null);

  const fixLat = fix?.lat ?? null;
  const fixLon = fix?.lon ?? null;

  useEffect(() => {
    if (shallowEnabled && fixLat !== null && fixLon !== null) return;
    activeProbe.current?.abort();
    activeProbe.current = null;
    lastProbe.current = null;
    setDepthM(null);
  }, [shallowEnabled, fixLat, fixLon]);

  useEffect(() => {
    if (!shallowEnabled || fixLat === null || fixLon === null) return;
    if (activeProbe.current) return;
    const last = lastProbe.current;
    if (last) {
      const moved = distanceMeters(last.lat, last.lon, fixLat, fixLon);
      const age = Date.now() - last.at;
      if (moved < PROBE_DISTANCE_M && age < PROBE_INTERVAL_MS) return;
    }
    lastProbe.current = { lat: fixLat, lon: fixLon, at: Date.now() };
    const controller = new AbortController();
    activeProbe.current = controller;
    void (async () => {
      try {
        await fetchDepthSamples([{ lat: fixLat, lon: fixLon }], 14, controller.signal, (_point, sample) => {
          if (sample.depth === null) return;
          setDepthM(sample.depth);
        });
      } catch {
        // A failed probe leaves the shallow-water alert off; the chart itself is
        // unaffected, and the next move or five minutes retries.
      } finally {
        if (activeProbe.current === controller) activeProbe.current = null;
      }
    })();
  }, [shallowEnabled, fixLat, fixLon]);

  useEffect(() => () => activeProbe.current?.abort(), []);

  return useMemo(
    () =>
      chartAlerts({
        fix,
        vessels,
        watch,
        depthM,
        draughtM,
        depthUnit: settings.units.depth,
        distanceUnit: settings.units.distance,
        shallowEnabled: settings.notifications.shallowWater,
        trafficEnabled: settings.notifications.aisProximity,
        anchorEnabled: settings.notifications.anchorDrift,
        courseEnabled: settings.notifications.offCourse,
      }),
    [
      fix,
      vessels,
      watch,
      depthM,
      draughtM,
      settings.units.depth,
      settings.units.distance,
      settings.notifications.shallowWater,
      settings.notifications.aisProximity,
      settings.notifications.anchorDrift,
      settings.notifications.offCourse,
    ],
  );
}
