/**
 * Pure selection logic for the Random Name Picker. The animation modes are
 * cosmetic; fairness lives here and is unit-tested (TESTING_PLAN Step 8).
 */

/** A student reduced to what the picker needs: an id and a display label. */
export interface PickerStudent {
  id: string;
  name: string;
}

/**
 * The set of students eligible for the next pick. With "exclude already picked"
 * off, that is everyone in scope; with it on, everyone not yet drawn this round.
 */
export function selectablePool(
  students: PickerStudent[],
  pickedIds: readonly string[],
  excludePicked: boolean,
): PickerStudent[] {
  if (!excludePicked) return students;
  const picked = new Set(pickedIds);
  return students.filter((s) => !picked.has(s.id));
}

/**
 * Uniformly picks one item. `rng` defaults to Math.random and is injectable so
 * the fairness/distribution tests are deterministic. Returns null for an empty
 * pool rather than throwing, so callers can render an empty state.
 */
export function pickRandom<T>(items: readonly T[], rng: () => number = Math.random): T | null {
  if (items.length === 0) return null;
  // Math.random is [0,1); guard the theoretical rng() === 1 so the index stays in range.
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}
