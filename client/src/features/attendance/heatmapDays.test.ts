import { describe, expect, it } from 'vitest';
import { classifyDay, mergeStatus } from './heatmapDays';

const TODAY = '2026-09-15'; // Tuesday

describe('classifyDay', () => {
  it('colors recorded school days by their status', () => {
    expect(classifyDay('2026-09-14', 'p', TODAY)).toBe('present'); // Monday
    expect(classifyDay('2026-09-14', 't', TODAY)).toBe('tardy');
    expect(classifyDay('2026-09-14', 'a', TODAY)).toBe('absent');
    expect(classifyDay('2026-09-14', 'e', TODAY)).toBe('excused');
  });

  it('treats weekends as weekend regardless of any record', () => {
    expect(classifyDay('2026-09-12', undefined, TODAY)).toBe('weekend'); // Saturday
    expect(classifyDay('2026-09-13', 'p', TODAY)).toBe('weekend'); // Sunday, even with a stray record
  });

  it('marks an unrecorded past school day as empty', () => {
    expect(classifyDay('2026-09-14', undefined, TODAY)).toBe('empty');
  });

  it('marks days after today as future', () => {
    expect(classifyDay('2026-09-16', undefined, TODAY)).toBe('future'); // Wednesday, after today
  });
});

describe('mergeStatus', () => {
  it('keeps the more severe status: absent > tardy > excused > present', () => {
    expect(mergeStatus(undefined, 'p')).toBe('p');
    expect(mergeStatus('p', 'e')).toBe('e');
    expect(mergeStatus('e', 't')).toBe('t');
    expect(mergeStatus('t', 'a')).toBe('a');
    // A less severe status never displaces a more severe one already present.
    expect(mergeStatus('a', 'p')).toBe('a');
    expect(mergeStatus('t', 'e')).toBe('t');
  });
});
