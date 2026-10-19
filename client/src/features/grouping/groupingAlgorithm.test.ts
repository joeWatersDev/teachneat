import { describe, it, expect } from 'vitest';
import { buildGroups, GroupingConflictError, type AlgoConstraint } from './groupingAlgorithm';

function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `s${i + 1}`);
}

function sizes(groups: { studentIds: string[] }[]): number[] {
  return groups.map((g) => g.studentIds.length).sort((a, b) => a - b);
}

function flat(groups: { studentIds: string[] }[]): string[] {
  return groups.flatMap((g) => g.studentIds).sort();
}

describe('client buildGroups (mirror of the server solver)', () => {
  it('partitions everyone exactly once, no group over the size', () => {
    const groups = buildGroups({ studentIds: ids(10), constraints: [], groupSize: 3 });
    expect(flat(groups)).toEqual(ids(10).sort());
    expect(sizes(groups)).toEqual([2, 2, 3, 3]);
  });

  it('produces the requested number of balanced groups', () => {
    const groups = buildGroups({ studentIds: ids(13), constraints: [], groupCount: 4 });
    expect(sizes(groups)).toEqual([3, 3, 3, 4]);
  });

  it('keeps "together" students together and "apart" students apart', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2'] },
      { constraintTypeKey: 'apart', studentIds: ['s1', 's3'] },
    ];
    for (let i = 0; i < 25; i++) {
      const groups = buildGroups({ studentIds: ids(8), constraints, groupCount: 2 });
      const g1 = groups.find((g) => g.studentIds.includes('s1'))!;
      expect(g1.studentIds).toContain('s2');
      expect(g1.studentIds).not.toContain('s3');
    }
  });

  it('keeps sizes even with a "together" cluster, and lists groups largest-first', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2'] },
    ];
    for (let i = 0; i < 30; i++) {
      const groups = buildGroups({ studentIds: ids(12), constraints, groupCount: 4 });
      expect(sizes(groups)).toEqual([3, 3, 3, 3]);
    }
    const uneven = buildGroups({ studentIds: ids(10), constraints: [], groupCount: 4 });
    const lens = uneven.map((g) => g.studentIds.length);
    expect(lens).toEqual([...lens].sort((a, b) => b - a));
    expect(lens).toEqual([3, 3, 2, 2]);
  });

  it('reaches the even split with together + apart constraints (13 into 6)', () => {
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

  it('throws GroupingConflictError for a together+apart contradiction', () => {
    const constraints: AlgoConstraint[] = [
      { constraintTypeKey: 'together', studentIds: ['s1', 's2'] },
      { constraintTypeKey: 'apart', studentIds: ['s1', 's2'] },
    ];
    expect(() => buildGroups({ studentIds: ids(6), constraints, groupCount: 3 })).toThrow(
      GroupingConflictError,
    );
  });

  it('is deterministic under an injected RNG', () => {
    const constant = () => 0;
    const a = buildGroups({ studentIds: ids(6), constraints: [], groupCount: 3, random: constant });
    const b = buildGroups({ studentIds: ids(6), constraints: [], groupCount: 3, random: constant });
    expect(a).toEqual(b);
  });
});
