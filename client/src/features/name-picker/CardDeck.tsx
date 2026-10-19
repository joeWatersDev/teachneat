import { useEffect, useRef, useState } from 'react';
import type { PickerStudent } from './picker';
import { cardBackClass } from './cardBacks';
import { fontStack, type PickerFont } from './fonts';
import { playCardShuffle, playCardFlip } from './sound';

interface CardDeckProps {
  /** The pre-decided winner the reveal settles on. */
  target: PickerStudent | null;
  /** Bumped by the parent on every draw so a repeat winner still re-animates. */
  spinToken: number;
  reducedMotion: boolean;
  /** Projection size multiplier (from the stage's Size control). */
  scale: number;
  /** Card-back design key (cardBacks.ts) and display font. */
  cardBack: string;
  font: PickerFont;
  /** Play shuffle / flip sound effects. */
  soundEnabled: boolean;
  onSettled: (student: PickerStudent) => void;
  /** Click-to-draw; the parent's guard is the lockout, so this no-ops mid-animation. */
  onSpin?: () => void;
  /** Disables click-to-draw (while an animation is in progress). */
  disabled?: boolean;
}

const SHUFFLE_MS = 900;
const FLIP_MS = 650;

type Phase = 'idle' | 'shuffle';

/**
 * Card-deck mode: a proper 5:7 playing-card stack. A draw flips the current card
 * face-down, shuffles, then flips the top card face-up to reveal the parent-chosen
 * winner (the winner is decided upstream; this only animates the reveal).
 */
export function CardDeck({
  target,
  spinToken,
  reducedMotion,
  scale,
  cardBack,
  font,
  soundEnabled,
  onSettled,
  onSpin,
  disabled,
}: CardDeckProps) {
  const [name, setName] = useState<string | null>(target?.name ?? null);
  const [flipped, setFlipped] = useState(target !== null);
  const [phase, setPhase] = useState<Phase>('idle');

  // Only animate on a genuine new draw, never on mount / mode switch. `flipped` is
  // carried on the ref so the spin effect knows whether a face-up card must first
  // flip down (and can depend only on spinToken).
  const prevToken = useRef(spinToken);
  const latest = useRef({ target, reducedMotion, soundEnabled, onSettled, flipped });
  useEffect(() => {
    latest.current = { target, reducedMotion, soundEnabled, onSettled, flipped };
  });

  useEffect(() => {
    if (spinToken === prevToken.current) return;
    prevToken.current = spinToken;
    const { target: t, reducedMotion: rm, soundEnabled: snd, onSettled: settled, flipped: wasFlipped } =
      latest.current;
    if (t === null) return;

    // Driving the reveal is exactly what this effect exists to do; the setState
    // calls here are the synchronization (deck state), not an avoidable cascade.
    // The settle callback runs off a timer.
    if (rm) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase('idle');
      setName(t.name);
      setFlipped(true);
      if (snd) playCardFlip();
      const timer = window.setTimeout(() => settled(t), 0);
      return () => clearTimeout(timer);
    }

    // Sequence: flip the previous card face-down first (keeping its name so it
    // stays on screen until it rotates out of view), THEN shuffle, THEN flip the
    // top card face-up on the new name. On the first draw there is nothing to
    // flip down, so it goes straight to the shuffle.
    const flipDownMs = wasFlipped ? FLIP_MS : 0;
    if (wasFlipped) {
      setFlipped(false);
      if (snd) playCardFlip();
    }
    const timers = [
      window.setTimeout(() => {
        setPhase('shuffle');
        if (snd) playCardShuffle(SHUFFLE_MS);
      }, flipDownMs),
      window.setTimeout(() => {
        setPhase('idle');
        setName(t.name);
        setFlipped(true);
        if (snd) playCardFlip();
      }, flipDownMs + SHUFFLE_MS),
      window.setTimeout(() => settled(t), flipDownMs + SHUFFLE_MS + FLIP_MS),
    ];
    return () => timers.forEach((id) => clearTimeout(id));
  }, [spinToken]);

  const height = `min(${(scale * 15).toFixed(2)}rem, 66vh)`;
  const back = cardBackClass(cardBack);
  const clickable = onSpin !== undefined && !disabled;

  return (
    <div className="flex flex-1 items-center justify-center py-2">
      <button
        type="button"
        onClick={onSpin}
        disabled={disabled || onSpin === undefined}
        aria-label="Draw a card"
        className={
          'border-0 bg-transparent p-0 ' +
          (clickable ? 'cursor-pointer' : 'cursor-default') +
          ' focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent'
        }
      >
        <div
          className={'ttk-deck-stack' + (phase === 'shuffle' ? ' ttk-deck-shuffling' : '')}
          style={{ height, aspectRatio: '5 / 7', maxWidth: '88vw' }}
        >
          {/* Depth cards behind, giving the stack thickness; they riffle during a shuffle. */}
          <div className={'ttk-deck-card ttk-deck-back ttk-riffle-l ' + back} aria-hidden="true" />
          <div className={'ttk-deck-card ttk-deck-back ttk-riffle-r ' + back} aria-hidden="true" />
          <div className={'ttk-deck-card ttk-deck-back ' + back} aria-hidden="true" />

          {/* Top card: flips from back to front to reveal the name. */}
          <div className={'ttk-deck-card ttk-deck-top' + (flipped ? ' is-flipped' : '')}>
            <div className="ttk-deck-inner" aria-live="polite">
              <div className={'ttk-deck-face ttk-deck-back ' + back} aria-hidden="true" />
              <div className="ttk-deck-face ttk-deck-front" style={{ fontFamily: fontStack(font) }}>
                {name ?? ''}
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
