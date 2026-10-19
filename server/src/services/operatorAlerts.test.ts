import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initOperatorAlerts,
  reportServerError,
  resetOperatorAlerts,
  routeLabel,
  topFrame,
  type ServerErrorReport,
} from './operatorAlerts.js';
import type { Mailer, OutboundMessage } from './mailer.js';

function fakeMailer(): { mailer: Mailer; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    mailer: {
      name: 'fake',
      async send(message) {
        sent.push(message);
      },
    },
  };
}

const report = (over: Partial<ServerErrorReport> = {}): ServerErrorReport => ({
  method: 'GET',
  route: '/api/students',
  status: 500,
  errorClass: 'TypeError',
  origin: 'students.ts:81',
  ...over,
});

beforeEach(() => resetOperatorAlerts());

/** The alert is only worth having if it cannot carry what it must not carry. */
describe('operator alerts carry no user data', () => {
  it('builds the route label from the mount path, never the path with its ids', () => {
    expect(routeLabel('/api/students', '/01JABCDEF0123456789STUDENT/at-risk')).toBe('/api/students');
  });

  it('truncates to two segments when there is no mount path, which is shallower than any id', () => {
    expect(routeLabel('', '/api/students/01JABCDEF0123456789STUDENT')).toBe('/api/students');
  });

  it('takes file and line from the stack and nothing else', () => {
    const err = new Error('no student named Genevieve Okonkwo in course SNC2D-01');
    const frame = topFrame(err);
    expect(frame).toMatch(/^[\w.-]+\.[jt]s:\d+$/);
    expect(frame).not.toMatch(/Genevieve|Okonkwo|SNC2D/);
  });

  it('returns null rather than guessing when there is no stack', () => {
    expect(topFrame({ message: 'nope' })).toBeNull();
    expect(topFrame(null)).toBeNull();
  });

  it('never puts the error message in the email', async () => {
    const { mailer, sent } = fakeMailer();
    initOperatorAlerts(mailer, 'ops@example.com');

    reportServerError(report({ errorClass: 'TypeError' }));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const body = sent[0].subject + sent[0].text + sent[0].html;
    // A message, a student name, an address and a sheet range: the four kinds of
    // thing an error string routinely interpolates.
    for (const forbidden of ['Genevieve', 'parent@example.com', 'attendance!A2:H', 'no student named']) {
      expect(body).not.toContain(forbidden);
    }
    expect(body).toContain('/api/students');
    expect(body).toContain('TypeError');
  });
});

describe('operator alert throttling', () => {
  it('sends the first occurrence of a problem', async () => {
    const { mailer, sent } = fakeMailer();
    initOperatorAlerts(mailer, 'ops@example.com');
    reportServerError(report());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('collapses a storm of the same problem into one email', async () => {
    const { mailer, sent } = fakeMailer();
    initOperatorAlerts(mailer, 'ops@example.com');
    for (let i = 0; i < 500; i++) reportServerError(report());
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('treats a different route, status or error class as a different problem', async () => {
    const { mailer, sent } = fakeMailer();
    initOperatorAlerts(mailer, 'ops@example.com');
    reportServerError(report());
    reportServerError(report({ route: '/api/attendance' }));
    reportServerError(report({ status: 503 }));
    reportServerError(report({ errorClass: 'RangeError' }));
    await vi.waitFor(() => expect(sent).toHaveLength(4));
  });

  it('caps the number of distinct alerts per window so an outage is not a flood', async () => {
    const { mailer, sent } = fakeMailer();
    initOperatorAlerts(mailer, 'ops@example.com');
    for (let i = 0; i < 50; i++) reportServerError(report({ route: `/api/r${i}` }));
    await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.length).toBeLessThanOrEqual(10);
  });

  it('does nothing but record when no operator address is configured', () => {
    const { mailer, sent } = fakeMailer();
    initOperatorAlerts(mailer, '');
    expect(() => reportServerError(report())).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('does not throw when the mailer rejects', async () => {
    initOperatorAlerts({ name: 'broken', send: () => Promise.reject(new Error('smtp down')) }, 'ops@example.com');
    expect(() => reportServerError(report())).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
