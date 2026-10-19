import type { sheets_v4, drive_v3 } from 'googleapis';
import { SCHEMA_VERSION } from '../config/schema.js';
import { trackGoogleCall } from './apiMetrics.js';
import { readStoredSchemaVersion, stampSchemaVersion } from './schemaMeta.js';
import { migrateV4ToV5 } from './migrationV4ToV5.js';
import { migrateV5ToV6 } from './migrationV5ToV6.js';

/**
 * Version-gated migrations for NON-additive schema changes — column renames or
 * removals, tab restructures, and data transforms. Purely additive bumps (a new
 * tab, or a new trailing column on an existing tab) need no entry here: they are
 * handled generically by the additive reconciliation in bootstrap, which extends
 * a prefix header to the current schema without any per-version code.
 *
 * Each migration transforms the sheet from `from` to `to`. It must operate on
 * RAW cell values via the Sheets API directly — the typed helpers in sheets.ts
 * assert the *current* schema's header and would reject a pre-migration tab.
 */
export interface Migration {
  from: string;
  to: string;
  description: string;
  migrate: (sheets: sheets_v4.Sheets, spreadsheetId: string) => Promise<void>;
}

/**
 * The ordered registry. v1→v2→v3 were shipped as pre-runner clean resets and
 * v3→v4 was purely additive, so v4→v5 is the first entry here. Add an entry only
 * for a non-additive change.
 */
export const MIGRATIONS: Migration[] = [
  {
    from: '4',
    to: '5',
    description: 'Attendance stored as exceptions plus class-day markers (Step 6k)',
    migrate: migrateV4ToV5,
  },
  {
    from: '5',
    to: '6',
    description: 'Drop the soft-deleted grouping rows the old auto-save left behind',
    migrate: migrateV5ToV6,
  },
];

export interface RunMigrationsOptions {
  /** Override the registry (tests inject a fake chain). Defaults to MIGRATIONS. */
  migrations?: Migration[];
  /** When set, a best-effort Drive backup copy is taken before the first step runs. */
  drive?: drive_v3.Drive;
}

/**
 * Walks the sheet forward from its stored schemaVersion toward the code's target
 * (`SCHEMA_VERSION`), applying registered migrations in order and stamping the
 * version after each completed step (so a mid-chain failure leaves the sheet at
 * the last fully-applied version rather than an ambiguous state).
 *
 * It stops as soon as no registered migration continues from the current
 * version. Any remaining gap to the target is assumed purely additive and is
 * closed by the additive reconciliation + final restamp that bootstrap runs
 * next. Returns the applied steps as `"from->to"` strings.
 */
export async function runMigrations(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  opts: RunMigrationsOptions = {},
): Promise<string[]> {
  const registry = opts.migrations ?? MIGRATIONS;
  const stored = (await readStoredSchemaVersion(sheets, spreadsheetId)) ?? SCHEMA_VERSION;
  let current = stored;
  const applied: string[] = [];
  let backedUp = false;

  while (current !== SCHEMA_VERSION) {
    const step = registry.find((m) => m.from === current);
    if (!step) break;
    if (opts.drive && !backedUp) {
      await backupBeforeMigrate(opts.drive, spreadsheetId, stored);
      backedUp = true;
    }
    await step.migrate(sheets, spreadsheetId);
    await stampSchemaVersion(sheets, spreadsheetId, step.to);
    applied.push(`${step.from}->${step.to}`);
    current = step.to;
  }
  return applied;
}

/**
 * Best-effort pre-migration backup: a Drive copy of the workbook, so a failed
 * non-additive migration is recoverable. A failure here must never block the
 * migration itself, so it is swallowed. Uses `drive.file` scope (the app owns
 * the file it created).
 */
async function backupBeforeMigrate(
  drive: drive_v3.Drive,
  spreadsheetId: string,
  fromVersion: string,
): Promise<void> {
  try {
    await trackGoogleCall('drive', 'files.copy', () =>
      drive.files.copy({
        fileId: spreadsheetId,
        requestBody: {
          name: `Teachneat Data — backup before v${SCHEMA_VERSION} migration (from v${fromVersion})`,
        },
      }),
    );
  } catch {
    // The backup is a safety net, not the operation. Never block the migration on it.
  }
}
