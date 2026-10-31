import { useState } from 'react';
import type { ReactNode } from 'react';
import type { BaseLayerId, ChartPreferences, ThemeId } from '../lib/chartPreferences';
import type { GpsMode } from '../lib/gpsPreference';
import type { GeoFix, GeoStatus } from '../hooks/useGeolocation';
import {
  ANCHOR_RADIUS_DEFAULT_M,
  ANCHOR_RADIUS_MAX_M,
  ANCHOR_RADIUS_MIN_M,
  COURSE_TOLERANCE_DEFAULT_DEG,
  formatWatchAge,
  normalizeBearing,
  parseCourseDeg,
  parseRadiusM,
  parseToleranceDeg,
} from '../lib/voyageWatch';
import type { VoyageWatch } from '../lib/voyageWatch';
import type { StationTab } from '../lib/station';
import { STATION_LABELS } from '../lib/station';
import { symbolFor } from '../lib/navaids';
import { NAVAID_GROUPS, isGroupHidden, toggleGroup } from '../lib/navaidGroups';
import { POI_GROUPS, isPoiGroupHidden, togglePoiGroup } from '../lib/poiGroups';
import { poiIconSvg } from '../lib/pois';
import { formatBytes } from '../lib/noaaChart';
import {
  BEARING_MODES,
  BOAT_TYPES,
  COORDINATE_FORMATS,
  DEPTH_UNITS,
  DISTANCE_UNITS,
  EXPERIENCE_LEVELS,
  depthUnitLabel,
  formatDistance,
  FUEL_UNITS,
  PRESSURE_UNITS,
  RATE_OF_TURN_UNITS,
  RELATIVE_BEARING_MODES,
  SPEED_UNITS,
  TEMPERATURE_UNITS,
  WIND_SPEED_UNITS,
} from '../lib/settings';
import type { AppSettings, DistanceUnit, UnitOption } from '../lib/settings';

export interface MarkStats {
  shown: number;
  total: number;
  live: boolean;
  cached: boolean;
}

export interface DbInfo {
  version: string;
  builtAt: string;
  count: number;
  duplicates: number;
  sources: string[];
  checkedAt: number | null;
}

interface LayerControlProps {
  open: boolean;
  onOpen: (open: boolean) => void;
  preferences: ChartPreferences;
  onChange: (next: ChartPreferences) => void;
  gpsMode: GpsMode;
  onGpsMode: (mode: GpsMode) => void;
  geoStatus: GeoStatus;
  geoError: string | null;
  markStats: MarkStats;
  dbInfo: DbInfo | null;
  onCheckUpdates: () => void;
  checking: boolean;
  checkMessage: string | null;
  chartCache: { tiles: number; bytes: number } | null;
  station: StationTab | null;
  onStation: (tab: StationTab | null) => void;
  noaaCovered: boolean;
  legendRegion: 'A' | 'B';
  settings: AppSettings;
  onSettings: (next: AppSettings) => void;
  fix: GeoFix | null;
  watch: VoyageWatch;
  onWatch: (next: VoyageWatch) => void;
  hidden?: boolean;
}

function Section({ title, children, hint, defaultOpen = false, id }: { title: string; children: ReactNode; hint?: string; defaultOpen?: boolean; id?: string }) {
  return (
    <details id={id} className="menu-section" open={defaultOpen}>
      <summary className="section-title section-summary">{title}</summary>
      {hint && <p className="section-hint">{hint}</p>}
      <div className="menu-rows">{children}</div>
    </details>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="menu-row"
      onClick={() => onChange(!checked)}
    >
      <span className="row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className={`switch ${checked ? 'on' : ''}`} aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

function RadioRow({
  label,
  hint,
  active,
  onSelect,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`menu-row ${active ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span className="row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className={`radio-dot ${active ? 'on' : ''}`} aria-hidden="true" />
    </button>
  );
}

function SelectRow<T extends string>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: UnitOption<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <label className="menu-select">
      <span className="row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="menu-field">
      <span className="row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * A number field with − and + buttons. The figure can still be typed in full,
 * which is quicker for a big change than holding a button; the buttons clamp to
 * the field's limits so the stored radius is never out of range.
 */
function StepperField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  onBlur,
}: {
  label: string;
  hint?: string;
  value: string;
  min: number;
  max: number;
  step: number;
  onChange: (next: string) => void;
  /** Called after focus leaves the field, so a half-typed figure can be tidied. */
  onBlur?: () => void;
}) {
  const typed = Number.parseFloat(value.replace(',', '.'));
  const current = Number.isFinite(typed) ? typed : min;
  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(min, Math.round(current + delta)));
    onChange(String(next));
  };
  return (
    <div className="menu-field stepper-field">
      <span className="row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <div className="stepper" role="group" aria-label={label}>
        <button
          type="button"
          className="stepper-button"
          aria-label={`Decrease ${label}`}
          disabled={current <= min}
          onClick={() => nudge(-step)}
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
        <button
          type="button"
          className="stepper-button"
          aria-label={`Increase ${label}`}
          disabled={current >= max}
          onClick={() => nudge(step)}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Anchor watch and course to steer. Both are set from the live fix: the anchor
 * circle is where the boat is now, and the course is either typed in or taken
 * from the heading being steered. The alerts in Settings read this state.
 */
function VoyageWatchSection({
  fix,
  watch,
  onWatch,
  distanceUnit,
}: {
  fix: GeoFix | null;
  watch: VoyageWatch;
  onWatch: (next: VoyageWatch) => void;
  distanceUnit?: DistanceUnit;
}) {
  const [radius, setRadius] = useState(() =>
    String(watch.anchor?.radiusM ?? ANCHOR_RADIUS_DEFAULT_M),
  );
  const [course, setCourse] = useState(() =>
    watch.course ? String(Math.round(watch.course.bearingDeg)) : '',
  );
  const [tolerance, setTolerance] = useState(() =>
    String(watch.course?.toleranceDeg ?? COURSE_TOLERANCE_DEFAULT_DEG),
  );

  const radiusM = parseRadiusM(radius);
  const toleranceDeg = parseToleranceDeg(tolerance) ?? COURSE_TOLERANCE_DEFAULT_DEG;

  const setAnchorRadius = (next: string) => {
    setRadius(next);
    const parsed = parseRadiusM(next);
    if (parsed === null || !watch.anchor) return;
    onWatch({ ...watch, anchor: { ...watch.anchor, radiusM: parsed } });
  };

  const setCourseText = (next: string) => {
    setCourse(next);
    const parsed = parseCourseDeg(next);
    if (next.trim() === '') {
      if (watch.course) onWatch({ ...watch, course: null });
      return;
    }
    if (parsed === null) return;
    onWatch({ ...watch, course: { bearingDeg: parsed, toleranceDeg } });
  };

  const setToleranceText = (next: string) => {
    setTolerance(next);
    const parsed = parseToleranceDeg(next);
    if (parsed === null || !watch.course) return;
    onWatch({ ...watch, course: { ...watch.course, toleranceDeg: parsed } });
  };

  const anchorAge = watch.anchor
    ? formatWatchAge(Date.now() - watch.anchor.droppedAt)
    : null;

  return (
    <>
      <p className="menu-note">
        {fix
          ? 'Uses the live position fix. Kept on this device.'
          : 'Waiting for a position fix — the anchor and heading cannot be set yet.'}
      </p>
      <p className="menu-note" data-testid="anchor-watch-status">
        {watch.anchor
          ? `Anchor down at ${watch.anchor.lat.toFixed(5)}, ${watch.anchor.lon.toFixed(5)} · ${
              formatDistance(watch.anchor.radiusM, distanceUnit)
            } circle · dropped ${anchorAge === 'just now' ? 'just now' : `${anchorAge} ago`}`
          : 'No anchor down.'}
      </p>
      <StepperField
        label="Swing circle"
        hint={`metres, ${ANCHOR_RADIUS_MIN_M}–${ANCHOR_RADIUS_MAX_M} · ${formatDistance(
          radiusM ?? watch.anchor?.radiusM ?? ANCHOR_RADIUS_DEFAULT_M,
          distanceUnit,
        )} on the chart`}
        value={radius}
        min={ANCHOR_RADIUS_MIN_M}
        max={ANCHOR_RADIUS_MAX_M}
        step={10}
        onChange={setAnchorRadius}
        onBlur={() => {
          // Put the field back on the circle that is actually drawn when the
          // typed figure is not a usable radius.
          if (parseRadiusM(radius) === null) {
            setRadius(String(watch.anchor?.radiusM ?? ANCHOR_RADIUS_DEFAULT_M));
          }
        }}
      />
      <button
        type="button"
        className="secondary-button wide"
        disabled={!fix}
        onClick={() => {
          if (!fix) return;
          onWatch({
            ...watch,
            anchor: {
              lat: fix.lat,
              lon: fix.lon,
              radiusM: radiusM ?? ANCHOR_RADIUS_DEFAULT_M,
              droppedAt: Date.now(),
            },
          });
        }}
      >
        Drop anchor here
      </button>
      {watch.anchor && (
        <button
          type="button"
          className="secondary-button wide"
          onClick={() => onWatch({ ...watch, anchor: null })}
        >
          Weigh anchor
        </button>
      )}
      <p className="menu-note" data-testid="course-watch-status">
        {watch.course
          ? `Course to steer ${Math.round(watch.course.bearingDeg)}° true · ${
              watch.course.toleranceDeg
            }° either side`
          : 'No course to steer set.'}
      </p>
      <div className="menu-field-pair">
        <TextField
          label="Course to steer"
          hint="degrees true"
          placeholder="042"
          value={course}
          onChange={setCourseText}
        />
        <TextField
          label="Tolerance"
          hint="degrees either side"
          placeholder={String(COURSE_TOLERANCE_DEFAULT_DEG)}
          value={tolerance}
          onChange={setToleranceText}
        />
      </div>
      <button
        type="button"
        className="secondary-button wide"
        disabled={!fix || (fix.heading ?? fix.compass ?? null) === null}
        onClick={() => {
          const heading = fix?.heading ?? fix?.compass ?? null;
          if (heading === null || heading === undefined) return;
          const bearing = normalizeBearing(heading);
          setCourse(String(Math.round(bearing)));
          onWatch({ ...watch, course: { bearingDeg: bearing, toleranceDeg } });
        }}
      >
        Hold current course
      </button>
      {watch.course && (
        <button
          type="button"
          className="secondary-button wide"
          onClick={() => {
            setCourse('');
            onWatch({ ...watch, course: null });
          }}
        >
          Clear course
        </button>
      )}
    </>
  );
}

const STATUS_TEXT: Record<GeoStatus, string> = {
  off: 'GPS is off',
  idle: 'GPS starting',
  requesting: 'Waiting for permission / fix',
  active: 'Receiving position',
  error: 'Location error',
  unsupported: 'Not supported on this device',
};

export function LayerControl({
  open,
  onOpen,
  preferences,
  onChange,
  gpsMode,
  onGpsMode,
  geoStatus,
  geoError,
  markStats,
  dbInfo,
  onCheckUpdates,
  checking,
  checkMessage,
  chartCache,
  station,
  onStation,
  noaaCovered,
  legendRegion,
  settings,
  onSettings,
  fix,
  watch,
  onWatch,
  hidden = false,
}: LayerControlProps) {
  const setBase = (base: BaseLayerId) => onChange({ ...preferences, base });
  const setOverlay = (key: keyof ChartPreferences['overlays'], value: boolean) =>
    onChange({ ...preferences, overlays: { ...preferences.overlays, [key]: value } });
  const setUnit = <K extends keyof AppSettings['units']>(key: K, value: AppSettings['units'][K]) =>
    onSettings({ ...settings, units: { ...settings.units, [key]: value } });
  const setNotification = (key: keyof AppSettings['notifications'], value: boolean) =>
    onSettings({ ...settings, notifications: { ...settings.notifications, [key]: value } });
  const setProfile = (key: keyof AppSettings['profile'], value: string) =>
    onSettings({ ...settings, profile: { ...settings.profile, [key]: value } });
  const setBoat = (key: keyof AppSettings['boat'], value: string) =>
    onSettings({ ...settings, boat: { ...settings.boat, [key]: value } });

  return (
    <>
      <button
        type="button"
        className={`menu-button ${open ? 'open' : ''} ${hidden || open ? 'is-hidden' : ''}`}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          {open ? (
            <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          ) : (
            <path
              d="M4 7 H20 M4 12 H20 M4 17 H20"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          )}
        </svg>
        <span className="menu-button-label">Menu</span>
      </button>

      {open && (
        <>
          <div className="scrim" onClick={() => onOpen(false)} role="presentation" />
          <section className="menu-panel" role="dialog" aria-modal="true" aria-label="Menu">
            <header className="menu-head">
              <div>
                <p className="eyebrow">WHEELOVER</p>
                <h2>Menu</h2>
                <p className="menu-tagline">Charts, navigation &amp; conditions</p>
              </div>
              <button type="button" className="icon-button" onClick={() => onOpen(false)} aria-label="Close menu">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <nav className="menu-shortcuts" aria-label="Menu sections">
              {[
                ['menu-settings', 'Settings'],
                ['menu-overlays', 'Map options'],
                ['menu-places', 'Places'],
                ['menu-chart-detail', 'Chart detail'],
                ['menu-vessel-position', 'Position'],
                ['menu-watch', 'Watch'],
                ['menu-stations', 'Stations'],
                ['menu-profile', 'My profile'],
                ['menu-boat', 'Boat'],
              ].map(([id, label]) => (
                <button key={id} type="button" onClick={(event) => {
                  const panel = event.currentTarget.closest('.menu-panel');
                  const section = panel?.querySelector(`#${id}`);
                  if (section instanceof HTMLDetailsElement) section.open = true;
                  const body = panel?.querySelector('.menu-body');
                  if (body && section) {
                    const top = section.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
                    body.scrollTo({ top, behavior: 'smooth' });
                  }
                }}>
                  {label}
                </button>
              ))}
            </nav>

            <div className="menu-body">
              <Section title="Base chart" defaultOpen>
                <RadioRow
                  label="Standard chart"
                  hint="OpenStreetMap raster"
                  active={preferences.base === 'osm'}
                  onSelect={() => setBase('osm')}
                />
                <RadioRow
                  label="Satellite"
                  hint="Esri World Imagery"
                  active={preferences.base === 'satellite'}
                  onSelect={() => setBase('satellite')}
                />
                <RadioRow
                  label="Nautical"
                  hint="Esri ocean base · bathymetry and sea names"
                  active={preferences.base === 'nautical'}
                  onSelect={() => setBase('nautical')}
                />
                <RadioRow
                  label="Relief"
                  hint="Esri shaded relief · land and seabed"
                  active={preferences.base === 'relief'}
                  onSelect={() => setBase('relief')}
                />
                <RadioRow
                  label="NOAA ENC"
                  hint="US waters · detailed ArcGIS chart display"
                  active={preferences.base === 'noaa'}
                  onSelect={() => setBase('noaa')}
                />
                <RadioRow
                  label="NOAA Raster"
                  hint="US waters · current chart display (replaces retired RNC tiles)"
                  active={preferences.base === 'rnc'}
                  onSelect={() => setBase('rnc')}
                />
                {preferences.base === 'noaa' && !noaaCovered && (
                  <p className="inline-warning">
                    This position is outside US chart coverage. Pan to US waters or pick another base chart.
                  </p>
                )}
                {preferences.base === 'rnc' && !noaaCovered && (
                  <p className="inline-warning">
                    This position is outside US chart coverage. Pan to US waters or pick another base chart.
                  </p>
                )}
              </Section>

              <Section title="Settings" id="menu-settings">
                <h4 className="settings-group">Map display</h4>
                <div className="segmented segmented-three" role="radiogroup" aria-label="Chart theme">
                  {(['day', 'night', 'red'] as ThemeId[]).map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      role="radio"
                      aria-checked={preferences.theme === theme}
                      className={preferences.theme === theme ? 'active' : ''}
                      onClick={() => onChange({ ...preferences, theme })}
                    >
                      {theme === 'day' ? 'Day' : theme === 'night' ? 'Night' : 'Red'}
                    </button>
                  ))}
                </div>
                <p className="menu-note">
                  {preferences.theme === 'day'
                    ? 'Full colour chart and panels.'
                    : preferences.theme === 'night'
                      ? 'Dimmed chart and panels for low light on deck.'
                      : 'Red-only palette to protect night vision; symbols keep their shapes.'}
                </p>

                <h4 className="settings-group">Units</h4>
                <SelectRow
                  label="Distance"
                  value={settings.units.distance}
                  options={DISTANCE_UNITS}
                  onChange={(value) => setUnit('distance', value)}
                />
                <SelectRow
                  label="Speed"
                  value={settings.units.speed}
                  options={SPEED_UNITS}
                  onChange={(value) => setUnit('speed', value)}
                />
                <SelectRow
                  label="Depth"
                  value={settings.units.depth}
                  options={DEPTH_UNITS}
                  onChange={(value) => setUnit('depth', value)}
                />
                <SelectRow
                  label="Bearing"
                  value={settings.units.bearing}
                  options={BEARING_MODES}
                  onChange={(value) => setUnit('bearing', value)}
                />
                <SelectRow
                  label="Relative bearing mode"
                  hint="How targets are called off the bow"
                  value={settings.units.relativeBearing}
                  options={RELATIVE_BEARING_MODES}
                  onChange={(value) => setUnit('relativeBearing', value)}
                />
                <SelectRow
                  label="Coordinates"
                  hint="Position and cursor readout"
                  value={settings.units.coordinates}
                  options={COORDINATE_FORMATS}
                  onChange={(value) => setUnit('coordinates', value)}
                />
                <SelectRow
                  label="Fuel usage"
                  value={settings.units.fuel}
                  options={FUEL_UNITS}
                  onChange={(value) => setUnit('fuel', value)}
                />
                <SelectRow
                  label="Temperature"
                  value={settings.units.temperature}
                  options={TEMPERATURE_UNITS}
                  onChange={(value) => setUnit('temperature', value)}
                />
                <SelectRow
                  label="Wind speed"
                  value={settings.units.windSpeed}
                  options={WIND_SPEED_UNITS}
                  onChange={(value) => setUnit('windSpeed', value)}
                />
                <SelectRow
                  label="Pressure"
                  value={settings.units.pressure}
                  options={PRESSURE_UNITS}
                  onChange={(value) => setUnit('pressure', value)}
                />
                <SelectRow
                  label="Rate of turn"
                  value={settings.units.rateOfTurn}
                  options={RATE_OF_TURN_UNITS}
                  onChange={(value) => setUnit('rateOfTurn', value)}
                />

                <h4 className="settings-group">Notifications</h4>
                <p className="menu-note">
                  Alerts shown on the chart. Choices are remembered on this device.
                </p>
                <ToggleRow
                  label="Arrival"
                  hint="Alert as you approach a waypoint or harbour"
                  checked={settings.notifications.arrival}
                  onChange={(value) => setNotification('arrival', value)}
                />
                <ToggleRow
                  label="Anchor drift"
                  hint="Alert when the boat swings outside the circle set in Anchor watch & course"
                  checked={settings.notifications.anchorDrift}
                  onChange={(value) => setNotification('anchorDrift', value)}
                />
                <ToggleRow
                  label="Off course"
                  hint="Alert when the heading leaves the course to steer set in Anchor watch & course"
                  checked={settings.notifications.offCourse}
                  onChange={(value) => setNotification('offCourse', value)}
                />
                <ToggleRow
                  label="Shallow water"
                  hint="Alert when the modelled depth under the keel is close to the boat's draught"
                  checked={settings.notifications.shallowWater}
                  onChange={(value) => setNotification('shallowWater', value)}
                />
                <ToggleRow
                  label="AIS proximity"
                  hint="Alert when a tracked vessel closes on you"
                  checked={settings.notifications.aisProximity}
                  onChange={(value) => setNotification('aisProximity', value)}
                />
                <ToggleRow
                  label="Alert sound"
                  checked={settings.notifications.sound}
                  onChange={(value) => setNotification('sound', value)}
                />
                <ToggleRow
                  label="Vibration"
                  hint="On devices that support it"
                  checked={settings.notifications.vibration}
                  onChange={(value) => setNotification('vibration', value)}
                />
              </Section>

              <Section title="Map options" id="menu-overlays">
                <ToggleRow
                  label="Depth contours"
                  hint="NOAA ENC isobaths in US waters (zoom 9+), GEBCO elsewhere"
                  checked={preferences.overlays.contours}
                  onChange={(value) => setOverlay('contours', value)}
                />
                {preferences.overlays.contours && (
                  <p className="menu-note">
                    {noaaCovered
                      ? 'US zoom 9+ uses NOAA ENC contours; other regions use the global GEBCO contour layer.'
                      : 'Global GEBCO contour layer.'}
                  </p>
                )}
                <ToggleRow
                  label="Depth numbers"
                  hint={`Modelled labels in ${depthUnitLabel(
                    settings.units.depth,
                  )} · GEBCO global, EMODnet from zoom 14 · zoom 12+`}
                  checked={preferences.overlays.depthLabels}
                  onChange={(value) => setOverlay('depthLabels', value)}
                />
                <ToggleRow
                  label="Charted soundings"
                  hint="NOAA ENC spot depths in the chart's printed unit · US waters, zoom 15+"
                  checked={preferences.overlays.soundings}
                  onChange={(value) => setOverlay('soundings', value)}
                />
                {preferences.overlays.soundings && !noaaCovered && (
                  <p className="inline-warning">
                    Charted soundings come from NOAA ENC and only cover US waters. The overlay stays off this chart
                    until you pan to a US harbour; depth contours fall back to GEBCO here.
                  </p>
                )}
                <ToggleRow
                  label="OpenSeaMap seamarks"
                  hint="Transparent raster over any base chart"
                  checked={preferences.overlays.openseamap}
                  onChange={(value) => setOverlay('openseamap', value)}
                />
                <ToggleRow
                  label="NAVAIDs from database"
                  hint="Aids to navigation, calling-in points and mapped reporting areas"
                  checked={preferences.overlays.navaids}
                  onChange={(value) => setOverlay('navaids', value)}
                />
                <ToggleRow
                  label="Ferry lanes"
                  hint="Ferry routes"
                  checked={preferences.overlays.ferries}
                  onChange={(value) => setOverlay('ferries', value)}
                />
                <ToggleRow
                  label="TSS lanes"
                  hint="Traffic separation schemes"
                  checked={preferences.overlays.tss}
                  onChange={(value) => setOverlay('tss', value)}
                />
                <ToggleRow
                  label="Bridges & clearances"
                  hint="Mapped bridge types and reported clearance/opening details · zoom 8+"
                  checked={preferences.overlays.bridges}
                  onChange={(value) => setOverlay('bridges', value)}
                />
                <ToggleRow
                  label="Protected sites"
                  hint="EMODnet Natura 2000 marine designations · zoom 6+ · Europe"
                  checked={preferences.overlays.protectedAreas}
                  onChange={(value) => setOverlay('protectedAreas', value)}
                />
                <a className="menu-row disclaimer-link" href="/disclaimer" onClick={() => onOpen(false)}>Data sources &amp; disclaimer<span className="chevron" aria-hidden="true">›</span></a>
                <ToggleRow
                  label="AIS targets"
                  hint="Live vessel positions on the chart"
                  checked={preferences.overlays.ais}
                  onChange={(value) => setOverlay('ais', value)}
                />
              </Section>

              <Section
                title="Public places"
                id="menu-places"
                hint="Marinas, fuel, chandlery, ramps, food and facilities from OpenStreetMap."
              >
                <ToggleRow
                  label="Show public places"
                  hint="Tap a pin for contact details · zoom 11+"
                  checked={preferences.overlays.pois}
                  onChange={(value) => setOverlay('pois', value)}
                />
                {preferences.overlays.pois && (
                  <>
                    <p className="menu-note">Tap a class to show or hide it; the choice is remembered on this device.</p>
                    <ul className="legend-grid poi-legend">
                      {POI_GROUPS.map((group) => {
                        const hidden = isPoiGroupHidden(preferences.hiddenPoiGroups, group.id);
                        return (
                          <li key={group.id}>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!hidden}
                              aria-label={`${group.label} — ${hidden ? 'hidden' : 'shown'}`}
                              className={`legend-item ${hidden ? 'is-off' : ''}`}
                              data-poi-group={group.id}
                              onClick={() =>
                                onChange({
                                  ...preferences,
                                  hiddenPoiGroups: togglePoiGroup(preferences.hiddenPoiGroups, group.id),
                                })
                              }
                            >
                              <span
                                className="poi-chip"
                                style={{ background: group.colour }}
                                dangerouslySetInnerHTML={{ __html: poiIconSvg(group.id, 18) }}
                                aria-hidden="true"
                              />
                              <span className="legend-label">{group.label}</span>
                              <span className="legend-state">{hidden ? 'Off' : 'On'}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    {preferences.hiddenPoiGroups.length > 0 && (
                      <button
                        type="button"
                        className="secondary-button legend-reset"
                        onClick={() => onChange({ ...preferences, hiddenPoiGroups: [] })}
                      >
                        Show every place class
                      </button>
                    )}
                  </>
                )}
              </Section>

              <Section title="Chart detail" id="menu-chart-detail">
                <ToggleRow
                  label="Show all marks"
                  hint="Ignore zoom declutter (can look crowded)"
                  checked={preferences.showAllMarks}
                  onChange={(value) => onChange({ ...preferences, showAllMarks: value })}
                />
                <p className="menu-note" data-testid="mark-stats">
                  {markStats.shown} of {markStats.total} aids in view ·{' '}
                  {markStats.live ? 'live Overpass query' : markStats.cached ? 'device cache' : 'mark database'}
                </p>
                <details className="legend">
                  <summary>Legend &amp; mark filters (IALA region {legendRegion})</summary>
                  <p className="legend-hint">
                    Tap a class to show or hide it on the chart. Choices are remembered on this device.
                  </p>
                  <ul className="legend-grid">
                    {NAVAID_GROUPS.map((group) => {
                      const spec = symbolFor(group.symbol, legendRegion);
                      const svg = spec.svg.replace('width="32" height="32"', 'width="26" height="26"');
                      const hidden = isGroupHidden(preferences.hiddenGroups, group.id);
                      return (
                        <li key={group.id}>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!hidden}
                            aria-label={`${group.label} — ${hidden ? 'hidden' : 'shown'}`}
                            className={`legend-item ${hidden ? 'is-off' : ''}`}
                            data-group={group.id}
                            onClick={() =>
                              onChange({ ...preferences, hiddenGroups: toggleGroup(preferences.hiddenGroups, group.id) })
                            }
                          >
                            <span
                              className="legend-symbol"
                              dangerouslySetInnerHTML={{ __html: svg }}
                              aria-hidden="true"
                            />
                            <span className="legend-label">{group.label}</span>
                            <span className="legend-state">{hidden ? 'Off' : 'On'}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {preferences.hiddenGroups.length > 0 && (
                    <button
                      type="button"
                      className="secondary-button legend-reset"
                      onClick={() => onChange({ ...preferences, hiddenGroups: [] })}
                    >
                      Show every mark class
                    </button>
                  )}
                </details>
              </Section>

              <Section
                title="Vessel position"
                id="menu-vessel-position"
                hint={gpsMode === 'off' ? 'Device GPS is disabled. Nothing is requested.' : geoError ?? undefined}
              >
                <div className="segmented" role="radiogroup" aria-label="GPS mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={gpsMode === 'on'}
                    className={gpsMode === 'on' ? 'active' : ''}
                    onClick={() => onGpsMode('on')}
                  >
                    Always on
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={gpsMode === 'off'}
                    className={gpsMode === 'off' ? 'active' : ''}
                    onClick={() => onGpsMode('off')}
                  >
                    Always off
                  </button>
                </div>
                <p className="menu-note" data-testid="gps-status">
                  {STATUS_TEXT[geoStatus]}
                </p>
                <ToggleRow
                  label="Show position panel"
                  hint="Coordinates, SOG and compass rose"
                  checked={preferences.showPosition}
                  onChange={(value) => onChange({ ...preferences, showPosition: value })}
                />
              </Section>

              <Section
                title="Anchor watch & course"
                id="menu-watch"
                hint="The drag and off-course alerts in Settings watch these."
              >
                <VoyageWatchSection
                  fix={fix}
                  watch={watch}
                  onWatch={onWatch}
                  distanceUnit={settings.units.distance}
                />
              </Section>

              <Section title="Stations" id="menu-stations">
                {(['ais', 'colregs'] as StationTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`menu-row nav-row ${station === tab ? 'selected' : ''}`}
                    onClick={() => {
                      onStation(station === tab ? null : tab);
                      onOpen(false);
                    }}
                  >
                    <span className="row-label">{STATION_LABELS[tab]}</span>
                    <span className="chevron" aria-hidden="true">›</span>
                  </button>
                ))}
              </Section>

              <Section
                title="My profile"
                id="menu-profile"
                hint="Your details stay on this device and are only used for the alerts you switch on."
              >
                <TextField
                  label="Name"
                  placeholder="Skipper"
                  value={settings.profile.name}
                  onChange={(value) => setProfile('name', value)}
                />
                <TextField
                  label="Home port"
                  placeholder="Portsmouth"
                  value={settings.profile.homePort}
                  onChange={(value) => setProfile('homePort', value)}
                />
                <SelectRow
                  label="Experience"
                  value={settings.profile.experience}
                  options={[
                    { value: '', label: 'Not set' },
                    ...EXPERIENCE_LEVELS.map((level) => ({ value: level as string, label: level as string })),
                  ]}
                  onChange={(value) => setProfile('experience', value)}
                />
                <TextField
                  label="Emergency contact"
                  hint="Name and number kept with your profile"
                  placeholder="Coastguard / next of kin"
                  value={settings.profile.emergencyContact}
                  onChange={(value) => setProfile('emergencyContact', value)}
                />
              </Section>

              <Section
                title="Boat settings"
                id="menu-boat"
                hint="Vessel particulars used by the passage and depth alerts."
              >
                <TextField
                  label="Boat name"
                  placeholder="Wheel Over"
                  value={settings.boat.name}
                  onChange={(value) => setBoat('name', value)}
                />
                <SelectRow
                  label="Type"
                  value={settings.boat.type}
                  options={[
                    { value: '', label: 'Not set' },
                    ...BOAT_TYPES.map((type) => ({ value: type as string, label: type as string })),
                  ]}
                  onChange={(value) => setBoat('type', value)}
                />
                <div className="menu-field-pair">
                  <TextField
                    label="Length"
                    hint="metres"
                    placeholder="11.5"
                    value={settings.boat.lengthM}
                    onChange={(value) => setBoat('lengthM', value)}
                  />
                  <TextField
                    label="Beam"
                    hint="metres"
                    placeholder="3.8"
                    value={settings.boat.beamM}
                    onChange={(value) => setBoat('beamM', value)}
                  />
                  <TextField
                    label="Draught"
                    hint="metres"
                    placeholder="1.6"
                    value={settings.boat.draughtM}
                    onChange={(value) => setBoat('draughtM', value)}
                  />
                </div>
                <TextField
                  label="MMSI"
                  hint="Nine digits, if the vessel is AIS fitted"
                  placeholder="232000000"
                  value={settings.boat.mmsi}
                  onChange={(value) => setBoat('mmsi', value)}
                />
                <TextField
                  label="Call sign"
                  placeholder="MABC1"
                  value={settings.boat.callSign}
                  onChange={(value) => setBoat('callSign', value)}
                />
              </Section>

              <Section title="Mark database" id="menu-data">
                {checkMessage && (
                  <p className="menu-note" data-testid="check-message" role="status">
                    {checkMessage}
                  </p>
                )}
                {dbInfo ? (
                  <>
                    <dl className="db-grid">
                      <div>
                        <dt>Aids</dt>
                        <dd>{dbInfo.count.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Duplicates merged</dt>
                        <dd>{dbInfo.duplicates}</dd>
                      </div>
                      <div>
                        <dt>Built</dt>
                        <dd>{new Date(dbInfo.builtAt).toLocaleDateString()}</dd>
                      </div>
                      <div>
                        <dt>Sources</dt>
                        <dd>{dbInfo.sources.length}</dd>
                      </div>
                    </dl>
                    <p className="menu-note">Version {dbInfo.version}</p>
                    <p className="menu-note">
                      {dbInfo.checkedAt
                        ? `Last checked ${new Date(dbInfo.checkedAt).toLocaleDateString()} · rechecked weekly`
                        : 'Weekly update check pending'}
                    </p>
                    <p className="menu-note" data-testid="chart-cache">
                      {chartCache
                        ? `NOAA chart cache: ${chartCache.tiles} tiles · ${formatBytes(chartCache.bytes)}`
                        : 'NOAA chart cache: checking…'}
                    </p>
                  </>
                ) : (
                  <p className="menu-note">Loading database status…</p>
                )}
                <button
                  type="button"
                  className="secondary-button wide"
                  onClick={onCheckUpdates}
                  disabled={checking}
                >
                  {checking ? 'Checking for updates…' : 'Check for updates'}
                </button>
              </Section>
            </div>
          </section>
        </>
      )}
    </>
  );
}
