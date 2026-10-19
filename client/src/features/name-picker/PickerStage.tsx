import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Minus, Plus, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CardDeck } from './CardDeck';
import { Wheel } from './Wheel';
import { fontStack, type PickerFont } from './fonts';
import type { PickerStudent } from './picker';
import type { PickerMode } from './preferences';

interface PickerStageProps {
  mode: PickerMode;
  pool: PickerStudent[];
  target: PickerStudent | null;
  spinToken: number;
  reducedMotion: boolean;
  onSettled: (student: PickerStudent) => void;
  /** The last selected student to caption; persists across a Reset, hidden while spinning. */
  selected: PickerStudent | null;
  animating: boolean;
  /** Trigger a draw by clicking the wheel/deck (guarded upstream, so a no-op mid-spin). */
  onSpin: () => void;
  /** When exclusion has drained the pool: show the reset prompt instead of a mode. */
  exhausted: boolean;
  onReset: () => void;
  /** Changes when the round resets (e.g. class switch), remounting the mode fresh. */
  resetKey: string;
  /** Display options. Font is per mode. */
  wheelFont: PickerFont;
  cardFont: PickerFont;
  wheelScheme: string;
  cardBack: string;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

const MIN_SCALE = 0.75;
const MAX_SCALE = 3;
const STEP = 0.25;
const DEFAULT_SCALE = 1.4;

const ICON_BTN =
  'grid h-9 w-9 shrink-0 place-items-center rounded-full text-secondary ' +
  'hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

/**
 * Projection surface for the picker: a `bg-surface` card with a Size control and a
 * fullscreen toggle (same pattern as the Grouping canvas), hosting the active
 * animation mode and captioning the settled result. The animation scales with the
 * Size knob so it reads across a classroom.
 */
export function PickerStage({
  mode,
  pool,
  target,
  spinToken,
  reducedMotion,
  onSettled,
  selected,
  animating,
  onSpin,
  exhausted,
  onReset,
  resetKey,
  wheelFont,
  cardFont,
  wheelScheme,
  cardBack,
  soundEnabled,
  onToggleSound,
}: PickerStageProps) {
  const captionFont = mode === 'wheel' ? wheelFont : cardFont;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  return (
    <div
      ref={containerRef}
      className={
        // overflow-hidden clips the wheel's rotating (square) SVG corners and the
        // card deck's riffle, which otherwise extend the scrollable area past the
        // viewport mid-animation and shift the fixed top bar on mobile.
        'flex flex-col gap-3 overflow-hidden rounded-lg border border-subtle bg-surface p-4 ' +
        (isFullscreen ? 'h-full' : '')
      }
    >
      <div className="flex items-center justify-between gap-3">
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
          <button
            type="button"
            aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
            aria-pressed={soundEnabled}
            className={ICON_BTN + ' ml-1'}
            onClick={onToggleSound}
          >
            {soundEnabled ? (
              <Volume2 size={18} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <VolumeX size={18} strokeWidth={1.75} aria-hidden="true" />
            )}
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

      {exhausted ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
          <p className="text-md font-semibold text-primary">Everyone has been picked</p>
          <p className="max-w-sm text-sm text-secondary">Reset to draw from the whole class again.</p>
          <Button variant="secondary" onClick={onReset}>
            <RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />
            Reset round
          </Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {mode === 'card' ? (
            <CardDeck
              key={resetKey}
              target={target}
              spinToken={spinToken}
              reducedMotion={reducedMotion}
              scale={scale}
              cardBack={cardBack}
              font={cardFont}
              soundEnabled={soundEnabled}
              onSettled={onSettled}
              onSpin={onSpin}
              disabled={animating}
            />
          ) : (
            <Wheel
              key={resetKey}
              pool={pool}
              target={target}
              spinToken={spinToken}
              reducedMotion={reducedMotion}
              scale={scale}
              scheme={wheelScheme}
              font={wheelFont}
              soundEnabled={soundEnabled}
              onSettled={onSettled}
              onSpin={onSpin}
              disabled={animating}
            />
          )}

          <div className="min-h-[3.5rem] text-center" aria-live="polite">
            {!animating && selected && (
              <>
                <span className="text-sm text-secondary">Selected</span>
                <p
                  className="text-2xl font-semibold text-primary"
                  style={{ fontFamily: fontStack(captionFont) }}
                >
                  {selected.name}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
