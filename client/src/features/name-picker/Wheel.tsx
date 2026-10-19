import { useEffect, useRef, useState } from 'react';
import type { PickerStudent } from './picker';
import {
  CENTER,
  RADIUS,
  POINTER_ANGLE,
  segmentPath,
  segmentCenterAngle,
  nextRotation,
} from './wheelGeometry';
import { schemeColor } from './palette';
import { fontStack, type PickerFont } from './fonts';
import { playWheelSpin, playDing } from './sound';

interface WheelProps {
  /** Students shown as segments; the winner is one of these. */
  pool: PickerStudent[];
  target: PickerStudent | null;
  /** Bumped by the parent on every draw so a repeat winner still re-spins. */
  spinToken: number;
  reducedMotion: boolean;
  /** Projection size multiplier (from the stage's Size control). */
  scale: number;
  /** Colour scheme key (palette.ts) and display font. */
  scheme: string;
  font: PickerFont;
  /** Play spin sound effects. */
  soundEnabled: boolean;
  onSettled: (student: PickerStudent) => void;
  /** Click-to-spin; the parent's guard is the lockout, so this no-ops mid-spin. */
  onSpin?: () => void;
  /** Disables click-to-spin (while a spin is in progress). */
  disabled?: boolean;
}

// Lower "friction": a longer, gentler spin that starts at a moderate pace and
// coasts to a soft stop, rather than whipping around fast and braking hard.
const SPIN_MS = 6000;
const SPIN_TURNS = 6;
const SPIN_EASE = 'cubic-bezier(0.25, 0.3, 0.15, 1)';

// How far across a segment the pointer may land, as a fraction of its half-width.
// <1 keeps a small buffer from the borders so the winner is never ambiguous, while
// letting the pointer land near a border for an occasional "close call".
const LANDING_SPREAD = 0.86;

// Labels start well out from the hub and run outward to near the rim.
const LABEL_START = RADIUS * 0.28;
const LABEL_END = RADIUS * 0.97;

// A low ceiling (few names) so long names don't overrun the rim, and a gentle
// slope so names shrink only slightly as the wheel fills up.
function labelFontSize(count: number): number {
  return Math.max(9, Math.min(11, Math.round(9 + 30 / count)));
}

// Cap length to the radial room available at the current font, so a name never
// runs past the rim (approx char width ≈ 0.55·fontSize).
function maxChars(count: number): number {
  const room = LABEL_END - LABEL_START;
  return Math.max(6, Math.floor(room / (labelFontSize(count) * 0.55)));
}

function truncate(name: string, count: number): string {
  const max = maxChars(count);
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Placement + rotation for a label. It runs radially from `LABEL_START` outward,
 * with the SAME orientation for every segment (`centerAngle − 90°`, no flipping),
 * chosen so a label reads right-side-up exactly when its segment rotates under the
 * pointer on the right.
 */
function labelAnchor(index: number, count: number): { x: number; y: number; rot: number } {
  const angle = segmentCenterAngle(index, count);
  const phi = (angle * Math.PI) / 180;
  return {
    x: CENTER + LABEL_START * Math.sin(phi),
    y: CENTER - LABEL_START * Math.cos(phi),
    rot: angle - 90,
  };
}

/**
 * Wheel mode: one colored segment per eligible student, spun by a CSS-transition
 * rotation (ease-out) that lands the parent-chosen winner under a fixed pointer on
 * the right. The settle callback fires on a timer matched to the transition, which
 * is more reliable across browsers than transitionend.
 */
export function Wheel({
  pool,
  target,
  spinToken,
  reducedMotion,
  scale,
  scheme,
  font,
  soundEnabled,
  onSettled,
  onSpin,
  disabled,
}: WheelProps) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const rotationRef = useRef(0);
  // Only animate on a genuine new draw, never on mount / mode switch (so navigating
  // to the picker never auto-spins).
  const prevToken = useRef(spinToken);

  const latest = useRef({ pool, target, reducedMotion, soundEnabled, onSettled });
  useEffect(() => {
    latest.current = { pool, target, reducedMotion, soundEnabled, onSettled };
  });

  useEffect(() => {
    if (spinToken === prevToken.current) return;
    prevToken.current = spinToken;
    const { pool: p, target: t, reducedMotion: rm, soundEnabled: snd, onSettled: settled } =
      latest.current;
    if (t === null) return;
    const index = p.findIndex((s) => s.id === t.id);
    if (index === -1) return;

    // Reduced motion (or a one-name pool) snaps straight to the target: a single
    // turn with the transition disabled, settling on the next tick. Otherwise it
    // spins SPIN_TURNS and settles when the transition finishes.
    const instant = rm || p.length <= 1;
    if (snd) {
      if (instant) playDing();
      else playWheelSpin(SPIN_MS);
    }
    // Land anywhere across the winning segment (not always dead-center) for the
    // occasional near-the-border "close call". Snap to center when instant.
    const halfSeg = 180 / p.length;
    const offset = instant ? 0 : (Math.random() * 2 - 1) * halfSeg * LANDING_SPREAD;
    const next = nextRotation(
      rotationRef.current,
      index,
      p.length,
      instant ? 1 : SPIN_TURNS,
      POINTER_ANGLE,
      offset,
    );
    rotationRef.current = next;
    // Kicking off the CSS-transition spin is exactly what this effect exists to
    // do — setting rotation/spinning here is the synchronization, not an
    // avoidable cascade. The settle callback runs off a timer below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpinning(!instant);
    setRotation(next);
    const timer = window.setTimeout(
      () => {
        setSpinning(false);
        settled(t);
      },
      instant ? 0 : SPIN_MS,
    );
    return () => clearTimeout(timer);
  }, [spinToken]);

  const count = pool.length;
  const seg = count > 0 ? 360 / count : 360;
  const fontSize = labelFontSize(Math.max(count, 1));
  const size = `min(${(scale * 20).toFixed(2)}rem, 88vmin)`;

  return (
    <div className="flex flex-1 items-center justify-center py-2">
      <button
        type="button"
        onClick={onSpin}
        disabled={disabled || onSpin === undefined}
        aria-label="Spin the wheel"
        className={
          'relative border-0 bg-transparent p-0 ' +
          (disabled || onSpin === undefined ? 'cursor-default' : 'cursor-pointer') +
          ' focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent'
        }
        // drop-shadow (not box-shadow) follows the circular silhouette; on the
        // non-rotating container so the shadow stays put while the wheel spins.
        style={{
          width: size,
          height: size,
          maxWidth: '100%',
          filter: 'drop-shadow(0 3px 4px rgba(0, 0, 0, 0.28))',
        }}
      >
        <svg
          viewBox="0 0 300 300"
          className="h-full w-full"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? `transform ${SPIN_MS}ms ${SPIN_EASE}` : 'none',
            fontFamily: fontStack(font),
          }}
          role="img"
          aria-label={`Wheel with ${count} name${count === 1 ? '' : 's'}`}
        >
          {count === 1 ? (
            <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={schemeColor(scheme, 0).bg} />
          ) : (
            pool.map((s, i) => (
              <path key={s.id} d={segmentPath(i * seg, (i + 1) * seg)} fill={schemeColor(scheme, i).bg} />
            ))
          )}
          {pool.map((s, i) => {
            const a = labelAnchor(i, Math.max(count, 1));
            return (
              <text
                key={`${s.id}-label`}
                transform={`translate(${a.x.toFixed(2)} ${a.y.toFixed(2)}) rotate(${a.rot})`}
                textAnchor="start"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={600}
                fill={schemeColor(scheme, i).fg}
              >
                {truncate(s.name, count)}
              </text>
            );
          })}
          {/* Hub */}
          <circle cx={CENTER} cy={CENTER} r={9} fill="var(--color-base)" stroke="var(--color-subtle)" />
        </svg>

        {/* Fixed pointer on the right, tip pointing left into the wheel. Rendered as
            an SVG triangle so it can carry a thin outline; sized with the same
            min(rem, vmin) basis as the wheel so it stays proportional. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 12 16"
          preserveAspectRatio="none"
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            right: 0,
            width: `min(${(scale * 0.75).toFixed(2)}rem, 3.3vmin)`,
            height: `min(${(scale * 1.0).toFixed(2)}rem, 4.4vmin)`,
          }}
        >
          <polygon points="1,8 11,1 11,15" fill="#000000" stroke="#ffffff" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
