import { describe, it, expect } from 'vitest';
import {
  parseCondition,
  isValidCondition,
  evaluateCondition,
  type ConditionContext,
} from './emailConditions.js';

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  lateCount: 0,
  unexcusedAbsences: 0,
  atRisk: false,
  ...over,
});

describe('parseCondition', () => {
  it('parses numeric gte conditions', () => {
    expect(parseCondition('lateCount gte 3')).toEqual({ metric: 'lateCount', op: 'gte', value: 3 });
    expect(parseCondition('unexcusedAbsences gte 5')).toEqual({
      metric: 'unexcusedAbsences',
      op: 'gte',
      value: 5,
    });
  });

  it('parses boolean is conditions', () => {
    expect(parseCondition('atRisk is true')).toEqual({
      metric: 'atRisk',
      op: 'is',
      value: true,
    });
    expect(parseCondition('atRisk is false')?.value).toBe(false);
  });

  it('rejects unknown metrics, wrong operators, and bad values', () => {
    expect(parseCondition('absenceRate gte 25')).toBeNull(); // metric not allowlisted
    expect(parseCondition('lateCount is 3')).toBeNull(); // wrong op for numeric
    expect(parseCondition('atRisk gte 1')).toBeNull(); // wrong op for boolean
    expect(parseCondition('lateCount gte -1')).toBeNull();
    expect(parseCondition('lateCount gte 9999')).toBeNull(); // > 3 digits
    expect(parseCondition('lateCount gte')).toBeNull();
    expect(parseCondition('lateCount gte 3; drop table')).toBeNull();
    expect(isValidCondition('atRisk is maybe')).toBe(false);
    // Retired with the IEP surface in Step 8a. A template saved before that
    // still carries it, and it must not parse: evaluateCondition then fails
    // closed and the block is dropped rather than sent to everybody.
    expect(parseCondition('hasAccommodations is true')).toBeNull();
  });
});

describe('evaluateCondition', () => {
  it('includes a block when a numeric threshold is met (>=)', () => {
    expect(evaluateCondition('lateCount gte 3', ctx({ lateCount: 3 }))).toBe(true);
    expect(evaluateCondition('lateCount gte 3', ctx({ lateCount: 4 }))).toBe(true);
    expect(evaluateCondition('lateCount gte 3', ctx({ lateCount: 2 }))).toBe(false);
  });

  it('evaluates unexcused absences independently', () => {
    expect(evaluateCondition('unexcusedAbsences gte 5', ctx({ unexcusedAbsences: 5 }))).toBe(true);
    expect(evaluateCondition('unexcusedAbsences gte 5', ctx({ unexcusedAbsences: 1 }))).toBe(false);
  });

  it('evaluates the at-risk boolean', () => {
    expect(evaluateCondition('atRisk is true', ctx({ atRisk: true }))).toBe(true);
    expect(evaluateCondition('atRisk is true', ctx({ atRisk: false }))).toBe(false);
    expect(evaluateCondition('atRisk is false', ctx({ atRisk: false }))).toBe(true);
  });

  it('drops a block guarded by the retired accommodations metric', () => {
    expect(evaluateCondition('hasAccommodations is true', ctx({ atRisk: true }))).toBe(false);
    expect(evaluateCondition('hasAccommodations is false', ctx({ atRisk: true }))).toBe(false);
  });

  it('fails closed on a malformed condition', () => {
    expect(evaluateCondition('nonsense', ctx({ lateCount: 99 }))).toBe(false);
  });
});
