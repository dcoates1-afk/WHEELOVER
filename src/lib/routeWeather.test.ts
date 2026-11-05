import { describe, expect, it } from 'vitest';
import { verdictForConditions, verdictForReport, type VerdictConditions } from './routeWeather';
import type { WeatherReport } from './weather';

const calm: VerdictConditions = { windKn: 10, gustsKn: 15, wavesM: 0.5, visibilityNm: 8 };

describe('route weather verdict', () => {
  it('goes when every factor is in the Go band', () => {
    const verdict = verdictForConditions(calm);
    expect(verdict.level).toBe('go');
    expect(verdict.drivers).toEqual([]);
    expect(verdict.unknown).toEqual([]);
  });

  it('names each factor driving a Caution', () => {
    expect(verdictForConditions({ ...calm, windKn: 20 }).drivers).toEqual(['Wind']);
    expect(verdictForConditions({ ...calm, gustsKn: 25 }).drivers).toEqual(['Gusts']);
    expect(verdictForConditions({ ...calm, wavesM: 1.5 }).drivers).toEqual(['Waves']);
    expect(verdictForConditions({ ...calm, visibilityNm: 3 }).drivers).toEqual(['Visibility']);
    for (const verdict of [
      verdictForConditions({ ...calm, windKn: 20 }),
      verdictForConditions({ ...calm, gustsKn: 25 }),
      verdictForConditions({ ...calm, wavesM: 1.5 }),
      verdictForConditions({ ...calm, visibilityNm: 3 }),
    ]) {
      expect(verdict.level).toBe('caution');
    }
  });

  it('names each factor driving a No-go', () => {
    expect(verdictForConditions({ ...calm, windKn: 30 }).level).toBe('nogo');
    expect(verdictForConditions({ ...calm, windKn: 30 }).drivers).toEqual(['Wind']);
    expect(verdictForConditions({ ...calm, gustsKn: 35 }).drivers).toEqual(['Gusts']);
    expect(verdictForConditions({ ...calm, wavesM: 2.5 }).drivers).toEqual(['Waves']);
    expect(verdictForConditions({ ...calm, visibilityNm: 1 }).drivers).toEqual(['Visibility']);
  });

  it('treats band edges exactly as confirmed', () => {
    // Go edges are exclusive on the low side for wind/gusts/waves, and
    // exclusive on the high side for visibility; Caution edges inclusive.
    expect(verdictForConditions({ ...calm, windKn: 15 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, windKn: 25 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, windKn: 25.1 }).level).toBe('nogo');
    expect(verdictForConditions({ ...calm, gustsKn: 20 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, gustsKn: 30 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, gustsKn: 30.1 }).level).toBe('nogo');
    expect(verdictForConditions({ ...calm, wavesM: 1 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, wavesM: 2 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, wavesM: 2.1 }).level).toBe('nogo');
    expect(verdictForConditions({ ...calm, visibilityNm: 5 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, visibilityNm: 2 }).level).toBe('caution');
    expect(verdictForConditions({ ...calm, visibilityNm: 1.9 }).level).toBe('nogo');
  });

  it('lets the worst factor win and names only its drivers', () => {
    const verdict = verdictForConditions({ ...calm, windKn: 30, visibilityNm: 3 });
    expect(verdict.level).toBe('nogo');
    expect(verdict.drivers).toEqual(['Wind']);
  });

  it('excludes unknown factors and names them instead of assuming calm', () => {
    const verdict = verdictForConditions({ ...calm, wavesM: null });
    expect(verdict.level).toBe('go');
    expect(verdict.unknown).toEqual(['Waves']);
    expect(verdict.factors.find((factor) => factor.name === 'Waves')?.display).toBeNull();
  });

  it('never claims Go on no data at all', () => {
    const verdict = verdictForConditions({ windKn: null, gustsKn: null, wavesM: null, visibilityNm: null });
    expect(verdict.level).toBe('caution');
    expect(verdict.unknown).toEqual(['Wind', 'Gusts', 'Waves', 'Visibility']);
  });

  it('converts report visibility from metres to nautical miles', () => {
    const report = {
      wind: [{ time: 't', value: 10 }],
      gusts: [{ time: 't', value: 15 }],
      waves: [{ time: 't', value: 0.5 }],
      visibility: [{ time: 't', value: 9260 }],
    } as unknown as WeatherReport;
    // 9260 m is just under 5 NM, so visibility alone holds it at Caution.
    const verdict = verdictForReport(report);
    expect(verdict.level).toBe('caution');
    expect(verdict.drivers).toEqual(['Visibility']);
    expect(verdict.factors.find((factor) => factor.name === 'Visibility')?.display).toBe('5.0 NM');
  });
});
