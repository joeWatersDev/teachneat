import { useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { isApiError } from '../../api/client';
import { createTemplate, updateTemplate } from '../../api/email';
import { RichTextEditor } from './RichTextEditor';
import { EmailPreview } from './EmailPreview';
import {
  PLACEHOLDERS,
  extractPlaceholders,
  renderBody,
  renderSubject,
} from './placeholders';
import { stripConditionAttrs } from './conditions';
import type { EmailTemplate } from './types';

interface TemplateEditorProps {
  template?: EmailTemplate;
  onClose: () => void;
  onSaved: (t: EmailTemplate) => void;
}

/** Sample values so the editor's preview shows real formatting, not raw tokens. */
const SAMPLE_VALUES: Record<string, string> = {
  firstName: 'Jordan',
  lastName: 'Lee',
  goesBy: 'JJ',
  pronouns: 'they/them',
  courseName: 'Period 3 Biology',
  lateCount: '4',
  unexcusedAbsences: '2',
};

export function TemplateEditor({ template, onClose, onSaved }: TemplateEditorProps) {
  const isEdit = Boolean(template);
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? '');
  const [bodyText, setBodyText] = useState(template?.bodyHtml ? ' ' : '');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    name.trim() !== '' && subject.trim() !== '' && bodyText.trim() !== '';

  const previewSubject = useMemo(() => renderSubject(subject, SAMPLE_VALUES), [subject]);
  // Show every block regardless of condition; the per-recipient behavior is
  // shown in Compose. Just strip the markers here.
  const previewBody = useMemo(
    () => renderBody(stripConditionAttrs(bodyHtml), SAMPLE_VALUES),
    [bodyHtml],
  );

  async function handleSave() {
    setError(null);
    setSaving(true);
    const payload = {
      name: name.trim(),
      subject: subject.trim(),
      bodyHtml,
      placeholdersUsed: extractPlaceholders(subject, bodyHtml),
    };
    try {
      const saved = template
        ? await updateTemplate(template.id, payload)
        : await createTemplate(payload);
      onSaved(saved);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save the template. Please try again.');
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Template' : 'New Template'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!canSubmit}>
            {isEdit ? 'Save Changes' : 'Create Template'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Input
          label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
        <Input
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          required
        />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-secondary">
            Body <span aria-hidden="true">*</span>
          </span>
          <RichTextEditor
            initialHtml={template?.bodyHtml ?? ''}
            placeholders={PLACEHOLDERS}
            onChange={(html, text) => {
              setBodyHtml(html);
              setBodyText(text);
            }}
          />
          <p className="text-xs text-secondary">
            Use the Insert placeholder menu to add fields like the student&apos;s first name. They
            are filled in per recipient when you send.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="text-sm text-secondary underline"
          >
            {showPreview ? 'Hide preview' : 'Show preview with sample data'}
          </button>
          {showPreview && (
            <div className="mt-2">
              <EmailPreview subject={previewSubject} bodyHtml={previewBody} />
            </div>
          )}
        </div>
        <p className="text-sm text-secondary">* indicates a required field</p>
      </div>
    </Modal>
  );
}
