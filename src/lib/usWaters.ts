const US_REGIONS: [number, number, number, number][] = [
  [-125.5, 24.0, -66.0, 50.0], // CONUS
  [-171.0, 51.0, -129.0, 72.0], // Alaska
  [-161.5, 18.5, -154.0, 23.0], // Hawaii
  [-68.0, 17.0, -64.5, 19.0], // Puerto Rico / USVI
];

export function isUsWaters(lat: number, lon: number): boolean {
  return US_REGIONS.some(
    ([west, south, east, north]) => lat >= south && lat <= north && lon >= west && lon <= east,
  );
}
