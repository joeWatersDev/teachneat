import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { billingEnabled, env, devToolsEnabledFor, isSupportAdmin } from '../config/env.js';
import { CURRENT_TERMS_VERSION, consentIsCurrent } from '../config/legal.js';
import { logger } from '../config/logger.js';
import { dropAllForUser } from '../services/cache.js';
import { resolveEffectivePlan } from '../services/plan.js';
import {
  authorizedClientForRefreshToken,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  MissingScopesError,
  revokeRefreshToken,
} from '../services/googleAuth.js';
import { cancelSubscriptionNow, canOfferPause, hasLiveSubscription } from '../services/billing.js';
import { buildGoogleClients } from '../services/sheetsClient.js';
import { discoverOrCreateSpreadsheet } from '../services/bootstrap.js';
import {
  createPgAccountStore,
  type Account,
  type AccountStore,
} from '../services/accountStore.js';
import {
  createPgLifecycleEmailStore,
  enqueueQuietly,
  type LifecycleEmailStore,
} from '../services/lifecycleEmail.js';
import {
  createPgSessionStore,
  SESSION_ABSOLUTE_TTL_MS,
  type SessionStore,
} from '../services/sessionStore.js';
import {
  clearSessionCookieOnResponse,
  loadSession,
  readSessionId,
  requireSession,
  sessionOf,
  setSessionCookieOnResponse,
} from '../middleware/session.js';
import { requireCsrf } from '../middleware/csrf.js';
import { ApiError } from '../utils/errors.js';

const OAUTH_STATE_COOKIE = 'ttk_oauth_state';

/**
 * The one deliberate exception to the project rule that every request schema is
 * `.strict()`. This validates Google's callback query string, and Google appends
 * parameters of its own (`scope`, `authuser`, `prompt`, `hd`, and more over
 * time); rejecting unexpected keys here would break sign-in the first time
 * Google added one. Only `code` and `state` are read, and everything else is
 * ignored rather than trusted.
 */
const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Google's failure path (Phase 2 Step 5a). When consent does not happen, Google
 * redirects back here with `error` and no `code` at all — which, before this
 * step, fell through the schema above into a generic VALIDATION_ERROR telling a
 * teacher their sign-in "was missing or invalid information". For the case that
 * matters most to this product that message is not merely unhelpful, it is
 * wrong: nothing about the request was invalid, their school board has blocked
 * the app, and no amount of retrying will change it.
 *
 * `admin_policy_enforced` is that case. Google signals it inconsistently — as
 * `error_subtype` on some flows and only inside `error_description` on others —
 * so both are checked rather than trusting one. Everything else that is
 * `access_denied` is the teacher declining the consent screen, which is a
 * different conversation and gets a different page.
 */
function classifyOAuthError(query: Record<string, unknown>): string | null {
  const error = typeof query.error === 'string' ? query.error : '';
  if (!error) return null;
  const subtype = typeof query.error_subtype === 'string' ? query.error_subtype : '';
  const description = typeof query.error_description === 'string' ? query.error_description : '';
  if (/admin_policy_enforced/i.test(`${subtype} ${description}`)) return 'ADMIN_POLICY_BLOCKED';
  if (error === 'access_denied') return 'CONSENT_DECLINED';
  return 'OAUTH_ERROR';
}

/** Why a `free` account has lost premium, where it had it before. */
export type LapsedFrom = 'trial' | 'subscription' | 'paused';

/**
 * Why this account is on `free`, or null if it is not on `free` or never had
 * premium at all.
 *
 * Three reasons, not the two the original `trialExpired` flag assumed. That flag
 * was `plan === 'free'` plus a trial end date in the past, which is true of
 * every lapsed account whatever happened to it — so a teacher who paid for a
 * year and then cancelled was told their *trial* had ended, and so was one whose
 * subscription is merely paused for the summer. Both had also had a trial once,
 * thirteen months earlier, and neither was being told anything useful.
 *
 * Order matters, and it is most-recent-cause-first rather than most-severe:
 *
 *  - `paused` outranks everything, because a pause is not a loss. The teacher
 *    chose it, it has an end date, and telling them their subscription "has
 *    ended" would contradict the notice on their own account page.
 *  - `subscription` next: an account holding a subscription id has had one, since
 *    the id is never cleared, and that is a more recent and more relevant event
 *    than a trial that ended before it started.
 *  - `trial` last, which is the only case the original flag actually got right.
 *
 * Null for an account that has never been premium, which is the case the copy
 * treats as an invitation rather than an explanation.
 */
function lapsedFrom(
  account: { trialEndsAt: string | null; stripeSubscriptionId: string | null; collectionPaused: boolean },
  plan: string,
  now: Date = new Date(),
): LapsedFrom | null {
  if (plan !== 'free') return null;
  if (account.collectionPaused) return 'paused';
  if (account.stripeSubscriptionId !== null) return 'subscription';
  if (account.trialEndsAt && new Date(account.trialEndsAt).getTime() <= now.getTime()) {
    return 'trial';
  }
  return null;
}

/**
 * Whether this sign-in is a teacher returning to data they already have, on an
 * account row that has never seen it.
 *
 * The first-run guide is keyed on `onboarded_at` alone, which knows nothing
 * about the teacher's Drive. Deleting an account leaves the spreadsheet
 * untouched by design (Step 6f), so registering again produces a brand-new row
 * pointing at a full roster, and the guide cheerfully tells a teacher holding
 * three classes to add their first students. `Skip for now` is the only exit
 * that applies to them.
 *
 * Three conditions, and each one excludes a case that must keep the guide:
 *
 *  - `!spreadsheetWasCreated` — bootstrap found an existing sheet through the
 *    Drive marker rather than creating one, so this teacher has used the
 *    product before. This is the whole signal, and it costs nothing: the
 *    callback already computes it and was discarding it.
 *  - `onboardedAt === null` — otherwise there is nothing to suppress.
 *  - `spreadsheetId === null` — the row is a fresh insert, since the callback
 *    records the id immediately after this runs. Without it, a teacher who
 *    opened the guide on day one, abandoned it, and signed back in would be
 *    silently robbed of it, because their second sign-in also discovers rather
 *    than creates.
 *
 * One false positive the `spreadsheetId` proxy admits, left in knowingly: if an
 * earlier sign-in died between `createSpreadsheet` succeeding and
 * `updateSpreadsheetId` landing, the row survives with a null spreadsheet id, and
 * the next sign-in discovers rather than creates. A genuinely new teacher is then
 * read as returning and loses the redirect, though not the guide, which stays in
 * the account menu. Closing it exactly means having `upsert` report whether it
 * inserted (Postgres `xmax = 0`), which is a store-interface change for a crash
 * window whose worst outcome is a missed redirect.
 *
 * Note the deliberate limitation: a discovered spreadsheet is evidence the
 * teacher has used the product, not that the sheet holds students. Someone who
 * registered, never added anyone, deleted the account and came back is counted
 * as returning and loses the guide. Reading the roster to tell the difference
 * would put a Sheets call on the sign-in path to serve a rarer case than the
 * one being fixed, and the guide stays reachable from the account menu either
 * way.
 */
export function returningTeacherOnFreshAccount(
  account: Pick<Account, 'onboardedAt' | 'spreadsheetId'>,
  spreadsheetWasCreated: boolean,
): boolean {
  return (
    !spreadsheetWasCreated && account.onboardedAt === null && account.spreadsheetId === null
  );
}

export function buildAuthRouter(
  store: AccountStore = createPgAccountStore(),
  sessions: SessionStore = createPgSessionStore(),
  lifecycle: LifecycleEmailStore = createPgLifecycleEmailStore(),
): Router {
  const router = Router();

  router.get('/google', (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    res.setHeader(
      'Set-Cookie',
      `${OAUTH_STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
        env.nodeEnv === 'production' ? '; Secure' : ''
      }`,
    );
    const url = buildAuthorizationUrl(state);
    const wantsJson = (req.headers.accept ?? '').includes('application/json');
    if (wantsJson) {
      res.json({ redirectUrl: url });
    } else {
      res.redirect(url);
    }
  });

  router.get('/google/callback', async (req, res, next) => {
    try {
      // Before the schema: an error response carries no `code`, so parsing
      // first would misreport every declined or blocked sign-in as malformed.
      // Nothing is exchanged or stored on this path, so there is no state to
      // verify — the redirect target is a fixed page on our own origin and the
      // only thing carried across is a code we chose ourselves, never a value
      // out of the query string.
      const oauthError = classifyOAuthError(req.query as Record<string, unknown>);
      if (oauthError) {
        logger.warn({ code: oauthError }, 'OAuth consent did not complete');
        res.redirect(`${env.clientOrigin}/auth/error?code=${oauthError}`);
        return;
      }

      const parsed = callbackSchema.safeParse(req.query);
      if (!parsed.success) {
        res.redirect(`${env.clientOrigin}/auth/error?code=VALIDATION_ERROR`);
        return;
      }
      const cookieHeader = req.headers.cookie ?? '';
      const stateCookie = cookieHeader
        .split(';')
        .map((p) => p.trim())
        .find((p) => p.startsWith(`${OAUTH_STATE_COOKIE}=`))
        ?.split('=')[1];
      if (!stateCookie || stateCookie !== parsed.data.state) {
        res.redirect(`${env.clientOrigin}/auth/error?code=VALIDATION_ERROR`);
        return;
      }

      let exchanged;
      try {
        exchanged = await exchangeCodeForTokens(parsed.data.code);
      } catch (err) {
        // A partial grant is refused before any account row is written, so a
        // teacher never reaches a tool that is certain to fail. The token is
        // not revoked: for a returning teacher that would also kill the grant
        // their other signed-in sessions are using, and the retry puts the
        // unticked box back in front of them regardless.
        if (err instanceof MissingScopesError) {
          logger.warn({ missing: err.missing }, 'Sign-in refused: required scopes not granted');
          res.redirect(`${env.clientOrigin}/auth/error?code=SCOPES_MISSING`);
          return;
        }
        throw err;
      }
      const { refreshToken, profile } = exchanged;

      // Insert or update this teacher's account row, then resolve their Sheet.
      const account = await store.upsert({
        googleSub: profile.googleSub,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        refreshToken,
        workspaceDomain: profile.workspaceDomain,
      });

      const auth = authorizedClientForRefreshToken(account.refreshToken);
      const { sheets, drive } = buildGoogleClients(auth);
      const { spreadsheetId, created } = await discoverOrCreateSpreadsheet(sheets, drive);
      await store.updateSpreadsheetId(profile.googleSub, spreadsheetId);

      // `account` is the row as upsert returned it, before the line above, and
      // returningTeacherOnFreshAccount depends on that: it reads
      // `spreadsheetId === null` to recognise a fresh insert. Re-reading the
      // account here, or moving the check above the write, would make it always
      // false and silently disable the guard below.

      // A teacher whose Drive already holds their data must not be walked
      // through the first-run guide. See returningTeacherOnFreshAccount above
      // for why these are the conditions and what the check deliberately does
      // not cover.
      //
      // Recorded as `onboarded_at` rather than a column of its own, which is a
      // small overload of that column's meaning: it reads as "finished the
      // guide" and is being set for someone who never saw it. That already
      // happens on the skip path, and `/admin/metrics` counts the column, so
      // its onboarding figure includes these. A dedicated column would be
      // honest and would cost a migration for a case this narrow.
      //
      // Swallowed on failure, like noteHasStudents in the students router: this
      // is bookkeeping for which screen to show next, and it must never be the
      // reason a sign-in fails.
      if (returningTeacherOnFreshAccount(account, created)) {
        try {
          await store.markOnboarded(profile.googleSub);
        } catch (err) {
          logger.warn(
            { err: (err as Error).message },
            'Could not suppress the first-run guide for a returning teacher',
          );
        }
      }

      // Signing in mints a fresh session id, so a pre-existing (possibly
      // attacker-planted) cookie value can never be promoted to an
      // authenticated one.
      const session = await sessions.create(profile.googleSub);
      setSessionCookieOnResponse(res, session.id, Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000));
      // The one-time state cookie has done its job; drop it rather than leaving
      // it in the browser for its full 10 minutes. Appended, because setting the
      // session cookie above uses setHeader and would otherwise overwrite it.
      res.appendHeader('Set-Cookie', `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
      res.redirect(`${env.clientOrigin}/`);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'OAuth callback failed');
      next(err);
    }
  });

  // Also the client's source for the CSRF token: it is fetched on load, before
  // any state-changing request can be made, and refreshed if one is rejected.
  router.get('/me', async (req, res, next) => {
    try {
      const session = await loadSession(req, sessions);
      if (!session) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
      const account = await store.getByGoogleSub(session.googleSub);
      if (!account) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
      const plan = resolveEffectivePlan(account);
      // Step 8a. With billing off there is no plan boundary, no trial and no
      // subscription, so every field that describes one is withheld rather
      // than sent as a value the client would have to know to ignore. The
      // client reads `billingEnabled` and renders no upgrade affordance at all.
      const billing = billingEnabled();
      const lapsed = billing ? lapsedFrom(account, plan) : null;
      res.json({
        email: account.email,
        name: account.name,
        avatarUrl: account.avatarUrl,
        csrfToken: session.csrfToken,
        // Presentation only — badges and disabled controls. Every gated
        // endpoint resolves the plan again for itself.
        plan,
        billingEnabled: billing,
        ...(billing && plan === 'trial' && account.trialEndsAt
          ? { trialEndsAt: account.trialEndsAt }
          : {}),
        // Why this account is on `free`, when it has been premium before
        // (Step 6h, widened here). A rendering hint and only that: it chooses
        // which words a locked control uses, never whether it is locked.
        //
        // The distinction it was added for is that an account which never had
        // premium is meeting a boundary, while one that has been reading
        // Statistics for a month has had something taken away, and telling the
        // second the same thing reads as a product that broke. Absent means the
        // former — never had it — and needs an invitation rather than an
        // explanation.
        ...(lapsed ? { lapsedFrom: lapsed } : {}),
        // The summer pause (Step 6i), for wording rather than for permission —
        // a paused account already resolves to `free` above, and every gated
        // endpoint resolves it again. It is sent so the account page can say
        // "paused until September" instead of leaving a teacher who chose the
        // pause to conclude their subscription was cancelled.
        ...(billing && account.collectionPaused
          ? { paused: true, pauseResumesAt: account.pauseResumesAt }
          : {}),
        // When a founding-user promo stops covering the subscription (Step 6i).
        // Sent for the same reason as the pause fields above: wording, not
        // permission. Until now this date existed only inside the reminder
        // email, so a teacher on the promo had no way to see when their free
        // period ended without going and finding that message.
        //
        // Not `currentPeriodEnd`, which a discounted subscription moves every
        // month while this date stays put.
        ...(billing && account.promoEndsAt ? { promoEndsAt: account.promoEndsAt } : {}),
        // When the current billing period ends, sent **only for a live
        // subscription**. That guard is the point: Stripe reports a terminated
        // subscription's original period end, so a `canceled` row can carry a
        // date well in the future, and shipping it would let the client say
        // "access until" about access that ended months ago.
        //
        // It exists for the cancellation dialog, which has to tell a
        // promo-covered teacher that cancelling ends their subscription at this
        // date rather than when the promo runs out — a distinction worth eleven
        // free months to them, and invisible without the date.
        ...(billing && hasLiveSubscription(account) && account.currentPeriodEnd
          ? { currentPeriodEnd: account.currentPeriodEnd }
          : {}),
        // Whether there is a subscription worth offering to cancel (Step 6i).
        // Deliberately not `hasBilling`, which is only whether a Stripe
        // customer exists: the customer id and the subscription id are both
        // kept after a subscription ends, so a teacher who cancelled last term
        // would be offered a cancellation for something already gone — and
        // Stripe refuses the deep link, which surfaces as a failure to open
        // billing at all. Nor is it the plan, since a comped account resolves
        // to `paid` with no subscription behind it.
        canCancel: billing && hasLiveSubscription(account),
        // Whether a pause is available to offer in the cancellation flow. The
        // eligibility that actually decides is on the endpoint, which re-reads
        // the interval from Stripe; this only keeps the dialog from offering
        // something that would be refused.
        pauseAvailable: billing && canOfferPause(account),
        // Whether the first-run guide has yet to be completed (Step 5a). Unlike
        // the hints below this one is not a permission at all, so there is
        // nothing to re-check: the worst a forged value can do is show or skip
        // a page of prose.
        needsOnboarding: account.onboardedAt === null,
        // Whether the account has ever had a student (Step 6f). The account menu
        // stops offering the first-run guide once it has, so the guide is a
        // first-week affordance rather than a permanent item. A rendering hint
        // like needsOnboarding: forging it shows or hides a page of prose.
        hasStudents: account.firstStudentAt !== null,
        // Unlike needsOnboarding above, this one *is* a permission, and it is
        // not enforced here: requireConsent refuses every gated router
        // independently, so a forged `false` buys a client nothing but an app
        // shell whose every request comes back CONSENT_REQUIRED.
        needsConsent: !consentIsCurrent(account),
        termsVersion: CURRENT_TERMS_VERSION,
        devTools: devToolsEnabledFor(session.googleSub),
        // Whether to offer the support triage view. A rendering hint like
        // devTools above: the admin endpoints re-check the allowlist, so
        // forging this reveals an empty page and nothing else.
        ...(isSupportAdmin(session.googleSub) ? { supportAdmin: true } : {}),
        // Only alongside devTools, because the toggle's label has to say what
        // is actually stored: with a real subscription behind it, a forced
        // `trial` and a cleared override can resolve to the same plan and are
        // otherwise indistinguishable in the menu.
        ...(billing && devToolsEnabledFor(session.googleSub)
          ? { planOverride: account.planOverride }
          : {}),
        // Whether a Stripe customer exists for this account, which decides
        // between offering "Upgrade" and "Manage billing". It is not the same
        // question as the plan: a lapsed account is `free` but still has a
        // customer, invoices, and a card worth managing.
        hasBilling: billing && account.stripeCustomerId !== null,
      });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Marks the first-run guide finished (Step 5a). It lives on the auth router
   * rather than getting a router of its own because the flag it writes is part
   * of the account state `/auth/me` already reports, and because that is where
   * the session-gate-then-CSRF pattern used below already lives.
   *
   * Session-gated and CSRF-checked like any other write, but deliberately
   * forgiving about what it writes: the store's markOnboarded is idempotent and
   * write-once, so a double submit, a retry, or re-opening the guide from the
   * account menu all leave the original timestamp alone.
   */
  router.post(
    '/onboarding/complete',
    (req, _res, next) => {
      loadSession(req, sessions)
        .then((session) => {
          if (!session) {
            next(new ApiError('UNAUTHORIZED', 'Not signed in.'));
            return;
          }
          next();
        })
        .catch(next);
    },
    requireCsrf,
    async (req, res, next) => {
      try {
        const session = await loadSession(req, sessions);
        if (!session) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
        await store.markOnboarded(session.googleSub);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  /**
   * Records acceptance of the terms and the data-responsibility acknowledgement
   * (Step 5c). On the auth router because it must remain reachable while
   * `requireConsent` is refusing everything else — a teacher who cannot reach
   * the endpoint that clears the gate is locked out of their own account.
   *
   * Both flags must be literally `true` and are required, not defaulted: an
   * omitted field is a client bug, and treating it as consent is the one
   * mistake this endpoint exists to prevent. The version is required too, and
   * must match the server's, so a stale cached client cannot record acceptance
   * of terms the teacher was never shown — that comes back as a validation
   * error, and the reload puts the current text in front of them.
   */
  const consentSchema = z
    .object({
      termsVersion: z.string().min(1).max(64),
      acceptedTerms: z.literal(true),
      acceptedDataResponsibility: z.literal(true),
    })
    .strict();

  router.post(
    '/consent',
    (req, _res, next) => {
      loadSession(req, sessions)
        .then((session) => {
          if (!session) {
            next(new ApiError('UNAUTHORIZED', 'Not signed in.'));
            return;
          }
          next();
        })
        .catch(next);
    },
    requireCsrf,
    async (req, res, next) => {
      try {
        const session = await loadSession(req, sessions);
        if (!session) throw new ApiError('UNAUTHORIZED', 'Not signed in.');
        const parsed = consentSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApiError('VALIDATION_ERROR', 'Both agreements must be accepted.');
        }
        if (parsed.data.termsVersion !== CURRENT_TERMS_VERSION) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'The agreements have changed. Reload the page and read them again.',
          );
        }
        await store.recordConsent(session.googleSub, CURRENT_TERMS_VERSION);

        // The welcome message (Step 6h). Queued here rather than in the OAuth
        // callback because this is the moment the account becomes usable: an
        // account that has not consented cannot reach a single tool, so
        // welcoming it would be premature.
        //
        // The age check is what keeps a *re-*consent quiet. This endpoint runs
        // again for every existing account whenever the terms version is
        // bumped, and without the check the next bump would welcome teachers
        // who have been using the app for a year. The queue's unique
        // constraint already covers anyone who has had a welcome, but not the
        // accounts that predate this table, and they are precisely the
        // population a version bump reaches.
        const account = await store.getByGoogleSub(session.googleSub);
        if (account && Date.now() - new Date(account.createdAt).getTime() < 24 * 60 * 60 * 1000) {
          await enqueueQuietly(lifecycle, {
            accountId: account.id,
            messageType: 'welcome',
            recipientEmail: account.email,
            recipientName: account.name,
          });
        }
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  // Logout revokes the session server-side and clears the cookie. The account
  // row persists (a teacher signing out is not deleting their account); account
  // removal is a separate, explicit action.
  router.post(
    '/logout',
    // Signing out when already signed out is a no-op, not an error, so the
    // session gate here is CSRF's prerequisite rather than an auth check.
    (req, res, next) => {
      loadSession(req, sessions)
        .then((session) => {
          if (!session) {
            clearSessionCookieOnResponse(res);
            res.status(204).end();
            return;
          }
          next();
        })
        .catch(next);
    },
    requireCsrf,
    async (req, res, next) => {
      try {
        const id = readSessionId(req);
        if (id) await sessions.destroy(id);
        clearSessionCookieOnResponse(res);
        res.status(204).end();
      } catch (e) {
        next(e);
      }
    },
  );

  /**
   * Signs the account out on every device (Phase 2 Step 6f).
   *
   * The scenario is not primarily a compromised account, it is a classroom
   * desktop. Sessions last 30 days absolute and 14 days idle, teachers sign in
   * on shared machines, and revoking the app in Google settings does nothing
   * about it: our sessions are opaque rows of our own, so ending them is
   * something only we can do.
   *
   * It ends the calling session too, and the cookie is cleared to match. "All
   * sessions except this one" would be a different feature, needing a list of
   * devices to choose from; this one is the panic button, and a panic button
   * that leaves one door open is the wrong shape.
   *
   * On the auth router, alongside logout, because it is the same operation with
   * a wider blast radius — and because that router is exempt from the consent
   * gate, which a teacher declining the terms needs it to be.
   */
  router.delete('/sessions', requireSession(sessions), requireCsrf, async (req, res, next) => {
    try {
      await sessions.destroyAllForUser(sessionOf(req).googleSub);
      clearSessionCookieOnResponse(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  /**
   * Deletes the account (Phase 2 Step 6f).
   *
   * Four steps, and the order is the design. Cancel the subscription, revoke
   * Google's grant, destroy the row, clear the cookie.
   *
   * **Stripe first, and a failure there stops everything.** An uncancelled
   * subscription outliving its account charges a card every month with nothing
   * left that could stop it: the portal is reached through a session that no
   * longer exists, for a customer nobody can look up. Every other step is
   * recoverable by comparison, so this is the one that runs while there is
   * still an account to refuse on behalf of.
   *
   * **Google's revocation is best-effort**, which is the opposite treatment and
   * for the opposite reason. Once our row is gone the token is inert to us; the
   * revocation is about tidying the teacher's own list of authorized apps, and
   * failing it is not worth trapping them in an account they asked to leave.
   *
   * **What this does not touch is the teacher's data.** The spreadsheet is in
   * their Drive and stays exactly where it is, which is the whole architecture
   * restated at its last possible moment. The confirmation dialog says so,
   * because a teacher who believes this destroys their class records will not
   * use it, and one who believes it and uses it anyway has lost their year.
   *
   * Sessions and support requests go with the row through ON DELETE CASCADE, so
   * the database side is a single statement.
   */
  router.delete('/account', requireSession(sessions), requireCsrf, async (req, res, next) => {
    try {
      const googleSub = sessionOf(req).googleSub;
      const account = await store.getByGoogleSub(googleSub);
      if (!account) throw new ApiError('UNAUTHORIZED', 'Not signed in.');

      if (account.stripeSubscriptionId) {
        try {
          await cancelSubscriptionNow(account.stripeSubscriptionId);
        } catch (err) {
          logger.error({ err: (err as Error).message }, 'Could not cancel subscription on delete');
          throw new ApiError(
            'INTERNAL_ERROR',
            'Your subscription could not be cancelled, so nothing was deleted. Cancel it from Manage billing and try again, or contact support.',
          );
        }
      }

      // Logged as a plain fact, not as an error: a false here is the ordinary
      // outcome for a token Google already considers dead.
      const revoked = await revokeRefreshToken(account.refreshToken);
      logger.info({ revoked }, 'Account deletion: Google authorisation revoked');

      // Explicit, even though ON DELETE CASCADE on sessions.google_sub would do
      // it. Leaving session revocation to a foreign key makes it a property of
      // the schema rather than of this endpoint, invisible at the call site and
      // absent from any store that is not Postgres. It costs one query.
      // Queued before the row is destroyed, and it outlives it (Step 6h). The
      // queue row carries its own copy of the address and holds no foreign key
      // to the account, precisely so this message can still be sent once there
      // is no account left to read a recipient from. Queued *before* the delete
      // rather than after so that a failure here is visible while there is
      // still something to look at; it never blocks the deletion either way.
      await enqueueQuietly(lifecycle, {
        accountId: account.id,
        messageType: 'account_deleted',
        recipientEmail: account.email,
        recipientName: account.name,
      });

      await sessions.destroyAllForUser(googleSub);
      await store.delete(googleSub);
      // Last, and after the row is gone: the working set is the only copy of
      // this teacher's student data still on the server, and dropping it before
      // the delete would leave a window where a request in flight could load it
      // back. Nothing can serve it once the account row is gone, so this is
      // about not holding it rather than about access — but "deleted" should
      // not quietly mean "deleted, and also still in memory for a while".
      dropAllForUser(googleSub);
      clearSessionCookieOnResponse(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}
