import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { TabNav } from '../../components/ui/TabNav';
import { PremiumBadge } from '../../components/ui/Premium';
import { Tooltip } from '../../components/ui/Tooltip';
import { isApiError } from '../../api/client';
import { listTemplates, getSendStatus } from '../../api/email';
import { ComposeView } from './ComposeView';
import { TemplatesView } from './TemplatesView';
import { useTabRoute } from '../../hooks/useTabRoute';
import type { EmailTemplate, SendStatus } from './types';

/** URL slugs: `/email/compose` and `/email/templates`. */
const TABS = ['compose', 'templates'] as const;

/**
 * What the chip's number means, in one plain sentence, chosen by which limit is
 * actually in force.
 *
 * The monthly allowance is the free tier's, and the server sends `monthlyCap`
 * only when it applies — so with billing off (Step 8a) it is absent and the
 * chip is showing the daily cap instead. Keying the sentence off the same value
 * the chip reads is what keeps the two from describing different limits.
 */
const MONTHLY_EXPLANATION =
  'Sending more than 30 emails a month is part of Premium. The free allowance resets each month.';
const DAILY_EXPLANATION =
  'Every account can send up to 120 emails a day. The count resets each day.';

export function EmailPage() {
  const route = useTabRoute('email', '/email', TABS, 'compose');
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus | null>(null);

  const reloadTemplates = useCallback(async () => {
    setTemplatesError(null);
    try {
      setTemplates(await listTemplates());
    } catch (e) {
      setTemplatesError(isApiError(e) ? e.message : 'Could not load templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const reloadStatus = useCallback(async () => {
    try {
      setSendStatus(await getSendStatus());
    } catch {
      // The quota indicator is non-critical; leave it blank on failure.
    }
  }, []);

  useEffect(() => {
    void reloadTemplates();
    void reloadStatus();
  }, [reloadTemplates, reloadStatus]);

  // The bare `/email`, or an unknown tab, goes to the last tab used.
  if (route.redirectTo !== null) {
    return <Navigate to={route.redirectTo} replace />;
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Email" />

      <TabNav
        label="Email views"
        items={[
          { to: '/email/compose', label: 'Compose' },
          { to: '/email/templates', label: 'Templates' },
        ]}
      />

      {route.tab === 'compose' ? (
        <>
          {/* Under the tabs and on Compose only: the allowance is about sending,
              and Templates sends nothing.

              The indicator shows the limit that actually binds. On `free` that
              is the monthly allowance — "188 remaining today" is true of the
              daily cap and useless as guidance when 30 a month is what will stop
              them. It carries the premium marker because sending beyond the
              monthly allowance is the paid feature, so the number a teacher is
              watching and the reason it is low are in the same place. The marker
              renders nothing while billing is off, when the daily cap is the only
              one. */}
          {sendStatus && (
            <div className="flex justify-end">
              <Tooltip
                label={
                  sendStatus.monthlyCap !== undefined ? MONTHLY_EXPLANATION : DAILY_EXPLANATION
                }
                side="bottom"
                align="end"
              >
                <span className="flex items-center gap-1.5 rounded-full bg-hover px-3 py-1 text-xs text-secondary">
                  <PremiumBadge />
                  {sendStatus.monthlyCap !== undefined
                    ? `${sendStatus.remainingThisMonth} of ${sendStatus.monthlyCap} remaining this month`
                    : `${sendStatus.sentToday} / ${sendStatus.dailyCap} sent today · ${sendStatus.remaining} remaining`}
                </span>
              </Tooltip>
            </div>
          )}
          <ComposeView
            templates={templates}
            sendStatus={sendStatus}
            onSent={() => {
              void reloadStatus();
            }}
          />
        </>
      ) : (
        <TemplatesView
          templates={templates}
          loading={templatesLoading}
          error={templatesError}
          onChanged={() => void reloadTemplates()}
        />
      )}
    </section>
  );
}
