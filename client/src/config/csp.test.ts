import { describe, it, expect } from 'vitest';
import { CONTENT_SECURITY_POLICY, cspMetaTag } from './csp';

/**
 * The policy is defence in depth, so what these assert is mostly that it has not
 * been quietly loosened. A CSP degrades silently: adding `'unsafe-inline'` to
 * script-src to make one stubborn thing work costs nothing visible and removes
 * most of the value, and nothing else in the build would notice.
 */
describe('content security policy', () => {
  const directive = (name: string): string =>
    CONTENT_SECURITY_POLICY.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('does not permit inline or eval script, which is the point of having it', () => {
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  });

  it('permits no origin to be fetched from that is not our own', () => {
    expect(directive('connect-src')).toBe("connect-src 'self'");
    expect(directive('default-src')).toBe("default-src 'self'");
  });

  it('allows the Google avatar host as a wildcard, since the subdomain varies', () => {
    expect(directive('img-src')).toContain('https://*.googleusercontent.com');
  });

  it('does not open images to any https host', () => {
    expect(directive('img-src')).not.toMatch(/\bhttps:(?!\/\/)/);
  });

  it('loads no external fonts, matching the system-stack rule', () => {
    expect(directive('font-src')).toBe("font-src 'self'");
  });

  it('forbids plugins and restricts base and form targets', () => {
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'self'");
    expect(directive('form-action')).toBe("form-action 'self'");
  });

  /**
   * Not an oversight. `frame-ancestors` is ignored in a meta-delivered policy,
   * so including it would read as protection that is not there. The document's
   * anti-framing defence is SameSite=Lax on the session cookie; the real header
   * needs the SPA served from Express.
   */
  it('does not pretend to set frame-ancestors, which meta cannot deliver', () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain('frame-ancestors');
  });

  it('renders a well-formed meta tag with a quotable content attribute', () => {
    const tag = cspMetaTag();
    expect(tag).toContain('http-equiv="Content-Security-Policy"');
    // A double quote in the policy would terminate the attribute early and
    // silently truncate everything after it.
    expect(CONTENT_SECURITY_POLICY).not.toContain('"');
  });
});
