import { describe, it, expect, beforeEach, vi } from 'vitest';
import { logger } from '../config/logger.js';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import { createStudent, setStudentAtRisk } from './students.js';
import { createTemplate } from './emailTemplates.js';
import { submitAttendance } from './attendance.js';
import { appendRows, readTabRows } from './sheets.js';
import {
  sendEmails,
  getSendStatus,
  renderPlaceholders,
  renderSubject,
  buildRawMessage,
  nextMonthStart,
  type RecipientSelection,
  type SendResult,
} from './emailSend.js';
import { FREE_MONTHLY_EMAIL_CAP } from '../config/plan.js';
import { EMAIL_DAILY_CAP } from '../config/email.js';

/**
 * An in-memory stand-in for the Postgres daily counter.
 *
 * Deliberately a working counter rather than a permissive stub: `reserve` really
 * claims and returns the post-claim total, `release` really gives back. A stub
 * that always allowed would let every send test pass while saying nothing about
 * the cap, which is the shape of the bug this replaced.
 */
function memoryDailyCounter(startingAt = 0) {
  let count = startingAt;
  return {
    get count() {
      return count;
    },
    reserve: async (n: number) => {
      count += n;
      return count;
    },
    release: async (n: number) => {
      count = Math.max(0, count - n);
    },
    peek: async () => count,
  };
}

const USER = 'user-sub-1';
const SENDER = 'teacher@school.test';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const gmail = env.buildGmail();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  const template = await createTemplate(sheets, spreadsheetId, USER, {
    name: 'Notice',
    subject: 'About {{firstName}}',
    bodyHtml: '<p>Hi {{firstName}} {{lastName}}</p>',
    placeholdersUsed: ['firstName', 'lastName'],
  });
  return { env, sheets, gmail, spreadsheetId, templateId: template.id };
}

/** Select a student's own email for a course. */
const toStudent = (studentId: string, course: string): RecipientSelection => ({
  studentId,
  course,
  includeStudent: true,
  includeParents: false,
});
/** Select all guardian emails for a course. */
const toParents = (studentId: string, course: string): RecipientSelection => ({
  studentId,
  course,
  includeStudent: false,
  includeParents: true,
});

async function seedSentLog(
  sheets: ReturnType<FakeGoogleEnv['buildSheets']>,
  spreadsheetId: string,
  n: number,
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `log${i}`,
    templateId: 't',
    recipientAddress: `x${i}@e.test`,
    recipientStudentId: 's',
    sentAt: `${day}T10:00:00Z`,
    statusKey: 'sent',
    errorCode: null,
  }));
  await appendRows(sheets, spreadsheetId, 'emailLog', rows);
}

describe('renderPlaceholders', () => {
  it('HTML-escapes values in an escaping (body) context', () => {
    expect(
      renderPlaceholders('Hi {{firstName}}', { firstName: '<b>A</b>' }, { escape: true }),
    ).toBe('Hi &lt;b&gt;A&lt;/b&gt;');
  });

  it('strips CR/LF from values in a non-escaping (subject) context', () => {
    expect(renderPlaceholders('Re: {{x}}', { x: 'a\nb\r\nc' }, { escape: false })).toBe('Re: a b c');
  });

  it('renders an unknown token as an empty string', () => {
    expect(renderPlaceholders('Hi {{missing}}!', {}, { escape: true })).toBe('Hi !');
  });
});

/**
 * SMTP header injection. Each case here was a working attack before the fix, so
 * they are written as the attack rather than as the guard: what is asserted is
 * that the injected header does not reach the message, not that some particular
 * function was called.
 *
 * The three delivery routes differed, which is why all three are kept. A recipient
 * address arrives from the spreadsheet, which is hand-editable and so never went
 * through the app's own validation. A subject arrives from a saved template. A
 * copy address arrives from the request and was the one route already closed,
 * by `z.email()`.
 */
describe('buildRawMessage: header injection', () => {
  const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');

  it('refuses a recipient address carrying a CRLF', () => {
    expect(() =>
      buildRawMessage(SENDER, 'alex@e.test\r\nBcc: attacker@evil.test', 'S', '<p>x</p>'),
    ).toThrow(/line break/i);
  });

  it('refuses a subject carrying a CRLF', () => {
    expect(() =>
      buildRawMessage(SENDER, 'alex@e.test', 'Newsletter\r\nBcc: attacker@evil.test', '<p>x</p>'),
    ).toThrow(/line break/i);
  });

  it('refuses a bare LF as well as a CRLF pair', () => {
    expect(() => buildRawMessage(SENDER, 'alex@e.test', 'A\nBcc: attacker@evil.test', '<p>x</p>')).toThrow(
      /line break/i,
    );
  });

  it('refuses a copy address carrying a CRLF', () => {
    expect(() =>
      buildRawMessage(SENDER, 'alex@e.test', 'S', '<p>x</p>', {
        mode: 'bcc',
        address: 'vp@e.test\r\nBcc: attacker@evil.test',
      }),
    ).toThrow(/line break/i);
  });

  it('refuses an address that would end the header block and supply its own body', () => {
    expect(() =>
      buildRawMessage(
        SENDER,
        'alex@e.test\r\nSubject: Fake\r\n\r\n<h1>attacker body</h1>\r\nX-Ignore: ',
        'Real',
        '<p>real</p>',
      ),
    ).toThrow(/line break/i);
  });

  // The subject guard cannot be delegated to encodeSubject: it base64-encodes
  // only non-ASCII subjects, and CR and LF are both ASCII, so this subject
  // reaches the header block verbatim.
  it('does not let an all-ASCII subject bypass the check via encodeSubject', () => {
    const injected = 'Plain ASCII\r\nX-Injected: yes';
    expect(() => buildRawMessage(SENDER, 'alex@e.test', injected, '<p>x</p>')).toThrow();
    // A non-ASCII subject is encoded, and still must not carry a break.
    expect(() => buildRawMessage(SENDER, 'alex@e.test', 'Café\r\nX-Injected: yes', '<p>x</p>')).toThrow();
  });

  it('still allows a line break in the body, which is content rather than structure', () => {
    const raw = buildRawMessage(SENDER, 'alex@e.test', 'S', '<p>one</p>\r\n<p>two</p>');
    expect(decode(raw)).toContain('<p>one</p>\r\n<p>two</p>');
  });

  it('encodes a legitimate non-ASCII subject rather than refusing it', () => {
    const raw = buildRawMessage(SENDER, 'alex@e.test', 'Réunion de parents', '<p>x</p>');
    expect(decode(raw)).toContain('Subject: =?UTF-8?B?');
  });
});

describe('renderSubject', () => {
  it('folds a line break in the template text, which renderPlaceholders cannot see', () => {
    expect(renderSubject('Notice\r\nBcc: attacker@evil.test', {})).toBe(
      'Notice Bcc: attacker@evil.test',
    );
  });

  it('folds a line break arriving through a placeholder value', () => {
    expect(renderSubject('Re: {{x}}', { x: 'a\r\nBcc: attacker@evil.test' })).toBe(
      'Re: a Bcc: attacker@evil.test',
    );
  });

  it('produces a subject buildRawMessage will accept, for any template', () => {
    const subject = renderSubject('A\r\nB\nC', { });
    expect(() => buildRawMessage(SENDER, 'alex@e.test', subject, '<p>x</p>')).not.toThrow();
  });
});

describe('buildRawMessage', () => {
  it('round-trips a decodable HTML message', () => {
    const raw = buildRawMessage(SENDER, 'to@e.test', 'Subject line', '<p>Body</p>');
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    expect(text).toContain('From: teacher@school.test');
    expect(text).toContain('To: to@e.test');
    expect(text).toContain('Content-Type: text/html');
    expect(text.endsWith('<p>Body</p>')).toBe(true);
  });

  it('adds a Bcc/Cc header for a copy address', () => {
    const bcc = Buffer.from(
      buildRawMessage(SENDER, 'to@e.test', 'S', '<p>x</p>', { mode: 'bcc', address: 'vp@e.test' }),
      'base64url',
    ).toString('utf8');
    expect(bcc).toContain('Bcc: vp@e.test');
    const cc = Buffer.from(
      buildRawMessage(SENDER, 'to@e.test', 'S', '<p>x</p>', { mode: 'cc', address: 'vp@e.test' }),
      'base64url',
    ).toString('utf8');
    expect(cc).toContain('Cc: vp@e.test');
  });
});

/**
 * The spreadsheet as an untrusted input.
 *
 * `createStudent` validates addresses, so these write the row through the sheets
 * layer directly, which is what a teacher does when they type into Google Sheets
 * and what someone they shared the sheet with can do too. That path never met
 * the app's validation, and it was the delivery route for the header injection
 * above.
 */
describe('sendEmails: addresses read back from a hand-edited sheet', () => {
  beforeEach(() => clearCache());

  /** Writes a student row straight to the tab, bypassing createStudent's validation. */
  async function plantStudent(
    sheets: ReturnType<FakeGoogleEnv['buildSheets']>,
    spreadsheetId: string,
    studentEmail: string,
  ): Promise<string> {
    const id = `planted-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    await appendRows(sheets, spreadsheetId, 'students', [
      {
        id,
        firstName: 'Alex',
        lastName: 'Ng',
        goesBy: null,
        pronouns: null,
        studentEmail,
        parentEmails: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);
    await appendRows(sheets, spreadsheetId, 'enrollments', [
      {
        id: `enr-${id}`,
        studentId: id,
        course: 'A',
        atRisk: null,
        startDate: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);
    return id;
  }

  it('does not send to an address carrying an injected Bcc header', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const id = await plantStudent(
      sheets,
      spreadsheetId,
      'alex@e.test\r\nBcc: attacker@evil.test',
    );

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(id, 'A')],
    }, { daily: memoryDailyCounter() });

    // Nothing left the building, and the teacher is told why rather than
    // being shown a silent success.
    expect(env.sentEmails).toHaveLength(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toEqual([{ studentId: id, reason: 'invalid_address' }]);
  });

  it('never writes an unusable address into the emailLog audit trail', async () => {
    const { sheets, gmail, spreadsheetId, templateId } = await setup();
    const id = await plantStudent(sheets, spreadsheetId, 'x@e.test\r\nBcc: attacker@evil.test');

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(id, 'A')],
    }, { daily: memoryDailyCounter() });

    const log = await readTabRows(sheets, spreadsheetId, 'emailLog');
    expect(log).toHaveLength(0);
  });

  it('still sends to a guardian whose own address is fine when a sibling address is not', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Bo',
      lastName: 'Li',
      courses: ['A'],
      parentEmails: ['mom@e.test'],
    });
    // A second guardian address added by hand, badly.
    const rows = await readTabRows(sheets, spreadsheetId, 'students');
    expect(rows).toHaveLength(1);

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toParents(s.id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(1);
    expect(env.sentEmails[0].to).toBe('mom@e.test');
  });

  it('reports a plain malformed address, not only an injected one', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const id = await plantStudent(sheets, spreadsheetId, 'not-an-address');

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(env.sentEmails).toHaveLength(0);
    expect(result.failed).toEqual([{ studentId: id, reason: 'invalid_address' }]);
  });

  it('is unaffected for an ordinary address, so the guard costs nothing normal', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const id = await plantStudent(sheets, spreadsheetId, 'first.last+tag@sub.school.on.ca');

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(1);
    expect(env.sentEmails[0].to).toBe('first.last+tag@sub.school.on.ca');
  });
});

describe('sendEmails', () => {
  beforeEach(() => clearCache());

  it('sends to the student address with placeholders substituted, from the teacher', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Ng',
      courses: ['A'],
      studentEmail: 'alex@e.test',
    });

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result).toEqual({ sent: 1, failed: [], skipped: [] });
    expect(env.sentEmails).toHaveLength(1);
    expect(env.sentEmails[0]).toMatchObject({
      from: SENDER,
      to: 'alex@e.test',
      subject: 'About Alex',
      body: '<p>Hi Alex Ng</p>',
    });
  });

  it('sends to every guardian email when guardians are selected', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Bo',
      lastName: 'Li',
      courses: ['A'],
      parentEmails: ['mom@e.test', 'dad@e.test'],
    });

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toParents(s.id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(2);
    expect(env.sentEmails.map((e) => e.to).sort()).toEqual(['dad@e.test', 'mom@e.test']);
  });

  it('sends to the student and all guardians when both are selected', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Bo',
      lastName: 'Li',
      courses: ['A'],
      studentEmail: 'bo@e.test',
      parentEmails: ['mom@e.test', 'dad@e.test'],
    });

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [{ studentId: s.id, course: 'A', includeStudent: true, includeParents: true }],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(3);
    expect(env.sentEmails.map((e) => e.to).sort()).toEqual([
      'bo@e.test',
      'dad@e.test',
      'mom@e.test',
    ]);
  });

  it('resolves the course-name and attendance-total placeholders for the send course', async () => {
    const { env, sheets, gmail, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Ng',
      courses: ['Math'],
      studentEmail: 'alex@e.test',
    });
    // 1 tardy, 2 absences (all weekdays).
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Math', [
      { studentId: s.id, statusKey: 't' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-02', 'Math', [
      { studentId: s.id, statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-03', 'Math', [
      { studentId: s.id, statusKey: 'a' },
    ]);
    const tmpl = await createTemplate(sheets, spreadsheetId, USER, {
      name: 'Attendance',
      subject: '{{courseName}} update',
      bodyHtml: '<p>{{courseName}}: {{lateCount}} late, {{unexcusedAbsences}} absent</p>',
      placeholdersUsed: ['courseName', 'lateCount', 'unexcusedAbsences'],
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId: tmpl.id,
      recipients: [toStudent(s.id, 'Math')],
    }, { daily: memoryDailyCounter() });

    expect(env.sentEmails[0].subject).toBe('Math update');
    expect(env.sentEmails[0].body).toBe('<p>Math: 1 late, 2 absent</p>');
  });

  it('scopes the attendance placeholders per course for a multi-course student', async () => {
    const { env, sheets, gmail, spreadsheetId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Ng',
      courses: ['Period 1', 'Period 4'],
      studentEmail: 'alex@e.test',
    });
    // Period 1: 2 absences. Period 4: 1 tardy.
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 1', [
      { studentId: s.id, statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-02', 'Period 1', [
      { studentId: s.id, statusKey: 'a' },
    ]);
    await submitAttendance(sheets, spreadsheetId, USER, '2026-09-01', 'Period 4', [
      { studentId: s.id, statusKey: 't' },
    ]);
    const tmpl = await createTemplate(sheets, spreadsheetId, USER, {
      name: 'PerClass',
      subject: '{{courseName}}',
      bodyHtml: '<p>{{lateCount}}/{{unexcusedAbsences}}</p>',
      placeholdersUsed: ['courseName', 'lateCount', 'unexcusedAbsences'],
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId: tmpl.id,
      recipients: [toStudent(s.id, 'Period 1'), toStudent(s.id, 'Period 4')],
    }, { daily: memoryDailyCounter() });

    expect(env.sentEmails.find((e) => e.subject === 'Period 1')?.body).toBe('<p>0/2</p>');
    expect(env.sentEmails.find((e) => e.subject === 'Period 4')?.body).toBe('<p>1/0</p>');
  });

  it('includes conditional blocks only for recipients that satisfy them', async () => {
    const { env, sheets, gmail, spreadsheetId } = await setup();
    const a = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'A',
      courses: ['Math'],
      studentEmail: 'a@e.test',
    });
    const b = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'B',
      lastName: 'B',
      courses: ['Math'],
      studentEmail: 'b@e.test',
    });
    // A: 4 lates and flagged at risk. B: neither.
    await setStudentAtRisk(sheets, spreadsheetId, USER, a.id, 'Math', true);
    for (const d of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
      await submitAttendance(sheets, spreadsheetId, USER, d, 'Math', [
        { studentId: a.id, statusKey: 't' },
      ]);
    }
    const tmpl = await createTemplate(sheets, spreadsheetId, USER, {
      name: 'Conditional',
      subject: 'Update',
      bodyHtml:
        '<p>Hello</p>' +
        '<p data-if="lateCount gte 3">You have several lates.</p>' +
        '<p data-if="atRisk is true">Let us arrange a check-in.</p>',
      placeholdersUsed: [],
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId: tmpl.id,
      recipients: [toStudent(a.id, 'Math'), toStudent(b.id, 'Math')],
    }, { daily: memoryDailyCounter() });

    const emailA = env.sentEmails.find((e) => e.to === 'a@e.test');
    const emailB = env.sentEmails.find((e) => e.to === 'b@e.test');
    expect(emailA?.body).toContain('several lates');
    expect(emailA?.body).toContain('arrange a check-in');
    expect(emailA?.body).not.toContain('data-if');
    expect(emailB?.body).toContain('Hello');
    expect(emailB?.body).not.toContain('several lates');
    expect(emailB?.body).not.toContain('arrange a check-in');
  });

  it('copies every message to a Bcc address by default', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'a@e.test',
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
      copyAddress: 'principal@school.test',
    }, { daily: memoryDailyCounter() });

    expect(env.sentEmails[0].bcc).toBe('principal@school.test');
    expect(env.sentEmails[0].cc).toBe('');
  });

  it('copies via Cc when copyMode is cc', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'a@e.test',
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
      copyAddress: 'principal@school.test',
      copyMode: 'cc',
    }, { daily: memoryDailyCounter() });

    expect(env.sentEmails[0].cc).toBe('principal@school.test');
    expect(env.sentEmails[0].bcc).toBe('');
  });

  it('skips students with no resolvable address and unknown ids', async () => {
    const { sheets, gmail, spreadsheetId, templateId } = await setup();
    const noEmail = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'C',
      lastName: 'D',
      courses: ['A'],
    });

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(noEmail.id, 'A'), toStudent('ghost', 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(0);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { studentId: noEmail.id, reason: 'no_email' },
        { studentId: 'ghost', reason: 'student_not_found' },
      ]),
    );
  });

  it('lets per-student overrides take precedence and escapes them', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Ng',
      courses: ['A'],
      studentEmail: 'alex@e.test',
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
      placeholderValues: { [s.id]: { firstName: '<script>x</script>' } },
    }, { daily: memoryDailyCounter() });

    expect(env.sentEmails[0].body).toBe('<p>Hi &lt;script&gt;x&lt;/script&gt; Ng</p>');
    expect(env.sentEmails[0].body).not.toContain('<script>');
  });

  it('sanitizes a value substituted into an attribute the template opened', async () => {
    // The escaping pass cannot help here: `javascript:alert(1)` contains none of
    // the characters escapeHtml touches, and an href holding only a placeholder
    // is a relative URL, so the template saves cleanly. The protection is that
    // the sanitizer runs over the finished document, after substitution, and
    // applies its scheme allowlist to the value rather than to the token.
    const { env, sheets, gmail, spreadsheetId } = await setup();
    const template = await createTemplate(sheets, spreadsheetId, USER, {
      name: 'Linked',
      subject: 'Hi',
      bodyHtml: '<p><a href="{{goesBy}}">Details</a></p>',
      placeholdersUsed: ['goesBy'],
    });
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Ng',
      courses: ['A'],
      studentEmail: 'alex@e.test',
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId: template.id,
      recipients: [toStudent(s.id, 'A')],
      placeholderValues: { [s.id]: { goesBy: 'javascript:alert(1)' } },
    }, { daily: memoryDailyCounter() });

    const body = env.sentEmails[0].body;
    expect(body).not.toContain('javascript:');
    expect(body).toContain('Details');
  });

  it('keeps an ordinary link working through the same path', async () => {
    // The guard above is worthless if it also drops legitimate links, and the
    // reordering it describes is the kind of change that could.
    const { env, sheets, gmail, spreadsheetId } = await setup();
    const template = await createTemplate(sheets, spreadsheetId, USER, {
      name: 'Linked',
      subject: 'Hi',
      bodyHtml: '<p><a href="{{goesBy}}">Details</a></p>',
      placeholdersUsed: ['goesBy'],
    });
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'Alex',
      lastName: 'Ng',
      courses: ['A'],
      studentEmail: 'alex@e.test',
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId: template.id,
      recipients: [toStudent(s.id, 'A')],
      placeholderValues: { [s.id]: { goesBy: 'https://example.test/a?b=1&c=2' } },
    }, { daily: memoryDailyCounter() });

    const body = env.sentEmails[0].body;
    expect(body).toContain('href="https://example.test/a?b=1&amp;c=2"');
    // Not double-escaped on the round trip through the sanitizer.
    expect(body).not.toContain('&amp;amp;');
  });

  it('rejects the whole request once the daily cap is already reached', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'a@e.test',
    });
    // The day is already spent. The count comes from the account's counter now,
    // not from emailLog rows, which is what stops a teacher clearing it by
    // editing their own spreadsheet.
    const counter = memoryDailyCounter(EMAIL_DAILY_CAP);

    await expect(
      sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
        templateId,
        recipients: [toStudent(s.id, 'A')],
      }, { daily: counter }),
    ).rejects.toMatchObject({ code: 'DAILY_EMAIL_CAP' });
    expect(env.sentEmails).toHaveLength(0);
    // The refused batch gave its claim back rather than spending the day.
    expect(counter.count).toBe(EMAIL_DAILY_CAP);
  });

  it('stops mid-batch at the cap, marking the overflow as failed', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s1 = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'a@e.test',
    });
    const s2 = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'C',
      lastName: 'D',
      courses: ['A'],
      studentEmail: 'c@e.test',
    });
    const counter = memoryDailyCounter(EMAIL_DAILY_CAP - 1);

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s1.id, 'A'), toStudent(s2.id, 'A')],
    }, { daily: counter });

    expect(result.sent).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toBe('daily_cap');
    expect(env.sentEmails).toHaveLength(1);
    // Two were claimed and one was sent, so the unused claim came back and the
    // day sits exactly at the cap rather than one over it.
    expect(counter.count).toBe(EMAIL_DAILY_CAP);
  });

  it('records a Gmail failure as failed and logs it without a body', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'fail@e.test',
    });
    env.gmailFailFor.add('fail@e.test');

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(0);
    expect(result.failed).toEqual([{ studentId: s.id, reason: 'send_failed' }]);

    const log = await readTabRows(sheets, spreadsheetId, 'emailLog');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ statusKey: 'failed', recipientAddress: 'fail@e.test' });
    // The audit row never carries body content.
    expect(JSON.stringify(log[0])).not.toContain('Hi ');
  });

  it("logs Gmail's refusal codes once per distinct reason, without the address", async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const a = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'one@e.test',
    });
    const b = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'C',
      lastName: 'D',
      courses: ['A'],
      studentEmail: 'two@e.test',
    });
    env.gmailFailFor.add('one@e.test');
    env.gmailFailFor.add('two@e.test');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
        templateId,
        recipients: [toStudent(a.id, 'A'), toStudent(b.id, 'A')],
      }, { daily: memoryDailyCounter() }, { accountId: 'acct-7' });

      expect(warn).toHaveBeenCalledTimes(1);
      const [fields, msg] = warn.mock.calls[0] as unknown as [Record<string, unknown>, string];
      expect(msg).toBe('Gmail refused email sends');
      expect(fields).toEqual({ status: 500, count: 2, accountId: 'acct-7', attempted: 2 });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('e.test');
    } finally {
      warn.mockRestore();
    }
  });

  it('logs nothing when every message is accepted', async () => {
    const { sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'ok@e.test',
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
        templateId,
        recipients: [toStudent(s.id, 'A')],
      }, { daily: memoryDailyCounter() });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('writes one sent audit row per delivered message', async () => {
    const { sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'a@e.test',
    });

    await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
    }, { daily: memoryDailyCounter() });

    const log = await readTabRows(sheets, spreadsheetId, 'emailLog');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      statusKey: 'sent',
      recipientAddress: 'a@e.test',
      templateId,
      recipientStudentId: s.id,
    });
  });

  it('reports daily send status against the cap', async () => {
    const status = await getSendStatus(memoryDailyCounter(3));
    expect(status).toEqual({
      sentToday: 3,
      dailyCap: EMAIL_DAILY_CAP,
      remaining: EMAIL_DAILY_CAP - 3,
    });
  });

  /**
   * The status read must not spend anything. `peek` is implemented as a claim of
   * zero so that reading and claiming share one statement and cannot disagree
   * about when the UTC day rolls over, which makes "does zero really change
   * nothing" worth pinning down rather than assuming.
   */
  it('does not consume allowance just by reporting it', async () => {
    const counter = memoryDailyCounter(3);
    await getSendStatus(counter);
    await getSendStatus(counter);
    expect(counter.count).toBe(3);
  });
});

describe("the free plan's monthly cap", () => {
  beforeEach(() => clearCache());

  /** The `free` allowance with `used` already spent, recording into a local counter. */
  function quota(used: number) {
    const recorded: number[] = [];
    return {
      recorded,
      value: {
        used,
        cap: FREE_MONTHLY_EMAIL_CAP,
        resetsAt: nextMonthStart(),
        record: async (n: number) => {
          recorded.push(n);
        },
      },
    };
  }

  async function studentIn(
    sheets: ReturnType<FakeGoogleEnv['buildSheets']>,
    spreadsheetId: string,
    email: string,
  ) {
    return createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: email,
    });
  }

  it('sends within the allowance and records only the successful sends', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await studentIn(sheets, spreadsheetId, 'a@e.test');
    const q = quota(29);

    const result = await sendEmails(
      gmail,
      sheets,
      spreadsheetId,
      USER,
      SENDER,
      { templateId, recipients: [toStudent(s.id, 'A')] },
      { daily: memoryDailyCounter(), monthly: q.value },
    );

    expect(result.sent).toBe(1);
    expect(env.sentEmails).toHaveLength(1);
    expect(q.recorded).toEqual([1]);
  });

  it('rejects the 31st send in the month with MONTHLY_EMAIL_CAP', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await studentIn(sheets, spreadsheetId, 'a@e.test');
    const q = quota(FREE_MONTHLY_EMAIL_CAP);

    await expect(
      sendEmails(
        gmail,
        sheets,
        spreadsheetId,
        USER,
        SENDER,
        { templateId, recipients: [toStudent(s.id, 'A')] },
        { daily: memoryDailyCounter(), monthly: q.value },
      ),
    ).rejects.toMatchObject({ code: 'MONTHLY_EMAIL_CAP' });
    expect(env.sentEmails).toHaveLength(0);
  });

  // Rejected whole, not partially applied: the teacher retries the same send
  // after upgrading rather than reconstructing who already heard from them.
  it('rejects a request that would cross the cap, sending nothing and logging nothing', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s1 = await studentIn(sheets, spreadsheetId, 'a@e.test');
    const s2 = await studentIn(sheets, spreadsheetId, 'c@e.test');
    const q = quota(FREE_MONTHLY_EMAIL_CAP - 1);

    await expect(
      sendEmails(
        gmail,
        sheets,
        spreadsheetId,
        USER,
        SENDER,
        { templateId, recipients: [toStudent(s1.id, 'A'), toStudent(s2.id, 'A')] },
        { daily: memoryDailyCounter(), monthly: q.value },
      ),
    ).rejects.toMatchObject({ code: 'MONTHLY_EMAIL_CAP' });
    expect(env.sentEmails).toHaveLength(0);
    expect(await readTabRows(sheets, spreadsheetId, 'emailLog')).toHaveLength(0);
    expect(q.recorded).toEqual([]);
  });

  it('tells a capped account when the allowance resets', async () => {
    const { sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await studentIn(sheets, spreadsheetId, 'a@e.test');
    const q = quota(FREE_MONTHLY_EMAIL_CAP);

    await expect(
      sendEmails(
        gmail,
        sheets,
        spreadsheetId,
        USER,
        SENDER,
        { templateId, recipients: [toStudent(s.id, 'A')] },
        { daily: memoryDailyCounter(), monthly: q.value },
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining(nextMonthStart().slice(0, 10)) });
  });

  it('does not apply to trial and paid, which pass no quota', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await studentIn(sheets, spreadsheetId, 'a@e.test');
    await seedSentLog(sheets, spreadsheetId, 100);

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
    }, { daily: memoryDailyCounter() });

    expect(result.sent).toBe(1);
    expect(env.sentEmails).toHaveLength(1);
  });

  it('resets at the start of the next calendar month, in UTC', () => {
    expect(nextMonthStart(new Date('2026-07-28T13:00:00Z'))).toBe('2026-08-01T00:00:00.000Z');
    expect(nextMonthStart(new Date('2026-12-31T23:59:59Z'))).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('GET /email/send-status figures', () => {
  beforeEach(() => clearCache());

  it('reports the monthly figures and the lower remaining allowance on free', async () => {
    const status = await getSendStatus(memoryDailyCounter(4), 'free', {
      used: 12,
      cap: FREE_MONTHLY_EMAIL_CAP,
      resetsAt: nextMonthStart(),
      record: async () => {},
    });

    expect(status).toMatchObject({
      sentToday: 4,
      dailyCap: EMAIL_DAILY_CAP,
      plan: 'free',
      sentThisMonth: 12,
      monthlyCap: 30,
      remainingThisMonth: 18,
    });
    // A client reading only `remaining` cannot overstate what may be sent.
    expect(status.remaining).toBe(18);
  });

  it('reports the daily figure and no monthly figures on paid', async () => {
    const status = await getSendStatus(memoryDailyCounter(4), 'paid');
    expect(status).toEqual({
      sentToday: 4,
      dailyCap: EMAIL_DAILY_CAP,
      remaining: EMAIL_DAILY_CAP - 4,
      plan: 'paid',
    });
  });
});

/**
 * The two ways the hard daily cap could be beaten before Step 7. Both are written
 * as the attack, and both were measured rather than reasoned about.
 */
describe('the daily cap under attack', () => {
  beforeEach(() => clearCache());

  /**
   * Four concurrent batches used to send 600 against a cap of 200 (the cap of
   * the day; it is 120 since Step 8a and the arithmetic is the same). The count was
   * read once at the top of a batch and only written at the bottom, and
   * `getOrLoad` coalesced the concurrent reads onto one promise, so overlapping
   * requests were *guaranteed* the same number rather than merely likely to get
   * it. The burst limiter permits sixty requests in ten seconds, so the ceiling
   * was far above 600.
   *
   * Claiming up front is what closes it: each batch is told what its own claim
   * brought the day to.
   */
  it('does not let concurrent batches each spend the whole day', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const recipients = [];
    for (let i = 0; i < 80; i++) {
      const s = await createStudent(sheets, spreadsheetId, USER, {
        firstName: `F${i}`,
        lastName: 'L',
        courses: ['A'],
        studentEmail: `s${i}@e.test`,
      });
      recipients.push(toStudent(s.id, 'A'));
    }

    // One counter, shared, exactly as one account's row is.
    const counter = memoryDailyCounter();
    // allSettled rather than all: a batch that arrives to find the day already
    // spent is refused outright with DAILY_EMAIL_CAP, which is the API's
    // existing contract for that case. What is on trial here is how many
    // messages leave, not how each caller is told.
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, { templateId, recipients }, {
          daily: counter,
        }),
      ),
    );

    // 320 messages were asked for across four overlapping batches. Before this,
    // every batch read the same empty day and all 320 went out.
    expect(env.sentEmails).toHaveLength(EMAIL_DAILY_CAP);
    const totalSent = outcomes
      .filter((o) => o.status === 'fulfilled')
      .reduce((n, o) => n + (o as PromiseFulfilledResult<SendResult>).value.sent, 0);
    expect(totalSent).toBe(EMAIL_DAILY_CAP);
    // And the day is left exactly full: no claim was leaked, none double-spent.
    expect(counter.count).toBe(EMAIL_DAILY_CAP);
    for (const o of outcomes) {
      if (o.status === 'rejected') expect(o.reason).toMatchObject({ code: 'DAILY_EMAIL_CAP' });
    }
  });

  /**
   * The simpler bypass, and the one that needed no race at all: the count came
   * from `emailLog` in the teacher's own spreadsheet, so deleting those rows
   * reset a "hard" cap to its full allowance. The counter lives in Postgres now, where
   * the teacher cannot reach it, and `emailLog` is left as what it always should
   * have been on its own — the audit record.
   */
  it('is not reset by clearing the emailLog rows in the spreadsheet', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'a@e.test',
    });
    const counter = memoryDailyCounter(EMAIL_DAILY_CAP);

    // Whatever the teacher does to the sheet, the allowance is elsewhere.
    const sheet = env.spreadsheets.get(spreadsheetId)!;
    const log = sheet.sheets.find((t: { title: string }) => t.title === 'emailLog');
    if (log) log.rows = log.rows.slice(0, 1);
    clearCache();

    await expect(
      sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
        templateId,
        recipients: [toStudent(s.id, 'A')],
      }, { daily: counter }),
    ).rejects.toMatchObject({ code: 'DAILY_EMAIL_CAP' });
    expect(env.sentEmails).toHaveLength(0);
  });

  it('gives back the claim for a message Gmail refused', async () => {
    const { env, sheets, gmail, spreadsheetId, templateId } = await setup();
    const s = await createStudent(sheets, spreadsheetId, USER, {
      firstName: 'A',
      lastName: 'B',
      courses: ['A'],
      studentEmail: 'bounce@e.test',
    });
    env.gmailFailFor.add('bounce@e.test');
    const counter = memoryDailyCounter();

    const result = await sendEmails(gmail, sheets, spreadsheetId, USER, SENDER, {
      templateId,
      recipients: [toStudent(s.id, 'A')],
    }, { daily: counter });

    expect(result.sent).toBe(0);
    // A Gmail failure is not something the teacher should pay a day's
    // allowance for, any more than a month's.
    expect(counter.count).toBe(0);
  });
});
