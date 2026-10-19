import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Star,
} from 'lucide-react';
import { FONTS, groupHeaderColor, type AppearanceSettings } from './appearance';
import type { Group, Grouping } from './types';

interface GroupsCanvasProps {
  grouping: Grouping | null;
  nameOf: (id: string) => string;
  appearance: AppearanceSettings;
  /** Called with the next groups after a drag-move or reorder; absent = not editable. */
  onChange?: (groups: Group[]) => void;
}

const MIN_SCALE = 0.75;
const MAX_SCALE = 3.5;
const STEP = 0.25;
const DEFAULT_SCALE = 1.15;

const ICON_BTN =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-secondary ' +
  'hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

interface DragInfo {
  studentId: string;
  fromIndex: number;
}

/** Removes `id` from group `from` and appends it to group `to`, dropping any now-empty group. */
function moveStudent(groups: Group[], id: string, from: number, to: number): Group[] {
  if (from === to) return groups;
  const next = groups.map((g) => ({ studentIds: [...g.studentIds] }));
  next[from].studentIds = next[from].studentIds.filter((s) => s !== id);
  next[to].studentIds.push(id);
  return next.filter((g) => g.studentIds.length > 0);
}

function swapGroups(groups: Group[], i: number, j: number): Group[] {
  if (j < 0 || j >= groups.length) return groups;
  const next = [...groups];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function GroupsCanvas({ grouping, nameOf, appearance, onChange }: GroupsCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  useEffect(() => {
    const onChangeFs = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChangeFs);
    return () => document.removeEventListener('fullscreenchange', onChangeFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  const groups = grouping?.groups ?? [];
  const editable = onChange !== undefined;

  const handleDrop = (toIndex: number) => {
    if (!drag || !onChange) return;
    onChange(moveStudent(groups, drag.studentId, drag.fromIndex, toIndex));
    setDrag(null);
    setDropTarget(null);
  };

  return (
    <div
      ref={containerRef}
      className={
        'flex flex-col gap-4 rounded-lg border border-subtle bg-surface p-4 ' +
        (isFullscreen ? 'h-full justify-start' : '')
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-sm text-secondary">Size</span>
          <button
            type="button"
            aria-label="Decrease size"
            className={ICON_BTN}
            disabled={scale <= MIN_SCALE}
            onClick={() => setScale((s) => Math.max(MIN_SCALE, Math.round((s - STEP) * 100) / 100))}
          >
            <Minus size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Increase size"
            className={ICON_BTN}
            disabled={scale >= MAX_SCALE}
            onClick={() => setScale((s) => Math.min(MAX_SCALE, Math.round((s + STEP) * 100) / 100))}
          >
            <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Show fullscreen'}
          className={ICON_BTN}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? (
            <Minimize2 size={18} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Maximize2 size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="py-16 text-center text-sm text-secondary">
          No groups yet. Choose your options and generate groups.
        </p>
      ) : (
        // Cards size in `em`, so the container font-size is a single scale knob (works in
        // fullscreen too). In fullscreen the wrapped rows center vertically.
        <div
          className={
            'flex flex-wrap justify-center gap-[1em] ' +
            (isFullscreen ? 'flex-1 content-center items-center' : 'content-start')
          }
          style={{ fontSize: `${scale * 16}px`, fontFamily: FONTS[appearance.font].stack }}
        >
          {groups.map((group, i) => {
            const color = groupHeaderColor(appearance.headerColorKey, i);
            return (
            <article
              key={i}
              onDragOver={(e) => {
                if (!editable || !drag) return;
                e.preventDefault();
                setDropTarget(i);
              }}
              onDragLeave={() => setDropTarget((t) => (t === i ? null : t))}
              onDrop={() => handleDrop(i)}
              className={
                'flex min-w-[9em] max-w-[16em] flex-col overflow-hidden rounded-[0.5em] border bg-elevated ' +
                (dropTarget === i ? 'border-accent' : 'border-subtle')
              }
            >
              <header
                className="flex items-center justify-between gap-[0.25em] px-[0.5em] py-[0.4em]"
                style={{ backgroundColor: color.bg, color: color.fg }}
              >
                <button
                  type="button"
                  aria-label={`Move Group ${i + 1} earlier`}
                  disabled={!editable || i === 0}
                  onClick={() => onChange?.(swapGroups(groups, i, i - 1))}
                  className="grid h-[1.4em] w-[1.4em] place-items-center rounded-full text-[inherit] hover:bg-black/10 disabled:opacity-30"
                >
                  <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                <span className="text-[1.1em] font-semibold">Group {i + 1}</span>
                <button
                  type="button"
                  aria-label={`Move Group ${i + 1} later`}
                  disabled={!editable || i === groups.length - 1}
                  onClick={() => onChange?.(swapGroups(groups, i, i + 1))}
                  className="grid h-[1.4em] w-[1.4em] place-items-center rounded-full text-[inherit] hover:bg-black/10 disabled:opacity-30"
                >
                  <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </header>
              <ul className="flex flex-col gap-[0.35em] p-[0.75em]">
                {group.studentIds.map((id, memberIndex) => (
                  <li
                    key={id}
                    draggable={editable}
                    onDragStart={() => setDrag({ studentId: id, fromIndex: i })}
                    onDragEnd={() => {
                      setDrag(null);
                      setDropTarget(null);
                    }}
                    className={
                      'flex items-center gap-[0.35em] text-[1em] leading-[1.35] text-primary ' +
                      (editable ? 'cursor-grab active:cursor-grabbing' : '')
                    }
                  >
                    {appearance.leaderStar && memberIndex === 0 && (
                      <Star
                        size={16}
                        strokeWidth={2}
                        className="shrink-0 text-accent"
                        style={{ width: '0.9em', height: '0.9em' }}
                        fill="currentColor"
                        aria-label="Group leader"
                      />
                    )}
                    {nameOf(id)}
                  </li>
                ))}
              </ul>
            </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
