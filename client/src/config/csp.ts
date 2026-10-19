/**
 * The Content Security Policy for the app document.
 *
 * Why this exists at all: Helmet sets a good CSP, and it only ever reaches
 * `/api` responses. The SPA is served by App Platform's static component out of
 * object storage, so Express never sees the request for `index.html` and the
 * page that actually runs the JavaScript has historically carried no policy.
 * App Platform cannot add one either — a `headers` block on an ingress rule is
 * rejected by the spec schema outright — so the policy ships inside the document.
 *
 * It is defence in depth, not the primary control. The primary controls are that
 * the project bans `dangerouslySetInnerHTML`, sanitises rich text server-side,
 * and renders the email preview into a fully sandboxed iframe. This is what
 * limits the damage on the day one of those has a hole, and in an app whose DOM
 * holds rosters, notes and guardian addresses, the difference between a
 * script running and a script running *and being able to phone home* is the
 * difference between a bug and a disclosure.
 *
 * Two limits of delivering it by `<meta>` rather than by header, both accepted
 * knowingly:
 *
 *  - **`frame-ancestors` cannot be set this way** and is ignored in a meta
 *    policy, so the document's clickjacking defence is not here. What stands in
 *    its place is `SameSite=Lax` on the session cookie: a cross-site frame gets
 *    no cookie, so the app renders signed out, and UI-redress against an
 *    authenticated victim does not work. Getting the real header needs the SPA
 *    served from Express, which is a deployment change rather than this one.
 *  - `report-uri` / `report-to` are likewise unavailable, so violations are
 *    visible in a browser console and nowhere else. Wiring up reporting would
 *    mean an endpoint that accepts unauthenticated POSTs, which this app has
 *    exactly one of and did not want a second.
 */

/**
 * `'unsafe-inline'` on styles only, and deliberately.
 *
 * It is not needed for React's `style={{…}}` prop, which sets properties through
 * CSSOM and is outside CSP's remit. It is here because a stylesheet-level
 * guarantee is not worth the breakage risk from a dependency that injects a
 * `<style>` tag or sets a style attribute, and because style injection is a far
 * weaker primitive than script injection. Note that Helmet's *default* policy is
 * looser still (`'self' https: 'unsafe-inline'`); the `https:` is dropped here.
 */
const DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // No 'unsafe-inline' and no 'unsafe-eval'. The build emits module scripts from
  // our own origin and nothing else, which is what makes this affordable.
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  /**
   * The account avatar in the top bar comes from Google's `picture` claim,
   * which the server passes through verbatim. The host is *not* fixed: Google
   * has served profile images from lh3 through lh6 and from other
   * googleusercontent subdomains, and a Workspace account is not guaranteed to
   * match a consumer one. Pinning `lh3` would leave a broken avatar for some
   * accounts and no obvious reason why, so the wildcard covers the subdomain
   * while still naming one Google-controlled host.
   *
   * Widening this costs nothing an attacker can use. Exfiltrating through an
   * image URL requires a host whose logs you can read, and this is not one.
   *
   * `data:` covers inline SVG and the icons the build inlines.
   */
  'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com'],
  // The system font stack only (DESIGN_SYSTEM.md: no custom font loading), so
  // nothing external is ever fetched.
  'font-src': ["'self'"],
  // The API is same-origin by design — one App Platform app, two components —
  // which is also what makes the session cookie first-party. Nothing else is
  // fetched: Stripe Checkout is a top-level navigation, not an XHR.
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  // The email preview is an `<iframe srcdoc>` with `sandbox=""`. A srcdoc frame
  // inherits the parent policy rather than being matched against frame-src, and
  // with no `allow-scripts` nothing in it can execute regardless.
  'frame-src': ["'self'"],
  'upgrade-insecure-requests': [],
};

/** The policy as it appears in the document. */
export const CONTENT_SECURITY_POLICY: string = Object.entries(DIRECTIVES)
  .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name))
  .join('; ');

/** The meta tag injected into the built `index.html`. */
export function cspMetaTag(): string {
  return `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`;
}
