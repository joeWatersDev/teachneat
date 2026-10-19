/**
 * Escapes the five HTML-special characters. Inlined rather than pulling in a
 * package for five lines (see DEPENDENCIES.md). Used for every placeholder
 * substitution in an HTML email body so recipient-visible values can never
 * inject markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
