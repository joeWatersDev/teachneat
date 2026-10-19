import { useState } from 'react';
import { Mail, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { LoadingState } from '../../components/ui/LoadingState';
import { isApiError } from '../../api/client';
import { deleteTemplate } from '../../api/email';
import { TemplateEditor } from './TemplateEditor';
import type { EmailTemplate } from './types';

interface TemplatesViewProps {
  templates: EmailTemplate[] | null;
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function TemplatesView({ templates, loading, error, onChanged }: TemplatesViewProps) {
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EmailTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTemplate(pendingDelete.id);
      setPendingDelete(null);
      onChanged();
    } catch (e) {
      setDeleteError(isApiError(e) ? e.message : 'Could not delete the template.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {/* No heading: the Templates tab above already names the view. */}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing('new')}>
          New Template
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading && templates === null ? (
        <LoadingState label="Loading templates…" />
      ) : templates && templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <Mail size={48} strokeWidth={1.5} className="text-disabled" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-primary">No templates yet</h3>
          <p className="max-w-sm text-sm text-secondary">
            Create a reusable message with placeholders like the student&apos;s name, then send it to
            selected students or their guardians.
          </p>
          <Button variant="primary" onClick={() => setEditing('new')}>
            New Template
          </Button>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-subtle">
          {(templates ?? []).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-4 border-b border-subtle bg-surface px-4 py-3 last:border-b-0 hover:bg-hover"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-primary">{t.name}</p>
                <p className="truncate text-sm text-secondary">{t.subject}</p>
              </div>
              <span className="hidden text-xs text-secondary sm:inline">
                Updated {formatDate(t.updatedAt)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${t.name}`}
                  onClick={() => setEditing(t)}
                  className="grid h-9 w-9 place-items-center rounded-full text-secondary hover:bg-hover hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Pencil size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${t.name}`}
                  onClick={() => setPendingDelete(t)}
                  className="grid h-9 w-9 place-items-center rounded-full text-secondary hover:bg-danger-bg hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateEditor
          template={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      {pendingDelete && (
        <Modal
          title="Delete template"
          size="confirm"
          onClose={() => (deleting ? undefined : setPendingDelete(null))}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmDelete} loading={deleting}>
                Delete Template
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="text-base text-primary">
              This will remove the template &ldquo;{pendingDelete.name}&rdquo;. Emails already sent
              are not affected.
            </p>
            {deleteError && (
              <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
                {deleteError}
              </p>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
