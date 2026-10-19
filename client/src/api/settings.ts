import { apiClient } from './client';

/** A high-absence threshold: a minimum sample of recorded days and a rate to exceed. */
export interface HighAbsenceThreshold {
  minAbsenceRate: number;
  minDaysRecorded: number;
}

export interface Settings {
  /** The threshold actually applied — the default on `free`, the stored value otherwise. */
  highAbsence: HighAbsenceThreshold & { isDefault: boolean };
  /** The account's saved threshold when it exists and is not currently applied. */
  storedOverride: HighAbsenceThreshold | null;
}

/** Not gated: the high-absence tooltip names the threshold on every plan. */
export function getSettings(): Promise<Settings> {
  return apiClient.get<Settings>('/settings');
}

/**
 * Only the rate is the teacher's to set. `minDaysRecorded` is a fixed sample
 * floor the server writes from its own default, so it is absent from the
 * request even though it comes back in the effective threshold.
 */
export function updateSettings(highAbsence: { minAbsenceRate: number }): Promise<Settings> {
  return apiClient.put<Settings>('/settings', { highAbsence });
}
