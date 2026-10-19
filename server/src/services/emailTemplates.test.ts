import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  softDeleteTemplate,
  sanitizeEmailHtml,
  filterConditionalHtml,
} from './emailTemplates.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, spreadsheetId };
}

const base = {
  name: 'Absence notice',
  subject: 'About {{firstName}}',
  bodyHtml: '<p>Hello {{firstName}}</p>',
  placeholdersUsed: ['firstName'],
};

describe('email templates service', () => {
  beforeEach(() => clearCache());

  it('creates, lists, gets, updates, and soft-deletes a template', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createTemplate(sheets, spreadsheetId, USER, base);
    expect(created.id).toBeTruthy();
    expect(created.placeholdersUsed).toEqual(['firstName']);

    const list = await listTemplates(sheets, spreadsheetId, USER);
    expect(list).toHaveLength(1);

    const fetched = await getTemplate(sheets, spreadsheetId, USER, created.id);
    expect(fetched.name).toBe('Absence notice');

    const updated = await updateTemplate(sheets, spreadsheetId, USER, created.id, {
      subject: 'Updated {{firstName}}',
    });
    expect(updated.subject).toBe('Updated {{firstName}}');
    expect(updated.bodyHtml).toBe('<p>Hello {{firstName}}</p>');

    await softDeleteTemplate(sheets, spreadsheetId, USER, created.id);
    expect(await listTemplates(sheets, spreadsheetId, USER)).toHaveLength(0);
  });

  it('404s for unknown ids on get/update/delete', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(getTemplate(sheets, spreadsheetId, USER, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      updateTemplate(sheets, spreadsheetId, USER, 'nope', { name: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(softDeleteTemplate(sheets, spreadsheetId, USER, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a body containing raw HTML the editor never emits', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(
      createTemplate(sheets, spreadsheetId, USER, {
        ...base,
        bodyHtml: '<p>hi</p><script>alert(1)</script>',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Nothing was written.
    expect(await listTemplates(sheets, spreadsheetId, USER)).toHaveLength(0);
  });

  it('strips disallowed-but-benign tags down to the allowlist on save', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createTemplate(sheets, spreadsheetId, USER, {
      ...base,
      bodyHtml: '<h1>Big</h1><p>Hi <strong>there</strong></p><div>x</div>',
    });
    expect(created.bodyHtml).toBe('Big<p>Hi <strong>there</strong></p>x');
  });

  it('keeps allowed links but forces rel and drops unsafe schemes', () => {
    expect(sanitizeEmailHtml('<a href="https://ok.test">ok</a>')).toBe(
      '<a href="https://ok.test" rel="noopener noreferrer">ok</a>',
    );
    // javascript: scheme is dropped, leaving the anchor without an href.
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('preserves a valid data-if conditional on a block when saved', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createTemplate(sheets, spreadsheetId, USER, {
      ...base,
      bodyHtml: '<p>Hi</p><p data-if="lateCount gte 3">You have been late a lot.</p>',
    });
    expect(created.bodyHtml).toContain('data-if="lateCount gte 3"');
  });

  it('rejects a template with an invalid conditional', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(
      createTemplate(sheets, spreadsheetId, USER, {
        ...base,
        bodyHtml: '<p data-if="absenceRate gte 25">nope</p>',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await listTemplates(sheets, spreadsheetId, USER)).toHaveLength(0);
  });

  it('final send-time sanitize strips the data-if marker', () => {
    expect(sanitizeEmailHtml('<p data-if="lateCount gte 3">hi</p>')).toBe('<p>hi</p>');
  });
});

describe('filterConditionalHtml', () => {
  const ctx = { lateCount: 0, unexcusedAbsences: 0, atRisk: false };

  it('keeps a block whose condition passes and drops one that fails', () => {
    const html =
      '<p>Always</p>' +
      '<p data-if="lateCount gte 3">Late warning</p>' +
      '<p data-if="atRisk is true">Check-in note</p>';
    const kept = filterConditionalHtml(html, { ...ctx, lateCount: 4, atRisk: false });
    expect(kept).toContain('Always');
    expect(kept).toContain('Late warning');
    expect(kept).not.toContain('Check-in note');
  });

  it('drops a failing conditional list item but keeps the rest of the list', () => {
    const html = '<ul><li>Keep</li><li data-if="unexcusedAbsences gte 5">Drop</li></ul>';
    const kept = filterConditionalHtml(html, ctx);
    expect(kept).toContain('Keep');
    expect(kept).not.toContain('Drop');
  });
});
