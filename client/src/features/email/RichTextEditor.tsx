import { useEffect, useReducer, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, List, ListOrdered, Link2, Link2Off, GitBranch } from 'lucide-react';
import { Tooltip } from '../../components/ui/Tooltip';
import type { PlaceholderDef } from './placeholders';
import { ConditionalBlock } from './ConditionalBlock';
import { CONDITION_METRICS, buildCondition, parseCondition } from './conditions';

interface RichTextEditorProps {
  initialHtml: string;
  onChange: (html: string, text: string) => void;
  placeholders: readonly PlaceholderDef[];
}

/**
 * Rich-text editor for email bodies. The tag surface is deliberately narrow
 * (bold, italic, lists, links) and matches the server's sanitize-html
 * allowlist, so nothing a teacher can author here is stripped on save. Raw HTML
 * cannot be entered — the editor owns the output. Blocks can carry a condition
 * (see ConditionalBlock) so lines only send when a recipient's data matches.
 */
export function RichTextEditor({ initialHtml, onChange, placeholders }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: false, autolink: false },
      }),
      ConditionalBlock,
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: 'ttk-editor min-h-[160px] px-3 py-2 text-base text-primary focus:outline-none',
        'aria-label': 'Email body',
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.getText()),
  });

  if (!editor) return null;
  return (
    <div className="rounded-md border border-subtle bg-base">
      <Toolbar editor={editor} placeholders={placeholders} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  placeholders,
}: {
  editor: Editor;
  placeholders: readonly PlaceholderDef[];
}) {
  // Re-render on every editor transaction so active states stay accurate.
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [conditionOpen, setConditionOpen] = useState(false);
  useEffect(() => {
    const handler = () => force();
    editor.on('transaction', handler);
    return () => {
      editor.off('transaction', handler);
    };
  }, [editor]);

  function toggleLink() {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt('Link URL (https:// or mailto:)');
    if (!url) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  const currentCondition =
    (editor.getAttributes('paragraph').dataIf as string | undefined) ??
    (editor.getAttributes('listItem').dataIf as string | undefined) ??
    null;

  return (
    <div className="border-b border-subtle">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <ToolbarButton
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} strokeWidth={2} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} strokeWidth={2} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Bulleted list"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={16} strokeWidth={2} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} strokeWidth={2} aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          label={editor.isActive('link') ? 'Remove link' : 'Add link'}
          active={editor.isActive('link')}
          onClick={toggleLink}
        >
          {editor.isActive('link') ? (
            <Link2Off size={16} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Link2 size={16} strokeWidth={2} aria-hidden="true" />
          )}
        </ToolbarButton>

        <span className="mx-1 h-5 w-px bg-subtle" aria-hidden="true" />

        <Tooltip label="Show the selected lines only for recipients whose data matches a condition (lates, absences, or academic risk).">
          <ToolbarButton
            label="Condition"
            active={conditionOpen || currentCondition !== null}
            tone="accent"
            onClick={() => setConditionOpen((v) => !v)}
          >
            <GitBranch size={16} strokeWidth={2} aria-hidden="true" />
          </ToolbarButton>
        </Tooltip>

        <span className="mx-1 h-5 w-px bg-subtle" aria-hidden="true" />

        <label className="sr-only" htmlFor="ttk-insert-placeholder">
          Insert placeholder
        </label>
        <select
          id="ttk-insert-placeholder"
          value=""
          onChange={(e) => {
            const key = e.target.value;
            if (key) editor.chain().focus().insertContent(`{{${key}}}`).run();
            e.target.value = '';
          }}
          className="h-8 rounded-md border border-subtle bg-elevated px-2 text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <option value="">Insert placeholder…</option>
          {placeholders.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {conditionOpen && (
        <ConditionForm
          current={currentCondition}
          onApply={(raw) => {
            editor
              .chain()
              .focus()
              .updateAttributes('paragraph', { dataIf: raw })
              .updateAttributes('listItem', { dataIf: raw })
              .run();
            setConditionOpen(false);
          }}
          onRemove={() => {
            editor
              .chain()
              .focus()
              .updateAttributes('paragraph', { dataIf: null })
              .updateAttributes('listItem', { dataIf: null })
              .run();
            setConditionOpen(false);
          }}
          onCancel={() => setConditionOpen(false)}
        />
      )}
    </div>
  );
}

function ConditionForm({
  current,
  onApply,
  onRemove,
  onCancel,
}: {
  current: string | null;
  onApply: (raw: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const parsed = current ? parseCondition(current) : null;
  const [metric, setMetric] = useState(parsed?.metric ?? CONDITION_METRICS[0].key);
  const [numValue, setNumValue] = useState(
    parsed && typeof parsed.value === 'number' ? String(parsed.value) : '3',
  );
  const [boolValue, setBoolValue] = useState(
    parsed && typeof parsed.value === 'boolean' ? (parsed.value ? 'true' : 'false') : 'true',
  );

  const def = CONDITION_METRICS.find((m) => m.key === metric) ?? CONDITION_METRICS[0];
  const numInvalid = def.kind === 'numeric' && !/^\d{1,3}$/.test(numValue);

  function apply() {
    if (def.kind === 'numeric') {
      if (numInvalid) return;
      onApply(buildCondition(metric, Number(numValue)));
    } else {
      onApply(buildCondition(metric, boolValue === 'true'));
    }
  }

  const FIELD =
    'h-8 rounded-md border border-subtle bg-base px-2 text-sm text-primary ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-elevated px-2 py-2">
      <span className="text-sm text-secondary">Show the selected line(s) only if</span>
      <label className="sr-only" htmlFor="ttk-cond-metric">
        Condition metric
      </label>
      <select
        id="ttk-cond-metric"
        className={FIELD}
        value={metric}
        onChange={(e) => setMetric(e.target.value)}
      >
        {CONDITION_METRICS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>

      {def.kind === 'numeric' ? (
        <>
          <span className="text-sm text-secondary">is at least</span>
          <label className="sr-only" htmlFor="ttk-cond-num">
            Threshold
          </label>
          <input
            id="ttk-cond-num"
            type="number"
            min={0}
            max={999}
            className={`${FIELD} w-20`}
            value={numValue}
            onChange={(e) => setNumValue(e.target.value)}
          />
        </>
      ) : (
        <>
          <label className="sr-only" htmlFor="ttk-cond-bool">
            Value
          </label>
          <select
            id="ttk-cond-bool"
            className={FIELD}
            value={boolValue}
            onChange={(e) => setBoolValue(e.target.value)}
          >
            <option value="true">is true</option>
            <option value="false">is false</option>
          </select>
        </>
      )}

      <button
        type="button"
        onClick={apply}
        disabled={numInvalid}
        className="h-8 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        Apply
      </button>
      {current && (
        <button
          type="button"
          onClick={onRemove}
          className="h-8 rounded-md border border-subtle bg-elevated px-3 text-sm text-danger hover:bg-danger-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Remove
        </button>
      )}
      <button type="button" onClick={onCancel} className="text-sm text-secondary underline">
        Cancel
      </button>
    </div>
  );
}

/**
 * `accent` is for a control that is the reason to look at the toolbar rather
 * than one of its verbs. Bold, italic and lists are what a teacher already
 * expects from any editor and are found without help; conditions are the thing
 * this editor does that no other one does, and rendered in the same grey as the
 * rest they read as a sixth formatting button. The accent is applied to the
 * resting state only — the active state is already the accent tint, so an
 * accented resting state that also lit up would stop distinguishing the two.
 */
function ToolbarButton({
  label,
  active,
  tone = 'default',
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  tone?: 'default' | 'accent';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const resting =
    tone === 'accent'
      ? 'text-accent hover:bg-accent-muted'
      : 'text-secondary hover:bg-hover hover:text-primary';
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={
        'grid h-8 w-8 place-items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ' +
        (active ? 'bg-accent-muted text-primary' : resting)
      }
    >
      {children}
    </button>
  );
}
