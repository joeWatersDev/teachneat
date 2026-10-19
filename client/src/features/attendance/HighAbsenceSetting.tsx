import { useEffect, useState } from 'react';
import { CalendarX } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { PremiumBadge, PremiumControl } from '../../components/ui/Premium';
import { isApiError } from '../../api/client';
import { updateSettings } from '../../api/settings';
import { useEntitlements } from '../../hooks/useEntitlements';
import { describeHighAbsence, DEFAULT_HIGH_ABSENCE } from './thresholds';

/** Fixed, not a lever: the sample floor below which no class is flagged. */
const MIN_RECORDED_DAYS = DEFAULT_HIGH_ABSENCE.minDaysRecorded;

/**
 * The high-absence threshold control, in the Statistics toolbar. The flag is
 * computed on every plan; choosing where it sits is premium — a teacher who
 * wants a threshold matched to their board's attendance policy is already
 * invested enough to pay, and the setting only means anything once statistics
 * are visible. One threshold per account, not per class.
 */
export function HighAbsenceSetting() {
  const { highAbsence, storedOverride, isPremium, refreshSettings } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the field from the effective threshold each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setRate(String(Math.round(highAbsence.minAbsenceRate * 1000) / 10));
    setError(null);
  }, [open, highAbsence]);

  async function save() {
    const minAbsenceRate = Number(rate) / 100;
    if (!Number.isFinite(minAbsenceRate) || minAbsenceRate <= 0 || minAbsenceRate > 1) {
      setError('Enter an absence rate between 1 and 100 percent.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateSettings({ minAbsenceRate });
      await refreshSettings();
      setOpen(false);
    } catch (e) {
      setError(isApiError(e) ? e.message : 'Could not save the threshold.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Its own right-aligned column in the toolbar: the date range is what the
          teacher scopes, the threshold is what the flag means, and reading them
          as one sentence conflates the two. */}
      <div className="ml-auto flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="flex items-center gap-1.5 whitespace-nowrap text-sm text-secondary">
            <CalendarX
              size={16}
              strokeWidth={2}
              className="shrink-0 text-warning"
              aria-hidden="true"
            />
            High absences: {describeHighAbsence(highAbsence)}
          </span>
          <PremiumControl explanation="Choosing the high-absence threshold is part of Premium.">
            {({ locked, describedBy }) => (
              <Button
                variant="secondary"
                disabled={locked}
                aria-disabled={locked || undefined}
                aria-describedby={describedBy}
                onClick={() => setOpen(true)}
              >
                Change threshold
                <PremiumBadge />
              </Button>
            )}
          </PremiumControl>
        </div>

        {/* A lapsed account is shown what upgrading restores, rather than being
            left to think its setting was discarded. */}
        {!isPremium && storedOverride && (
          <p className="text-right text-sm text-secondary">
            Your saved threshold ({describeHighAbsence(storedOverride)}) applies again on the paid
            plan.
          </p>
        )}
      </div>

      {open && (
        <Modal title="High-absence threshold" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-secondary">
              A student is flagged when their absence rate for a class is above this percentage. It
              applies to every class. Classes with fewer than {MIN_RECORDED_DAYS} recorded days are
              never flagged, so a threshold is not drawn from too small a sample.
            </p>
            <Input
              label="Absence rate (percent)"
              type="number"
              min={1}
              max={100}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            {error && (
              <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={saving} onClick={() => void save()}>
                Save
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
