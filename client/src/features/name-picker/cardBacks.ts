/**
 * Card-back designs for the card-deck mode. Each key maps to a `ttk-deck-back--<key>`
 * CSS class in index.css that supplies the pattern and border colour; the shared
 * `.ttk-deck-back` provides the border width, radius, and shadow.
 */
export interface CardBack {
  key: string;
  label: string;
}

export const CARD_BACKS: CardBack[] = [
  { key: 'classic', label: 'Classic' },
  { key: 'crimson', label: 'Crimson' },
  { key: 'forest', label: 'Forest' },
  { key: 'royal', label: 'Royal' },
  { key: 'dots', label: 'Dots' },
];

export function cardBackClass(key: string): string {
  const valid = CARD_BACKS.some((b) => b.key === key) ? key : 'classic';
  return `ttk-deck-back--${valid}`;
}
