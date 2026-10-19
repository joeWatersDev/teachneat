import { useCallback, useEffect, useState } from 'react';
import { listStudents, getRiskSummary } from '../../api/students';
import { isApiError } from '../../api/client';
import { getRosterSnapshot, setRosterSnapshot, type RiskFlags } from './rosterCache';
import type { Student } from './types';

export interface RosterData {
  students: Student[] | null;
  /** Per student, the academic-risk / high-absence warning flags. */
  riskByStudent: Record<string, RiskFlags>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Updates one student's at-risk courses in place (and in the cache), without a refetch. */
  patchAtRisk: (studentId: string, atRiskCourses: string[]) => void;
}

/**
 * Loads the roster and its warning flags in two parallel requests. Renders the
 * cached snapshot immediately when one exists (stale-while-revalidate) so
 * revisiting the tab never flashes a loading state.
 *
 * `forTool` is passed through to the roster read and is only ever 'picker'; see
 * listStudents. Note that the revalidating fetch runs on every mount even when
 * the snapshot is warm, which is what makes the picker's count a count of
 * opening it rather than of first opening it.
 */
export function useRoster(forTool?: 'picker'): RosterData {
  const cached = getRosterSnapshot();
  const [students, setStudents] = useState<Student[] | null>(cached?.students ?? null);
  const [riskByStudent, setRisk] = useState<Record<string, RiskFlags>>(
    cached?.riskByStudent ?? {},
  );
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (getRosterSnapshot() === null) setLoading(true);
    setError(null);
    try {
      const [list, risk] = await Promise.all([listStudents(forTool), getRiskSummary()]);
      const riskMap: Record<string, RiskFlags> = {};
      for (const entry of risk) {
        riskMap[entry.studentId] = {
          atRiskCourses: entry.atRiskCourses,
          highAbsenceCourses: entry.highAbsenceCourses,
        };
      }
      setRosterSnapshot({ students: list, riskByStudent: riskMap });
      setStudents(list);
      setRisk(riskMap);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Failed to load the roster. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [forTool]);

  const patchAtRisk = useCallback((studentId: string, atRiskCourses: string[]) => {
    setRisk((m) => {
      const prev = m[studentId] ?? { atRiskCourses: [], highAbsenceCourses: [] };
      const next = { ...m, [studentId]: { ...prev, atRiskCourses } };
      const snap = getRosterSnapshot();
      if (snap) setRosterSnapshot({ ...snap, riskByStudent: next });
      return next;
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { students, riskByStudent, loading, error, reload, patchAtRisk };
}
