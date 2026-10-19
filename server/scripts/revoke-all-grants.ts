/**
 * Sunset path, run by hand once, immediately before the production database is
 * deleted: revoke every stored Google refresh token, so that Teachneat leaves
 * each teacher's list of authorised apps rather than lingering there after the
 * service is gone. It is the bulk form of what account deletion does per
 * teacher (`revokeRefreshToken` in routes/auth.ts), and it touches nothing in
 * the database; deleting the cluster afterwards is what removes the rows.
 *
 * Connects to TEARDOWN_DATABASE_URL and never to DATABASE_URL, so pointing it
 * at production is a deliberate act. TEARDOWN_DATABASE_CA_CERT carries the
 * cluster's CA. The key ring is built the way check-restore.ts builds it, from
 * the KMS variables in the environment. Revocation posts to Google's revoke
 * endpoint directly, which needs no client credentials, so this script does
 * not load the server's config. Tokens are never printed; the output is counts.
 *
 * Without --execute it decrypts every token and reports what it would revoke.
 *
 *   npx tsx scripts/revoke-all-grants.ts
 *   npx tsx scripts/revoke-all-grants.ts --execute
 */
import 'dotenv/config';
import pg from 'pg';
import { unwrapKey } from '../src/services/kms.js';
import { createKeyedCipher } from '../src/services/tokenCipher.js';

const execute = process.argv.includes('--execute');
const url = process.env.TEARDOWN_DATABASE_URL ?? '';
const ca = (process.env.TEARDOWN_DATABASE_CA_CERT ?? '').replace(/\\n/g, '\n');
const keyName = process.env.TOKEN_KMS_KEY_NAME ?? '';
const wrappedKey = process.env.TOKEN_KEY_WRAPPED ?? '';
const keyId = process.env.TOKEN_KEY_ID || 'k1';
const legacySecret = process.env.TOKEN_ENCRYPTION_KEY ?? '';

if (!url || !ca) {
  console.error('Set TEARDOWN_DATABASE_URL and TEARDOWN_DATABASE_CA_CERT to the production cluster.');
  process.exit(1);
}
if (!keyName || !wrappedKey) {
  console.error('TOKEN_KMS_KEY_NAME and TOKEN_KEY_WRAPPED must be set to decrypt the stored tokens.');
  process.exit(1);
}

const parsed = new URL(url);
const client = new pg.Client({
  host: parsed.hostname,
  port: parsed.port ? Number.parseInt(parsed.port, 10) : 5432,
  user: decodeURIComponent(parsed.username),
  password: decodeURIComponent(parsed.password),
  database: parsed.pathname.replace(/^\//, '') || undefined,
  ssl: { ca, rejectUnauthorized: true },
});
await client.connect();

const key = await unwrapKey({ keyName, credentialsJson: process.env.TOKEN_KMS_CREDENTIALS ?? '' }, wrappedKey);
const cipher = createKeyedCipher([{ id: keyId, key }], keyId, legacySecret.length > 0 ? legacySecret : undefined);

const counts = { accounts: 0, noToken: 0, undecryptable: 0, revoked: 0, alreadyInvalid: 0, wouldRevoke: 0 };
try {
  console.log(`Database host: ${parsed.hostname}${execute ? '' : '  (dry run; pass --execute to revoke)'}`);
  const { rows } = await client.query<{ refresh_token_enc: string | null }>('SELECT refresh_token_enc FROM users');
  for (const { refresh_token_enc: payload } of rows) {
    counts.accounts++;
    if (!payload) {
      counts.noToken++;
      continue;
    }
    let token: string;
    try {
      token = cipher.decrypt(payload);
    } catch {
      counts.undecryptable++;
      continue;
    }
    if (!execute) {
      counts.wouldRevoke++;
      continue;
    }
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
    // 400 invalid_token means Google already considers the grant gone, which is
    // the outcome this script exists to reach.
    if (res.ok) counts.revoked++;
    else if (res.status === 400) counts.alreadyInvalid++;
    else throw new Error(`Google revoke endpoint returned ${res.status}; stopping so the rest can be retried.`);
  }
} finally {
  await client.end();
}

for (const [name, n] of Object.entries(counts)) console.log(`  ${name.padEnd(16)} ${n}`);
process.exit(counts.undecryptable > 0 ? 1 : 0);
