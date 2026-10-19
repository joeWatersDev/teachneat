import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { getAppInfo, type AppInfo } from '../api/appInfo';

/**
 * The page a blocked teacher forwards to their IT department (Phase 2 Step 5a).
 *
 * Its reader is a Workspace administrator making a five-minute decision about
 * one app for one teacher who has already asked for it. That is a narrower
 * reader than the privacy page's, and the difference shapes everything here:
 * the instruction comes first and the reassurance second, because an admin who
 * has decided still needs the console path, and an admin who has not will scroll.
 *
 * It is deliberately not a procurement document. This product is sold to
 * individual teachers, not to boards — the board is a gatekeeper, not a buyer —
 * so there is no contract to review, no purchase to approve and no budget line.
 * A signable DPA is offered on request rather than published, because writing
 * contract terms means fixing the operating entity, jurisdiction and retention
 * commitments, which is a decision the project has deliberately not made yet.
 *
 * Public and outside AuthProvider, like the rest of the marketing surface, for a
 * reason specific to this page: the admin reading it is not the teacher who was
 * blocked, has no account, and may well arrive from a pasted link. A page about
 * being unable to sign in must not itself require signing in.
 */

const SCOPE_REASONS: { match: string; label: string; reason: string }[] = [
  {
    match: 'drive.file',
    label: 'Drive — files created by this app',
    reason:
      'The app stores all class data in one spreadsheet on the teacher’s own Drive. This permission lets it create that spreadsheet on first use, reopen it, and read and write it. It is the per-file variant, so the app can see only the files it made and nothing else in the teacher’s Drive, and it does not request the broader Google Sheets permission.',
  },
  {
    match: 'gmail.send',
    label: 'Gmail — send only',
    reason:
      'Class emails go out from the teacher’s own address, so replies come back to them. Send-only: the app cannot read, search or delete anything in the mailbox.',
  },
];

function describeScope(scope: string) {
  return SCOPE_REASONS.find((s) => scope.includes(s.match));
}

export function ForAdminsPage() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // A failure here leaves the client id unrendered and the rest of the page
    // intact. The prose is the part that does not depend on the server.
    getAppInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const clientId = info?.oauthClientId ?? '';
  const grantedScopes = info?.scopes ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
      <h1 className="text-display-md font-semibold text-balance text-primary">
        Information for Google Workspace administrators
      </h1>
      <p className="mt-4 text-md leading-relaxed text-secondary">
        A teacher on your domain has asked to use Teachneat and cannot, because third-party app
        access is restricted.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-primary">Allowlisting the app</h2>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          In the Google Admin console, go to Security → Access and data control → API controls →
          Manage third-party app access, choose Add app → OAuth App Name Or Client ID, and enter the
          client ID below. Set access to Trusted, and scope the change to the organizational unit
          the teacher belongs to rather than the whole domain if you prefer.
        </p>

        <div className="mt-4 rounded-lg border border-subtle bg-elevated p-4">
          <p className="text-xs text-secondary">OAuth client ID</p>
          {clientId ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code className="break-all font-mono text-sm text-primary">{clientId}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(clientId).then(() => setCopied(true));
                }}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-subtle px-3 text-xs text-primary hover:bg-hover"
              >
                {copied ? (
                  <Check size={14} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Copy size={14} strokeWidth={2} aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-secondary">
              Not available on this deployment.{' '}
              <Link to="/contact" className="text-primary underline hover:no-underline">
                Ask us for it
              </Link>{' '}
              and we will send it.
            </p>
          )}
          <p className="mt-3 text-xs text-secondary">App name: {info?.appName ?? 'Teachneat'}</p>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-secondary">
          Nothing is installed domain-wide and no administrative access is requested. Each teacher
          signs in and grants consent for their own account; allowlisting only removes the block on
          them being able to.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-primary">What the app asks for, and why</h2>
        <dl className="mt-4 flex flex-col">
          {grantedScopes
            .map((scope) => ({ scope, detail: describeScope(scope) }))
            .filter((s) => s.detail)
            .map(({ scope, detail }) => (
              <div key={scope} className="flex flex-col gap-1.5 border-t border-subtle py-4">
                <dt className="font-semibold text-primary">{detail?.label}</dt>
                <dd className="m-0 flex flex-col gap-1.5">
                  <code className="break-all font-mono text-xs text-secondary">{scope}</code>
                  <span className="text-sm leading-relaxed text-secondary">{detail?.reason}</span>
                </dd>
              </div>
            ))}
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-secondary">
          Sign-in also uses the standard identity permissions (name, email address and profile
          picture). The app requests no restricted scopes: it cannot read the teacher’s mailbox, it
          cannot see the rest of their Drive, and it has no access to any other account on your
          domain.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-primary">Where student data is stored</h2>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          In a Google Sheet on the teacher’s own Drive, inside your domain.
        </p>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed text-secondary">
          <li>
            Student names, contact details, attendance records and a teacher’s own notes are
            written only to that spreadsheet. They are never written to our database.
          </li>
          <li>
            Our database holds account information only: the Google account identity, the
            teacher’s own name and email, which spreadsheet is theirs, their Workspace domain, an
            encrypted refresh token, sign-in sessions, a consent record, usage counts and any support
            requests the teacher sends. The privacy policy lists it in full.
          </li>
          <li>
            Student data is not written to our application logs. It passes through the server in
            memory while a request is served, because the server is what calls the Google APIs, and
            is not retained afterwards.
          </li>
          <li>
            The file stays yours. If the teacher leaves, the spreadsheet is handled by your existing
            offboarding process along with the rest of their Drive, and revoking the app’s access in
            the Admin console or in their account stops it immediately.
          </li>
          {/* Kept when the rest of the cost copy was gated, at the user's
              instruction, and this is the reader it matters most to: "no
              payment processor is involved" is a subprocessor answer, which is
              a question a board's privacy review asks in its own right. */}
          <li>
            The service is free during early access. No payment is taken, no payment details are
            collected, and no payment processor is involved. If that changes, billing would be
            between us and the individual teacher, never the board.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-primary">If you need something in writing</h2>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          A data processing agreement is available on request. Teachneat accounts belong to
          individual teachers rather than to boards, so there is nothing for your finance or
          procurement process to approve, but we are happy to sign an agreement if your privacy
          policy requires one before an app touching student data can be allowlisted.{' '}
          <Link to="/contact" className="text-primary underline hover:no-underline">
            Get in touch
          </Link>{' '}
          and tell us what your board needs.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          See also the{' '}
          <Link to="/privacy" className="text-primary underline hover:no-underline">
            privacy policy
          </Link>{' '}
          and{' '}
          <Link to="/terms" className="text-primary underline hover:no-underline">
            terms of service
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
