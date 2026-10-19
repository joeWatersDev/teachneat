import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HIGH_ABSENCE,
  isHighAbsenceRisk,
  describeHighAbsence,
  highAbsenceLabel,
} from './thresholds';

describe('isHighAbsenceRisk', () => {
  it('needs the rate strictly above the threshold and the day minimum met', () => {
    expect(isHighAbsenceRisk(5, 0.4)).toBe(true);
    expect(isHighAbsenceRisk(20, 0.15)).toBe(false); // strictly above, not equal
    expect(isHighAbsenceRisk(4, 1)).toBe(false); // below the day minimum
  });

  it('applies a supplied threshold rather than the default', () => {
    const strict = { minAbsenceRate: 0.25, minDaysRecorded: 10 };
    // 20% over 20 days: flagged by the default, not by this account's threshold.
    expect(isHighAbsenceRisk(20, 0.2)).toBe(true);
    expect(isHighAbsenceRisk(20, 0.2, strict)).toBe(false);
    expect(isHighAbsenceRisk(20, 0.3, strict)).toBe(true);
    // The day minimum moves with it.
    expect(isHighAbsenceRisk(8, 0.5, strict)).toBe(false);
  });
});

describe('stating the rule', () => {
  it('describes the default threshold in words', () => {
    expect(describeHighAbsence(DEFAULT_HIGH_ABSENCE)).toBe(
      'Absent for over 15% of recorded days.',
    );
    expect(highAbsenceLabel(DEFAULT_HIGH_ABSENCE)).toBe(
      'High absences (over 15% of recorded days)',
    );
  });

  it('describes a custom threshold, so the wording is never stale', () => {
    const custom = { minAbsenceRate: 0.225, minDaysRecorded: 5 };
    expect(describeHighAbsence(custom)).toBe('Absent for over 22.5% of recorded days.');
  });

  // The sample floor is still enforced, but it is not the teacher's to set, so
  // naming it in every label made a one-number rule read as a two-number one.
  it('omits the sample minimum, which is fixed rather than chosen', () => {
    expect(describeHighAbsence(DEFAULT_HIGH_ABSENCE)).not.toContain('recorded days,');
    expect(describeHighAbsence({ minAbsenceRate: 0.15, minDaysRecorded: 40 })).toBe(
      describeHighAbsence(DEFAULT_HIGH_ABSENCE),
    );
  });
});
