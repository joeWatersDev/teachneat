import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetRememberedTabs } from '../../hooks/useTabRoute';
import { EmailPage } from './EmailPage';
import * as emailApi from '../../api/email';
import * as studentsApi from '../../api/students';
import { clearRosterSnapshot } from '../students/rosterCache';
import { WithEntitlements } from '../../test/entitlements';
import type { SendStatus } from './types';

vi.mock('../../api/email');
vi.mock('../../api/students');

function renderPage(at = '/email') {
  return render(
    <WithEntitlements>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/email" element={<EmailPage />} />
          <Route path="/email/:tab" element={<EmailPage />} />
        </Routes>
      </MemoryRouter>
    </WithEntitlements>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  clearRosterSnapshot();
  resetRememberedTabs();
  vi.mocked(emailApi.listTemplates).mockResolvedValue([]);
  vi.mocked(emailApi.getRecipientMetrics).mockResolvedValue([]);
  vi.mocked(studentsApi.listStudents).mockResolvedValue([]);
  vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([]);
});

/**
 * The quota indicator shows the limit that binds. "188 remaining today" is true
 * of the daily cap and useless as guidance to a free account, since 30 a month
 * is what will actually stop them.
 */
describe('the email quota indicator', () => {
  it('shows the monthly allowance on free', async () => {
    const status: SendStatus = {
      sentToday: 4,
      dailyCap: 120,
      remaining: 18,
      plan: 'free',
      sentThisMonth: 12,
      monthlyCap: 30,
      remainingThisMonth: 18,
      monthlyResetsAt: '2026-08-01T00:00:00.000Z',
    };
    vi.mocked(emailApi.getSendStatus).mockResolvedValue(status);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('18 of 30 remaining this month')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/sent today/)).not.toBeInTheDocument();
  });

  it('shows the daily figure on a plan with no monthly cap', async () => {
    const status: SendStatus = { sentToday: 47, dailyCap: 120, remaining: 73, plan: 'paid' };
    vi.mocked(emailApi.getSendStatus).mockResolvedValue(status);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('47 / 120 sent today · 73 remaining')).toBeInTheDocument(),
    );
  });
});

/** Compose and Templates are URL-backed tabs, and the allowance belongs to Compose. */
describe('the email tabs', () => {
  beforeEach(() => {
    vi.mocked(emailApi.getSendStatus).mockResolvedValue({
      sentToday: 47,
      dailyCap: 120,
      remaining: 73,
      plan: 'paid',
    });
  });

  it('opens on Compose, with the allowance shown', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: 'Compose' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('47 / 120 sent today · 73 remaining')).toBeInTheDocument();
  });

  it('hides the allowance on Templates', async () => {
    renderPage();
    await screen.findByText('47 / 120 sent today · 73 remaining');
    await userEvent.click(screen.getByRole('link', { name: 'Templates' }));
    expect(screen.getByRole('link', { name: 'Templates' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText(/sent today/)).not.toBeInTheDocument();
  });
});
