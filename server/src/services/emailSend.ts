import type { sheets_v4, gmail_v1 } from 'googleapis';
import { ulid } from 'ulid';
import { ApiError } from '../utils/errors.js';
import { logger } from '../config/logger.js';
import { summarizeGoogleError, type GoogleErrorSummary } from '../utils/googleErrors.js';
import { nowIso } from '../utils/time.js';
import { escapeHtml } from '../utils/htmlEscape.js';
import { isSendableAddress } from '../utils/emailAddress.js';
import { EMAIL_DAILY_CAP, PLACEHOLDER_PATTERN } from '../config/email.js';
import { appendRows, type RowObject } from './sheets.js';
import { trackGoogleCall } from './apiMetrics.js';
import { listStudents, type Student } from './students.js';
import { getStats, isHighAbsenceRisk } from './attendance.js';
import type { HighAbsenceThreshold } from '../config/plan.js';
import { getTemplate, filterConditionalHtml, sanitizeEmailHtml } from './emailTemplates.js';
import type { ConditionContext } from './emailConditions.js';
import type { Plan } from './plan.js';

export type CopyMode = 'cc' | 'bcc';

/** A per-(student, course) send. The client picks which address kinds to
 * include (never the raw addresses), so the server always resolves the actual
 * addresses from the student record (see IMPLEMENTATION_PLAN.md). The `course`
 * scopes the course-name and attendance placeholders for this message. */
export interface RecipientSelection {
  studentId: string;
  course: string;
  /** Include the student's own email if one is on file. */
  includeStudent: boolean;
  /** Include every guardian email on the student's record. */
  includeParents: boolean;
}

export interface SendEmailInput {
  templateId: string;
  recipients: RecipientSelection[];
  placeholderValues?: Record<string, Record<string, string>>;
  /** Optional teacher-entered address copied on every message (e.g. a principal). */
  copyAddress?: string;
  copyMode?: CopyMode;
}

export interface SendResult {
  sent: number;
  failed: Array<{ studentId: string; reason: string }>;
  skipped: Array<{ studentId: string; reason: 'no_email' | 'student_not_found' }>;
}

/**
 * The `free` plan's calendar-month allowance. The count is a per-user integer in
 * Postgres rather than a total over the teacher's `emailLog`: a paywall cannot be
 * enforced from a spreadsheet the teacher can edit, and an integer carries no
 * PII. `emailLog` stays the audit record. Absent on `trial` and `paid`, which
 * have no monthly cap.
 */
export interface MonthlyEmailQuota {
  used: number;
  cap: number;
  /** Records n successful sends against this month's counter. */
  record(count: number): Promise<void>;
  /** When the allowance resets, so a capped teacher is told rather than merely refused. */
  resetsAt: string;
}

/**
 * What a send is allowed to spend. The two limits travel together because they
 * are asked the same question at the same moment and a caller that supplied one
 * and forgot the other would enforce half a cap.
 */
export interface SendAllowances {
  /** The hard daily cap (EMAIL_DAILY_CAP). Always present: it applies to every plan. */
  daily: DailyEmailCounter;
  /** The free plan's monthly allowance. Absent on `trial` and `paid`. */
  monthly?: MonthlyEmailQuota;
}

export interface SendStatus {
  sentToday: number;
  dailyCap: number;
  remaining: number;
  plan?: Plan;
  sentThisMonth?: number;
  monthlyCap?: number;
  remainingThisMonth?: number;
  monthlyResetsAt?: string;
}

/** First instant of the next UTC calendar month — when a monthly allowance resets. */
export function nextMonthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The account's allowance for the current UTC day, held in Postgres.
 *
 * It used to be counted by reading `emailLog` out of the teacher's spreadsheet.
 * Two things were wrong with that, and they compounded. The Sheet is editable by
 * the teacher, so deleting the rows reset a "hard" daily cap to full with no
 * tooling at all. And a count read at the start of a batch was still being spent
 * against at the end of it, so concurrent batches all measured the same empty
 * day: four overlapping requests sent 600 against a cap of 200, the cap of the day.
 *
 * So it is a counter now, not a derived total, and `reserve` is a claim rather
 * than a read. The same reasoning already applied to the monthly free-tier
 * allowance — see {@link MonthlyEmailQuota}, which says a paywall cannot be
 * enforced from a spreadsheet the teacher can edit. That argument was never
 * carried across to the daily cap, which is the harder limit and the one the
 * Gmail scope's standing depends on.
 *
 * `emailLog` remains the audit record. This holds two integers and no PII.
 */
export interface DailyEmailCounter {
  /** Claims `n` sends and returns the day's new total, including this claim. */
  reserve(n: number): Promise<number>;
  /** Hands back `n` claims that were not used. */
  release(n: number): Promise<void>;
  /** The day's total without claiming anything, for the status display. */
  peek(): Promise<number>;
}

/**
 * The quota indicator's source. `remaining` is always the lower of the caps that
 * apply, so a client reading only that field cannot overstate what may be sent;
 * the monthly figures are returned only when a monthly cap exists, which is what
 * lets the Email tool show a free account the limit that actually binds it.
 */
export async function getSendStatus(
  daily: DailyEmailCounter,
  plan?: Plan,
  quota?: MonthlyEmailQuota,
): Promise<SendStatus> {
  const sentToday = await daily.peek();
  const dailyRemaining = Math.max(0, EMAIL_DAILY_CAP - sentToday);
  const base = { sentToday, dailyCap: EMAIL_DAILY_CAP, remaining: dailyRemaining };
  if (!quota) return plan ? { ...base, plan } : base;
  const monthlyRemaining = Math.max(0, quota.cap - quota.used);
  return {
    ...base,
    remaining: Math.min(dailyRemaining, monthlyRemaining),
    plan,
    sentThisMonth: quota.used,
    monthlyCap: quota.cap,
    remainingThisMonth: monthlyRemaining,
    monthlyResetsAt: quota.resetsAt,
  };
}

/** Attendance totals for one (student, course). Feeds the `lateCount` and
 * `unexcusedAbsences` placeholders, which are scoped per class. */
export interface AttendanceTotals {
  tardies: number;
  absences: number;
}

/** Key for the per-(student, course) totals map. */
function pairKey(studentId: string, course: string): string {
  return `${studentId}\u0000${course}`;
}

async function attendanceTotalsByPair(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<Map<string, AttendanceTotals>> {
  // getStats already returns one row per (student, course).
  const rows = await getStats(sheets, spreadsheetId, userKey);
  const totals = new Map<string, AttendanceTotals>();
  for (const r of rows) {
    totals.set(pairKey(r.studentId, r.course), {
      tardies: r.totalTardies,
      absences: r.totalAbsences,
    });
  }
  return totals;
}

/**
 * Per-(student, course) figures the Compose view needs: the `lateCount` and
 * `unexcusedAbsences` placeholder previews and the "High absences" quick select.
 *
 * Deliberately its own free endpoint rather than a read of `GET /attendance/stats`:
 * the email tool and its attendance conditions are free-tier, the statistics view
 * is premium, and pointing a free feature at a gated endpoint would have broken
 * it on `free`. `highAbsence` is computed here with the account's effective
 * threshold so the client never has to re-derive it from a hardcoded constant.
 */
export interface RecipientMetric {
  studentId: string;
  course: string;
  lateCount: number;
  unexcusedAbsences: number;
  daysRecorded: number;
  highAbsence: boolean;
}

export async function listRecipientMetrics(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  threshold: HighAbsenceThreshold,
): Promise<RecipientMetric[]> {
  const rows = await getStats(sheets, spreadsheetId, userKey);
  return rows.map((r) => ({
    studentId: r.studentId,
    course: r.course,
    lateCount: r.totalTardies,
    unexcusedAbsences: r.totalAbsences,
    daysRecorded: r.daysRecorded,
    highAbsence: isHighAbsenceRisk(r, threshold),
  }));
}

/**
 * Default placeholder values for a (student, course) send. Record fields come
 * straight off the student; `courseName` is the send's course; `lateCount` and
 * `unexcusedAbsences` are that course's attendance totals (0 when none recorded).
 */
export function studentPlaceholderValues(
  s: Student,
  course: string,
  totals?: AttendanceTotals,
): Record<string, string> {
  return {
    firstName: s.firstName ?? '',
    lastName: s.lastName ?? '',
    goesBy: s.goesBy ?? '',
    pronouns: s.pronouns ?? '',
    courseName: course,
    lateCount: String(totals?.tardies ?? 0),
    unexcusedAbsences: String(totals?.absences ?? 0),
  };
}

/**
 * Substitutes `{{token}}` occurrences. Values are HTML-escaped for the body
 * (`escape: true`) so a recipient-visible value can never inject markup; the
 * subject is a plain-text header, so its values are only stripped of CR/LF to
 * prevent header injection. Tokens with no value render as an empty string.
 *
 * Stripping the *values* is not on its own enough for a header, because the
 * template's own subject text is interpolated too and never passed through
 * here as a value. {@link renderSubject} is what a header field must be built
 * with; this function alone leaves the template half unguarded.
 */
export function renderPlaceholders(
  text: string,
  values: Record<string, string>,
  opts: { escape: boolean },
): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, key: string) => {
    const raw = values[key];
    if (raw === undefined) return '';
    return opts.escape ? escapeHtml(raw) : raw.replace(/[\r\n]+/g, ' ');
  });
}

/**
 * The subject as it may appear in a header: placeholders substituted, then the
 * whole result folded to a single line.
 *
 * The fold covers the template's own text, which is the half `renderPlaceholders`
 * cannot see. A saved template can only carry a line break if it predates the
 * schema that now rejects one (see `subjectLine` in routes/email.ts), so this
 * normalises rather than refuses: a stray newline in a teacher's own subject
 * should still send. Anything reaching {@link buildRawMessage} with a break
 * left in it is a bug, and is thrown there rather than folded silently.
 */
export function renderSubject(template: string, values: Record<string, string>): string {
  return renderPlaceholders(template, values, { escape: false }).replace(/[\r\n]+/g, ' ');
}

function encodeSubject(subject: string): string {
  // MIME encoded-word for non-ASCII subjects; plain otherwise.
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

/**
 * Refuses a header value carrying a CR or LF.
 *
 * Headers are joined with CRLF and separated from the body by a blank line, so
 * a break inside a value is not a malformed string — it is a new header, or the
 * end of the header block and an attacker-chosen body after it. Every field
 * below is interpolated, so every field needs this.
 *
 * It throws rather than stripping on purpose. Callers are expected to have
 * normalised already (see {@link renderSubject}) or to have validated the value
 * (see {@link usableAddress}), so reaching here means a layer above failed, and
 * quietly folding the break would hide that for as long as it kept working.
 * The send loop catches it per message: one message is logged as failed and the
 * batch carries on, rather than the fault taking down a whole send.
 *
 * `encodeSubject` cannot be relied on for this. It base64-encodes only
 * *non-ASCII* subjects, and CR and LF are both ASCII, so an all-ASCII subject
 * carrying a break passes through it verbatim.
 *
 * Which is also why the subject is checked *before* encoding rather than after.
 * Encoding a non-ASCII subject does hide a break inside the base64, so a check
 * on the encoded form would quietly pass exactly the inputs a check exists to
 * catch. Testing the raw value keeps one invariant with no exceptions in it:
 * no header value contains a line break at any stage.
 */
function assertHeaderSafe(field: string, value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Refusing to build a message: the ${field} header contains a line break`);
  }
  return value;
}

/** Builds a base64url-encoded RFC 2822 HTML message for the Gmail send API. An
 * optional copy address is added as a Cc or Bcc header on the message. */
export function buildRawMessage(
  from: string,
  to: string,
  subject: string,
  html: string,
  copy?: { mode: CopyMode; address: string },
): string {
  const headers = [
    `From: ${assertHeaderSafe('From', from)}`,
    `To: ${assertHeaderSafe('To', to)}`,
  ];
  if (copy) {
    const field = copy.mode === 'cc' ? 'Cc' : 'Bcc';
    headers.push(`${field}: ${assertHeaderSafe(field, copy.address)}`);
  }
  headers.push(
    `Subject: ${encodeSubject(assertHeaderSafe('Subject', subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
  );
  // The body is not checked: everything after the blank line is body, so a
  // break in the HTML is content rather than structure.
  const message = `${headers.join('\r\n')}\r\n\r\n${html}`;
  return Buffer.from(message, 'utf8').toString('base64url');
}

interface OutboundMessage {
  studentId: string;
  address: string;
  subject: string;
  html: string;
}

/** Resolves a selection to zero or more of the student's on-file addresses, or a
 * skip reason. Addresses are read from the record — never trusted from input.
 *
 * "Never trusted from input" was true of the *request* and not of the record.
 * The record comes out of a spreadsheet the teacher can edit by hand, so each
 * address is checked here against the same schema the write path uses. Rejected
 * ones are returned separately rather than dropped: a teacher told "3 sent" when
 * a guardian was silently skipped has been told the wrong thing, and this is the
 * one place that knows the address was unusable.
 *
 * A student with one bad address and one good one still gets the good one. The
 * alternative, refusing the whole recipient, would withhold a message from a
 * guardian whose own address was fine. */
function resolveAddresses(
  student: Student | undefined,
  sel: RecipientSelection,
): {
  addresses: string[];
  invalid: string[];
  skip?: SendResult['skipped'][number]['reason'];
} {
  if (!student) return { addresses: [], invalid: [], skip: 'student_not_found' };
  const candidates: string[] = [];
  if (sel.includeStudent && student.studentEmail) candidates.push(student.studentEmail);
  if (sel.includeParents) candidates.push(...student.parentEmails);
  if (candidates.length === 0) return { addresses: [], invalid: [], skip: 'no_email' };

  const addresses: string[] = [];
  const invalid: string[] = [];
  for (const candidate of candidates) {
    if (isSendableAddress(candidate)) addresses.push(candidate);
    else invalid.push(candidate);
  }
  return { addresses, invalid };
}

/**
 * Renders and sends one message per resolved recipient address. Validation and
 * recipient resolution happen up front; the daily cap is checked before any
 * send and again per message so a batch that runs into the cap stops cleanly.
 * Every send attempt (success or Gmail failure) writes one emailLog row; log
 * rows never contain the message body. An optional copy address is Cc'd/Bcc'd
 * on every message.
 */
export async function sendEmails(
  gmail: gmail_v1.Gmail,
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  senderEmail: string,
  input: SendEmailInput,
  allowances: SendAllowances,
  /** Identifies the account in operator logs. The row id, never an address. */
  context: { accountId?: string } = {},
): Promise<SendResult> {
  const { daily, monthly: quota } = allowances;
  const [template, students, totals] = await Promise.all([
    getTemplate(sheets, spreadsheetId, userKey, input.templateId),
    listStudents(sheets, spreadsheetId, userKey),
    attendanceTotalsByPair(sheets, spreadsheetId, userKey),
  ]);
  const byId = new Map(students.map((s) => [s.id, s]));
  const copy =
    input.copyAddress && input.copyAddress.length > 0
      ? { mode: input.copyMode ?? 'bcc', address: input.copyAddress }
      : undefined;

  const result: SendResult = { sent: 0, failed: [], skipped: [] };
  const outbound: OutboundMessage[] = [];

  for (const recipient of input.recipients) {
    const student = byId.get(recipient.studentId);
    const { addresses, invalid, skip } = resolveAddresses(student, recipient);
    if (skip) {
      result.skipped.push({ studentId: recipient.studentId, reason: skip });
      continue;
    }
    // Reported before the cap is consulted, because an unusable address is a
    // fact about the record rather than something the allowance decides, and it
    // should reach the teacher whether or not the batch later runs out of room.
    // Nothing is logged to `emailLog`: no send was attempted, and the row would
    // put a hand-edited address into the audit trail for no gain.
    for (const _ of invalid) {
      result.failed.push({ studentId: recipient.studentId, reason: 'invalid_address' });
    }
    if (addresses.length === 0) continue;
    const pairTotals = totals.get(pairKey(recipient.studentId, recipient.course));
    const values = {
      ...studentPlaceholderValues(student as Student, recipient.course, pairTotals),
      ...(input.placeholderValues?.[recipient.studentId] ?? {}),
    };
    const ctx: ConditionContext = {
      lateCount: pairTotals?.tardies ?? 0,
      unexcusedAbsences: pairTotals?.absences ?? 0,
      atRisk: (student as Student).atRiskCourses.includes(recipient.course),
    };
    const subject = renderSubject(template.subject, values);
    // Drop conditional blocks that fail for this recipient, substitute
    // placeholders, then sanitize what came out. The order is load bearing in
    // both directions.
    //
    // Conditionals first, because `data-if` is the template author's marker and
    // a substituted value must never be able to introduce one.
    //
    // Sanitizing **last** rather than first, which is the half that changed.
    // `escape: true` covers a value landing in text — it escapes `& < > " '`, so
    // no value can open a tag. It does not cover a value landing inside an
    // attribute the template already opened. A saved template may legitimately
    // carry `<a href="{{goesBy}}">`: an href holding only a placeholder is a
    // relative URL, so it survives `sanitizeForSave`, and none of the escaped
    // characters appear in `javascript:alert(1)`. Sanitizing before substitution
    // meant both passes inspected the placeholder rather than the value, and the
    // value reached the recipient's mail client unexamined. Running the
    // sanitizer over the finished document is what puts the scheme allowlist in
    // front of the value instead of in front of the token.
    //
    // Escaping is still done first and still matters: it is what keeps a value
    // from being parsed as markup at all, so the sanitizer is deciding about the
    // template's structure rather than about structure a value invented. The two
    // are layers, not alternatives. Passing already-escaped text through
    // sanitize-html is a round trip — it decodes entities to text and re-encodes
    // them on output — so nothing is double-escaped.
    //
    // `data-if` is stripped by this same call, as it always was; it is just now
    // stripped at the end rather than the middle.
    const conditioned = filterConditionalHtml(template.bodyHtml, ctx);
    const html = sanitizeEmailHtml(renderPlaceholders(conditioned, values, { escape: true }));
    for (const address of addresses) {
      outbound.push({ studentId: recipient.studentId, address, subject, html });
    }
  }

  // Claim the day's allowance *before* going near Gmail.
  //
  // This used to read a count and then send against it, which meant two
  // concurrent batches read the same number and each sent a full allowance
  // under it. Measured at 600 messages against the then-cap of 200 with only four
  // overlapping requests, and the burst limiter permits sixty in ten seconds.
  // The count also came from `emailLog` in the teacher's own spreadsheet, so
  // deleting those rows reset the cap outright, no race required.
  //
  // Reserving turns both into one atomic UPDATE: whatever else is in flight,
  // this batch is told what its own claim brought the day's total to, and the
  // unused part is handed back at the end.
  const claimed = await daily.reserve(outbound.length);
  let remaining = Math.max(0, EMAIL_DAILY_CAP - (claimed - outbound.length));
  if (remaining <= 0) {
    // Nothing will be sent, so return the whole claim before refusing.
    await daily.release(outbound.length);
    throw new ApiError(
      'DAILY_EMAIL_CAP',
      `The daily send limit of ${EMAIL_DAILY_CAP} emails has been reached. It resets at 00:00 UTC.`,
    );
  }

  // A capped plan is checked before anything is sent, and a request that would
  // cross its allowance is rejected whole rather than partially applied: the
  // teacher retries the same send after upgrading instead of reconstructing
  // which half of the class already heard from them.
  if (quota) {
    const monthlyRemaining = Math.max(0, quota.cap - quota.used);
    if (outbound.length > monthlyRemaining) {
      // Refuse whole, so hand back the daily claim too: nothing is being sent,
      // and a rejected request must not quietly spend the teacher's day.
      await daily.release(outbound.length);
      throw new ApiError(
        'MONTHLY_EMAIL_CAP',
        monthlyRemaining === 0
          ? `The free plan's limit of ${quota.cap} emails a month has been reached. It resets on ${quota.resetsAt.slice(0, 10)}.`
          : `This send is ${outbound.length} emails and only ${monthlyRemaining} of the free plan's ${quota.cap} a month remain. The allowance resets on ${quota.resetsAt.slice(0, 10)}.`,
      );
    }
    remaining = Math.min(remaining, monthlyRemaining);
  }

  const now = nowIso();
  const logRows: RowObject[] = [];
  // Why Gmail refused, keyed by Google's own codes and counted, so a batch of
  // thirty identical refusals is one log line rather than thirty. The response
  // to the teacher still says only `send_failed`; this is for the operator, who
  // otherwise has no way to tell a missing permission from a rejected address.
  const gmailFailures = new Map<string, { summary: GoogleErrorSummary; count: number }>();
  for (const msg of outbound) {
    if (remaining <= 0) {
      result.failed.push({ studentId: msg.studentId, reason: 'daily_cap' });
      continue;
    }
    try {
      const raw = buildRawMessage(senderEmail, msg.address, msg.subject, msg.html, copy);
      await trackGoogleCall('gmail', 'messages.send', () =>
        gmail.users.messages.send({ userId: 'me', requestBody: { raw } }),
      );
      result.sent += 1;
      remaining -= 1;
      logRows.push(logRow(template.id, msg.address, msg.studentId, now, 'sent', null));
    } catch (err) {
      result.failed.push({ studentId: msg.studentId, reason: 'send_failed' });
      logRows.push(logRow(template.id, msg.address, msg.studentId, now, 'failed', 'send_failed'));
      const summary = summarizeGoogleError(err);
      const key = `${summary.status}|${summary.reason}|${summary.googleStatus}`;
      const entry = gmailFailures.get(key) ?? { summary, count: 0 };
      entry.count += 1;
      gmailFailures.set(key, entry);
    }
  }
  for (const { summary, count } of gmailFailures.values()) {
    logger.warn(
      { ...summary, count, accountId: context.accountId, attempted: outbound.length },
      'Gmail refused email sends',
    );
  }

  if (logRows.length > 0) {
    await appendRows(sheets, spreadsheetId, 'emailLog', logRows);
  }
  // Hand back what was claimed and not spent: messages the cap stopped, and
  // messages Gmail refused. A teacher should not lose a day's allowance to a
  // batch that ran into the limit, nor to Gmail failing. Only what actually
  // left counts.
  const unused = outbound.length - result.sent;
  if (unused > 0) await daily.release(unused);

  // Only successful sends count against the allowance; a Gmail failure is not
  // something the teacher should pay for out of their month.
  if (quota && result.sent > 0) await quota.record(result.sent);

  return result;
}

function logRow(
  templateId: string,
  recipientAddress: string,
  recipientStudentId: string,
  sentAt: string,
  statusKey: 'sent' | 'failed',
  errorCode: string | null,
): RowObject {
  return {
    id: ulid(),
    templateId,
    recipientAddress,
    recipientStudentId,
    sentAt,
    statusKey,
    errorCode,
  };
}
