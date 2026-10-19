import { describe, it, expect, beforeEach } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { clearCache } from './cache.js';
import {
  listConstraints,
  createConstraint,
  updateConstraint,
  softDeleteConstraint,
} from './groupingConstraints.js';
import { isApiError } from '../utils/errors.js';

const USER = 'user-sub-1';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, spreadsheetId };
}

describe('groupingConstraints service', () => {
  beforeEach(() => clearCache());

  it('creates and lists a constraint with pipe-joined studentIds', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createConstraint(sheets, spreadsheetId, USER, {
      constraintTypeKey: 'together',
      studentIds: ['a', 'b', 'c'],
      notes: 'lab partners',
    });
    expect(created.studentIds).toEqual(['a', 'b', 'c']);

    const all = await listConstraints(sheets, spreadsheetId, USER);
    expect(all).toHaveLength(1);
    expect(all[0].constraintTypeKey).toBe('together');
    expect(all[0].studentIds).toEqual(['a', 'b', 'c']);
    expect(all[0].notes).toBe('lab partners');
  });

  it('updates a constraint in place', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createConstraint(sheets, spreadsheetId, USER, {
      constraintTypeKey: 'apart',
      studentIds: ['a', 'b'],
    });
    const updated = await updateConstraint(sheets, spreadsheetId, USER, created.id, {
      studentIds: ['a', 'b', 'd'],
      notes: 'keep separated',
    });
    expect(updated.studentIds).toEqual(['a', 'b', 'd']);
    expect(updated.notes).toBe('keep separated');

    const all = await listConstraints(sheets, spreadsheetId, USER);
    expect(all).toHaveLength(1);
    expect(all[0].studentIds).toEqual(['a', 'b', 'd']);
  });

  it('soft-deletes a constraint so it no longer lists', async () => {
    const { sheets, spreadsheetId } = await setup();
    const created = await createConstraint(sheets, spreadsheetId, USER, {
      constraintTypeKey: 'apart',
      studentIds: ['a', 'b'],
    });
    await softDeleteConstraint(sheets, spreadsheetId, USER, created.id);
    expect(await listConstraints(sheets, spreadsheetId, USER)).toHaveLength(0);
  });

  it('404s updating or deleting an unknown constraint', async () => {
    const { sheets, spreadsheetId } = await setup();
    await expect(
      updateConstraint(sheets, spreadsheetId, USER, 'nope', { notes: 'x' }),
    ).rejects.toSatisfy((e: unknown) => isApiError(e) && e.code === 'NOT_FOUND');
    await expect(
      softDeleteConstraint(sheets, spreadsheetId, USER, 'nope'),
    ).rejects.toSatisfy((e: unknown) => isApiError(e) && e.code === 'NOT_FOUND');
  });
});
