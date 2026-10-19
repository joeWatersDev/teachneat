import { describe, it, expect } from 'vitest';
import { pickRandom, selectablePool, type PickerStudent } from './picker';

function roster(n: number): PickerStudent[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, name: `Student ${i + 1}` }));
}

describe('pickRandom', () => {
  it('returns null for an empty pool', () => {
    expect(pickRandom([])).toBeNull();
  });

  it('always returns the only member of a one-item pool', () => {
    const only = { id: 's1', name: 'Solo' };
    expect(pickRandom([only])).toBe(only);
  });

  it('stays in range even if rng returns its supremum', () => {
    const items = roster(4);
    // Math.random never returns 1, but a stubbed rng might; index must not overflow.
    expect(pickRandom(items, () => 1)).toBe(items[3]);
  });

  it('is roughly uniform over 4,000 picks against a small roster', () => {
    const items = roster(4);
    const counts = new Map<string, number>(items.map((s) => [s.id, 0]));
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const picked = pickRandom(items)!;
      counts.set(picked.id, counts.get(picked.id)! + 1);
    }
    const expected = runs / items.length;
    for (const c of counts.values()) {
      // Within 25% of the expected share — loose enough to be non-flaky, tight
      // enough to catch a biased selector (e.g. one that never picks index 0).
      expect(c).toBeGreaterThan(expected * 0.75);
      expect(c).toBeLessThan(expected * 1.25);
    }
  });
});

describe('selectablePool', () => {
  const students = roster(3);

  it('returns everyone when exclusion is off', () => {
    expect(selectablePool(students, ['s1', 's2'], false)).toEqual(students);
  });

  it('drops already-picked students when exclusion is on', () => {
    expect(selectablePool(students, ['s1'], true)).toEqual([students[1], students[2]]);
  });

  it('empties once everyone has been picked', () => {
    expect(selectablePool(students, ['s1', 's2', 's3'], true)).toEqual([]);
  });
});
