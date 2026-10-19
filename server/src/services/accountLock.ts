import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ApiError } from '../utils/errors.js';
import { sessionOf } from '../middleware/session.js';

/**
 * A per-account exclusive lock, held while a class archive, restore or rename
 * runs (Phase 2 Step 6e).
 *
 * The hazard it closes is specific. Moving a class rewrites whole tabs: the
 * operation reads a tab, works out which rows stay, and writes those back. A
 * write that lands in between — a teacher marking attendance for a class they
 * did *not* archive — is read by nobody and then overwritten by the rewrite. It
 * disappears with no error anywhere, in the one operation where losing a row is
 * least forgivable.
 *
 * So writes are refused for the duration and reads are left alone. Reads cannot
 * corrupt anything, and blocking them would freeze the whole app over an
 * operation that takes seconds.
 *
 * **In-process, and that is a deliberate limit.** It protects one instance,
 * which is exactly the scope the app runs in today (see the multi-instance
 * decision: single instance now, sticky sessions if we scale out). A second
 * instance would need this in Postgres, and the note here is the reminder that
 * it is a prerequisite for scaling out rather than an afterthought.
 *
 * Not a queue: a second archive is refused rather than made to wait. Two
 * concurrent whole-tab rewrites are exactly what must not happen, and a teacher
 * who double-clicks is better told "already running" than left watching a
 * spinner that silently serialises.
 */

const locked = new Set<string>();

export function isLocked(googleSub: string): boolean {
  return locked.has(googleSub);
}

/**
 * Runs `fn` holding the account's lock, releasing it however `fn` settles. A
 * lock left held by a thrown error would lock a teacher out of their own writes
 * until the process restarted.
 */
export async function withAccountLock<T>(googleSub: string, fn: () => Promise<T>): Promise<T> {
  if (locked.has(googleSub)) {
    throw new ApiError(
      'CONFLICT',
      'Your classes are already being updated. Wait for that to finish.',
    );
  }
  locked.add(googleSub);
  try {
    return await fn();
  } finally {
    locked.delete(googleSub);
  }
}

/** Methods that change nothing, and so are safe to serve mid-rewrite. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuses state-changing requests for an account whose archive is in flight.
 * Mounted on the tool routers, so it covers every write a teacher could issue
 * from another tab while the dialog is open.
 */
export const rejectWhileLocked: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (isLocked(sessionOf(req).googleSub)) {
    next(
      new ApiError(
        'CONFLICT',
        'Your classes are being updated. This will only take a moment — try again when it finishes.',
      ),
    );
    return;
  }
  next();
};

/** Test hook: drop every held lock. */
export function clearLocks(): void {
  locked.clear();
}
