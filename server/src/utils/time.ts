export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * True for Saturday/Sunday. Parses the YYYY-MM-DD as UTC so the weekday is
 * independent of the server's local timezone.
 */
export function isWeekend(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The calendar day after the given YYYY-MM-DD, in UTC.
 *
 * Shared by the v4→v5 migration and the enrollment start-date rule so the two
 * cannot drift: both express "the first day this student could have been in a
 * register" as the day after the last one that was taken.
 */
export function dayAfter(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
