import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SupportPage } from './SupportPage';
import * as supportApi from '../../api/support';

vi.mock('../../api/support', () => ({
  createSupportRequest: vi.fn(),
  listMySupportRequests: vi.fn(),
}));

const createSupportRequest = vi.mocked(supportApi.createSupportRequest);
const listMySupportRequests = vi.mocked(supportApi.listMySupportRequests);

const existing: supportApi.SupportRequest = {
  id: 'req-1',
  googleSub: 'sub-1',
  category: 'bug',
  subject: 'Attendance will not save',
  message: 'It spins forever.',
  status: 'open',
  adminNote: '',
  planAtSubmit: 'free',
  createdAt: '2026-07-01T12:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  listMySupportRequests.mockResolvedValue({ requests: [], truncated: false });
});

describe('SupportPage', () => {
  it('asks only for what the account cannot supply', async () => {
    render(<SupportPage />);
    // No name or email field: the server takes both from the session.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('What is this about?')).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject/)).toBeInTheDocument();
    expect(screen.getByLabelText('Details')).toBeInTheDocument();
  });

  // The one place a teacher could put student data into our database, so the
  // form has to say not to rather than assume they know.
  it('warns against including student information', () => {
    render(<SupportPage />);
    expect(screen.getByText(/do not include student names/i)).toBeInTheDocument();
  });

  it('will not submit an empty subject or message', async () => {
    render(<SupportPage />);
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Subject/), 'Hello');
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Details'), 'Details here');
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  });

  it('sends the request, clears the form, and reloads the list', async () => {
    createSupportRequest.mockResolvedValue(existing);
    render(<SupportPage />);
    await userEvent.type(screen.getByLabelText(/Subject/), 'Attendance will not save');
    await userEvent.type(screen.getByLabelText('Details'), 'It spins forever.');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() =>
      expect(createSupportRequest).toHaveBeenCalledWith({
        category: 'question',
        subject: 'Attendance will not save',
        message: 'It spins forever.',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/has been sent/i);
    expect(screen.getByLabelText(/Subject/)).toHaveValue('');
    // Once on mount, once after a successful send.
    expect(listMySupportRequests).toHaveBeenCalledTimes(2);
  });

  it('keeps what was typed when the send fails', async () => {
    createSupportRequest.mockRejectedValue({ code: 'INTERNAL_ERROR', status: 500, message: 'Nope' });
    render(<SupportPage />);
    await userEvent.type(screen.getByLabelText(/Subject/), 'Keep me');
    await userEvent.type(screen.getByLabelText('Details'), 'And me');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(screen.getByLabelText(/Subject/)).toHaveValue('Keep me');
  });

  // A capped list that looks complete is worse than one that says it is capped.
  it('says so when the list was cut short', async () => {
    listMySupportRequests.mockResolvedValue({ requests: [existing], truncated: true });
    render(<SupportPage />);
    expect(await screen.findByText(/most recent requests only/i)).toBeInTheDocument();
  });

  // A form that swallows a message and says "thanks" is indistinguishable from
  // one that dropped it, so past requests and their status are shown.
  it('lists past requests with their status', async () => {
    listMySupportRequests.mockResolvedValue({ requests: [existing], truncated: false });
    render(<SupportPage />);
    expect(await screen.findByText('Attendance will not save')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
  });
});
