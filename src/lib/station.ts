export type StationTab = 'ais' | 'tracking' | 'colregs';

export const STATION_TABS: StationTab[] = ['ais', 'tracking', 'colregs'];

export const STATION_TAB_LABELS: Record<StationTab, string> = {
  ais: 'AIS',
  tracking: 'Tracking',
  colregs: 'COLREGs',
};

export const STATION_LABELS: Record<StationTab, string> = {
  ais: 'AIS live traffic',
  tracking: 'Tracking info',
  colregs: 'COLREGs guide',
};
