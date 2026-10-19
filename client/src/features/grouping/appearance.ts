import { useCallback, useState } from 'react';

/** Display-only look controls for the projected grouping output (global preference). */

export type FontChoice = 'system' | 'serif' | 'rounded';

export interface FontSpec {
  label: string;
  stack: string;
}

// System fonts only (DESIGN_SYSTEM.md: no custom font loading, no monospace in the teacher UI).
export const FONTS: Record<FontChoice, FontSpec> = {
  system: {
    label: 'System',
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  serif: { label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  rounded: { label: 'Rounded', stack: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
};

export interface HeaderColor {
  key: string;
  label: string;
  bg: string;
  fg: string;
}

// Saturated fills that keep the group headers legible; foreground picked for contrast.
export const HEADER_COLORS: HeaderColor[] = [
  { key: 'accent', label: 'Gold', bg: '#ffab00', fg: '#1a1a1a' },
  { key: 'blue', label: 'Blue', bg: '#4285f4', fg: '#ffffff' },
  { key: 'green', label: 'Green', bg: '#34a853', fg: '#ffffff' },
  { key: 'red', label: 'Red', bg: '#d93025', fg: '#ffffff' },
  { key: 'gray', label: 'Slate', bg: '#5f6368', fg: '#ffffff' },
];

export function headerColor(key: string): HeaderColor {
  return HEADER_COLORS.find((c) => c.key === key) ?? HEADER_COLORS[0];
}

/** Special header option: each group gets the next colour, cycling through this palette. */
export const RAINBOW_KEY = 'rainbow';

export interface Swatch {
  bg: string;
  fg: string;
}

export const RAINBOW_PALETTE: Swatch[] = [
  { bg: '#ffab00', fg: '#1a1a1a' }, // gold
  { bg: '#4285f4', fg: '#ffffff' }, // blue
  { bg: '#34a853', fg: '#ffffff' }, // green
  { bg: '#d93025', fg: '#ffffff' }, // red
  { bg: '#a142f4', fg: '#ffffff' }, // purple
  { bg: '#12b5cb', fg: '#1a1a1a' }, // teal
  { bg: '#fa7b17', fg: '#1a1a1a' }, // orange
  { bg: '#e52592', fg: '#ffffff' }, // pink
];

/**
 * CSS for the swatch preview in the settings modal: four distinct equal bands
 * (hard stops, no blending) as a compact rainbow icon. The group headers cycle
 * through the fuller RAINBOW_PALETTE above; this shorter list is just the icon.
 */
const RAINBOW_SWATCH_BANDS = ['#ffab00', '#4285f4', '#34a853', '#d93025'];
export const RAINBOW_GRADIENT = `linear-gradient(90deg, ${RAINBOW_SWATCH_BANDS.map((bg, i) => {
  const step = 100 / RAINBOW_SWATCH_BANDS.length;
  return `${bg} ${i * step}% ${(i + 1) * step}%`;
}).join(', ')})`;

/**
 * The header colour for a specific group. For "Rainbow" each group cycles through
 * the palette by its index; otherwise every group shares the one chosen colour.
 */
export function groupHeaderColor(key: string, index: number): Swatch {
  if (key === RAINBOW_KEY) return RAINBOW_PALETTE[index % RAINBOW_PALETTE.length];
  const c = headerColor(key);
  return { bg: c.bg, fg: c.fg };
}

export interface AppearanceSettings {
  font: FontChoice;
  headerColorKey: string;
  /** Star the first member of each group as its leader. */
  leaderStar: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  font: 'system',
  headerColorKey: 'accent',
  leaderStar: false,
};

const STORAGE_KEY = 'ttk.grouping.appearance';

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function persist(settings: AppearanceSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures (private mode / quota); settings simply don't persist.
  }
}

/** Appearance state backed by localStorage, so a teacher's look choices survive reloads. */
export function useAppearance(): {
  appearance: AppearanceSettings;
  update: (patch: Partial<AppearanceSettings>) => void;
} {
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearance());
  const update = useCallback((patch: Partial<AppearanceSettings>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);
  return { appearance, update };
}
