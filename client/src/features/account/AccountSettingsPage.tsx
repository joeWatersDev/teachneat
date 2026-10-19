import { useState, type ReactNode } from 'react';
import { CreditCard, LogOut, PauseCircle, Star, Trash2, XCircle } from 'lucide-react';
import { ActionList, type ActionRow } from '../../components/ui/ActionList';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Select';
import { PremiumMark } from '../../components/ui/PremiumMark';
import { useAuth } from '../../hooks/useAuth';
import { useUpgrade } from '../../hooks/useUpgrade';
import {
  createPortalSession,
  pauseSubscription,
  PAUSE_DEFAULT_MONTHS,
  PAUSE_MONTH_CHOICES,
} from '../../api/billing';
import { deleteAccount, revokeAllSessions, type Plan } from '../../api/auth';
import { isApiError } from '../../api/client';

/**
 * Account settings (Phase 2 Step 6f).
 *
 * The account menu had accumulated an item per step — support, the first-run
 * guide, billing, sign-out, the dev toggle — without ever being designed as a
 * whole, and two of the things this step adds are destructive. A dropdown is
 * the wrong container for an action that ends an account: it is small, it is
 * dismissed by clicking anywhere, and it has no room to say what a control
 * does before it is clicked. So the menu keeps only navigation, and the actions
 * live on a page with space to explain them.
 *
 * Three rows, and the order is least to most consequential.
 *
 * **Both destructive actions leave by full page load rather than by client-side
 * navigation**, and that is not a stylistic choice. `navigate('/')` keeps the
 * single-page app alive with an `AuthProvider` that still believes it is signed
 * in, so the roster it lands on issues a request, gets a 401, and shows the
 * "your session ended" error screen — which is exactly what a teacher who just
 * pressed a button should not see. A real navigation re-runs `/auth/me` against
 * no session and lands on the marketing home page, and it also drops every piece
 * of student data still resident in React state, which is the right thing to do
 * at the moment a teacher ends every session or deletes their account.
 *
 * `redirectTo` is injectable for the same reason `AuthProvider` takes one: jsdom
 * has no navigation to spy on.
 */

/** The word a teacher must type to confirm deletion. */
const DELETE_PHRASE = 'Delete';

/** A date a teacher can read, in the app's plain style. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * A quiet pill stating one fact about the account, sitting beside the Premium
 * mark rather than competing with it.
 *
 * Neutral tokens deliberately: the accent tint belongs to the Premium mark,
 * which is the one badge here that says what the account *is*. These say when
 * something ends, which is information rather than status, and two accent pills
 * side by side would make the pair read as decoration.
 */
function InfoBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-subtle bg-subtle px-3 py-1 text-sm font-medium text-secondary">
      {children}
    </span>
  );
}

/**
 * The account's state, as badges under the email address.
 *
 * Two questions, answered separately and in that order: what access this account
 * has, and what is about to change about it. The first is the Premium mark or
 * "Free account" — a binary, because the product has one paid plan and there is
 * no third thing to be. The second is a date.
 *
 * A trial counts as Premium in the first badge, which is not a fudge: `trial`
 * and `paid` are entitlement-identical, so a trialling teacher has Premium
 * access and the badge would be lying to say otherwise. The date badge beside it
 * is what stops that reading as a permanent state.
 *
 * **A promo suppresses the trial date rather than appearing beside it**, and
 * this is the common case rather than an exotic one: a founding-user promo is
 * aimed at new signups, so most redeemers still have a trial running. Both dates
 * are true, but only the promo's is operative — a promo-covered account rolls
 * from `trial` to `paid` at trial end with no change in access and no charge, so
 * "Trial ends September 13" would announce a transition that does not happen,
 * and it is the more alarming-sounding of the two. The rule is the presence of a
 * promo and not whether it outlasts the trial: if a promo ended first it would be
 * the date of the first charge, which is operative, while the trial end still
 * would not be.
 *
 * A paused account resolves to `free` server-side and so shows "Free account"
 * here, which on its own would be alarming to someone who chose the pause. The
 * notice below the badges is what explains it, and it is why that notice is not
 * optional.
 */
function AccountBadges({
  billingEnabled,
  plan,
  trialEndsAt,
  promoEndsAt,
}: {
  billingEnabled: boolean;
  plan: Plan;
  trialEndsAt?: string;
  promoEndsAt?: string;
}) {
  // Step 8a: with no paid tier the account has no plan to state. Every account
  // is on the same footing, and a badge saying so would be an answer to a
  // question nobody is asking.
  if (!billingEnabled) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {plan === 'free' ? <InfoBadge>Free account</InfoBadge> : <PremiumMark />}
      {plan === 'trial' && trialEndsAt && !promoEndsAt && (
        <InfoBadge>Trial ends {formatDate(trialEndsAt)}</InfoBadge>
      )}
      {/* Leads with what the teacher has rather than with the mechanism, and
          names the date they start paying rather than the date a coupon expires. */}
      {promoEndsAt && (
        <InfoBadge>Free promo pricing until {formatDate(promoEndsAt)}</InfoBadge>
      )}
    </div>
  );
}

export function AccountSettingsPage({
  redirectTo = (url: string) => {
    window.location.assign(url);
  },
}: {
  redirectTo?: (url: string) => void;
} = {}) {
  const { profile, refresh } = useAuth();
  const { openUpgrade } = useUpgrade();
  const [openingPortal, setOpeningPortal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pauseMonths, setPauseMonths] = useState(PAUSE_DEFAULT_MONTHS);
  const [pausing, setPausing] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Trimmed and case-insensitive. The point of the phrase is to make deletion a
  // deliberate act rather than a misclick, and a teacher who has typed the word
  // has been deliberate; refusing "delete" for its lowercase d would only teach
  // them to resent the control.
  const phraseMatches = typed.trim().toLowerCase() === DELETE_PHRASE.toLowerCase();

  // Whether a founding-user promo is still covering the subscription. Read here
  // rather than trusted from `pauseAvailable`, which is false for several
  // unrelated reasons — an annual plan, a pause already taken this year — and
  // would put this explanation in front of teachers it does not describe.
  const promoEndsAt = profile?.promoEndsAt ?? null;
  const promoRunning = promoEndsAt !== null && new Date(promoEndsAt).getTime() > Date.now();
  // Present only for a live subscription, so it is safe to state as a date the
  // subscription actually ends on. Absent falls back to naming no date rather
  // than to a wrong one.
  const periodEndsAt = profile?.currentPeriodEnd ?? null;

  // Whether to offer the upgrade at the top of the list. `free` covers an account
  // that never subscribed and one whose subscription has ended; `trial` covers an
  // account that is about to become one of those.
  const offerUpgrade =
    profile?.billingEnabled === true &&
    (profile.plan === 'free' || profile.plan === 'trial') &&
    !profile.paused;

  function closeConfirm() {
    setConfirmingDelete(false);
    setTyped('');
  }

  function openPortal(flow?: 'cancel') {
    setError(null);
    setOpeningPortal(true);
    createPortalSession(flow)
      // A new tab, as in the menu this moved from: the portal is a separate
      // errand and coming back should not mean reloading the app.
      .then(({ url }) => window.open(url, '_blank', 'noopener,noreferrer'))
      .catch(() => setError('Billing could not be opened. Please try again.'))
      .finally(() => setOpeningPortal(false));
  }

  /**
   * Takes the pause, then refreshes the profile rather than assuming what it
   * did: the Stripe webhook is the sole writer of subscription state, so the
   * account is not paused until Stripe has told the server so. The refresh may
   * therefore land a moment before the webhook and still show the subscription
   * as live, which is a briefly stale label rather than a wrong entitlement.
   */
  function takePause() {
    setError(null);
    setPausing(true);
    pauseSubscription(pauseMonths)
      .then(() => refresh())
      .then(() => setCancelling(false))
      .catch((e: unknown) => {
        // The server's own message is shown, because each refusal names a
        // specific condition the teacher can act on — an annual plan, a pause
        // already taken this year — and a generic message would leave them
        // retrying something that cannot succeed.
        setError(
          isApiError(e) ? e.message : 'Your subscription could not be paused. Please try again.',
        );
      })
      .finally(() => setPausing(false));
  }

  function signOutEverywhere() {
    setError(null);
    setSigningOutAll(true);
    revokeAllSessions()
      // This browser's session is one of the ones just ended, so there is
      // nothing left here to render. A full load rather than a route change:
      // see the note above the component.
      .then(() => redirectTo('/'))
      .catch(() => {
        setError('You could not be signed out everywhere. Please try again.');
        setSigningOutAll(false);
      });
  }

  function confirmDelete() {
    if (!phraseMatches) return;
    setError(null);
    setDeleting(true);
    deleteAccount()
      .then(() => redirectTo('/'))
      .catch((e: unknown) => {
        // The server's message is worth showing here rather than replacing with
        // a generic one: the failure it names — a subscription that would not
        // cancel — has an action attached to it that only the teacher can take.
        setError(
          isApiError(e) ? e.message : 'Your account could not be deleted. Please try again.',
        );
        setDeleting(false);
        closeConfirm();
      });
  }

  const rows: ActionRow[] = [
    // The upgrade sits above billing rather than inside it, because an account
    // that is not paying has nothing to manage and everything to decide. It is
    // offered on `trial` as well as `free`: unlike a gated control, this page is
    // somewhere a teacher goes deliberately, so an upgrade here interrupts
    // nobody — the same distinction `useUpgrade` draws for the account menu and
    // the sidebar footer.
    //
    // **A paused account is excluded**, and not for tone: a paused subscription
    // still exists, so Checkout would create a second one and bill the teacher
    // twice. See `promptFromGatedControls` for the full reasoning.
    ...(offerUpgrade
      ? [
          {
            key: 'upgrade',
            icon: Star,
            label: 'Upgrade to Premium',
            description:
              'Attendance statistics, email at class scale, grouping rules, and the display options.',
            onClick: openUpgrade,
            tone: 'accent',
          } satisfies ActionRow,
        ]
      : []),
    // Every billing row below is withheld while billing is off (Step 8a).
    // `hasBilling` and `canCancel` already arrive false from the server in that
    // case, and `offerUpgrade` is false above, so the fallback "Upgrade to
    // Premium" row is the only one that needs saying explicitly.
    ...(profile?.hasBilling
      ? [
          {
            key: 'billing',
            icon: CreditCard,
            label: 'Manage billing',
            description:
              'Manage your subscription, payment method, invoices and receipts, via Stripe.',
            // Wrapped rather than passed directly: ActionList hands its onClick
            // to the button, so React would supply the click event as the `flow`
            // argument and this row would ask for the cancellation page.
            onClick: () => openPortal(),
            loading: openingPortal,
          } satisfies ActionRow,
        ]
      : offerUpgrade || !profile?.billingEnabled
        ? // A teacher who has never checked out has no Stripe customer and so no
          // portal to open, and the upgrade row above already says what to do
          // instead. A second row would repeat it. With billing off there is no
          // subscribing to describe at all.
          []
        : [
            {
              key: 'billing',
              icon: CreditCard,
              label: 'Upgrade to Premium',
              description:
                'No billing details are on file yet. Billing is managed here once you subscribe.',
              onClick: openUpgrade,
            } satisfies ActionRow,
          ]),
    // The cancellation entry point (Step 6i), and the only place the pause is
    // offered. "Manage billing" above still goes straight to Stripe for cards,
    // invoices and receipts; a teacher who came for one of those should not be
    // shown a retention offer on the way.
    //
    // Gated on canCancel rather than on hasBilling, and the difference is not
    // cosmetic: hasBilling only means a Stripe customer exists, and both that
    // id and the subscription id outlive a cancellation, so an account that
    // cancelled last term would be offered a cancellation for a subscription
    // Stripe has already ended — and refuses to open a cancel flow for.
    ...(profile?.canCancel && !profile?.paused
      ? [
          {
            key: 'cancel',
            icon: XCircle,
            label: 'Cancel subscription',
            description:
              'End your Premium subscription. You lose access to Premium features and revert to a free account. Your data remains unaffected.',
            onClick: () => setCancelling(true),
          } satisfies ActionRow,
        ]
      : []),
    {
      key: 'sessions',
      icon: LogOut,
      label: 'Log out of all sessions',
      description:
        'Signs out every browser and device, including this one. Useful if you have left yourself signed in on a classroom or shared computer.',
      onClick: signOutEverywhere,
      loading: signingOutAll,
    },
    {
      key: 'delete',
      icon: Trash2,
      label: 'Delete account',
      description:
        'Permanently deletes your Teachneat account. Your data remains accessible on your Google Drive.',
      onClick: () => setConfirmingDelete(true),
      tone: 'danger',
    },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Account settings" />

      <div className="flex flex-col gap-2">
        <div className="text-sm text-primary">{profile?.name}</div>
        <div className="text-sm text-secondary">{profile?.email}</div>
        {profile && (
          <AccountBadges
            billingEnabled={profile.billingEnabled}
            plan={profile.plan}
            trialEndsAt={profile.trialEndsAt}
            promoEndsAt={profile.promoEndsAt}
          />
        )}
      </div>

      {/* A paused subscription needs saying out loud. Without it the account
          reads as `free` with a "Manage billing" row and no explanation, and a
          teacher who chose the pause would reasonably conclude they had been
          cancelled. */}
      {profile?.paused && (
        <div className="flex items-start gap-2 rounded-md border border-subtle bg-subtle p-3 text-sm text-secondary">
          <PauseCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your subscription is paused
            {profile.pauseResumesAt ? ` until ${formatDate(profile.pauseResumesAt)}` : ''}. You are
            not being billed, and Premium features come back on automatically when it resumes.
            Nothing has been deleted.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <ActionList rows={rows} />

      {/* The cancellation flow (Step 6i). The pause is the offer, and cancelling
          outright is still one click away and not hidden behind it — a
          retention offer that makes leaving harder is a dark pattern, and this
          product's audience talks to each other. */}
      {cancelling && (
        <Modal
          title="Before you cancel"
          onClose={() => setCancelling(false)}
          footer={
            // Least to most consequential, left to right, which is the order the
            // delete dialog and the account rows already use. The confirm width
            // is deliberately not asked for here: it is sized for two buttons,
            // and this footer carries three.
            <>
              <Button variant="secondary" onClick={() => setCancelling(false)}>
                Keep my subscription
              </Button>
              {profile?.pauseAvailable && (
                <Button loading={pausing} onClick={takePause}>
                  Pause instead
                </Button>
              )}
              <Button
                variant="danger"
                loading={openingPortal}
                onClick={() => {
                  setCancelling(false);
                  // Deep-linked into the portal cancellation page: this button
                  // and Manage billing must not land in the same place.
                  openPortal('cancel');
                }}
              >
                Continue to cancel
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-secondary">
            {profile?.pauseAvailable && (
              <>
                {/* Named for the situation rather than for the mechanism: a
                    teacher is not looking for "pause_collection", they are
                    looking for a way not to pay over a summer they are not
                    teaching. */}
                <p>
                  If you are stopping for the summer rather than leaving, you can pause your
                  subscription instead. You are not billed while it is paused, nothing is deleted,
                  and everything is waiting when you come back.
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor="pause-months" className="text-primary">
                    Pause for
                  </label>
                  <Select
                    id="pause-months"
                    value={pauseMonths}
                    onChange={(e) => setPauseMonths(Number(e.target.value))}
                  >
                    {PAUSE_MONTH_CHOICES.map((m) => (
                      <option key={m} value={m}>
                        {m} {m === 1 ? 'month' : 'months'}
                      </option>
                    ))}
                  </Select>
                </div>
                <p>A subscription can be paused once every twelve months.</p>
              </>
            )}
            {/* A promo-covered subscription gets its own explanation, and it
                replaces the standard sentence rather than joining it, because
                that sentence is wrong here twice over: this teacher has not
                "already paid" for anything, and the period it refers to ends
                next month rather than when the offer does.
                
                That gap is the whole point. A discounted subscription still
                renews monthly at zero, so cancelling lands on the next monthly
                boundary and forfeits every free month after it. A teacher
                cancelling now to avoid a charge eleven months away would be
                giving up eleven months to prevent nothing, which is the most
                expensive misreading this dialog could invite. */}
            {promoRunning && promoEndsAt ? (
              <>
                <p>
                  You are not being billed at the moment. Your founding-user offer covers you until{' '}
                  {formatDate(promoEndsAt)}.
                </p>
                <p>
                  {periodEndsAt ? (
                    <>
                      Cancelling now would end your subscription on {formatDate(periodEndsAt)}, at
                      the end of the current billing month. The remaining promotional offer time
                      would be lost.
                    </>
                  ) : (
                    <>
                      Cancelling now would end your subscription at the end of the current billing
                      month. The remaining promotional offer time would be lost.
                    </>
                  )}
                </p>
              </>
            ) : (
              <p>
                Cancelling takes effect at the end of the period you have already paid for, and
                Premium features keep working until then.
              </p>
            )}
          </div>
        </Modal>
      )}

      {confirmingDelete && (
        <Modal
          title="Delete your account?"
          size="confirm"
          onClose={closeConfirm}
          footer={
            <>
              <Button variant="secondary" onClick={closeConfirm}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleting}
                disabled={!phraseMatches}
                onClick={confirmDelete}
              >
                Delete account
              </Button>
            </>
          }
        >
          {/* What it does not do, first. A teacher who thinks this destroys
              their class records will not use it; one who thinks it and uses it
              anyway has lost their year. */}
          <div className="flex flex-col gap-3 text-sm leading-relaxed text-secondary">
            <p>
              <strong className="font-semibold text-primary">
                Your student data is not deleted.
              </strong>{' '}
              It is in a Google Sheet on your own Drive, and it stays there. Open it, export it or
              delete it yourself, whenever you like.
            </p>
            <p>What is deleted is your account with us:</p>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>your sign-in, your settings, and any support messages you have sent us;</li>
              <li>this app’s permission to open your sheet or send email as you; and</li>
              <li>your subscription, which is cancelled immediately and not refunded.</li>
            </ul>
            <p>This cannot be undone. Signing up again would start an empty account.</p>
          </div>

          {/* Typing the word is the friction, and it is here rather than on the
              button because the button is where a misclick lands. It also forces
              the list above to be read past on the way to the field. */}
          <div className="mt-4">
            <Input
              label={`Type ${DELETE_PHRASE} to confirm`}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && phraseMatches) confirmDelete();
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
