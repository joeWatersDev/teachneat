/**
 * Operator path for Step 8b, run by hand after restoring a backup to a scratch
 * cluster: count the rows in every table and confirm that every stored refresh
 * token still decrypts under the current key ring.
 *
 * Connects to RESTORE_DATABASE_URL and never to DATABASE_URL, so pointing it at
 * a database is a deliberate act rather than whatever server/.env happens to
 * hold. RESTORE_DATABASE_CA_CERT carries that cluster's CA, because TLS
 * verification stays on here for the same reason it does in pool.ts. Both
 * queries are reads, so running it against production for a baseline is safe.
 *
 * The ring is built the way initTokenCipher builds it, from the KMS variables
 * in the environment. Plaintext tokens are never printed or retained: the
 * output is counts, plus the user id of any row that fails.
 *
 *   npx tsx scripts/check-restore.ts
 */
import 'dotenv/config';
import pg from 'pg';
import { unwrapKey } from '../src/services/kms.js';
import { createKeyedCipher } from '../src/services/tokenCipher.js';

const url = process.env.RESTORE_DATABASE_URL ?? '';
const ca = (process.env.RESTORE_DATABASE_CA_CERT ?? '').replace(/\\n/g, '\n');
const keyName = process.env.TOKEN_KMS_KEY_NAME ?? '';
const wrappedKey = process.env.TOKEN_KEY_WRAPPED ?? '';
const keyId = process.env.TOKEN_KEY_ID || 'k1';
const legacySecret = process.env.TOKEN_ENCRYPTION_KEY ?? '';

if (!url) {
  console.error('RESTORE_DATABASE_URL is not set. Point it at the restored cluster.');
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error('RESTORE_DATABASE_URL equals DATABASE_URL. Point it at the restored cluster.');
  process.exit(1);
}
if (!ca && /sslmode=/.test(url)) {
  console.error(
    'RESTORE_DATABASE_URL uses TLS but RESTORE_DATABASE_CA_CERT is not set, so the server certificate ' +
      "cannot be verified. Set it to the cluster's CA certificate (ops/RESTORE_TEST.md, step 4).",
  );
  process.exit(1);
}
if (!keyName || !wrappedKey) {
  console.error('TOKEN_KMS_KEY_NAME and TOKEN_KEY_WRAPPED must be set to check token decryption.');
  process.exit(1);
}

function clientConfig(): pg.ClientConfig {
  if (!ca) return { connectionString: url };
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, '') || undefined,
    ssl: { ca, rejectUnauthorized: true },
  };
}

const started = Date.now();
const client = new pg.Client(clientConfig());
await client.connect();

const failed: string[] = [];
try {
  console.log(`Database host: ${new URL(url).hostname}`);

  const { rows: tables } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  console.log('\nRow counts');
  for (const { table_name } of tables) {
    const quoted = `"${table_name.replace(/"/g, '""')}"`;
    const { rows } = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${quoted}`);
    console.log(`  ${table_name.padEnd(24)} ${rows[0]?.n ?? '?'}`);
  }

  const key = await unwrapKey(
    { keyName, credentialsJson: process.env.TOKEN_KMS_CREDENTIALS ?? '' },
    wrappedKey,
  );
  const cipher = createKeyedCipher(
    [{ id: keyId, key }],
    keyId,
    legacySecret.length > 0 ? legacySecret : undefined,
  );

  const { rows: users } = await client.query<{ id: string; refresh_token_enc: string | null }>(
    'SELECT id, refresh_token_enc FROM users',
  );
  let decrypted = 0;
  let empty = 0;
  const formats = new Map<string, number>();
  for (const user of users) {
    const payload = user.refresh_token_enc;
    if (!payload) {
      empty++;
      continue;
    }
    const format = payload.startsWith('v2:') ? `v2, key ${payload.slice(3).split('.')[0]}` : 'legacy';
    formats.set(format, (formats.get(format) ?? 0) + 1);
    try {
      if (cipher.decrypt(payload).length === 0) throw new Error('empty plaintext');
      decrypted++;
    } catch {
      failed.push(user.id);
    }
  }

  console.log(`\nRefresh tokens (ring active key ${keyId})`);
  console.log(`  users                    ${users.length}`);
  console.log(`  decrypted                ${decrypted}`);
  console.log(`  failed                   ${failed.length}`);
  console.log(`  no token stored          ${empty}`);
  for (const [format, n] of formats) console.log(`  format ${format.padEnd(17)} ${n}`);
  for (const id of failed) console.log(`  failed user id           ${id}`);
} finally {
  await client.end();
}

console.log(`\nCheck took ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(failed.length > 0 ? 1 : 0);
