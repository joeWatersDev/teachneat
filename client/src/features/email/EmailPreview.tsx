interface EmailPreviewProps {
  subject: string;
  bodyHtml: string;
}

/**
 * Renders the email body in a sandboxed iframe via `srcDoc`. This avoids
 * `dangerouslySetInnerHTML` (banned project-wide) and isolates the markup: the
 * empty `sandbox` disables scripts, forms, and same-origin access, so even
 * unexpected HTML can only render as inert content.
 */
export function EmailPreview({ subject, bodyHtml }: EmailPreviewProps) {
  const doc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;' +
    'font-size:14px;line-height:20px;color:#202124;background:#ffffff;margin:12px;}' +
    'a{color:#1a73e8;}ul{padding-left:1.5rem;}ol{padding-left:1.5rem;}' +
    '</style></head><body>' +
    bodyHtml +
    '</body></html>';

  return (
    <div className="overflow-hidden rounded-md border border-subtle">
      <div className="border-b border-subtle bg-elevated px-3 py-2">
        <p className="text-xs text-secondary">Subject</p>
        <p className="text-base text-primary">
          {subject || <span className="text-secondary">(no subject)</span>}
        </p>
      </div>
      <iframe
        title="Email preview"
        sandbox=""
        srcDoc={doc}
        className="h-64 w-full bg-white"
      />
    </div>
  );
}
