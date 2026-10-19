import type { sheets_v4 } from 'googleapis';
import { ulid } from 'ulid';
import sanitizeHtml from 'sanitize-html';
import { ApiError } from '../utils/errors.js';
import { nowIso } from '../utils/time.js';
import { cacheKey, getOrLoad, updateCached } from './cache.js';
import {
  appendRow,
  readTabRowsIndexed,
  updateRowByNumber,
  isActive,
  type RowObject,
} from './sheets.js';
import {
  evaluateCondition,
  isValidCondition,
  type ConditionContext,
} from './emailConditions.js';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  placeholdersUsed: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateCreateInput {
  name: string;
  subject: string;
  bodyHtml: string;
  placeholdersUsed: string[];
}

export type EmailTemplateUpdateInput = Partial<EmailTemplateCreateInput>;

const RESOURCE = 'emailTemplates';

/**
 * Strict allowlist matching exactly what the email rich-text editor produces
 * (see DEPENDENCIES.md). Anything outside it is discarded. Links keep only
 * `href`, are restricted to safe schemes, and always carry
 * rel="noopener noreferrer".
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'a'],
  // `rel` is allowed only so the forced rel="noopener noreferrer" from
  // transformTags survives attribute filtering; teacher input can't set it
  // because simpleTransform overwrites it.
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { a: ['http', 'https', 'mailto'] },
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

// Block tags that may carry a `data-if` conditional. Saved templates keep the
// attribute; the final email (sanitizeEmailHtml) strips it.
const CONDITION_TAGS = ['p', 'ul', 'ol', 'li'] as const;
const SAVE_OPTIONS: sanitizeHtml.IOptions = {
  ...SANITIZE_OPTIONS,
  allowedAttributes: {
    a: ['href', 'rel'],
    ...Object.fromEntries(CONDITION_TAGS.map((t) => [t, ['data-if']])),
  },
};

/** Markers that unambiguously indicate hand-authored HTML the editor never
 * emits. Their presence is rejected outright so raw HTML cannot be smuggled in;
 * everything else is defensively stripped by sanitizeEmailHtml regardless. */
const DANGEROUS_HTML = /<\s*(script|style|iframe|object|embed|link|meta)\b|on[a-z]+\s*=|javascript:/i;

/** Sanitizes editor HTML down to the base allowlist, dropping any `data-if`.
 * This is the final form sent to Gmail — no unsanitized HTML, no leftover
 * conditional markers. */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Sanitizes editor HTML for storage, preserving valid `data-if` conditionals
 * on block tags. */
export function sanitizeForSave(html: string): string {
  return sanitizeHtml(html, SAVE_OPTIONS);
}

function conditionValues(html: string): string[] {
  const out: string[] = [];
  const re = /data-if="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** Rejects a body whose conditional markers do not match the grammar. Runs on
 * sanitized output, so it only sees `data-if` on allowed block tags. */
function assertValidConditions(html: string): void {
  for (const raw of conditionValues(html)) {
    if (!isValidCondition(raw)) {
      throw new ApiError('VALIDATION_ERROR', 'A conditional block has an invalid condition.');
    }
  }
}

/**
 * Drops block elements whose `data-if` condition is false for `ctx`, keeping the
 * attribute on survivors (stripped later by sanitizeEmailHtml). Runs at send
 * time, once per (student, course).
 */
export function filterConditionalHtml(html: string, ctx: ConditionContext): string {
  return sanitizeHtml(html, {
    ...SAVE_OPTIONS,
    exclusiveFilter: (frame) => {
      const cond = frame.attribs?.['data-if'];
      return cond ? !evaluateCondition(cond, ctx) : false;
    },
  });
}

/** Rejects bodies containing raw HTML that could not have come from the editor.
 * Pairs with sanitizeEmailHtml (defense in depth): this returns a clear 400 for
 * obviously-malicious input rather than silently stripping it. */
function assertEditorHtml(bodyHtml: string): void {
  if (DANGEROUS_HTML.test(bodyHtml)) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'The email body contains formatting that is not allowed.',
    );
  }
}

function str(v: RowObject[string]): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function rowToTemplate(obj: RowObject): EmailTemplate {
  const placeholdersRaw = str(obj.placeholdersUsed);
  return {
    id: String(obj.id),
    name: String(obj.name ?? ''),
    subject: String(obj.subject ?? ''),
    bodyHtml: String(obj.bodyHtml ?? ''),
    placeholdersUsed: placeholdersRaw ? placeholdersRaw.split('|').filter(Boolean) : [],
    createdAt: String(obj.createdAt ?? ''),
    updatedAt: String(obj.updatedAt ?? ''),
  };
}

export async function listTemplates(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
): Promise<EmailTemplate[]> {
  return getOrLoad(cacheKey(userKey, RESOURCE), async () => {
    const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'emailTemplates');
    return rows.filter((r) => isActive(r.obj)).map((r) => rowToTemplate(r.obj));
  });
}

export async function getTemplate(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
): Promise<EmailTemplate> {
  const templates = await listTemplates(sheets, spreadsheetId, userKey);
  const found = templates.find((t) => t.id === id);
  if (!found) throw new ApiError('NOT_FOUND', 'Email template not found.');
  return found;
}

export async function createTemplate(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  input: EmailTemplateCreateInput,
): Promise<EmailTemplate> {
  assertEditorHtml(input.bodyHtml);
  const bodyHtml = sanitizeForSave(input.bodyHtml);
  assertValidConditions(bodyHtml);
  const now = nowIso();
  const row: RowObject = {
    id: ulid(),
    name: input.name,
    subject: input.subject,
    bodyHtml,
    placeholdersUsed: input.placeholdersUsed.join('|') || null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  await appendRow(sheets, spreadsheetId, 'emailTemplates', row);
  const created = rowToTemplate(row);
  updateCached<EmailTemplate[]>(cacheKey(userKey, RESOURCE), (list) => [...list, created]);
  return created;
}

export async function updateTemplate(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
  patch: EmailTemplateUpdateInput,
): Promise<EmailTemplate> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'emailTemplates');
  const match = rows.find((r) => r.obj.id === id && isActive(r.obj));
  if (!match) throw new ApiError('NOT_FOUND', 'Email template not found.');

  const next: RowObject = { ...match.obj };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.subject !== undefined) next.subject = patch.subject;
  if (patch.bodyHtml !== undefined) {
    assertEditorHtml(patch.bodyHtml);
    const bodyHtml = sanitizeForSave(patch.bodyHtml);
    assertValidConditions(bodyHtml);
    next.bodyHtml = bodyHtml;
  }
  if (patch.placeholdersUsed !== undefined) {
    next.placeholdersUsed = patch.placeholdersUsed.join('|') || null;
  }
  next.updatedAt = nowIso();

  await updateRowByNumber(sheets, spreadsheetId, 'emailTemplates', match.rowNumber, next, {
    headerValidated: true,
  });
  const updated = rowToTemplate(next);
  updateCached<EmailTemplate[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.map((t) => (t.id === updated.id ? updated : t)),
  );
  return updated;
}

export async function softDeleteTemplate(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  userKey: string,
  id: string,
): Promise<void> {
  const rows = await readTabRowsIndexed(sheets, spreadsheetId, 'emailTemplates');
  const match = rows.find((r) => r.obj.id === id && isActive(r.obj));
  if (!match) throw new ApiError('NOT_FOUND', 'Email template not found.');

  const now = nowIso();
  const deleted: RowObject = { ...match.obj, updatedAt: now, deletedAt: now };
  await updateRowByNumber(sheets, spreadsheetId, 'emailTemplates', match.rowNumber, deleted, {
    headerValidated: true,
  });
  updateCached<EmailTemplate[]>(cacheKey(userKey, RESOURCE), (list) =>
    list.filter((t) => t.id !== id),
  );
}
