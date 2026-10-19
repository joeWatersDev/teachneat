import { describe, it, expect } from 'vitest';
import { buildGroups, type AlgoConstraint } from './groupingAlgorithm.js';
import { isApiError } from '../utils/errors.js';

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

function sizes(groups: { studentIds: string[] }[]): number[] {
  return groups.map((g) => g.studentIds.length).sort((a, b) => a - b);
}

function flat(groups: { studentIds: string[] }[]): string[] {
  return groups.flatMap((g) => g.studentIds).sort();
}

describe('buildGroups', () => {
  it('requires exactly one of groupSize / groupCount', () => {
    expect(() => buildGroups({ studentIds: ids(4), constraints: [] })).toThrow();
    expect(() =>
      buildGroups({ studentIds: ids(4), constraints: [], groupSize: 2, groupCount: 2 }),
    ).toThrow();
  });

  it('partitions everyone exactly once (no duplicates, no drops)', () => {
    const groups = buildGroups({ studentIds: ids(10), constraints: [], groupSize: 3 });
    expect(flat(groups)).toEqual(ids(10).sort());
  });

  it('by group size: no group exceeds the size, remainder spread evenly', () => {
    // 10 / 3 -> ceil = 4 bins, even split 3,3,2,2
    const groups = buildGroups({ studentIds: ids(10), constraints: [], groupSize: 3 });
    expect(groups).toHaveLength(4);
    expect(sizes(groups)).toEqual([2, 2, 3, 3]);
  });

  it('by group count: produces that many balanced groups', () => {
    const groups = buildGroups({ studentIds: ids(13), constraints: [], groupCount: 4 });
    expect(groups).toHaveLength(4);
    expect(sizes(groups)).toEqual([3, 3, 3, 4]);
  });

  it('caps group count at the number of students', () => {
    const groups = buildGroups({ studentIds: ids(3), constraints: [], groupCount: 10 });
    expect(groups).toHaveLength(3);
    expect(sizes(groups)).toEqual([1, 1, 1]);
  });

  it('keeps "together" students in the same group', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2', 's3'] },
    ];
    for (let i = 0; i < 25; i++) {
      const groups = buildGroups({ studentIds: ids(12), constraints, groupSize: 3 });
      const g1 = groups.find((g) => g.studentIds.includes('s1'))!;
      expect(g1.studentIds).toContain('s2');
      expect(g1.studentIds).toContain('s3');
    }
  });

  it('keeps sizes even when a "together" cluster is present (by group count)', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2'] },
    ];
    // 12 students into 4 groups: a size-2 cluster fits inside a group of 3, so
    // the "together" pair must not push any group past the even size of 3.
    for (let i = 0; i < 30; i++) {
      const groups = buildGroups({ studentIds: ids(12), constraints, groupCount: 4 });
      expect(sizes(groups)).toEqual([3, 3, 3, 3]);
    }
  });

  it('reaches the even split even with together + apart constraints', () => {
    // The reported case: 13 students into 6 groups, one pair kept together and a
    // few kept apart. The only even split is one group of 3 and five of 2; a
    // single greedy pass would sometimes settle for a lopsided valid split, so
    // this guards that the balanced arrangement is chosen every time.
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2'] },
      { constraintTypeKey: 'apart', studentIds: ['s3', 's4'] },
      { constraintTypeKey: 'apart', studentIds: ['s5', 's6', 's7'] },
    ];
    for (let i = 0; i < 40; i++) {
      const groups = buildGroups({ studentIds: ids(13), constraints, groupCount: 6 });
      expect(sizes(groups)).toEqual([2, 2, 2, 2, 2, 3]);
      const together = groups.find((g) => g.studentIds.includes('s1'))!;
      expect(together.studentIds).toContain('s2');
    }
  });

  it('lists groups largest-to-smallest', () => {
    const groups = buildGroups({ studentIds: ids(10), constraints: [], groupCount: 4 });
    const lens = groups.map((g) => g.studentIds.length);
    expect(lens).toEqual([...lens].sort((a, b) => b - a));
    expect(lens).toEqual([3, 3, 2, 2]);
  });

  it('keeps "apart" students in different groups', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'apart', studentIds: ['s1', 's2'] },
    ];
    for (let i = 0; i < 25; i++) {
      const groups = buildGroups({ studentIds: ids(8), constraints, groupCount: 2 });
      const g1 = groups.find((g) => g.studentIds.includes('s1'))!;
      expect(g1.studentIds).not.toContain('s2');
    }
  });

  it('throws CONFLICT when a pair is both together and apart', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2'] },
      { constraintTypeKey: 'apart', studentIds: ['s1', 's2'] },
    ];
    try {
      buildGroups({ studentIds: ids(6), constraints, groupCount: 3 });
      throw new Error('expected CONFLICT');
    } catch (e) {
      expect(isApiError(e) && e.code).toBe('CONFLICT');
    }
  });

  it('throws CONFLICT when apart cannot fit in the requested number of groups', () => {
    // Three students all mutually apart, but only two groups available.
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'apart', studentIds: ['s1', 's2', 's3'] },
    ];
    try {
      buildGroups({ studentIds: ids(4), constraints, groupCount: 2 });
      throw new Error('expected CONFLICT');
    } catch (e) {
      expect(isApiError(e) && e.code).toBe('CONFLICT');
    }
  });

  it('ignores constraints referencing students outside the population', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 'ghost'] },
    ];
    const groups = buildGroups({ studentIds: ids(4), constraints, groupSize: 2 });
    expect(flat(groups)).toEqual(ids(4).sort());
  });

  it('produces different arrangements across runs (randomized)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const groups = buildGroups({ studentIds: ids(9), constraints: [], groupSize: 3 });
      const signature = groups
        .map((g) => g.studentIds.slice().sort().join(','))
        .sort()
        .join('|');
      seen.add(signature);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('returns no groups for an empty population', () => {
    expect(buildGroups({ studentIds: [], constraints: [], groupSize: 3 })).toEqual([]);
  });

  it('uses an injected RNG deterministically', () => {
    const constant = () => 0; // Fisher-Yates with 0 keeps order; chooseBin picks first best.
    const a = buildGroups({ studentIds: ids(6), constraints: [], groupCount: 3, random: constant });
    const b = buildGroups({ studentIds: ids(6), constraints: [], groupCount: 3, random: constant });
    expect(a).toEqual(b);
  });
});
