import { useState } from 'react';
import { Check, Star } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { createCheckout, PRICING, type BillingInterval } from '../../api/billing';

/**
 * What the paid plan adds, phrased as the teacher would describe it rather than
 * as the codebase names it. Kept short: the modal is reached by someone who has
 * already met the boundary, so it confirms what they get, it does not sell.
 */
const INCLUDED = [
  'Attendance statistics and the per-student attendance summary',
  'Up to 120 emails a day, up from 30 a month',
  'Advanced grouping and seating rules',
  'A high-absence threshold set to match your board’s policy',
  'Display and styling options in Grouping and the Name Picker',
];

/** Annual first: it is the plan we lead with, and order is most of what leading means. */
const ORDER: BillingInterval[] = ['annual', 'monthly'];

export function UpgradeModal({ onClose }: { onClose: () => void }) {
  // Annual is pre-selected. The reasoning is retention rather than fees — see
  // NEXT_STEPS ("Billing provider") — but either way it is the default we want
  // a teacher to have to actively move away from.
  const [interval, setInterval] = useState<BillingInterval>('annual');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const { url } = await createCheckout(interval);
      // A full navigation, not a fetch: checkout is a Stripe-hosted page, and
      // the card is entered there rather than anywhere in this app.
      window.location.assign(url);
    } catch {
      setError('Could not start checkout. Please try again.');
      setStarting(false);
    }
  }

  return (
    <Modal
      title="Upgrade to Premium"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void start()} loading={starting}>
            Continue to payment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 pb-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Billing interval</legend>
          {ORDER.map((key) => {
            const option = PRICING[key];
            const selected = interval === key;
            return (
              <label
                key={key}
                className={
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ' +
                  (selected
                    ? 'border-accent bg-accent-muted'
                    : 'border-subtle bg-elevated hover:bg-hover')
                }
              >
                <input
                  type="radio"
                  name="billing-interval"
                  value={key}
                  checked={selected}
                  onChange={() => setInterval(key)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={
                    'grid h-5 w-5 shrink-0 place-items-center rounded-full border ' +
                    (selected ? 'border-accent bg-accent' : 'border-subtle')
                  }
                >
                  {selected && <Check size={12} strokeWidth={3} className="text-on-accent" />}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-primary">{option.price}</span>
                  <span className="text-xs text-secondary">{option.caption}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-primary">Premium includes</p>
          <ul className="flex flex-col gap-1.5">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-secondary">
                <Star
                  size={14}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 fill-accent text-accent"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
