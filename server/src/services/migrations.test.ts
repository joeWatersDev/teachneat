import { describe, it, expect } from 'vitest';
import { FakeGoogleEnv } from '../test/fakeGoogle.js';
import { discoverOrCreateSpreadsheet } from './bootstrap.js';
import { runMigrations, type Migration } from './migrations.js';
import { readStoredSchemaVersion, stampSchemaVersion } from './schemaMeta.js';
import { SCHEMA_VERSION } from '../config/schema.js';

async function setup() {
  const env = new FakeGoogleEnv();
  const sheets = env.buildSheets();
  const drive = env.buildDrive();
  const { spreadsheetId } = await discoverOrCreateSpreadsheet(sheets, drive);
  return { env, sheets, drive, spreadsheetId };
}

describe('runMigrations', () => {
  it('applies nothing when the sheet is already at the target version', async () => {
    const { sheets, spreadsheetId } = await setup();
    expect(await runMigrations(sheets, spreadsheetId, { migrations: [] })).toEqual([]);
  });

  it('walks registered steps in order from the stored version, stamping each', async () => {
    const { sheets, spreadsheetId } = await setup();
    await stampSchemaVersion(sheets, spreadsheetId, '1');

    const order: string[] = [];
    const migrations: Migration[] = [
      { from: '1', to: '2', description: 'a', migrate: async () => void order.push('1->2') },
      {
        from: '2',
        to: SCHEMA_VERSION,
        description: 'b',
        migrate: async () => void order.push(`2->${SCHEMA_VERSION}`),
      },
    ];

    const applied = await runMigrations(sheets, spreadsheetId, { migrations });
    expect(applied).toEqual(['1->2', `2->${SCHEMA_VERSION}`]);
    expect(order).toEqual(['1->2', `2->${SCHEMA_VERSION}`]);
    expect(await readStoredSchemaVersion(sheets, spreadsheetId)).toBe(SCHEMA_VERSION);
  });

  it('stops when no step continues the chain, leaving the rest to additive reconcile', async () => {
    const { sheets, spreadsheetId } = await setup();
    await stampSchemaVersion(sheets, spreadsheetId, '1');
    const migrations: Migration[] = [
      { from: '1', to: '2', description: 'a', migrate: async () => {} },
      // no step from '2' onward — a purely additive remainder
    ];

    const applied = await runMigrations(sheets, spreadsheetId, { migrations });
    expect(applied).toEqual(['1->2']);
    // Stamped only as far as the applied step; bootstrap's final restamp finishes it.
    expect(await readStoredSchemaVersion(sheets, spreadsheetId)).toBe('2');
  });

  it('takes exactly one best-effort Drive backup before applying steps', async () => {
    const { env, sheets, drive, spreadsheetId } = await setup();
    await stampSchemaVersion(sheets, spreadsheetId, '1');
    const migrations: Migration[] = [
      { from: '1', to: '2', description: 'a', migrate: async () => {} },
      { from: '2', to: SCHEMA_VERSION, description: 'b', migrate: async () => {} },
    ];

    await runMigrations(sheets, spreadsheetId, { migrations, drive });
    expect(env.callCounts['drive.copy']).toBe(1);
  });

  it('does not back up when there are no steps to apply', async () => {
    const { env, sheets, drive, spreadsheetId } = await setup();
    await runMigrations(sheets, spreadsheetId, { migrations: [], drive });
    expect(env.callCounts['drive.copy'] ?? 0).toBe(0);
  });
});
