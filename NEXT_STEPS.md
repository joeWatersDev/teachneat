# Teachneat — Next Steps

The direct next step to implement, the standing obligations no step owns, the most recently completed work,
and the open questions. This document is the authoritative record of what is finished and what is not.

**Where the project stands.** The project was sunset on 2026-10-18 (reasoning under Decisions Made in
[HISTORY.md](HISTORY.md)) and production was taken down on 2026-10-23: the app, the database, the Google Cloud
project and the private GitHub repository are all deleted. The steps that would have followed (**8c → 8e →
8f → 9 → 9a → 10**) are not scheduled, and everything below them is kept as the state a revival would start
from. Phase 1 is complete; Phase 2 is complete through Step 8, plus 8a, 8b and 8d.

**Step 8's sub-steps were renumbered on 2026-08-28** and the old numbers are not aliases: what was 8a is now
8c, what was 8b is now 8d, what was 8c is now 8a, and 8d and 8e became 8e and 8f. A new 8b was inserted.
Anything written before that date — commit messages, code comments, an earlier session — uses the old
numbering. The map and the reason are in [HISTORY.md](HISTORY.md) under Decisions Made; the reason in one
line is that the scope reduction decides what the product is, so it has to precede every step that describes
the product to somebody.

**The feature surface shrank deliberately, and IEP is not coming back.** A legal review of who may
authorise a third-party tool for student records concluded that the authority belongs to the school board in
every jurisdiction examined, that the vendor-facing statutes in New York, California and Texas attach
regardless of any district agreement, and that the teacher-facing warranty in the terms transfers nothing.
8a narrowed the launch to Ontario, free, and removed IEP permanently in response. **Billing is dormant
behind `BILLING_ENABLED` and restores by flipping it; IEP is deleted and does not.** Anything proposing an
accommodation field is proposing to reopen that decision. See IMPLEMENTATION_PLAN.md Step 8a.

## Maintaining this document

**Read this before editing anything below it.** This document reached 969 lines on 2026-08-27, of which
about 780 restated entries already sitting in [HISTORY.md](HISTORY.md). It got there one reasonable-looking
paragraph at a time, every one of them added by someone who had just finished a step and wanted the context
preserved. The context was already preserved. What follows is the procedure that prevents the next
recurrence, and it is a procedure rather than a principle because a principle is what failed.

**When a step completes, in this order:**

1. **Append** the full entry to the Work Log in [HISTORY.md](HISTORY.md). That is the only place completed
   work is described, and it is where all the detail goes. Be as long as the work deserves.
2. **Replace** the Most Recently Completed section below. Delete the previous entry outright; do not append
   beside it, do not keep "for context", do not leave a one-line pointer to it. It is in HISTORY.
3. **Rewrite** the Next Step section for the new next step. Do not keep the old one as background.
4. **Delete** every Standing Obligation and Open Question the step discharged. Delete the line. Do not
   annotate it "resolved", "done" or "closed" — a resolved item annotated in place is the exact mechanism
   that produced the 969 lines, because each annotation looked individually harmless.
5. **Route anything durable out of this document.** A standing *rule* goes to Security Practices in
   [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) or to whichever spec governs the thing it constrains. A
   fact about the sheet, the API, the interface, the test criteria or a dependency goes to
   [SHEETS_SCHEMA.md](SHEETS_SCHEMA.md), [API_CONTRACT.md](API_CONTRACT.md),
   [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [TESTING_PLAN.md](TESTING_PLAN.md) or
   [DEPENDENCIES.md](DEPENDENCIES.md). A settled question goes to Decisions Made in HISTORY. What a step
   *delivers* goes to IMPLEMENTATION_PLAN. If it does not fit any of those, it is probably history.
6. **Check the length.** This document has a working budget of **250 lines**, of which this maintenance
   section is about forty. Going over it is not forbidden, but it is a signal to be acted on rather than
   noted: open the document, find what is being retained that should have been deleted at step 4, and delete
   it. The budget exists because "keep it short" is not checkable and a number is.

**The test for any paragraph here: does it change what someone does next?** A statement about what is now
true and requires no action is history. A statement about what must still happen belongs here until it
happens, and then it goes too. "Step 6d is done and here is what it shipped" fails the test. "The TTL must
not be lengthened until push invalidation is proven" passes it, and will fail it the day that ships.

---

## Next Step

**None while the project is sunset.** The remaining shutdown tasks are administrative and tracked privately. A relaunch
would start from the archive bundle and would have to redo Google's OAuth verification, since the project
that held it is deleted.

---

## Standing Obligations

Live commitments that no completed step discharged. Each is a thing that must happen, not a thing that did.

**Standing items in 8c.**

- **GST/HST is the operator's obligation, not Stripe's**, because Stripe is a payment processor rather than
  a merchant-of-record service. Dormant since 8a: with no charge to a teacher there is no supply to tax, and
  the obligation returns in full the day a paid plan does. Kept here rather than deleted precisely because
  it is the kind of thing that gets reinstated silently.

**Open operational items, none owned by a step.**

- **Drive push invalidation is unbuilt, and the working-set TTL must not be lengthened until it is proven in
  production.** This was 6d's last pair and remains unscheduled. `files.watch` needs a publicly reachable
  HTTPS endpoint on a verified domain, which now exists, so the blocker is scheduling rather than capability.
  Channel renewal is the part that fails silently if written and never exercised.
- **No staging environment.** Defensible for a solo operation, but it should be a decision rather than an
  omission.
- **Neither legal document has been reviewed by a lawyer.** Booked as part of 8c.
- **A postal address for the operator** is owed in both documents, waiting on the PO box.
- **The business-name registration expires on 2026-10-09 plus five years, 2031-10-09.** Renewal can be filed
  from six months before, and needs the company key that was emailed to the official business address; a
  registration not renewed within sixty days of expiry has to be filed again under a new BIN. Any change to
  the registered address must be filed as an amendment within 15 days.
- **The three GitHub Actions are pinned to commit SHAs**, which converts silent auto-updating into deliberate
  maintenance. Left alone long enough they break on a runner change.
- **`TRUST_PROXY_HOPS` is `2`, measured and verified live, and nothing guards it.** No test asserts it and no
  alarm fires when it goes stale, because it is a fact about DigitalOcean's infrastructure rather than about
  this codebase. See Security Practices in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for how to
  re-derive it.

---

## Most Recently Completed

_Only the latest entry, for quick context. Full history, every step in order, is in
[HISTORY.md](HISTORY.md). When the next step completes, **replace** this section rather than appending to it._

### Sunset teardown

Production was taken down on 2026-10-23 after the exit poll closed, and each deletion was verified
afterwards. Full write-up in [HISTORY.md](HISTORY.md).

## Decisions Made

Settled questions, with the conclusion and the rationale, live in [HISTORY.md](HISTORY.md) under
"Decisions Made", as one record rather than two. Durable design facts also appear in the relevant spec.

---

## Open Questions

Genuinely open and non-blocking. Resolved questions are deleted from this list rather than annotated as
resolved; the reasoning goes to Decisions Made in [HISTORY.md](HISTORY.md).

- **Sidebar icon for the Students page.** `Users` (Lucide) is the current pick. Swappable with a one-line
  change.
- **Email tool sidebar position.** Currently last. Can be reordered if automated attendance communications
  become a primary workflow.
- **What replaces the free-tier-to-trial acquisition story** when billing returns. 6i's founding-user promo
  was built against the old shape and needs rethinking rather than reusing.
- **What accounts created during the free year get on the day billing returns.** `accountStore` still writes
  `trial_ends_at` at signup, so every one of them will carry a long-expired trial and resolve straight to
  `free` the moment `BILLING_ENABLED` is set. Left alone deliberately — it is a decision for the step that
  restores billing, not one to guess at now — but it is a decision, and it will not announce itself.
- **Whether `MAX_RECIPIENTS_PER_SEND` should follow the daily cap down.** It is 200 against a cap of 120, so
  a maximal request can no longer complete in one day; it fills the allowance and skips the rest with a
  reason. That is the cap working rather than a defect, and it is listed here so the mismatch is a choice.
- **Whether any of the early-access metrics work lands before Step 10 rather than in Phase 3.**
  `requirePremium` returns early while `BILLING_ENABLED` is false, so `first_premium_attempt_at` stays
  null for every account created in the free year, and no per-feature use is counted at all.
  Instrumentation added after the first cohort arrives does not backfill, so the subset worth having
  before launch is a decision with a deadline rather than an open-ended one. Scope and the decisions
  already taken are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) under Phase 3.
- **Phase 3: the MAU threshold** that triggers the start of resource-sharing development.
- **Phase 3: the definition of "high quality"** for a contribution. Peer review, admin review, usage metrics,
  or some combination.
