import { apiClient } from './client';

/** A class the teacher is currently teaching. */
export interface LiveClass {
  id: string;
  name: string;
  createdAt: string;
  studentCount: number;
}

export interface ArchivedClass extends LiveClass {
  archivedAt: string;
}

export interface ClassList {
  live: LiveClass[];
  archived: ArchivedClass[];
}

/** A class restored under a new name because its own was taken by a live class. */
export interface Rename {
  from: string;
  to: string;
}

export interface MoveResult extends ClassList {
  renamed: Rename[];
}

export function listClasses(): Promise<ClassList> {
  return apiClient.get<ClassList>('/classes');
}

/**
 * Both directions take a list rather than a single id: end-of-semester turnover
 * archives nearly everything at once, so bulk is the normal case rather than the
 * advanced one.
 *
 * The response carries the new class lists, so the dialog re-renders from the
 * result instead of issuing a second request against data that has just moved.
 *
 * **These two opt out of the automatic rate-limit retry**, alone among the app's
 * requests. A move is a dozen Google calls, so re-sending it after a 429 spends
 * the exhausted quota again from the top and makes each attempt likelier to fail
 * than the one before. The server already retries the individual call that was
 * refused, which is where a retry can be cheap; here it can only be expensive.
 */
const NO_RETRY = { retryOnRateLimit: false };

export function archiveClasses(classIds: string[]): Promise<MoveResult> {
  return apiClient.post<MoveResult>('/classes/archive', { classIds }, NO_RETRY);
}

export function unarchiveClasses(classIds: string[]): Promise<MoveResult> {
  return apiClient.post<MoveResult>('/classes/unarchive', { classIds }, NO_RETRY);
}

/**
 * Renames one class, live or archived. Answers with the class lists, like the
 * moves. Keeps the default rate-limit retry: it is two to four Sheets calls (one
 * read and one write, plus the class and enrollment reads on a cold cache), not a
 * dozen, and repeating it is harmless because the same name again is a no-op.
 */
export function renameClass(classId: string, name: string): Promise<ClassList> {
  return apiClient.patch<ClassList>(`/classes/${encodeURIComponent(classId)}`, { name });
}
