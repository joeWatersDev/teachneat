/**
 * Wheel segment colour schemes. Rainbow (the default) cycles a full palette; the
 * two-tone schemes alternate a high-contrast pair between adjacent segments. A
 * local copy (rather than importing Grouping's palette) keeps the feature
 * self-contained per the feature-folder convention.
 */
export interface Swatch {
  bg: string;
  fg: string;
}

const RAINBOW: Swatch[] = [
  { bg: '#ffab00', fg: '#1a1a1a' }, // gold
  { bg: '#4285f4', fg: '#ffffff' }, // blue
  { bg: '#34a853', fg: '#ffffff' }, // green
  { bg: '#d93025', fg: '#ffffff' }, // red
  { bg: '#a142f4', fg: '#ffffff' }, // purple
  { bg: '#12b5cb', fg: '#1a1a1a' }, // teal
  { bg: '#fa7b17', fg: '#1a1a1a' }, // orange
  { bg: '#e52592', fg: '#ffffff' }, // pink
];

export interface WheelScheme {
  key: string;
  label: string;
  /** Colours cycled by segment index; length 2 gives an alternating two-tone. */
  colors: Swatch[];
}

// Rainbow first (default); the rest are two-tone alternating pairs drawn from
// high-contrast (complementary / tetradic) colours.
export const WHEEL_SCHEMES: WheelScheme[] = [
  { key: 'rainbow', label: 'Rainbow', colors: RAINBOW },
  {
    key: 'bw',
    label: 'Black & white',
    colors: [
      { bg: '#111111', fg: '#ffffff' },
      { bg: '#f5f5f5', fg: '#111111' },
    ],
  },
  {
    key: 'blue-orange',
    label: 'Blue & orange',
    colors: [
      { bg: '#1a56d6', fg: '#ffffff' },
      { bg: '#fa7b17', fg: '#1a1a1a' },
    ],
  },
  {
    key: 'purple-gold',
    label: 'Purple & gold',
    colors: [
      { bg: '#6a2cc9', fg: '#ffffff' },
      { bg: '#ffab00', fg: '#1a1a1a' },
    ],
  },
  {
    key: 'teal-magenta',
    label: 'Teal & magenta',
    colors: [
      { bg: '#0f9b8e', fg: '#ffffff' },
      { bg: '#e52592', fg: '#ffffff' },
    ],
  },
];

export function wheelScheme(key: string): WheelScheme {
  return WHEEL_SCHEMES.find((s) => s.key === key) ?? WHEEL_SCHEMES[0];
}

export function schemeColor(key: string, index: number): Swatch {
  const s = wheelScheme(key);
  return s.colors[index % s.colors.length];
}

// Rainbow icon: the same four-band linear gradient the Grouping tool uses, so the
// Rainbow option reads identically across tools.
const RAINBOW_BANDS = ['#ffab00', '#4285f4', '#34a853', '#d93025'];
export const RAINBOW_GRADIENT = `linear-gradient(90deg, ${RAINBOW_BANDS.map((bg, i) => {
  const step = 100 / RAINBOW_BANDS.length;
  return `${bg} ${i * step}% ${(i + 1) * step}%`;
}).join(', ')})`;

/** A gradient preview for a scheme's swatch: the rainbow band, or alternating two-tone bands. */
export function schemeGradient(scheme: WheelScheme): string {
  if (scheme.key === 'rainbow') return RAINBOW_GRADIENT;
  const bands = 4;
  const stops = Array.from({ length: bands }, (_, i) => {
    const bg = scheme.colors[i % scheme.colors.length].bg;
    const step = 100 / bands;
    return `${bg} ${i * step}% ${(i + 1) * step}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
