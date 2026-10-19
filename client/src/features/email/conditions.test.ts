import { describe, it, expect } from 'vitest';
import {
  parseCondition,
  evaluateCondition,
  formatCondition,
  buildCondition,
  applyConditions,
  stripConditionAttrs,
  type ConditionContext,
} from './conditions';

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  lateCount: 0,
  unexcusedAbsences: 0,
  atRisk: false,
  ...over,
});

describe('conditions grammar', () => {
  it('parses and rejects per the shared grammar', () => {
    expect(parseCondition('lateCount gte 3')).toEqual({ metric: 'lateCount', op: 'gte', value: 3 });
    expect(parseCondition('atRisk is true')?.value).toBe(true);
    expect(parseCondition('absenceRate gte 25')).toBeNull();
    expect(parseCondition('lateCount is 3')).toBeNull();
    // Retired with the IEP surface in Step 8a, and it must stay unparseable
    // here as well as on the server: this mirror decides what the editor
    // offers and what the compose preview shows, so a metric the server has
    // dropped would preview a block that never gets sent.
    expect(parseCondition('hasAccommodations is true')).toBeNull();
  });

  it('builds the string form from an editor selection', () => {
    expect(buildCondition('lateCount', 3)).toBe('lateCount gte 3');
    expect(buildCondition('atRisk', true)).toBe('atRisk is true');
    expect(buildCondition('atRisk', false)).toBe('atRisk is false');
  });

  it('formats a human label', () => {
    expect(formatCondition('lateCount gte 3')).toBe('Only if lates ≥ 3');
    expect(formatCondition('unexcusedAbsences gte 5')).toBe('Only if unexcused absences ≥ 5');
    expect(formatCondition('atRisk is true')).toBe('Only if student is at academic risk');
    expect(formatCondition('atRisk is false')).toBe('Only if student is not at academic risk');
  });

  it('evaluates conditions against a context', () => {
    expect(evaluateCondition('lateCount gte 3', ctx({ lateCount: 4 }))).toBe(true);
    expect(evaluateCondition('lateCount gte 3', ctx({ lateCount: 2 }))).toBe(false);
    expect(evaluateCondition('atRisk is true', ctx({ atRisk: true }))).toBe(true);
    expect(evaluateCondition('atRisk is true', ctx({ atRisk: false }))).toBe(false);
    // A block guarded by the retired metric is dropped rather than shown.
    expect(evaluateCondition('hasAccommodations is true', ctx({ atRisk: true }))).toBe(false);
  });
});

describe('applyConditions', () => {
  const html =
    '<p>Always</p>' +
    '<p data-if="lateCount gte 3">Late warning</p>' +
    '<p data-if="atRisk is true">Check-in note</p>';

  it('keeps passing blocks (stripping the marker) and drops failing ones', () => {
    const out = applyConditions(html, ctx({ lateCount: 4, atRisk: false }));
    expect(out).toContain('Always');
    expect(out).toContain('Late warning');
    expect(out).not.toContain('Check-in note');
    expect(out).not.toContain('data-if');
  });

  it('drops all conditional blocks when nothing matches', () => {
    const out = applyConditions(html, ctx());
    expect(out).toContain('Always');
    expect(out).not.toContain('Late warning');
    expect(out).not.toContain('Check-in note');
  });
});

describe('stripConditionAttrs', () => {
  it('removes markers but keeps every block', () => {
    const out = stripConditionAttrs(
      '<p>A</p><p data-if="lateCount gte 3">B</p>',
    );
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).not.toContain('data-if');
  });
});
