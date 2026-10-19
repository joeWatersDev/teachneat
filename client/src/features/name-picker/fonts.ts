/** Display fonts for the picker's projected names (system fonts only, per DESIGN_SYSTEM). */
export type PickerFont = 'system' | 'serif' | 'rounded';

export const PICKER_FONTS: Record<PickerFont, { label: string; stack: string }> = {
  system: {
    label: 'System',
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  serif: { label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  rounded: { label: 'Rounded', stack: '"Trebuchet MS", "Segoe UI", system-ui, sans-serif' },
};

export function fontStack(font: PickerFont): string {
  return (PICKER_FONTS[font] ?? PICKER_FONTS.system).stack;
}
