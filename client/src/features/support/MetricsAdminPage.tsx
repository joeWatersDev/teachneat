import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/ui/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { isApiError } from '../../api/client';
import { getOperatorMetrics, type OperatorMetrics, type UsageTool } from '../../api/support';

/**
 * The operator metrics view (Phase 2 Step 6j).
 *
 * Plain for the same reason as the triage page beside it: one person reads it.
 * The server answers 404 to anyone off the support allowlist, so this renders
 * "not found" rather than an access-denied screen.
 *
 * Two things on this page are load-bearing rather than decorative. The funnel
 * stages are counts against a denominator, not a cascade, because an account
 * can send an email without ever having generated a grouping — rendering them
 * as a funnel that only descends would invent a drop-off that is not there. And
 * the picker column carries its caveat inline, because its number means
 * something different from the other three and a reader comparing them without
 * knowing that would draw a wrong conclusion.
 */

const TOOLS: UsageTool[] = ['attendance', 'grouping', 'email', 'picker'];

const TOOL_LABELS: Record<UsageTool, string> = {
  attendance: 'Attendance',
  grouping: 'Grouping',
  email: 'Email',
  picker: 'Name picker',
};

/** The funnel rows, in the order a new account meets them. */
const STAGES: { key: keyof OperatorMetrics['funnel']; label: string }[] = [
  { key: 'signedUp', label: 'Signed up' },
  { key: 'onboarded', label: 'Finished the guide' },
  { key: 'firstStudent', label: 'Added a student' },
  { key: 'firstAttendance', label: 'Saved attendance' },
  { key: 'firstGrouping', label: 'Generated groups' },
  { key: 'firstPicker', label: 'Opened the picker' },
  { key: 'firstEmail', label: 'Sent an email' },
  { key: 'premiumAttempt', label: 'Reached a Premium gate' },
];

/** `2026-08` as `August 2026`, which is what a reader scanning a column wants. */
function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function MetricsAdminPage() {
  const [metrics, setMetrics] = useState<OperatorMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getOperatorMetrics()
      .then(setMetrics)
      .catch((e: unknown) =>
        setError(isApiError(e) && e.status === 404 ? 'Not found.' : 'Could not load metrics.'),
      );
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!metrics) return <LoadingState label="Loading metrics…" />;

  const { funnel, usage, signups } = metrics;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Metrics" />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">Activation</h2>
        <p className="text-sm text-secondary">
          Accounts that have reached each milestone at least once, out of {funnel.signedUp} total.
          These are separate counts rather than steps of a funnel: an account can send an email
          without having generated groups, so the numbers do not have to descend.
        </p>
        <table className="w-full max-w-xl text-sm">
          <tbody>
            {STAGES.map(({ key, label }) => {
              const value = funnel[key];
              const share = funnel.signedUp > 0 ? Math.round((value / funnel.signedUp) * 100) : 0;
              return (
                <tr key={key} className="border-b border-subtle last:border-0">
                  <th scope="row" className="py-2 text-left font-normal text-secondary">
                    {label}
                  </th>
                  <td className="py-2 text-right tabular-nums text-primary">{value}</td>
                  <td className="w-16 py-2 text-right tabular-nums text-secondary">
                    {key === 'signedUp' ? '' : `${share}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">Tool use by month</h2>
        <p className="text-sm text-secondary">
          Each cell is the number of times the tool was used that month, with the number of distinct
          accounts in brackets. Counts are kept for {metrics.retentionMonths} months.
        </p>
        {metrics.pickerCountsPageOpens && (
          <p className="text-sm text-secondary">
            The name picker column counts the tool being opened, not rounds drawn. It has no
            server request of its own, so it is measured on the roster read its page already makes.
            It is not comparable to the other three columns.
          </p>
        )}
        {usage.length === 0 ? (
          <p className="text-sm text-secondary">No usage recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="py-2 text-left font-medium text-secondary">
                    Month
                  </th>
                  {TOOLS.map((tool) => (
                    <th
                      key={tool}
                      scope="col"
                      className="py-2 text-right font-medium text-secondary"
                    >
                      {TOOL_LABELS[tool]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.period} className="border-b border-subtle last:border-0">
                    <th scope="row" className="py-2 text-left font-normal text-primary">
                      {formatPeriod(row.period)}
                    </th>
                    {TOOLS.map((tool) => (
                      <td
                        key={tool}
                        className="py-2 text-right tabular-nums text-primary"
                      >
                        {row.counts[tool]}{' '}
                        <span className="text-secondary">({row.accounts[tool]})</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">New accounts by month</h2>
        {signups.length === 0 ? (
          <p className="text-sm text-secondary">No accounts yet.</p>
        ) : (
          <table className="w-full max-w-xs text-sm">
            <tbody>
              {signups.map((row) => (
                <tr key={row.period} className="border-b border-subtle last:border-0">
                  <th scope="row" className="py-2 text-left font-normal text-secondary">
                    {formatPeriod(row.period)}
                  </th>
                  <td className="py-2 text-right tabular-nums text-primary">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
