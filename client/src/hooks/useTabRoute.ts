import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * The last tab each tabbed page was on, remembered while the app is open.
 *
 * Module scope, not localStorage, for the same reasons as `useSelectedClass`:
 * it survives moving between tools, and a fresh app session starts at the
 * page's default tab.
 */
const remembered: Record<string, string> = {};

/** Test hook: forget every remembered tab between runs. */
export function resetRememberedTabs(): void {
  for (const key of Object.keys(remembered)) delete remembered[key];
}

/**
 * Reads the tab from the path segment after `basePath`, for a page whose
 * sub-pages are URL-backed tabs (`/attendance/history`).
 *
 * Read from the location rather than a route param, so a page can declare its
 * tabs as static routes beside a dynamic sibling — `/students/roster` next to
 * `/students/:studentId` — without the two competing for the same param.
 *
 * Returns the active tab, or `null` with where the page should redirect when
 * the segment is missing or not one of `tabs`: the tab the teacher last used, or
 * `fallback` the first time. The query string is carried across, so a link like
 * `/students?add=bulk` still arrives with its instruction.
 */
export function useTabRoute<T extends string>(
  page: string,
  basePath: string,
  tabs: readonly T[],
  fallback: T,
): { tab: T; redirectTo: null } | { tab: null; redirectTo: string } {
  const { pathname, search } = useLocation();
  const segment = pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length + 1).split('/')[0]
    : '';
  const active = tabs.find((t) => t === segment) ?? null;

  useEffect(() => {
    if (active !== null) remembered[page] = active;
  }, [page, active]);

  if (active !== null) return { tab: active, redirectTo: null };
  const last = tabs.find((t) => t === remembered[page]) ?? fallback;
  return { tab: null, redirectTo: `${basePath}/${last}${search}` };
}
