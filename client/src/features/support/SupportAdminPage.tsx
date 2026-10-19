import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { isApiError } from '../../api/client';
import {
  listAllSupportRequests,
  setAccountPlanOverride,
  triageSupportRequest,
  type SupportRequestWithAccount,
  type SupportStatus,
} from '../../api/support';
import { STATUS_LABELS } from './statusCopy';
import { AccountActivitySummary } from './AccountActivitySummary';

const STATUS_VALUES: SupportStatus[] = ['new', 'open', 'resolved', 'closed'];
const OVERRIDE_VALUES = ['none', 'free', 'trial', 'paid'] as const;

/**
 * Operator triage. Deliberately plain: it is read by one person, and every
 * minute spent styling it is a minute not spent on the product teachers see.
 *
 * The server answers 404 for anyone not on the support allowlist, so this page
 * renders "not found" rather than an access-denied screen — matching what the
 * API says about itself.
 */
export function SupportAdminPage() {
  const [filter, setFilter] = useState<SupportStatus | 'all'>('new');
  const [requests, setRequests] = useState<SupportRequestWithAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  // State is written only when the request settles, so calling this from an
  // effect does not cascade a render. Clearing the visible list on a filter
  // change belongs to the change handler, which is where the intent is.
  const load = useCallback(() => {
    listAllSupportRequests(filter === 'all' ? undefined : filter)
      .then((page) => {
        setRequests(page.requests);
        setTruncated(page.truncated);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(
          isApiError(e) && e.status === 404
            ? 'Not found.'
            : 'Could not load support requests.',
        ),
      );
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (updated: SupportRequestWithAccount) =>
    setRequests((current) =>
      (current ?? []).map((r) => (r.id === updated.id ? updated : r)),
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Support triage">
        <Select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => {
            setRequests(null);
            setFilter(e.target.value as SupportStatus | 'all');
          }}
        >
          <option value="all">All</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button onClick={load}>Refresh</Button>
      </PageHeader>

      {error && <ErrorState message={error} action={<Button onClick={load}>Retry</Button>} />}
      {!error && requests === null && <LoadingState label="Loading requests…" />}
      {!error && requests?.length === 0 && (
        <p className="text-sm text-secondary">No requests with this status.</p>
      )}
      {/* Silent truncation would be worst exactly when the queue is busiest, so
          a cut-short list says so rather than looking like a complete one. */}
      {!error && truncated && (
        <p className="text-sm text-secondary">
          More requests match than are shown. Narrow the status filter to see the rest.
        </p>
      )}
      {!error &&
        requests?.map((r) => <TriageCard key={r.id} request={r} onChange={replace} />)}
    </div>
  );
}

function TriageCard({
  request,
  onChange,
}: {
  request: SupportRequestWithAccount;
  onChange: (updated: SupportRequestWithAccount) => void;
}) {
  const [note, setNote] = useState(request.adminNote);
  const [saving, setSaving] = useState(false);
  const [comping, setComping] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [override, setOverride] = useState(request.currentPlanOverride ?? 'none');

  function save(changes: { status?: SupportStatus; adminNote?: string }) {
    setSaving(true);
    setFailed(null);
    triageSupportRequest(request.id, changes)
      .then(onChange)
      .catch(() => setFailed('Update failed.'))
      .finally(() => setSaving(false));
  }

  function applyOverride(value: string) {
    // Unreachable from the UI (the control is not rendered without an account),
    // but the type is nullable and a comp with no account to apply it to is
    // meaningless rather than merely wrong.
    if (request.googleSub === null) return;
    const previous = override;
    setOverride(value);
    setComping(true);
    setFailed(null);
    setAccountPlanOverride(request.googleSub, value === 'none' ? null : (value as 'free' | 'trial' | 'paid'))
      // Put the dropdown back if the write did not land. Leaving it on the new
      // value would show a comp that was never granted, which is the one thing
      // this control must not do.
      .catch(() => {
        setOverride(previous);
        setFailed('Comp failed.');
      })
      .finally(() => setComping(false));
  }

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-subtle bg-elevated p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-primary">{request.subject}</h2>
        <span className="text-xs text-secondary">
          {request.category} · {new Date(request.createdAt).toLocaleString()}
        </span>
      </div>
      {/* Two kinds of sender. An account-backed request carries a verified
          address and a plan; one from the landing page's signed-out form
          carries neither, and saying so matters — the operator is about to
          reply to an address nobody has confirmed. */}
      {request.verifiedIdentity ? (
        <p className="text-xs text-secondary">
          {request.accountName} ({request.accountEmail}) · plan when sent: {request.planAtSubmit} ·
          subscription: {request.subscriptionStatus}
        </p>
      ) : (
        <p className="text-xs text-secondary">
          {request.accountName} ({request.accountEmail}) · sent from the public contact form, no
          account · address unverified
        </p>
      )}
      <p className="whitespace-pre-wrap text-sm text-primary">{request.message}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`status-${request.id}`} className="text-sm text-secondary">
            Status
          </label>
          <Select
            id={`status-${request.id}`}
            value={request.status}
            disabled={saving}
            onChange={(e) => save({ status: e.target.value as SupportStatus })}
          >
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {/* The comp lever. Writes plan_override only, so the account's real
            Stripe state is untouched and the comp can be lifted by setting this
            back to "none". Absent entirely on a signed-out request: there is no
            account to grant anything to, and a disabled control here would only
            pose a question that has no answer. */}
        {request.googleSub !== null && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`comp-${request.id}`} className="text-sm text-secondary">
              Plan override
            </label>
            <Select
              id={`comp-${request.id}`}
              value={override}
              disabled={comping}
              onChange={(e) => applyOverride(e.target.value)}
            >
              {OVERRIDE_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v === 'none' ? 'No override' : v}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <Textarea
        label="Internal note"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center justify-end gap-3">
        {failed && <span className="text-sm text-danger">{failed}</span>}
        <Button
          loading={saving}
          disabled={note === request.adminNote}
          onClick={() => save({ adminNote: note })}
        >
          Save note
        </Button>
      </div>
      {/* Only for an account-backed request: a signed-out one has no account
          whose activation state could be read. */}
      {request.googleSub !== null && <AccountActivitySummary googleSub={request.googleSub} />}
    </article>
  );
}
