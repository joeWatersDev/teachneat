import type { HighAbsenceThreshold } from '../../api/settings';

/**
 * The product default high-absence threshold, mirrored by hand from the server
 * (server/src/config/plan.ts `DEFAULT_HIGH_ABSENCE`): at least 5 recorded days
 * and an absence rate strictly above 15%.
 *
 * This is the fallback only. A `trial` or `paid` account may store its own
 * threshold, so every flag reads the effective one from `useEntitlements`
 * rather than this constant — the roster icons, the student-detail summary, the
 * Statistics flag, and the email tool's high-absence selection must never
 * disagree about which students are flagged.
 */
export const DEFAULT_HIGH_ABSENCE: HighAbsenceThreshold = {
  minAbsenceRate: 0.15,
  minDaysRecorded: 5,
};

export function isHighAbsenceRisk(
  daysRecorded: number,
  absenceRate: number,
  threshold: HighAbsenceThreshold = DEFAULT_HIGH_ABSENCE,
): boolean {
  return daysRecorded >= threshold.minDaysRecorded && absenceRate > threshold.minAbsenceRate;
}

/** The percentage a threshold's rate represents, trimmed of trailing zeroes. */
function ratePercent(threshold: HighAbsenceThreshold): number {
  return Math.round(threshold.minAbsenceRate * 1000) / 10;
}

/**
 * The rule in words. A teacher cannot judge a warning whose rule they cannot
 * see, so wherever the flag appears the threshold behind it is stated.
 *
 * Only the rate is named. The minimum sample (`minDaysRecorded`) still applies
 * and is still enforced, but it is a fixed statistical guard rather than
 * something the teacher sets, and naming it in every label made a one-number
 * rule read as a two-number one.
 */
export function describeHighAbsence(threshold: HighAbsenceThreshold): string {
  return `Absent for over ${ratePercent(threshold)}% of recorded days.`;
}

/** Short label: "High absences (over 15% of recorded days)". */
export function highAbsenceLabel(threshold: HighAbsenceThreshold): string {
  return `High absences (over ${ratePercent(threshold)}% of recorded days)`;
}
