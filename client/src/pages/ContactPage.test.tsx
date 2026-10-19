import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ContactPage } from './ContactPage';
import * as supportApi from '../api/support';

/**
 * `delay: null` rather than the default.
 *
 * userEvent waits a macrotask between keystrokes by default, and this file
 * types about ninety characters across four controlled inputs, each one a React
 * re-render. That is comfortably inside the 5s default timeout on an idle
 * machine and not on a busy one, which made these three tests fail roughly one
 * run in seven -- always together, always when the server suite was running
 * beside them. A test that fails on machine load rather than on behaviour is
 * worse than no test on a repo where a red CI run blocks a production deploy.
 */
function setupUser() {
  return userEvent.setup({ delay: null });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ContactPage />
    </MemoryRouter>,
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/your name/i), 'A Teacher');
  await user.type(screen.getByLabelText(/your email address/i), 'teacher@board.example');
  await user.type(screen.getByLabelText(/subject/i), 'Board has blocked the app');
  await user.type(screen.getByLabelText(/^message$/i), 'Who do I send the privacy summary to?');
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('ContactPage', () => {
  it('cannot be submitted until every required field has content', async () => {
    const user = setupUser();
    renderPage();
    const submit = screen.getByRole('button', { name: /send message/i });
    expect(submit).toBeDisabled();

    await fillRequiredFields(user);
    expect(submit).toBeEnabled();
  });

  it('sends what the visitor typed and confirms it landed', async () => {
    const send = vi.spyOn(supportApi, 'sendPublicContact').mockResolvedValue(undefined);
    const user = setupUser();
    renderPage();
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({
      name: 'A Teacher',
      email: 'teacher@board.example',
      category: 'question',
      subject: 'Board has blocked the app',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/has been sent/i);
  });

  it('keeps the honeypot out of the tab order and unannounced', () => {
    renderPage();
    const honeypot = screen.getByLabelText(/leave this field empty/i, { selector: 'input' });
    expect(honeypot).toHaveAttribute('tabindex', '-1');
    // aria-hidden on the wrapper is what keeps a screen reader from reaching a
    // field that only exists to catch automated fillers.
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('surfaces the rate-limit message rather than a generic failure', async () => {
    vi.spyOn(supportApi, 'sendPublicContact').mockRejectedValue({
      code: 'RATE_LIMITED',
      message: 'Too many messages from this connection. Please try again later.',
      status: 429,
    });
    const user = setupUser();
    renderPage();
    await fillRequiredFields(user);
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many messages/i);
  });

  it('tells a visitor not to include student information', () => {
    renderPage();
    expect(screen.getByText(/do not include student names/i)).toBeInTheDocument();
  });

  it('points a signed-in teacher at the in-app form instead', () => {
    // Named, not linked. The page is reachable only with a session, so the link
    // would 404 for most of the people reading this page.
    renderPage();
    expect(screen.getByText(/help and support page inside the app/i)).toBeInTheDocument();
  });
});
