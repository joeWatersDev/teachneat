import { useState } from 'react';
import { getAccountActivity, type AccountActivity, type UsageTool } from '../../api/support';
import { isApiError } from '../../api/client';

/**
 * One account's activation state, shown inside the support ticket written by
 * that account (Phase 2 Step 6j).
 *
 * It lives here rather than on the metrics page on purpose. The operator
 * question this answers — "has this teacher actually got started, or are they
 * stuck?" — only ever arises while reading a request they sent, and putting it
 * here means there is no account search anywhere in the product: an account
 * that has not written in cannot be looked at.
 *
 * Loaded on expand rather than with the ticket list, so opening the triage page
 * does not read the activation state of every account with an open request.
 */

const TOOLS: UsageTool[] = ['attendance', 'grouping', 'email', 'picker'];

const TOOL_LABELS: Record<UsageTool, string> = {
  attendance: 'Attendance',
  grouping: 'Grouping',
  email: 'Email',
  picker: 'Picker',
};

const MILESTONE_LABELS: [keyof AccountActivity['milestones'], string][] = [
  ['onboardedAt', 'Finished the guide'],
  ['firstStudentAt', 'Added a student'],
  ['firstAttendanceAt', 'Saved attendance'],
  ['firstGroupingAt', 'Generated groups'],
  ['firstPickerAt', 'Opened the picker'],
  ['firstEmailAt', 'Sent an email'],
  ['firstPremiumAttemptAt', 'Reached a Premium gate'],
];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : 'never';
}

export function AccountActivitySummary({ googleSub }: { googleSub: string }) {
  const [activity, setActivity] = useState<AccountActivity | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || activity !== null) return;
    // Cleared before the retry, not only on success. Without this a failed
    // first expand leaves `error` set while `activity` stays null, so the next
    // expand refetches and, if it succeeds, renders the stale error above the
    // data it contradicts — the two guards below are independent.
    setError(null);
    getAccountActivity(googleSub)
      .then(setActivity)
      .catch((e: unknown) =>
        setError(isApiError(e) && e.status === 404 ? 'Account not found.' : 'Could not load activity.'),
      );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-subtle pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="self-start text-sm text-secondary underline hover:text-primary"
      >
        {open ? 'Hide account activity' : 'Show account activity'}
      </button>

      {open && error !== null && <p className="text-sm text-secondary">{error}</p>}

      {open && error === null && activity === null && (
        <p className="text-sm text-secondary">Loading…</p>
      )}

      {open && activity !== null && (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-secondary">
            Account created {new Date(activity.createdAt).toLocaleDateString()}.
          </p>

          <ul className="flex flex-col gap-1">
            {MILESTONE_LABELS.map(([key, label]) => (
              <li key={key} className="flex justify-between gap-4 text-secondary">
                <span>{label}</span>
                <span className="tabular-nums text-primary">
                  {formatDate(activity.milestones[key])}
                </span>
              </li>
            ))}
          </ul>

          {activity.usage.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="border-b border-subtle">
                    <th scope="col" className="py-1 text-left font-medium text-secondary">
                      Month
                    </th>
                    {TOOLS.map((tool) => (
                      <th
                        key={tool}
                        scope="col"
                        className="py-1 text-right font-medium text-secondary"
                      >
                        {TOOL_LABELS[tool]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activity.usage.map((row) => (
                    <tr key={row.period} className="border-b border-subtle last:border-0">
                      <th scope="row" className="py-1 text-left font-normal text-primary">
                        {row.period}
                      </th>
                      {TOOLS.map((tool) => (
                        <td key={tool} className="py-1 text-right tabular-nums text-primary">
                          {row.counts[tool]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* The picker's asymmetry follows the number wherever it is shown. */}
          <p className="text-xs text-secondary">
            Picker counts are opens of the tool, not rounds drawn.
          </p>
        </div>
      )}
    </div>
  );
}
