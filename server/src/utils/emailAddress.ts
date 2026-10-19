import { z } from 'zod';

/**
 * The one definition of an address this app will accept or send to.
 *
 * It is shared between the write path (the student routes' validation) and the
 * read path (resolving recipients out of the spreadsheet) on purpose. Those two
 * used to disagree: writes were validated with `z.email()` while reads took the
 * cell contents as a string, so an address that could never have been *stored*
 * through the app could still be *sent to* by editing the sheet directly. The
 * gap was not theoretical — it let a value carrying a CRLF inject arbitrary
 * SMTP headers, including a Bcc that silently copied every message about a
 * student to a third party. One schema is what keeps the two ends from drifting
 * apart again.
 *
 * 254 is the RFC 5321 maximum length of a forward path.
 */
export const emailAddressSchema = z.email().max(254);

/**
 * Whether an address read back from the teacher's spreadsheet may be used as a
 * recipient.
 *
 * The spreadsheet is the system of record and it is *editable by hand*, by the
 * teacher and by anyone they have shared it with, so nothing read out of it has
 * been through the app's validation. It is an untrusted external input in
 * exactly the way a request body is, and this is the boundary check that treats
 * it as one.
 */
export function isSendableAddress(value: string): boolean {
  return emailAddressSchema.safeParse(value).success;
}
