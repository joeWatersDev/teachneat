import { useCallback, useState } from 'react';
import type { PickerFont } from './fonts';

/** Which animation plays when a name is drawn. Marble race is a deferred stretch mode. */
export type PickerMode = 'card' | 'wheel';

export interface PickerPrefs {
  mode: PickerMode;
  /** When true, a picked student is removed from the pool until the round is reset. */
  excludePicked: boolean;
  /** Display font for the projected names — kept separate per mode. */
  wheelFont: PickerFont;
  cardFont: PickerFont;
  /** Wheel colour scheme key (see palette.ts). */
  wheelScheme: string;
  /** Card-back design key (see cardBacks.ts). */
  cardBack: string;
  /** Play sound effects during the animations. */
  sound: boolean;
}

export const DEFAULT_PREFS: PickerPrefs = {
  mode: 'card',
  excludePicked: false,
  wheelFont: 'system',
  cardFont: 'system',
  wheelScheme: 'rainbow',
  cardBack: 'classic',
  sound: true,
};

const STORAGE_KEY = 'ttk.namePicker.prefs';
const FONTS: PickerFont[] = ['system', 'serif', 'rounded'];

function readFont(value: unknown): PickerFont {
  return FONTS.includes(value as PickerFont) ? (value as PickerFont) : 'system';
}

function load(): PickerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<PickerPrefs> & { font?: unknown };
    return {
      mode: p.mode === 'wheel' ? 'wheel' : 'card',
      excludePicked: p.excludePicked === true,
      // Fall back to a prior single `font` value when migrating older saved prefs.
      wheelFont: readFont(p.wheelFont ?? p.font),
      cardFont: readFont(p.cardFont ?? p.font),
      wheelScheme: typeof p.wheelScheme === 'string' ? p.wheelScheme : 'rainbow',
      cardBack: typeof p.cardBack === 'string' ? p.cardBack : 'classic',
      sound: p.sound !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function persist(prefs: PickerPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage failures (private mode / quota); prefs just don't persist.
  }
}

/** Picker preferences backed by localStorage, so display choices survive reloads. */
export function usePickerPrefs(): {
  prefs: PickerPrefs;
  update: (patch: Partial<PickerPrefs>) => void;
} {
  const [prefs, setPrefs] = useState<PickerPrefs>(() => load());
  const update = useCallback((patch: Partial<PickerPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);
  return { prefs, update };
}
