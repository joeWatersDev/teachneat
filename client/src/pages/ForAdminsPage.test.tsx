import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../hooks/useTheme';
import { MarketingLayout } from '../layouts/MarketingLayout';
import { ForAdminsPage } from './ForAdminsPage';
import * as appInfoApi from '../api/appInfo';

vi.mock('../api/appInfo');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.send',
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <MarketingLayout>
          <ForAdminsPage />
        </MarketingLayout>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(appInfoApi.getAppInfo).mockResolvedValue({
    appName: 'Teachneat',
    oauthClientId: '1234-abc.apps.googleusercontent.com',
    scopes: SCOPES,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the administrator page', () => {
  it('renders with no session at all', () => {
    // Its whole reason to exist: the reader is the administrator of a teacher
    // who could not sign in, and may have no account here themselves.
    expect(() => renderPage()).not.toThrow();
  });

  it('shows the client ID an administrator has to paste', async () => {
    renderPage();
    expect(await screen.findByText('1234-abc.apps.googleusercontent.com')).toBeInTheDocument();
  });

  it('names the Admin console setting rather than saying "allowlist it"', async () => {
    renderPage();
    expect(screen.getByText(/Manage third-party app access/i)).toBeInTheDocument();
  });

  /**
   * The page explains the scopes the server actually requests. If a scope were
   * added to the sign-in flow, the endpoint would serve it and this page would
   * render it with no description — which is why the descriptions are keyed off
   * the scope string rather than hardcoded as a list of three.
   */
  it('describes each sensitive scope the server reports', async () => {
    renderPage();
    for (const label of [/files created by this app/i, /send only/i]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it('states that no restricted access is requested', async () => {
    renderPage();
    expect(await screen.findByText(/cannot read the teacher’s mailbox/i)).toBeInTheDocument();
  });

  // Not a procurement document: the board is a gatekeeper, not the buyer, so
  // the page must not imply there is a purchase to approve.
  it('offers a DPA on request without publishing contract terms', async () => {
    renderPage();
    expect(screen.getByText(/available on request/i)).toBeInTheDocument();
    expect(screen.getByText(/accounts belong to\s+individual teachers/i)).toBeInTheDocument();
  });

  it('falls back to a contact route when the deployment has no client ID', async () => {
    vi.mocked(appInfoApi.getAppInfo).mockResolvedValue({
      appName: 'Teachneat',
      oauthClientId: '',
      scopes: SCOPES,
    });
    renderPage();
    expect(await screen.findByRole('link', { name: /ask us for it/i })).toBeInTheDocument();
  });

  // A failed fetch must not take the prose down with it: everything an admin
  // needs to make the decision, as opposed to execute it, is static.
  it('still explains the data handling when the info call fails', async () => {
    vi.mocked(appInfoApi.getAppInfo).mockRejectedValue(new Error('offline'));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/never written to our database/i)).toBeInTheDocument(),
    );
  });

  it('tells an administrator that no payment processor is involved', async () => {
    // A subprocessor answer, which is a question a board's privacy review asks
    // in its own right. It stayed when the rest of the cost copy was gated.
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/never written to our database/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/no payment processor is involved/i)).toBeInTheDocument();
  });

  it('is reachable from the marketing footer', () => {
    renderPage();
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer).getByRole('link', { name: /for school administrators/i }),
    ).toHaveAttribute('href', '/for-admins');
  });
});
