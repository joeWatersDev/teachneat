/** Parses a YYYY-MM-DD string as a UTC calendar date (timezone-independent). */
export function parseIso(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Formats a Date's UTC calendar day as YYYY-MM-DD. */
export function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 0 = Sunday … 6 = Saturday, computed in UTC. */
export function weekday(date: string): number {
  return parseIso(date).getUTCDay();
}

/** True for Saturday/Sunday. */
export function isWeekend(date: string): boolean {
  const day = weekday(date);
  return day === 0 || day === 6;
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD string, in UTC. */
export function addDays(date: string, delta: number): string {
  const d = parseIso(date);
  d.setUTCDate(d.getUTCDate() + delta);
  return toIso(d);
}

/** Today in the teacher's local timezone, as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
