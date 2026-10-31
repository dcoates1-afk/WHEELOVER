export interface SeriesPoint {
  time: string;
  value: number;
}

export interface WeatherReport {
  lat: number;
  lon: number;
  fetchedAt: number;
  wind: SeriesPoint[];
  gusts: SeriesPoint[];
  windDirection: SeriesPoint[];
  temperature: SeriesPoint[];
  waves: SeriesPoint[];
  wavePeriod: SeriesPoint[];
  seaTemperature: SeriesPoint[];
  /** Mean sea-level pressure in hectopascals, hourly. */
  pressure: SeriesPoint[];
  /** Sea level above mean sea level from the global tide model, hourly. */
  seaLevel: SeriesPoint[];
  /** Surface current speed in km/h from the global ocean model. */
  currentSpeed: SeriesPoint[];
  /** Direction the surface current sets towards, degrees true. */
  currentDirection: SeriesPoint[];
  marineAvailable: boolean;
  tideModelAvailable: boolean;
  currentModelAvailable: boolean;
}

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

interface OpenMeteoResponse {
  hourly?: Record<string, unknown>;
}

function series(hourly: Record<string, unknown> | undefined, key: string): SeriesPoint[] {
  const times = (hourly?.time as string[] | undefined) ?? [];
  const values = (hourly?.[key] as (number | null)[] | undefined) ?? [];
  const points: SeriesPoint[] = [];
  for (let index = 0; index < times.length; index += 1) {
    const value = values[index];
    if (typeof value === 'number' && Number.isFinite(value)) {
      points.push({ time: times[index], value });
    }
  }
  return points;
}

/**
 * Open-Meteo covers the whole globe, so weather is the one part of the panel
 * that never needs a fallback. The marine request also carries the SMOC sea
 * level and surface current, which stand in for NOAA outside US waters.
 */
export async function fetchWeather(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherReport> {
  const forecastParams = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl',
    wind_speed_unit: 'kn',
    timezone: 'UTC',
    forecast_days: '2',
  });
  const marineParams = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly:
      'wave_height,wave_period,sea_surface_temperature,' +
      'sea_level_height_msl,ocean_current_velocity,ocean_current_direction',
    timezone: 'UTC',
    forecast_days: '2',
  });

  const [forecastResponse, marineResponse] = await Promise.all([
    fetch(`${FORECAST_URL}?${forecastParams}`, { signal }),
    fetch(`${MARINE_URL}?${marineParams}`, { signal }).catch(() => null),
  ]);

  if (!forecastResponse.ok) throw new Error(`Weather service returned HTTP ${forecastResponse.status}`);
  const forecast = (await forecastResponse.json()) as OpenMeteoResponse;

  let marine: OpenMeteoResponse | null = null;
  if (marineResponse && marineResponse.ok) {
    marine = (await marineResponse.json()) as OpenMeteoResponse;
  }

  const seaLevel = series(marine?.hourly, 'sea_level_height_msl');
  const currentSpeed = series(marine?.hourly, 'ocean_current_velocity');
  const currentDirection = series(marine?.hourly, 'ocean_current_direction');

  return {
    lat,
    lon,
    fetchedAt: Date.now(),
    wind: series(forecast.hourly, 'wind_speed_10m'),
    gusts: series(forecast.hourly, 'wind_gusts_10m'),
    windDirection: series(forecast.hourly, 'wind_direction_10m'),
    temperature: series(forecast.hourly, 'temperature_2m'),
    waves: series(marine?.hourly, 'wave_height'),
    wavePeriod: series(marine?.hourly, 'wave_period'),
    seaTemperature: series(marine?.hourly, 'sea_surface_temperature'),
    pressure: series(forecast.hourly, 'pressure_msl'),
    seaLevel,
    currentSpeed,
    currentDirection,
    marineAvailable: Array.isArray(marine?.hourly?.wave_height),
    tideModelAvailable: seaLevel.length > 1,
    currentModelAvailable: currentSpeed.length > 1,
  };
}
