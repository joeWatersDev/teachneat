/**
 * Whether the public surface may talk about what the product costs.
 *
 * Phase 2 Step 8a switched billing off behind the server's `BILLING_ENABLED`
 * and left the marketing copy describing the result: free during early access,
 * no paid plan, no card, every feature included. That copy is accurate and it
 * is still an answer to a question nobody is being asked yet, so this flag hides
 * the whole subject instead — the pricing page and its route, the nav and footer
 * entries that reach it, the cost question in the FAQ, the payment bullet for
 * board administrators, and the cost points on the landing page.
 *
 * Nothing was deleted. Restoring the subject means setting this to `true`,
 * setting `BILLING_ENABLED` on the server, and rewriting the copy the flag
 * guards for whatever the plan actually is at that point: what it currently
 * says is "there is no paid plan", which is the wrong answer once there is one.
 *
 * A build-time constant rather than a value from the server, because the pages
 * it guards render outside `AuthProvider` and deliberately cost no `/auth/me`
 * round trip (`MarketingLayout`). The legal documents are not gated: the privacy
 * policy and the terms describe the plan and billing fields our database holds
 * and the price provisions that apply, which is disclosure rather than pitch,
 * and a reader is worse served by its absence.
 */
export const PUBLIC_BILLING_VISIBLE = false;
