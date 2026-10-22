import type { ReactNode } from 'react';
import type { BaseLayerId, ChartPreferences, ThemeId } from '../lib/chartPreferences';
import type { GpsMode } from '../lib/gpsPreference';
import type { GeoStatus } from '../hooks/useGeolocation';
import type { StationTab } from '../lib/station';
import { STATION_LABELS } from '../lib/station';
import { symbolFor } from '../lib/navaids';
import { NAVAID_GROUPS, isGroupHidden, toggleGroup } from '../lib/navaidGroups';
import { POI_GROUPS, isPoiGroupHidden, togglePoiGroup } from '../lib/poiGroups';
import { poiIconSvg } from '../lib/pois';
import { formatBytes } from '../lib/noaaChart';

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
  hidden?: boolean;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="menu-section">
      <h3 className="section-title">{title}</h3>
      {hint && <p className="section-hint">{hint}</p>}
      <div className="menu-rows">{children}</div>
    </section>
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
  hidden = false,
}: LayerControlProps) {
  const setBase = (base: BaseLayerId) => onChange({ ...preferences, base });
  const setOverlay = (key: keyof ChartPreferences['overlays'], value: boolean) =>
    onChange({ ...preferences, overlays: { ...preferences.overlays, [key]: value } });

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
                <p className="menu-tagline">Maritime Navigation and Planning</p>
              </div>
              <button type="button" className="icon-button" onClick={() => onOpen(false)} aria-label="Close menu">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="menu-body">
              <Section title="Base chart">
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

              <Section title="Display">
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
              </Section>

              <Section title="Overlays">
                <ToggleRow
                  label="Depth contours"
                  hint="NOAA ENC isobaths in US waters (zoom 9+), GEBCO elsewhere"
                  checked={preferences.overlays.contours}
                  onChange={(value) => setOverlay('contours', value)}
                />
                {preferences.overlays.contours && !noaaCovered && (
                  <p className="menu-note">
                    Outside US waters contours come from GEBCO's global 15″ grid, so they are an overview
                    rather than a harbour survey.
                  </p>
                )}
                <ToggleRow
                  label="Depth numbers"
                  hint="Modelled labels in metres · GEBCO global, EMODnet from zoom 14 · zoom 12+"
                  checked={preferences.overlays.depthLabels}
                  onChange={(value) => setOverlay('depthLabels', value)}
                />
                {preferences.overlays.depthLabels && (
                  <p className="menu-note">
                    Sampled from seabed grids, not surveyed chart soundings. Use them to read the shape of the
                    seabed, never to plan a safe depth.
                  </p>
                )}
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
                <div className="depth-units" data-testid="depth-units">
                  <h4>Depth measurements</h4>
                  <dl>
                    <div>
                      <dt>Depth numbers</dt>
                      <dd>Metres below sea level · modelled seabed sample</dd>
                    </div>
                    <div>
                      <dt>Charted soundings</dt>
                      <dd>NOAA ENC spot depths · the chart's printed unit (feet or metres)</dd>
                    </div>
                    <div>
                      <dt>Contours</dt>
                      <dd>NOAA ENC chart unit in US waters · metres from GEBCO elsewhere</dd>
                    </div>
                  </dl>
                </div>
                <ToggleRow
                  label="OpenSeaMap seamarks"
                  hint="Transparent raster over any base chart"
                  checked={preferences.overlays.openseamap}
                  onChange={(value) => setOverlay('openseamap', value)}
                />
                <ToggleRow
                  label="NAVAIDs from database"
                  hint="Buoys, beacons, lights, ranges, hazards"
                  checked={preferences.overlays.navaids}
                  onChange={(value) => setOverlay('navaids', value)}
                />
                <ToggleRow
                  label="Ferry lanes"
                  hint="Charted crossings · Solent, Channel ports and New York"
                  checked={preferences.overlays.ferries}
                  onChange={(value) => setOverlay('ferries', value)}
                />
                <ToggleRow
                  label="TSS lanes"
                  hint="Traffic separation schemes · English Channel and Dover Strait"
                  checked={preferences.overlays.tss}
                  onChange={(value) => setOverlay('tss', value)}
                />
                {(preferences.overlays.ferries || preferences.overlays.tss) && (
                  <p className="menu-note">
                    Routes are community-mapped OpenStreetMap data drawn in their own layer: ferries as dashed cyan
                    lines, traffic separation lanes in magenta (amber for separation zones). Nothing appears where OSM
                    has no mapped route, so pan to the Solent, the Channel or New York to see them.
                  </p>
                )}
                <ToggleRow
                  label="AIS targets"
                  hint="Live vessel positions on the chart"
                  checked={preferences.overlays.ais}
                  onChange={(value) => setOverlay('ais', value)}
                />
              </Section>

              <Section
                title="Public places"
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
                    <p className="menu-note">
                      Places are community-mapped and can be out of date. Tap a class to show or hide it; the
                      choice is remembered on this device.
                    </p>
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

              <Section title="Chart detail">
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

              <Section title="Stations">
                {(['ais', 'colregs', 'weather'] as StationTab[]).map((tab) => (
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

              <Section title="Mark database">
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
