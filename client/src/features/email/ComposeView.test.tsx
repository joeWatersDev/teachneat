import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as baseRender, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ComposeView } from './ComposeView';
import * as studentsApi from '../../api/students';
import * as emailApi from '../../api/email';
import { clearRosterSnapshot } from '../students/rosterCache';
import { WithEntitlements } from '../../test/entitlements';
import type { Student } from '../students/types';
import type { EmailTemplate, RecipientMetric, SendStatus } from './types';

vi.mock('../../api/students');
vi.mock('../../api/email');

/** Every render goes through the entitlements context the view now reads. */
function render(ui: React.ReactElement): RenderResult {
  return baseRender(<WithEntitlements>{ui}</WithEntitlements>);
}

function student(over: Partial<Student>): Student {
  return {
    id: 'id1',
    firstName: 'Alex',
    lastName: 'Rivera',
    goesBy: null,
    pronouns: null,
    courses: ['Period 1'],
    atRiskCourses: [],
    studentEmail: null,
    parentEmails: [],
    notes: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

/** A row of the email tool's own (ungated) per-recipient attendance figures. */
function metric(over: Partial<RecipientMetric>): RecipientMetric {
  return {
    studentId: 'a',
    course: 'Period 1',
    lateCount: 0,
    unexcusedAbsences: 0,
    daysRecorded: 0,
    highAbsence: false,
    ...over,
  };
}

const TEMPLATE: EmailTemplate = {
  id: 't1',
  name: 'Absence notice',
  subject: 'About {{firstName}}',
  bodyHtml: '<p>Hi {{firstName}}</p>',
  placeholdersUsed: ['firstName'],
  createdAt: '',
  updatedAt: '',
};

const STATUS: SendStatus = { sentToday: 0, dailyCap: 120, remaining: 120 };

/** ComposeView needs a router context: student names link to `/students/:studentId`. */
function renderCompose(onSent = vi.fn()) {
  return render(
    <MemoryRouter>
      <ComposeView templates={[TEMPLATE]} sendStatus={STATUS} onSent={onSent} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  clearRosterSnapshot();
  vi.mocked(studentsApi.getRiskSummary).mockResolvedValue([]);
  vi.mocked(emailApi.getRecipientMetrics).mockResolvedValue([]);
});

describe('ComposeView', () => {
  it('shows a student-email and a single guardian checkbox per row, blank where absent', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({
        id: 'a',
        studentEmail: 'alex@e.test',
        parentEmails: ['mom@e.test', 'dad@e.test'],
      }),
      student({ id: 'b', firstName: 'Sam', lastName: 'Lee', parentEmails: [] }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }),
    ).toBeInTheDocument();
    // One guardian checkbox even though there are two guardian emails, each shown on its own line.
    expect(
      screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('mom@e.test')).toBeInTheDocument();
    expect(screen.getByText('dad@e.test')).toBeInTheDocument();
    // Sam has no addresses: no checkboxes for that row.
    expect(
      screen.queryByRole('checkbox', { name: /Sam Lee/ }),
    ).not.toBeInTheDocument();
  });

  it('links a recipient name to their student detail view', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', studentEmail: 'alex@e.test' }),
    ]);
    render(
      <MemoryRouter initialEntries={['/email']}>
        <Routes>
          <Route path="/email" element={<ComposeView templates={[TEMPLATE]} sendStatus={STATUS} onSent={vi.fn()} />} />
          <Route path="/students/:studentId" element={<p>Student detail for a</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Alex Rivera' }));
    expect(screen.getByText('Student detail for a')).toBeInTheDocument();
  });

  it('lists a multi-course student once per course', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', courses: ['Period 1', 'Period 4'], parentEmails: ['mom@e.test'] }),
    ]);
    renderCompose();
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 4' }),
    ).toBeInTheDocument();
  });

  it('All Guardians checks only rows that have a guardian email', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', studentEmail: 'alex@e.test', parentEmails: ['mom@e.test'] }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Select all guardians' }));
    expect(
      screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }),
    ).not.toBeChecked();
    // One guardian row selected; the guardian entry has a single email.
    expect(screen.getByText('1 email(s) to send')).toBeInTheDocument();
  });

  it('All Students checks the student-email column', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', studentEmail: 'alex@e.test', parentEmails: ['mom@e.test'] }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Select all students' }));
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }),
    ).toBeChecked();
  });

  it('High absences selects both the student and guardian emails for flagged rows', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', studentEmail: 'alex@e.test', parentEmails: ['mom@e.test'] }),
      student({
        id: 'b',
        firstName: 'Sam',
        lastName: 'Lee',
        studentEmail: 'sam@e.test',
        parentEmails: ['dad@e.test'],
      }),
    ]);
    // highAbsence is decided server-side with the account's effective
    // threshold; the view selects on the flag rather than re-deriving it.
    vi.mocked(emailApi.getRecipientMetrics).mockResolvedValue([
      metric({ studentId: 'a', unexcusedAbsences: 6, daysRecorded: 20, highAbsence: true }),
      metric({ studentId: 'b', unexcusedAbsences: 1, daysRecorded: 20, highAbsence: false }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'High absences' })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: 'High absences' }));
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }),
    ).toBeChecked();
    // Sam is under threshold and is not selected.
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Sam Lee in Period 1' }),
    ).not.toBeChecked();
  });

  it('At risk selects both the student and guardian emails for at-risk rows', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({
        id: 'a',
        studentEmail: 'alex@e.test',
        parentEmails: ['mom@e.test'],
        atRiskCourses: ['Period 1'],
      }),
      student({
        id: 'b',
        firstName: 'Sam',
        lastName: 'Lee',
        studentEmail: 'sam@e.test',
        parentEmails: ['dad@e.test'],
        atRiskCourses: [],
      }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'At risk' }));
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }),
    ).toBeChecked();
    // Sam is not flagged at risk and is not selected.
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Sam Lee in Period 1' }),
    ).not.toBeChecked();
  });

  it('At risk flags only the course the student is at risk in', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({
        id: 'a',
        studentEmail: 'alex@e.test',
        courses: ['Period 1', 'Period 4'],
        atRiskCourses: ['Period 4'],
      }),
    ]);
    renderCompose();
    // A two-course student appears once per course row, so wait on a specific row.
    await screen.findByRole('checkbox', { name: 'Student email for Alex Rivera in Period 4' });

    await user.click(screen.getByRole('button', { name: 'At risk' }));
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 4' }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }),
    ).not.toBeChecked();
  });

  it('keeps the preview dropdown present with placeholder text before any selection', async () => {
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', parentEmails: ['mom@e.test'] }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    const dropdown = screen.getByLabelText('Preview for') as HTMLSelectElement;
    expect(dropdown).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Select a recipient to preview' })).toBeInTheDocument();
  });

  it('previews the template for the selected recipient', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', parentEmails: ['mom@e.test'] }),
    ]);
    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }));

    expect(screen.getByText('About Alex')).toBeInTheDocument();
    const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).toContain('<p>Hi Alex</p>');
    expect(screen.getByLabelText('Preview for')).not.toBeDisabled();
  });

  it('fills per-course attendance placeholders in the preview', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', courses: ['Period 1'], parentEmails: ['mom@e.test'] }),
    ]);
    vi.mocked(emailApi.getRecipientMetrics).mockResolvedValue([
      metric({ lateCount: 3, unexcusedAbsences: 2, daysRecorded: 10 }),
    ]);
    const template: EmailTemplate = {
      ...TEMPLATE,
      subject: 'Class: {{courseName}}',
      bodyHtml: '<p>{{lateCount}} lates, {{unexcusedAbsences}} absent</p>',
    };
    render(
      <MemoryRouter>
        <ComposeView templates={[template]} sendStatus={STATUS} onSent={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }));

    await waitFor(() => {
      const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
      expect(frame.getAttribute('srcdoc')).toContain('<p>3 lates, 2 absent</p>');
    });
    expect(screen.getByText('Class: Period 1')).toBeInTheDocument();
  });

  it('shows a conditional block in the preview when the recipient matches', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', studentEmail: 'alex@e.test' }),
    ]);
    vi.mocked(emailApi.getRecipientMetrics).mockResolvedValue([
      metric({ lateCount: 4, daysRecorded: 10 }),
    ]);
    const template: EmailTemplate = {
      ...TEMPLATE,
      bodyHtml: '<p>Hi {{firstName}}</p><p data-if="lateCount gte 3">Late warning.</p>',
    };
    render(
      <MemoryRouter>
        <ComposeView templates={[template]} sendStatus={STATUS} onSent={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }));

    await waitFor(() => {
      const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
      expect(frame.getAttribute('srcdoc')).toContain('Late warning.');
    });
  });

  it('hides a conditional block in the preview when the recipient does not match', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', firstName: 'Alex', studentEmail: 'alex@e.test' }),
    ]);
    vi.mocked(emailApi.getRecipientMetrics).mockResolvedValue([
      metric({ lateCount: 0, daysRecorded: 10 }),
    ]);
    const template: EmailTemplate = {
      ...TEMPLATE,
      bodyHtml: '<p>Hi {{firstName}}</p><p data-if="lateCount gte 3">Late warning.</p>',
    };
    render(
      <MemoryRouter>
        <ComposeView templates={[template]} sendStatus={STATUS} onSent={vi.fn()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }));

    await waitFor(() => {
      const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
      expect(frame.getAttribute('srcdoc')).toContain('Hi Alex');
    });
    const frame = screen.getByTitle('Email preview') as HTMLIFrameElement;
    expect(frame.getAttribute('srcdoc')).not.toContain('Late warning.');
  });

  it('confirms the count and sends per-(student, course) selections', async () => {
    const user = userEvent.setup();
    const onSent = vi.fn();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', courses: ['Period 1'], parentEmails: ['mom@e.test', 'dad@e.test'] }),
    ]);
    vi.mocked(emailApi.sendEmail).mockResolvedValue({ sent: 2, failed: [], skipped: [] });

    renderCompose(onSent);
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }));
    // Two guardian emails on one row => two messages.
    expect(screen.getByText('2 email(s) to send')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(screen.getByRole('dialog', { name: 'Send email' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Send 2 email/ }));

    await waitFor(() =>
      expect(emailApi.sendEmail).toHaveBeenCalledWith({
        templateId: 't1',
        recipients: [{ studentId: 'a', course: 'Period 1', includeStudent: false, includeParents: true }],
      }),
    );
    expect(await screen.findByText('Sent 2 email(s).')).toBeInTheDocument();
    expect(onSent).toHaveBeenCalled();
  });

  it('includes a BCC copy address in the send payload', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', studentEmail: 'alex@e.test' }),
    ]);
    vi.mocked(emailApi.sendEmail).mockResolvedValue({ sent: 1, failed: [], skipped: [] });

    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Student email for Alex Rivera in Period 1' }));
    await user.type(screen.getByLabelText('Copy every email to (optional)'), 'vp@school.test');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(screen.getByRole('button', { name: /Send 1 email/ }));

    await waitFor(() =>
      expect(emailApi.sendEmail).toHaveBeenCalledWith({
        templateId: 't1',
        recipients: [{ studentId: 'a', course: 'Period 1', includeStudent: true, includeParents: false }],
        copyAddress: 'vp@school.test',
        copyMode: 'bcc',
      }),
    );
  });

  it('surfaces a daily-cap error from the server', async () => {
    const user = userEvent.setup();
    vi.mocked(studentsApi.listStudents).mockResolvedValue([
      student({ id: 'a', parentEmails: ['mom@e.test'] }),
    ]);
    vi.mocked(emailApi.sendEmail).mockRejectedValue({
      code: 'DAILY_EMAIL_CAP',
      status: 429,
      message: 'The daily send limit of 120 emails has been reached.',
    });

    renderCompose();
    await waitFor(() => expect(screen.getByText('Alex Rivera')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Template'), 't1');
    await user.click(screen.getByRole('checkbox', { name: 'Guardian emails for Alex Rivera in Period 1' }));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(screen.getByRole('button', { name: /Send 1 email/ }));

    expect(
      await screen.findByText('The daily send limit of 120 emails has been reached.'),
    ).toBeInTheDocument();
  });
});
