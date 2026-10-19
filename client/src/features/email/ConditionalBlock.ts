import { Extension } from '@tiptap/core';
import { formatCondition } from './conditions';

/**
 * Adds a `dataIf` attribute to paragraph and list-item nodes. It serializes to
 * `data-if` (read at send time by the server) plus a derived
 * `data-condition-label` and a class the editor styles into a chip, so a
 * conditional block is visibly marked while authoring. The label is derived, not
 * stored: the sanitizer strips it on save and it is recomputed on load.
 */
export const ConditionalBlock = Extension.create({
  name: 'conditionalBlock',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'listItem'],
        attributes: {
          dataIf: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-if'),
            renderHTML: (attributes) => {
              const raw = attributes.dataIf as string | null;
              if (!raw) return {};
              return {
                'data-if': raw,
                'data-condition-label': formatCondition(raw) ?? '',
                class: 'ttk-conditional',
              };
            },
          },
        },
      },
    ];
  },
});
