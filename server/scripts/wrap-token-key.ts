/**
 * Operator path for Step 6d, run once by hand: generate a 32-byte data key,
 * wrap it with Cloud KMS, and print the value for TOKEN_KEY_WRAPPED.
 *
 * Reads TOKEN_KMS_KEY_NAME and TOKEN_KMS_CREDENTIALS from the environment (or
 * from server/.env), so it wraps with exactly the key and identity the running
 * app will unwrap with. The raw key is never written to disk.
 *
 *   npx tsx scripts/wrap-token-key.ts
 */
import crypto from 'node:crypto';
import 'dotenv/config';
import { wrapKey } from '../src/services/kms.js';

const keyName = process.env.TOKEN_KMS_KEY_NAME ?? '';
if (!keyName) {
  console.error('TOKEN_KMS_KEY_NAME is not set. Set it in server/.env first.');
  process.exit(1);
}

const key = crypto.randomBytes(32);
const wrapped = await wrapKey(
  { keyName, credentialsJson: process.env.TOKEN_KMS_CREDENTIALS ?? '' },
  key,
);

console.log('TOKEN_KEY_WRAPPED=' + wrapped);
