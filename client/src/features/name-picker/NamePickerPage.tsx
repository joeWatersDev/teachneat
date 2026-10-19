import { useCallback, useMemo, useState } from 'react';
import { Shuffle, RotateCcw, Palette } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Select } from '../../components/ui/Select';
import { useRoster } from '../students/useRoster';
import { toPickerStudents } from './names';
import { pickRandom, selectablePool, type PickerStudent } from './picker';
import { usePickerPrefs } from './preferences';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { primeAudio } from './sound';
import { PickerStage } from './PickerStage';
import { PickerDisplayOptions } from './PickerDisplayOptions';
import { PremiumBadge, PremiumControl } from '../../components/ui/Premium';
import { useSelectedClass } from '../../hooks/useSelectedClass';

export function NamePickerPage() {
  // 'picker' is the usage marker described in listStudents: the picker has no
  // endpoint of its own to count, so it identifies the roster read it already
  // makes. It changes nothing about what comes back.
  const { students, loading, error, reload } = useRoster('picker');
  const { prefs, update: updatePrefs } = usePickerPrefs();
  const reducedMotion = usePrefersReducedMotion();

  // Students committed as removed. The most recent winner (`lastPick`) is NOT here
  // until the next draw, so it stays on the wheel until then.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [target, setTarget] = useState<PickerStudent | null>(null);
  const [spinToken, setSpinToken] = useState(0);
  const [animating, setAnimating] = useState(false);
  // `lastPick` drives the deferred-removal logic (cleared on Reset); `selected` is
  // purely the caption and survives a Reset so the last result stays on screen.
  const [lastPick, setLastPick] = useState<PickerStudent | null>(null);
  const [selected, setSelected] = useState<PickerStudent | null>(null);
  // Tracks the class the current round belongs to, to detect a class change.
  const [roundCourse, setRoundCourse] = useState<string | null>(null);
  const [showDisplay, setShowDisplay] = useState(false);

  const courses = useMemo(
    () =>
      Array.from(new Set((students ?? []).flatMap((s) => s.courses))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [students],
  );
  // Defaults to the first class alphabetically, and is remembered across
  // navigation per tool — see useSelectedClass.
  const [activeCourse, setCourse] = useSelectedClass('namePicker', courses);

  const pickerStudents = useMemo(() => {
    const list = students ?? [];
    const scoped =
      activeCourse === null ? list : list.filter((s) => s.courses.includes(activeCourse));
    return toPickerStudents(scoped);
  }, [students, activeCourse]);

  // The pool the stage draws and picks from. It still includes the currently shown
  // winner (removal is deferred to the next draw), so a selected name stays visible.
  const pool = useMemo(
    () => selectablePool(pickerStudents, pickedIds, prefs.excludePicked),
    [pickerStudents, pickedIds, prefs.excludePicked],
  );

  // A fresh round whenever the class changes (React's adjust-state-during-render
  // pattern, so it applies before paint rather than in an effect).
  if (activeCourse !== roundCourse) {
    setRoundCourse(activeCourse);
    setPickedIds([]);
    setTarget(null);
    setLastPick(null);
    setSelected(null);
    setAnimating(false);
  }

  const handleSettled = useCallback((student: PickerStudent) => {
    setAnimating(false);
    setLastPick(student);
    setSelected(student);
    // The winner is not committed to `pickedIds` here — that happens on the next
    // draw, which is when it is visually removed from the wheel.
  }, []);

  const handlePick = () => {
    if (animating) return;
    primeAudio(); // resume the audio context within this click, so spin sounds play
    // Commit the previously shown winner now (so it leaves the wheel as this spin
    // begins), then draw from what remains.
    const committed =
      prefs.excludePicked && lastPick ? [...pickedIds, lastPick.id] : pickedIds;
    const chosen = pickRandom(selectablePool(pickerStudents, committed, prefs.excludePicked));
    setPickedIds(committed);
    setLastPick(null);
    if (!chosen) return; // pool drained → exhausted state renders
    setTarget(chosen);
    setSpinToken((n) => n + 1);
    setAnimating(true);
  };

  const handleReset = () => {
    setPickedIds([]);
    setTarget(null);
    setLastPick(null);
  };

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
        icon={Shuffle}
        heading="No students to pick from"
        description="The name picker draws from your roster. Add students on the Students page first."
      />
    );
  }

  const drawnCount = pickedIds.length + (prefs.excludePicked && lastPick ? 1 : 0);
  const exhausted = prefs.excludePicked && lastPick === null && pool.length === 0;

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Name Picker">
        <label className="flex items-center gap-2 text-sm text-secondary">
          Class
          <Select
            value={activeCourse ?? ''}
            onChange={(e) => setCourse(e.target.value)}
            disabled={animating}
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

      <div className="flex flex-col gap-4 rounded-lg border border-subtle bg-elevated p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-secondary">Style</span>
            <SegmentedControl
              label="Animation style"
              value={prefs.mode}
              onChange={(mode) => updatePrefs({ mode })}
              options={[
                { value: 'card', label: 'Card deck', disabled: animating },
                { value: 'wheel', label: 'Wheel', disabled: animating },
              ]}
            />
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {prefs.excludePicked && (
              <span className="text-sm text-secondary">
                Picked {drawnCount} of {pickerStudents.length}
              </span>
            )}
            {prefs.excludePicked && (
              <Button
                variant="secondary"
                onClick={handleReset}
                disabled={animating || (pickedIds.length === 0 && lastPick === null)}
              >
                <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
                Reset
              </Button>
            )}
            <Button variant="primary" onClick={handlePick} disabled={animating || exhausted}>
              <Shuffle size={16} strokeWidth={1.75} aria-hidden="true" />
              {animating ? 'Picking…' : 'Pick a name'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Premium. The Size control, fullscreen, and the sound toggle stay
              free — they decide whether the picker is readable and audible from
              the back of the room, which is legibility, not decoration. */}
          <PremiumControl explanation="Display options for the picker are part of Premium.">
            {({ locked, describedBy }) => (
              <Button
                variant="secondary"
                disabled={locked}
                aria-disabled={locked || undefined}
                aria-describedby={describedBy}
                onClick={() => setShowDisplay(true)}
              >
                <Palette size={16} strokeWidth={1.75} aria-hidden="true" />
                Display options
                <PremiumBadge />
              </Button>
            )}
          </PremiumControl>

          {/* The toggle sits on the second row under the buttons rather than
              beside the Style control, because it is about them: it decides
              whether a pick removes that student from the pool, which is what
              makes Reset and the "Picked n of m" count appear at all. Next to
              Style it read as a third display option, which is the one thing it
              is not. */}
          <label className="ml-auto flex items-center gap-2 text-sm text-secondary">
            <Toggle
              checked={prefs.excludePicked}
              onChange={(next) => updatePrefs({ excludePicked: next })}
              disabled={animating}
              label="Remove selected students"
            />
            Remove selected students
          </label>
        </div>
      </div>

      <PickerStage
        mode={prefs.mode}
        pool={pool}
        target={target}
        spinToken={spinToken}
        reducedMotion={reducedMotion}
        onSettled={handleSettled}
        selected={selected}
        animating={animating}
        onSpin={handlePick}
        exhausted={exhausted}
        onReset={handleReset}
        resetKey={activeCourse ?? ''}
        wheelFont={prefs.wheelFont}
        cardFont={prefs.cardFont}
        wheelScheme={prefs.wheelScheme}
        cardBack={prefs.cardBack}
        soundEnabled={prefs.sound}
        onToggleSound={() => updatePrefs({ sound: !prefs.sound })}
      />

      {showDisplay && (
        <PickerDisplayOptions
          mode={prefs.mode}
          prefs={prefs}
          onChange={updatePrefs}
          onClose={() => setShowDisplay(false)}
        />
      )}
    </section>
  );
}

