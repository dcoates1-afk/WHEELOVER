import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Navaid } from '../lib/navaidTypes';
import { NavaidSheet } from './NavaidSheet';

function wreck(overrides: Partial<Navaid> = {}): Navaid {
  return {
    id: 'osm:node/1',
    lat: 50.7395327,
    lon: -1.0385084,
    category: 'hazard_danger',
    form: 'mark',
    name: null,
    light: null,
    colour: null,
    shape: null,
    height: null,
    range: null,
    path: null,
    transitBearing: null,
    transitDistanceM: null,
    transitPartner: null,
    transitPartnerName: null,
    channel: null,
    description: null,
    lit: null,
    priority: 78,
    source: 'osm',
    updated: null,
    region: 'solent',
    ...overrides,
  };
}

function render(mark: Navaid): string {
  return renderToStaticMarkup(createElement(NavaidSheet, {
    mark,
    onCentre: () => undefined,
    onClose: () => undefined,
  }));
}

describe('wreck detail sheet', () => {
  it('renders EMODnet heritage context separately from charted danger and depth', () => {
    const html = render(wreck({
      wreckInventoryName: 'HMS INVINCIBLE',
      wreckInventoryDepth: '6-7',
      wreckType: 'Wooden sailing',
      wreckTypeDescription: 'Remains of the wreck of a British Third Rate ship of the line',
      wreckHistoricalContext: 'Sank in 1758 after grounding.',
      wreckInventoryPositionType: 'Polygon centroid',
      wreckInventoryMatchDistanceM: 10,
      wreckInventoryLegalStatus: 'Protected wreck',
      wreckInventorySource: 'EMODnet Human Activities heritage wrecks (CC BY 4.0)',
      wreckInventoryUrl: 'https://emodnet.ec.europa.eu/geonetwork/srv/api/records/e965088b-a265-4517-84df-c49b156af8a7',
      wreckCategory: 'dangerous',
    }));

    expect(html).toContain('HMS INVINCIBLE');
    expect(html).toContain('dangerous');
    expect(html).toContain('6-7');
    expect(html).toContain('Polygon centroid; matched chart mark 10 m away');
    expect(html).toContain('Protected wreck');
    expect(html).toContain('Sank in 1758 after grounding.');
    expect(html).toContain('EMODnet Human Activities heritage wrecks (CC BY 4.0)');
  });

  it('lists mapped sound-signal and racon details with the annotated symbol', () => {
    const html = render(wreck({
      category: 'lateral_port',
      form: 'buoy',
      lit: true,
      light: 'Fl red 5s',
      lightColour: 'red',
      fogSignal: true,
      fogSignalCategory: 'bell',
      fogSignalGroup: '2',
      fogSignalPeriod: '30',
      radarTransponderCategory: 'racon',
      radarReflector: true,
    }));

    expect(html).toContain('Sound signal (bell / horn)');
    expect(html).toContain('bell · group 2 · 30 s period');
    expect(html).toContain('Radar transponder (racon)');
    expect(html).toContain('racon');
    expect(html).toContain('Radar reflector');
    expect(html).toContain('sheet-symbol-annotated');
    expect(html).toContain('data-mark-annotation="light"');
    expect(html).toContain('data-mark-annotation="sound"');
    expect(html).toContain('data-mark-annotation="racon"');
  });

  it('renders NOAA ENC Direct GIS attributes with the navigation-safety warning', () => {
    const html = render(wreck({
      id: 'noaa-enc:node/610308',
      source: 'noaa-enc',
      region: 'ny-harbor',
      wreckCategory: 'dangerous',
      wreckChartSource: 'NOAA ENC Direct to GIS (CC0; converted GIS feature, not certified for navigation)',
      wreckChartExpectedDepth: '20.1',
      wreckChartQuality: '6',
      wreckChartSurveyDate: '20080905',
      wreckChartSourceUrl: 'https://nauticalcharts.noaa.gov/learn/encdirect/',
      sourceCitation: 'NOAA ENC Direct to GIS; dataset US3NY1AE.000',
    }));

    expect(html).toContain('NOAA ENC Direct GIS category');
    expect(html).toContain('20.1 m');
    expect(html).toContain('20080905');
    expect(html).toContain('NOAA ENC Direct to GIS');
    expect(html).not.toContain('not certified for navigation');
  });
});
