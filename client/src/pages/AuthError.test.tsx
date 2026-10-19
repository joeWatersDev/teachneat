import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthError } from './AuthError';

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/error${query}`]}>
      <AuthError />
    </MemoryRouter>,
  );
}

describe('AuthError', () => {
  it('shows the VALIDATION_ERROR message when code=VALIDATION_ERROR', () => {
    renderAt('?code=VALIDATION_ERROR');
    expect(
      screen.getByText(/sign-in could not be completed/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Error code: VALIDATION_ERROR/)).toBeInTheDocument();
  });

  it('falls back to INTERNAL_ERROR for unknown codes', () => {
    renderAt('?code=BANANA');
    expect(screen.getByText(/Error code: BANANA/)).toBeInTheDocument();
    expect(screen.getByText(/Sign-in failed unexpectedly/i)).toBeInTheDocument();
  });

  it('exposes a try-again link to the sign-in URL', () => {
    renderAt('');
    const link = screen.getByRole('link', { name: /try again/i });
    expect(link.getAttribute('href')).toBe('/api/auth/google');
  });

  describe('a domain that blocks the app', () => {
    // The point of the whole branch: retrying is the one thing that cannot
    // work, so offering it would be the screen's worst possible advice.
    it('offers no retry', () => {
      renderAt('?code=ADMIN_POLICY_BLOCKED');
      expect(screen.queryByRole('link', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('points at the page written for the administrator', () => {
      renderAt('?code=ADMIN_POLICY_BLOCKED');
      const link = screen.getByRole('link', { name: /information for administrators/i });
      expect(link.getAttribute('href')).toBe('/for-admins');
    });

    it('says the block is on the school side rather than blaming the request', () => {
      renderAt('?code=ADMIN_POLICY_BLOCKED');
      expect(screen.getByText(/restricts which third-party apps/i)).toBeInTheDocument();
      expect(screen.queryByText(/missing or invalid information/i)).not.toBeInTheDocument();
    });
  });

  it('tells a teacher who unticked a permission to leave both ticked, and offers a retry', () => {
    renderAt('?code=SCOPES_MISSING');
    expect(screen.getByText(/leave both boxes ticked/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/Sign-in failed unexpectedly/i)).not.toBeInTheDocument();
  });

  it('treats a cancelled consent as retryable and does not mention administrators', () => {
    renderAt('?code=CONSENT_DECLINED');
    expect(screen.getByRole('link', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText(/no account was created/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /information for administrators/i }),
    ).not.toBeInTheDocument();
  });
});
