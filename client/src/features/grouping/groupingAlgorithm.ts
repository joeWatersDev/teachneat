/**
 * Client-side group builder. A faithful mirror of the server's pure solver
 * (server/src/services/groupingAlgorithm.ts) so the app can generate and
 * re-generate groups instantly and locally — no network round-trip per press,
 * which is what makes the Regenerate button feel instant and mashable. The saved
 * arrangement is persisted separately (debounced) by the page.
 *
 * KEEP IN SYNC with the server copy. Both are pure and unit-tested independently.
 */

export type GroupingConstraintTypeKey = 'together' | 'apart';

export interface AlgoConstraint {
  constraintTypeKey: GroupingConstraintTypeKey;
  studentIds: string[];
}

export interface BuildGroupsInput {
  studentIds: string[];
  constraints: AlgoConstraint[];
  /** Exactly one of groupSize / groupCount must be provided. */
  groupSize?: number;
  groupCount?: number;
  /** Injectable RNG (0..1) for deterministic tests; defaults to Math.random. */
  random?: () => number;
}

export interface GeneratedGroup {
  studentIds: string[];
}

/** Thrown when constraints cannot be satisfied; the page surfaces the message. */
export class GroupingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupingConflictError';
  }
}

const MAX_RESTARTS = 200;

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x);
    if (root === undefined) {
      this.parent.set(x, x);
      return x;
    }
    while (root !== this.parent.get(root)) {
      root = this.parent.get(root)!;
    }
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export function buildGroups(input: BuildGroupsInput): GeneratedGroup[] {
  const { groupSize, groupCount } = input;
  const hasSize = groupSize !== undefined;
  const hasCount = groupCount !== undefined;
  if (hasSize === hasCount) {
    throw new Error('Provide exactly one of groupSize or groupCount.');
  }
  const random = input.random ?? Math.random;

  const population = Array.from(new Set(input.studentIds));
  const inPop = new Set(population);
  if (population.length === 0) return [];

  const constraints = input.constraints
    .map((c) => ({
      constraintTypeKey: c.constraintTypeKey,
      studentIds: Array.from(new Set(c.studentIds.filter((id) => inPop.has(id)))),
    }))
    .filter((c) => c.studentIds.length >= 2);

  // 1. Fuse "together" members into clusters.
  const uf = new UnionFind();
  for (const id of population) uf.find(id);
  for (const c of constraints) {
    if (c.constraintTypeKey !== 'together') continue;
    const [first, ...rest] = c.studentIds;
    for (const other of rest) uf.union(first, other);
  }

  // 2. Apart adjacency + together/apart contradiction detection.
  const apart = new Map<string, Set<string>>();
  const addApart = (a: string, b: string) => {
    if (!apart.has(a)) apart.set(a, new Set());
    apart.get(a)!.add(b);
  };
  for (const c of constraints) {
    if (c.constraintTypeKey !== 'apart') continue;
    for (let i = 0; i < c.studentIds.length; i++) {
      for (let j = i + 1; j < c.studentIds.length; j++) {
        const a = c.studentIds[i];
        const b = c.studentIds[j];
        if (uf.find(a) === uf.find(b)) {
          throw new GroupingConflictError(
            'These constraints conflict: a pair is required both together and apart.',
          );
        }
        addApart(a, b);
        addApart(b, a);
      }
    }
  }

  // 3. Atomic units (together clusters, singletons included).
  const unitByRoot = new Map<string, string[]>();
  for (const id of population) {
    const root = uf.find(id);
    if (!unitByRoot.has(root)) unitByRoot.set(root, []);
    unitByRoot.get(root)!.push(id);
  }
  const units = Array.from(unitByRoot.values());

  // 4. Bin count and even target sizes.
  const n = population.length;
  const bins = hasSize
    ? Math.max(1, Math.ceil(n / groupSize!))
    : Math.max(1, Math.min(groupCount!, n));
  const base = Math.floor(n / bins);
  const remainder = n % bins;
  const targets = Array.from({ length: bins }, (_, i) => base + (i < remainder ? 1 : 0));

  // 5. Randomized placement with bounded restarts. Units are placed largest-first
  //    (a "together" cluster is one atomic unit) so big clusters land in roomy
  //    bins and singletons fill the gaps; randomness is preserved by shuffling,
  //    then stable-sorting by size. Each restart yields one valid arrangement (or
  //    fails "apart"). We keep the MOST BALANCED across restarts rather than the
  //    first — apart constraints can make a single greedy pass land on a valid but
  //    lopsided split, while the even target split is usually reachable on another
  //    try. Balance = sum of squared group sizes (minimized by the even split);
  //    stop early once an attempt reaches that optimum.
  const optimalScore = targets.reduce((sum, t) => sum + t * t, 0);
  let best: string[][] | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < MAX_RESTARTS; attempt++) {
    const order = shuffle(units, random).sort((a, b) => b.length - a.length);
    const placed: string[][] = Array.from({ length: bins }, () => []);
    let ok = true;

    for (const unit of order) {
      const apartOk: number[] = [];
      for (let b = 0; b < bins; b++) {
        if (!violatesApart(unit, placed[b], apart)) apartOk.push(b);
      }
      if (apartOk.length === 0) {
        ok = false;
        break;
      }
      const bin = chooseBin(apartOk, placed, targets, unit.length, random);
      placed[bin].push(...unit);
    }
    if (!ok) continue;

    const groups = placed.filter((g) => g.length > 0);
    const score = groups.reduce((sum, g) => sum + g.length * g.length, 0);
    if (score < bestScore) {
      bestScore = score;
      best = groups;
    }
    if (bestScore <= optimalScore) break; // can't beat the even split
  }

  if (best) {
    // List groups largest-to-smallest.
    return best
      .map((studentIds) => ({ studentIds }))
      .sort((a, b) => b.studentIds.length - a.studentIds.length);
  }

  throw new GroupingConflictError(
    'These constraints can’t be satisfied with the requested number of groups.',
  );
}

function violatesApart(unit: string[], bin: string[], apart: Map<string, Set<string>>): boolean {
  for (const member of unit) {
    const foes = apart.get(member);
    if (!foes) continue;
    for (const occupant of bin) {
      if (foes.has(occupant)) return true;
    }
  }
  return false;
}

function chooseBin(
  candidates: number[],
  placed: string[][],
  targets: number[],
  unitSize: number,
  random: () => number,
): number {
  const remaining = (b: number) => targets[b] - placed[b].length;
  const fits = candidates.filter((b) => remaining(b) >= unitSize);
  const pool = fits.length > 0 ? fits : candidates;
  const maxRemaining = Math.max(...pool.map(remaining));
  const best = pool.filter((b) => remaining(b) === maxRemaining);
  return best[Math.floor(random() * best.length)];
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
