import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group as GroupIcon } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { isApiError } from '../../api/client';
import {
  listConstraints,
  saveCurrentGrouping,
  getCurrentGrouping,
  type SaveCurrentInput,
} from '../../api/grouping';
import { useRoster } from '../students/useRoster';
import { useEntitlements } from '../../hooks/useEntitlements';
import { useSelectedClass } from '../../hooks/useSelectedClass';
import { buildNameLookup } from './names';
import { buildGroups } from './groupingAlgorithm';
import { useAppearance } from './appearance';
import { ConfigPanel, ConfigPanelSkeleton } from './ConfigPanel';
import { ConstraintsEditor } from './ConstraintsEditor';
import { AppearanceSettings } from './AppearanceSettings';
import { GroupsCanvas } from './GroupsCanvas';
import type { Group, Grouping, GroupingConstraint, GroupingMode } from './types';

const LIMITS: Record<GroupingMode, { min: number; max: number }> = {
  size: { min: 2, max: 10 },
  count: { min: 2, max: 20 },
};

// Wait for a lull in edits before writing to Sheets, so mashing Regenerate (or a
// flurry of drags) collapses into a single save of the final arrangement.
const SAVE_DEBOUNCE_MS = 900;

function clamp(value: number, mode: GroupingMode): number {
  const { min, max } = LIMITS[mode];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** The size/count parameter carried by a grouping, for re-persisting after an edit. */
function paramsOf(g: Grouping): { groupSize?: number; groupCount?: number } {
  return g.groupSize !== null ? { groupSize: g.groupSize } : { groupCount: g.groupCount ?? undefined };
}

export function GroupingPage() {
  const { students, loading, error, reload } = useRoster();
  const { appearance, update: updateAppearance } = useAppearance();
  const { isPremium } = useEntitlements();
  const [mode, setMode] = useState<GroupingMode>('size');
  const [value, setValue] = useState(4);
  const [grouping, setGrouping] = useState<Grouping | null>(null);
  // Gates the ConfigPanel: true while a class's saved grouping is being fetched,
  // so the mode/target controls never flash their defaults before it resolves.
  const [groupingLoading, setGroupingLoading] = useState(true);
  const [constraints, setConstraints] = useState<GroupingConstraint[] | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [showConstraints, setShowConstraints] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);

  // Debounced-save machinery: the latest pending write and its timer.
  const pendingSave = useRef<SaveCurrentInput | null>(null);
  const saveTimer = useRef<number | null>(null);

  const courses = useMemo(
    () =>
      Array.from(new Set((students ?? []).flatMap((s) => s.courses))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [students],
  );
  // Defaults to the first class alphabetically, and is remembered across
  // navigation per tool — see useSelectedClass.
  const [activeCourse, setCourse] = useSelectedClass('grouping', courses);

  const scopedStudents = useMemo(() => {
    const list = students ?? [];
    return activeCourse === null ? list : list.filter((s) => s.courses.includes(activeCourse));
  }, [students, activeCourse]);

  const nameOf = useMemo(() => buildNameLookup(students ?? []), [students]);

  const reloadConstraints = useCallback(async () => {
    // Constraints are premium, and the endpoint is gated. A free account gets
    // an empty set rather than an error: generation still works, its saved
    // rules are simply not applied, and they re-apply on upgrade.
    if (!isPremium) {
      setConstraints([]);
      return;
    }
    try {
      setConstraints(await listConstraints());
    } catch {
      // Non-fatal: fall back to no constraints so grouping still works.
      setConstraints([]);
    }
  }, [isPremium]);

  useEffect(() => {
    void reloadConstraints();
  }, [reloadConstraints]);

  // Flushes any pending write immediately (used before a class switch and on unmount).
  const flushSave = useCallback(async () => {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const payload = pendingSave.current;
    pendingSave.current = null;
    if (!payload) return;
    try {
      await saveCurrentGrouping(payload);
    } catch (e) {
      setOpError(isApiError(e) ? e.message : 'Could not save this grouping. Please try again.');
    }
  }, []);

  const scheduleSave = useCallback(
    (payload: SaveCurrentInput) => {
      pendingSave.current = payload;
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  // Restore the saved grouping whenever the class changes (persisting any pending
  // edits from the previous class first, so switching away never loses them).
  useEffect(() => {
    if (activeCourse === null) return;
    let cancelled = false;
    void (async () => {
      await flushSave();
      if (cancelled) return;
      setGrouping(null);
      setGroupingLoading(true);
      try {
        const g = await getCurrentGrouping(activeCourse);
        if (cancelled) return;
        setGrouping(g);
        if (g?.groupSize != null) {
          setMode('size');
          setValue(g.groupSize);
        } else if (g?.groupCount != null) {
          setMode('count');
          setValue(g.groupCount);
        }
      } catch (e) {
        if (!cancelled) {
          setOpError(isApiError(e) ? e.message : 'Could not load this class’s grouping.');
        }
      } finally {
        if (!cancelled) setGroupingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCourse, flushSave]);

  // Flush a pending write when leaving the page.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
      const payload = pendingSave.current;
      pendingSave.current = null;
      if (payload) void saveCurrentGrouping(payload).catch(() => {});
    };
  }, []);

  if (loading && students === null) {
    return <LoadingState label="Loading roster…" />;
  }

  if (error && students === null) {
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            Retry
          </Button>
        }
      />
    );
  }

  const list = students ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        icon={GroupIcon}
        heading="No students to group"
        description="Grouping works from your roster. Add students on the Students page first."
      />
    );
  }

  // Runs the solver locally for instant display, then schedules a debounced save.
  const runGenerate = () => {
    if (activeCourse === null || constraints === null) return;
    const v = clamp(value, mode);
    setValue(v);
    setOpError(null);
    try {
      const params = mode === 'size' ? { groupSize: v } : { groupCount: v };
      const groups = buildGroups({
        studentIds: scopedStudents.map((s) => s.id),
        constraints: constraints.map((c) => ({
          constraintTypeKey: c.constraintTypeKey,
          studentIds: c.studentIds,
        })),
        ...params,
      });
      setGrouping({
        id: null,
        groupSize: params.groupSize ?? null,
        groupCount: params.groupCount ?? null,
        groups,
        generatedAt: new Date().toISOString(),
        savedAt: null,
      });
      scheduleSave({ course: activeCourse, ...params, groups });
    } catch (e) {
      setOpError(e instanceof Error ? e.message : 'Could not generate groups.');
    }
  };

  // A drag-move or group reorder from the canvas: update locally, then debounce-save.
  const applyGroups = (groups: Group[]) => {
    if (!grouping || activeCourse === null) return;
    setGrouping({ ...grouping, groups });
    scheduleSave({ course: activeCourse, ...paramsOf(grouping), groups });
  };

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Grouping">
        <label className="flex items-center gap-2 text-sm text-secondary">
          Class
          <Select
            value={activeCourse ?? ''}
            onChange={(e) => setCourse(e.target.value)}
            aria-label="Filter by class"
          >
            {courses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </label>
      </PageHeader>

      {groupingLoading ? (
        <ConfigPanelSkeleton />
      ) : (
        <ConfigPanel
          mode={mode}
          onModeChange={setMode}
          value={value}
          onValueChange={setValue}
          onGenerate={runGenerate}
          hasResult={grouping !== null}
          disabled={activeCourse === null || constraints === null}
          onOpenConstraints={() => setShowConstraints(true)}
          onOpenAppearance={() => setShowAppearance(true)}
        />
      )}

      {opError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{opError}</p>
      )}

      <GroupsCanvas
        grouping={grouping}
        nameOf={nameOf}
        appearance={appearance}
        onChange={grouping ? applyGroups : undefined}
      />

      {showConstraints && (
        <ConstraintsEditor
          students={scopedStudents}
          nameOf={nameOf}
          onClose={() => {
            setShowConstraints(false);
            void reloadConstraints();
          }}
        />
      )}
      {showAppearance && (
        <AppearanceSettings
          appearance={appearance}
          onChange={updateAppearance}
          onClose={() => setShowAppearance(false)}
        />
      )}
    </section>
  );
}
