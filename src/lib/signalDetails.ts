import type { Navaid } from './navaidTypes';

/**
 * The sound-signal and radar-transponder details a mark can carry.
 *
 * Two indexes supply these: the sector index (which carries signals for the
 * lights it covers) and the worldwide signal index. Both only ever fill what a
 * mark is missing — a mark's own record is the one checked against the chart.
 */
export interface SignalDetails {
  fogSignal?: boolean;
  fogSignalCategory?: string;
  fogSignalGroup?: string;
  fogSignalPeriod?: string;
  fogSignalSequence?: string;
  radarTransponderCategory?: string;
  radarTransponderGroup?: string;
  radarTransponderPeriod?: string;
  radarTransponderSequence?: string;
}

/** True when the details hold a sound signal or racon the mark does not. */
export function signalDetailsMissing(mark: Navaid, details: SignalDetails): boolean {
  const noSound = details.fogSignal === true && !mark.fogSignal;
  const racon = details.radarTransponderCategory ?? details.radarTransponderGroup ??
    details.radarTransponderPeriod ?? details.radarTransponderSequence;
  const noRacon = Boolean(racon) &&
    !mark.radarTransponderCategory && !mark.radarTransponderGroup &&
    !mark.radarTransponderPeriod && !mark.radarTransponderSequence;
  return noSound || noRacon;
}

/** Copy only the signal details the mark is missing; its own values always win. */
export function fillSignalDetails(next: Navaid, details: SignalDetails): void {
  if (details.fogSignal && !next.fogSignal) {
    next.fogSignal = true;
    if (details.fogSignalCategory) next.fogSignalCategory = next.fogSignalCategory ?? details.fogSignalCategory;
    if (details.fogSignalGroup) next.fogSignalGroup = next.fogSignalGroup ?? details.fogSignalGroup;
    if (details.fogSignalPeriod) next.fogSignalPeriod = next.fogSignalPeriod ?? details.fogSignalPeriod;
    if (details.fogSignalSequence) next.fogSignalSequence = next.fogSignalSequence ?? details.fogSignalSequence;
  }
  if (details.radarTransponderCategory) {
    next.radarTransponderCategory = next.radarTransponderCategory ?? details.radarTransponderCategory;
  }
  if (details.radarTransponderGroup) {
    next.radarTransponderGroup = next.radarTransponderGroup ?? details.radarTransponderGroup;
  }
  if (details.radarTransponderPeriod) {
    next.radarTransponderPeriod = next.radarTransponderPeriod ?? details.radarTransponderPeriod;
  }
  if (details.radarTransponderSequence) {
    next.radarTransponderSequence = next.radarTransponderSequence ?? details.radarTransponderSequence;
  }
}
