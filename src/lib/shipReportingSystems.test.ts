import { describe, expect, it } from 'vitest';
import source from '../data/shipReportingSystems.json';
import { SHIP_REPORTING_SYSTEMS, validateShipReportingDataset } from './shipReportingSystems';

describe('curated ship-reporting boundaries', () => {
  it('includes the verified CORAL SHIPREP boundaries, GOFREP reporting lines, and WHALESNORTH boundary', () => {
    expect(SHIP_REPORTING_SYSTEMS.features).toHaveLength(41);
    const nordregPartial = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'nordreg-sscz-5-explicit-coordinate-chain');
    expect(nordregPartial?.properties.role).toBe('outer_boundary');
    expect(nordregPartial?.properties.datum).toContain('Not stated');
    expect(nordregPartial?.properties.sourceCitation).toContain('Zone 5');
    expect(nordregPartial?.geometry.coordinates).toEqual([
      [-84, 69.5], [-93 - 20 / 60, 69.5], [-93 - 20 / 60, 67], [-84, 67], [-84, 69.5],
    ]);
    expect(nordregPartial?.properties.geometryNote).toContain('not the entire Northern VTS Zone');
    const ecaregPartials = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'ecareg');
    expect(ecaregPartials).toHaveLength(8);
    expect(ecaregPartials.every((feature) => feature.properties.role === 'partial_boundary')).toBe(true);
    expect(ecaregPartials.every((feature) => feature.properties.datum.includes('Not stated'))).toBe(true);
    const sscz7 = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'nordreg-sscz-7-explicit-coordinate-boundary');
    expect(sscz7?.geometry.coordinates).toEqual([
      [-93 - 20 / 60, 70], [-104 - 50 / 60, 70], [-104 - 50 / 60, 66 + 20 / 60], [-93 - 20 / 60, 66 + 20 / 60], [-93 - 20 / 60, 70],
    ]);
    expect(sscz7?.geometry.coordinates[0]).toEqual(sscz7?.geometry.coordinates.at(-1));
    expect(SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'ecareg-local-st-johns-north-head-line')?.geometry.coordinates).toEqual([
      [-52 - 25 / 60 - 14.8 / 3600, 47 + 18 / 60 + 36.3 / 3600],
      [-52 - 44 / 60 - 52 / 3600, 47 + 18 / 60 + 39 / 3600],
    ]);
    expect(new Set(SHIP_REPORTING_SYSTEMS.features.slice(0, 5).map((feature) => feature.properties.systemId))).toEqual(
      new Set(['coral_shiprep']),
    );
    expect(SHIP_REPORTING_SYSTEMS.features.slice(0, 5).map((feature) => feature.properties.role)).toEqual([
      'outer_boundary',
      'inner_atba_boundary',
      'inner_atba_boundary',
      'inner_atba_boundary',
      'inner_atba_boundary',
    ]);
    const gofrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'gofrep');
    expect(gofrep).toHaveLength(9);
    expect(gofrep.map((feature) => feature.properties.role)).toEqual([
      'reporting_line', 'reporting_line', 'reporting_line', 'outer_boundary',
      'partial_boundary', 'partial_boundary', 'reporting_line', 'reporting_line', 'reporting_line',
    ]);
    expect(SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'gofrep-st-petersburg-tallinn-reporting-line')?.geometry.coordinates).toEqual([
      [28.05, 59 + 28 / 60], [27 + 38 / 60, 59 + 37 / 60], [26 + 33 / 60, 59 + 46 / 60], [26.5, 59.95],
    ]);
    expect(SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'gofrep-vainameri-reporting-line')?.geometry.coordinates).toEqual([
      [22 + 35 / 60, 59.1], [23 + 31 / 60, 59 + 14 / 60],
    ]);
    const gofrepWestern = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'gofrep-western-reporting-line-coordinate-segment');
    expect(gofrepWestern?.geometry.coordinates).toEqual([[22.5, 59.555], [21.5, 59 + 10 / 60]]);
    expect(gofrepWestern?.properties.geometryNote).toContain('named lighthouse and peninsula endpoints are not georeferenced');
    const northumberland = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'ecareg' && feature.properties.areaName === 'Northumberland Strait Local Eastern VTS Zone');
    expect(northumberland).toHaveLength(2);
    expect(northumberland.every((feature) => feature.properties.sourceUrl.includes('page-5.html'))).toBe(true);
    expect(northumberland.map((feature) => feature.geometry.coordinates)).toEqual([
      [[-63 - 27 / 60 - 59.3 / 3600, 45 + 52 / 60 + 42.3 / 3600], [-63 - 13 / 60 - 18.3 / 3600, 46 + 7 / 60 + 47.9 / 3600]],
      [[-64 - 13 / 60 - 42 / 3600, 46 + 13 / 60 + 41.8 / 3600], [-64 - 8 / 60 - 5.3 / 3600, 46 + 24 / 60 + 4.8 / 3600]],
    ]);
    const fundy = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'ecareg-local-bay-of-fundy-coordinate-chain-partial');
    expect(fundy?.geometry.coordinates).toHaveLength(10);
    expect(fundy?.properties.geometryNote).toContain('malformed longitude');
    expect(SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'nordreg-sscz-7-explicit-coordinate-boundary')?.properties.role).toBe('outer_boundary');
    const whalesnorth = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'whalesnorth');
    expect(whalesnorth).toHaveLength(1);
    expect(whalesnorth[0].properties.role).toBe('partial_boundary');
    const gdanrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'gdanrep');
    expect(gdanrep).toHaveLength(1);
    expect(gdanrep[0].properties.role).toBe('reporting_line');
    expect(gdanrep[0].properties.datum).toBe('WGS 84');
    expect(gdanrep[0].geometry.coordinates).toEqual([
      [18.542666666666666, 54.75],
      [19.101666666666667, 54.75],
      [19.403333333333332, 54.60333333333333],
      [19.638333333333332, 54.458166666666664],
    ]);
    const whalessouth = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'whalessouth');
    expect(whalessouth).toHaveLength(1);
    expect(whalessouth[0].properties.role).toBe('partial_boundary');
    expect(whalessouth[0].geometry.coordinates).toEqual([[-80.86, 30], [-80.86, 31.45]]);
    const soundrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'soundrep');
    expect(soundrep).toHaveLength(5);
    expect(soundrep.every((feature) => feature.properties.role === 'reporting_line')).toBe(true);
    expect(soundrep.find((feature) => feature.id === 'soundrep-north-boundary-denmark')?.geometry.coordinates).toEqual([
      [12.183333333333334, 56.10966666666667],
      [12.183333333333334, 56.233333333333334],
    ]);
    expect(soundrep.find((feature) => feature.id === 'soundrep-east-boundary-sweden')?.geometry.coordinates).toEqual([
      [12.908333333333333, 55.166666666666664],
      [13.032166666666666, 55.3815],
    ]);
    const gofrepBoundary = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.id === 'gofrep-international-waters-boundary');
    expect(gofrepBoundary?.properties.role).toBe('outer_boundary');
    expect(gofrepBoundary?.geometry.coordinates).toHaveLength(51);
    expect(gofrepBoundary?.geometry.coordinates[0]).toEqual(gofrepBoundary?.geometry.coordinates.at(-1));
    expect(gofrepBoundary?.geometry.coordinates[0]).toEqual([22.5, 59.555]);
    const beltrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'beltrep');
    expect(beltrep).toHaveLength(2);
    expect(beltrep.every((feature) => feature.properties.role === 'partial_boundary')).toBe(true);
    expect(beltrep.every((feature) => feature.properties.sourceUrl.includes('MSC.332(90)%20Rev.1.pdf'))).toBe(true);
    expect(beltrep[0].properties.geometryNote).toContain('remains operative on this verification date');
    expect(beltrep[0].geometry.coordinates).toEqual([[10.633333333333333, 55.6], [10.633333333333333, 55.78333333333333], [10.933333333333334, 56], [11.283333333333333, 56]]);
    const caldovrep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'caldovrep');
    expect(caldovrep?.properties.role).toBe('partial_boundary');
    expect(caldovrep?.geometry.coordinates).toEqual([[1.45, 51 + 23 / 60], [2.55, 51 + 5 / 60]]);
    expect(caldovrep?.properties.datum).toContain('Not stated');
    const coprep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'coprep');
    expect(coprep?.properties.role).toBe('partial_boundary');
    expect(coprep?.geometry.coordinates).toEqual([[-10 - 14 / 60, 39.75], [-10 - 14 / 60, 38 + 41 / 60], [-9 - 35 / 60, 36.5], [-8.5, 36.25]]);
    const wetrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'wetrep');
    expect(wetrep).toHaveLength(2);
    expect(wetrep[0].geometry.coordinates).toHaveLength(17);
    expect(wetrep[1].geometry.coordinates).toHaveLength(4);
    expect(wetrep[0].geometry.coordinates.at(-1)).toEqual([-7 - 25 / 60, 37 + 10 / 60]);
    expect(wetrep[1].geometry.coordinates[0]).toEqual([-6 - 21.8 / 60, 52 + 10.3 / 60]);
    expect(wetrep.every((feature) => feature.properties.sourceUrl.includes('MSC.190(79).pdf'))).toBe(true);
    expect(wetrep[0].properties.geometryNote).toContain('not the §2.1 reporting-area coordinates');
    const mancherep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'mancherep');
    expect(mancherep?.properties.role).toBe('outer_boundary');
    expect(mancherep?.geometry.coordinates).toEqual([
      [-2.966666666666667, 50.166666666666664],
      [-2, 50.166666666666664],
      [-2, 49.333333333333336],
      [-2.966666666666667, 49.333333333333336],
      [-2.966666666666667, 50.166666666666664],
    ]);
  });

  it('keeps the official source, datum, verification date, and ordered coordinate ranges', () => {
    for (const feature of SHIP_REPORTING_SYSTEMS.features) {
      expect(feature.properties.sourceUrl).toMatch(/^https:\/\//);
      expect(feature.properties.verifiedAsOf).toMatch(/^2026-10-2[245]$/);
      expect(feature.geometry.coordinates.length).toBeGreaterThan(1);
      expect(feature.geometry.coordinates.every(([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)).toBe(true);
    }
    const coral = SHIP_REPORTING_SYSTEMS.features.slice(0, 5);
    for (const feature of coral) {
      expect(feature.properties.sourceCitation).toContain('MSC.279(85)');
      expect(feature.properties.sourceUrl).toContain('ecfr.gov');
      expect(feature.properties.datum).toBe('NAD83');
      expect(feature.properties.verifiedAsOf).toBe('2026-10-22');
      expect(feature.geometry.coordinates[0]).toEqual(feature.geometry.coordinates.at(-1));
    }
    expect(coral[0].geometry.coordinates[0]).toEqual([-178.1075, 29.4035]);
    expect(coral[0].properties.geometryNote.toLowerCase()).toContain('approximate');
    const gofrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'gofrep');
    for (const feature of gofrep) {
      expect(feature.properties.sourceUrl).toContain(feature.properties.role === 'outer_boundary' ? 'imorules.com' : 'fintraffic.fi');
      expect(feature.properties.datum).toBe('WGS 84');
      expect(feature.properties.geometryNote.toLowerCase()).toContain('display');
    }
    const whalesnorth = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'whalesnorth');
    expect(whalesnorth?.properties.sourceCitation).toContain('33 CFR');
    expect(whalesnorth?.properties.sourceUrl).toContain('ecfr.gov');
    expect(whalesnorth?.properties.datum).toBe('NAD 83');
    expect(whalesnorth?.properties.geometryNote.toLowerCase()).toContain('partial and approximate');
    expect(whalesnorth?.properties.geometryNote).toContain('is year-round');
    const gdanrep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'gdanrep');
    expect(gdanrep?.properties.sourceUrl).toContain('MSC.249(83).pdf');
    expect(gdanrep?.properties.datum).toBe('WGS 84');
    expect(gdanrep?.properties.geometryNote).toContain('Polish chart No. 151');
    expect(gdanrep?.properties.sourceCitation).toContain('MSC.249(83)');
    expect(gdanrep?.properties.geometryNote).toContain('verified open line');
    const whalessouth = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'whalessouth');
    expect(whalessouth?.properties.sourceUrl).toContain('ecfr.gov');
    expect(whalessouth?.properties.sourceCitation).toContain('33 CFR');
    expect(whalessouth?.properties.datum).toBe('NAD 83');
    expect(whalessouth?.properties.verifiedAsOf).toBe('2026-10-25');
    expect(whalessouth?.properties.geometryNote).toContain('omits both latitude limits and the shoreline closure');
    expect(whalessouth?.properties.geometryNote).toContain('15 November through 16 April');
    const soundrep = SHIP_REPORTING_SYSTEMS.features.filter((feature) => feature.properties.systemId === 'soundrep');
    for (const feature of soundrep) {
      expect(feature.properties.sourceUrl).toContain('MSC.314(88)%20Rev.1.pdf');
      expect(feature.properties.sourceCitation).toContain('MSC.314(88)/Rev.1');
      expect(feature.properties.geometryNote).toContain('1 December 2026');
      expect(feature.properties.datum).toBe('WGS 84');
      expect(feature.properties.verifiedAsOf).toBe('2026-10-25');
    }
    expect(gofrep.map((feature) => feature.geometry.coordinates.length)).toEqual([9, 8, 5, 51, 11, 9, 4, 2, 2]);
    expect(gofrep[0].geometry.coordinates[0]).toEqual([21.668, 59.098]);
    expect(gofrep[1].geometry.coordinates.at(-1)).toEqual([26.5, 59.98583333333333]);
    expect(gofrep[2].geometry.coordinates[0]).toEqual([26.5, 59.95]);
    expect(gofrep[3].geometry.coordinates).toHaveLength(51);
    expect(gofrep[3].geometry.coordinates[0]).toEqual([22.5, 59.555]);
    expect(gofrep[3].geometry.coordinates.at(-1)).toEqual(gofrep[3].geometry.coordinates[0]);
    expect(gofrep[4].geometry.coordinates[0]).toEqual([22 + 50.2 / 60, 59 + 44.45 / 60]);
    expect(gofrep[5].geometry.coordinates[0]).toEqual([24 + 21.6 / 60, 59 + 28.4 / 60]);
    expect(gofrep[8].geometry.coordinates).toEqual([[22.5, 59.555], [21.5, 59 + 10 / 60]]);
    const mancherep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'mancherep');
    expect(mancherep?.properties.sourceCitation).toContain('MSC.110(73)');
    expect(mancherep?.properties.sourceUrl).toContain('MSC.110(73).pdf');
    expect(mancherep?.properties.datum).toContain('Not specified');
    expect(mancherep?.properties.geometryNote).toContain('not specify a geodetic datum');
    expect(mancherep?.geometry.coordinates[0]).toEqual(mancherep?.geometry.coordinates.at(-1));
    const straitrep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'straitrep');
    expect(straitrep?.properties.role).toBe('reporting_line');
    expect(straitrep?.geometry.coordinates).toEqual([
      [103.5125, 1.2583333333333333],
      [103.40583333333333, 1.1533333333333333],
    ]);
    expect(straitrep?.properties.sourceUrl).toContain('mpa.gov.sg');
    expect(straitrep?.properties.datum).toContain('Not specified');
    expect(straitrep?.properties.geometryNote).toContain('not the full STRAITREP operational-area boundary');
    expect(mancherep?.properties.sourceCitation).toContain('MSC.110(73)');
    const reefrep = SHIP_REPORTING_SYSTEMS.features.find((feature) => feature.properties.systemId === 'reef_rep');
    expect(reefrep?.properties.role).toBe('partial_boundary');
    expect(reefrep?.properties.sourceUrl).toContain('F2019L01463');
    expect(reefrep?.properties.sourceCitation).toContain('MSC.315(88)');
    expect(reefrep?.properties.datum).toContain('WGS 84');
    expect(reefrep?.properties.geometryNote).toContain('Marine Order 63 is current');
    expect(reefrep?.properties.geometryNote).toContain('21°00′S, 152°55′E');
    expect(reefrep?.properties.geometryNote).toContain('AUS 4635');
    expect(reefrep?.properties.geometryNote).toContain('not a complete area polygon');
    expect(reefrep?.geometry.coordinates).toEqual([
      [152.91666666666666, -21],
      [153.75, -23.7],
      [153.58333333333334, -24.5],
    ]);
    expect(reefrep?.properties.sourceCitation).toContain('MSC.315(88)');
    expect(reefrep?.properties.datum).toContain('WGS 84');
    expect(reefrep?.properties.geometryNote).toContain('not a complete area polygon');
  });

  it('keeps both outer arcs at their stated spherical radii between the published endpoints', () => {
    const coordinates = SHIP_REPORTING_SYSTEMS.features[0].geometry.coordinates;
    const radians = Math.PI / 180;
    const earthRadiusNm = 3440.065;
    const distanceNm = (a: [number, number], b: [number, number]) => {
      const [lon1, lat1] = a.map((value) => value * radians);
      const [lon2, lat2] = b.map((value) => value * radians);
      const deltaLon = lon2 - lon1;
      const deltaLat = lat2 - lat1;
      const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
      return 2 * earthRadiusNm * Math.asin(Math.sqrt(haversine));
    };
    const findSegment = (start: [number, number], end: [number, number], from: number) => {
      const startIndex = coordinates.findIndex((point, index) => index >= from && point[0] === start[0] && point[1] === start[1]);
      const endIndex = coordinates.findIndex((point, index) => index > startIndex && point[0] === end[0] && point[1] === end[1]);
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(endIndex).toBeGreaterThan(startIndex);
      return { startIndex, endIndex, points: coordinates.slice(startIndex, endIndex + 1) };
    };
    const arcs = [
      {
        start: [-161.705, 24.0435] as [number, number],
        end: [-162.13566666666668, 22.0765] as [number, number],
        center: [-161.92033333333333, 23.060166666666667] as [number, number],
        radiusNm: 60.25,
      },
      {
        start: [-178.53716666666668, 27.435] as [number, number],
        end: [-178.1075, 29.4035] as [number, number],
        center: [-178.32516666666668, 28.4205] as [number, number],
        radiusNm: 60.17,
      },
    ];
    let afterPreviousArc = 0;
    for (const arc of arcs) {
      const segment = findSegment(arc.start, arc.end, afterPreviousArc);
      expect(segment.points.length).toBeGreaterThan(700);
      for (const point of segment.points.slice(1, -1)) {
        expect(distanceNm(arc.center, point)).toBeCloseTo(arc.radiusNm, 5);
      }
      afterPreviousArc = segment.endIndex + 1;
    }
    expect(coordinates[0]).toEqual(coordinates.at(-1));
  });

  it('includes the WHALESNORTH offshore boundary with its seven official NAD 83 positions', () => {
    const feature = SHIP_REPORTING_SYSTEMS.features.find((entry) => entry.properties.systemId === 'whalesnorth');
    expect(feature).toBeDefined();
    expect(feature?.properties.datum).toBe('NAD 83');
    expect(feature?.properties.sourceUrl).toContain('ecfr.gov');
    expect(feature?.properties.sourceCitation).toContain('33 CFR');
    expect(feature?.properties.geometryNote).toContain('Massachusetts shoreline');
    expect(feature?.properties.geometryNote.toLowerCase()).toContain('approximate');
    expect(feature?.geometry.coordinates).toEqual([
      [-70.61666666666666, 42.65],
      [-70.21666666666667, 42.75],
      [-68.51666666666667, 42.166666666666664],
      [-68.51666666666667, 41],
      [-69.28333333333333, 41],
      [-70.03333333333333, 42.083333333333336],
      [-70.16666666666667, 42.06666666666667],
    ]);
  });

  it('records researched systems that must not be drawn as guessed polygons', () => {
    const notes = SHIP_REPORTING_SYSTEMS.coverageNotes;
    expect(notes).toHaveLength(18);
    for (const id of ['nordreg', 'ecareg', 'caldovrep', 'ouessrep', 'wetrep', 'coprep', 'amver', 'lrit']) {
      expect(notes.find((note) => note.systemId === id)).toBeDefined();
    }
    expect(notes.find((note) => note.systemId === 'ouessrep')?.note).toContain('35 NM');
    expect(notes.find((note) => note.systemId === 'ouessrep')?.note).toContain('repealed 2017-085');
    expect(notes.find((note) => note.systemId === 'ouessrep')?.note).toContain('different operational areas');
    expect(notes.find((note) => note.systemId === 'ouessrep')?.note).toContain('40 NM');
    expect(notes.find((note) => note.systemId === 'gofrep')?.note).toContain('St. Petersburg–Tallinn');
    expect(notes.find((note) => note.systemId === 'gofrep')?.note).toContain('Väinameri');
    expect(notes.find((note) => note.systemId === 'gofrep')?.note).toContain('western');
    expect(notes.find((note) => note.systemId === 'gdanrep')?.datum).toBe('WGS 84');
    expect(notes.find((note) => note.systemId === 'wetrep')?.note).toContain('do not amend §2.1 coordinates');
    expect(notes.find((note) => note.systemId === 'beltrep')?.note).toContain('1 December 2026');
    expect(notes.find((note) => note.systemId === 'soundrep')?.note).toContain('1 December 2026');
    expect(notes.find((note) => note.systemId === 'nordreg')?.datum).toContain('Not stated');
    expect(notes.find((note) => note.systemId === 'nordreg')?.note).toContain('upper limit');
    expect(notes.find((note) => note.systemId === 'nordreg')?.note).toContain('EEZ');
    expect(notes.find((note) => note.systemId === 'ecareg')?.note).toContain('bearing rays');
    expect(notes.find((note) => note.systemId === 'nordreg')?.note).toContain('SSCZ 5 and 7');
    expect(notes.find((note) => note.systemId === 'ecareg')?.sourceCitation).toContain('SOR/2025-275');
    expect(notes.find((note) => note.systemId === 'reef_rep')?.sourceCitation).toContain('MSC.315(88)');
    expect(notes.find((note) => note.systemId === 'reef_rep')?.note).toContain('21°00′S 152°55′E');
    expect(notes.find((note) => note.systemId === 'amver')?.status).toContain('Voluntary');
    expect(notes.find((note) => note.systemId === 'caldovrep')?.status).toContain('partial segment');
    expect(notes.find((note) => note.systemId === 'wetrep')?.status).toContain('partial open lines');
    expect(notes.find((note) => note.systemId === 'coprep')?.status).toContain('partial chain');
    expect(notes.find((note) => note.systemId === 'lrit')?.status).toContain('tracking');
  });

  it('rejects missing provenance, invalid coordinates, unknown geometry, and inferred systems', () => {
    const valid = source as unknown as Record<string, unknown>;
    expect(validateShipReportingDataset(valid)).not.toBeNull();
    const noSource = structuredClone(valid) as { features: { properties: Record<string, unknown> }[] };
    delete noSource.features[0].properties.sourceUrl;
    expect(validateShipReportingDataset(noSource)).toBeNull();
    const noCoverageNote = structuredClone(valid) as { coverageNotes: unknown[] };
    noCoverageNote.coverageNotes[0] = { systemId: 'invalid' };
    expect(validateShipReportingDataset(noCoverageNote)).toBeNull();
    const invalidVerificationDate = structuredClone(valid) as { features: { properties: Record<string, unknown> }[] };
    invalidVerificationDate.features[0].properties.verifiedAsOf = '2026-02-31';
    expect(validateShipReportingDataset(invalidVerificationDate)).toBeNull();
    const badPoint = structuredClone(valid) as { features: { geometry: { coordinates: number[][] } }[] };
    badPoint.features[0].geometry.coordinates[0] = [181, 0];
    expect(validateShipReportingDataset(badPoint)).toBeNull();
    const badGeometry = structuredClone(valid) as { features: { geometry: Record<string, unknown> }[] };
    badGeometry.features[0].geometry.type = 'Polygon';
    expect(validateShipReportingDataset(badGeometry)).toBeNull();
    const unknown = structuredClone(valid) as { features: { id: string; properties: Record<string, unknown> }[] };
    unknown.features.push({ ...unknown.features[0], id: 'unverified-straitrep', properties: { ...unknown.features[0].properties, systemId: 'unverified_straitrep', system: 'STRAITREP' } });
    expect(validateShipReportingDataset(unknown)).toBeNull();
    expect(SHIP_REPORTING_SYSTEMS.features.some((feature) => feature.properties.systemId === 'unverified_beltrep')).toBe(false);
  });
});
