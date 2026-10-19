import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.nodeEnv === 'test' ? 'silent' : env.nodeEnv === 'production' ? 'info' : 'debug',
  /**
   * A backstop, not the control. Nothing is supposed to log student data in the
   * first place; this is what catches the case where something does, so the
   * failure is a redacted field rather than a name in a log line.
   *
   * `notes` is the one worth naming. It is free text on a student record, which
   * is where a teacher writes the things that are least appropriate to log:
   * behavioural observations, medical detail, family circumstances. `goesBy` and
   * `pronouns` are identifying in the same way `firstName` is, and were missing
   * for no reason other than that the list was written from the fields that
   * happened to come to mind.
   *
   * Note the shape of `*.field`: pino matches one level of nesting, so a student
   * logged as `{ student: { profile: { firstName } } }` would not be caught.
   * That is a reason not to log the object, not a reason to enumerate deeper.
   */
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.refreshToken',
      '*.accessToken',
      '*.parentEmails',
      '*.studentEmail',
      '*.recipientAddress',
      '*.firstName',
      '*.lastName',
      '*.goesBy',
      '*.pronouns',
      '*.notes',
    ],
    censor: '[redacted]',
  },
});
