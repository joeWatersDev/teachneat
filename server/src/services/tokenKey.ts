import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { unwrapKey } from './kms.js';
import { createAesGcmCipher, createKeyedCipher, type TokenCipher } from './tokenCipher.js';

/**
 * Resolves which {@link TokenCipher} the process runs with (Step 6d).
 *
 * Two configurations, and which one applies is decided by whether KMS is
 * configured rather than by `NODE_ENV`, so the KMS path can be exercised
 * locally against a real keyring before it is exercised in production:
 *
 * - **KMS configured** — one `decrypt` call at boot unwraps the data key from
 *   `TOKEN_KEY_WRAPPED`, and the keyed cipher runs from it in memory. Rows
 *   written by the env-secret cipher stay readable through the cutover, because
 *   `TOKEN_ENCRYPTION_KEY` is passed as the legacy secret.
 * - **KMS not configured** — the env-secret cipher, unchanged. Fine for
 *   development; `assertProductionConfig` is what refuses it in production.
 *
 * Initialisation is async and the cipher is not, deliberately: see the note on
 * `createKeyedCipher`. `init` must therefore run before anything builds an
 * account store, which is why boot awaits it ahead of `buildApp`.
 */
let cipher: TokenCipher | null = null;

export function isKmsConfigured(): boolean {
  return env.tokenCipher.kmsKeyName.length > 0 && env.tokenCipher.wrappedKey.length > 0;
}

export async function initTokenCipher(): Promise<void> {
  if (!isKmsConfigured()) {
    cipher = createAesGcmCipher(env.tokenCipher.key);
    return;
  }
  const key = await unwrapKey(
    {
      keyName: env.tokenCipher.kmsKeyName,
      credentialsJson: env.tokenCipher.kmsCredentials,
    },
    env.tokenCipher.wrappedKey,
  );
  cipher = createKeyedCipher(
    [{ id: env.tokenCipher.keyId, key }],
    env.tokenCipher.keyId,
    env.tokenCipher.key.length > 0 ? env.tokenCipher.key : undefined,
  );
  logger.info({ keyId: env.tokenCipher.keyId }, 'Token data key unwrapped from KMS');
}

/**
 * The process-wide cipher. Falls back to the env-secret cipher when `init` has
 * not run — which is the case in tests and in any tool that imports the store
 * without booting the server — so the fallback is a supported path, not a bug.
 */
export function getTokenCipher(): TokenCipher {
  if (!cipher) cipher = createAesGcmCipher(env.tokenCipher.key);
  return cipher;
}

/** Test seam. */
export function setTokenCipher(next: TokenCipher | null): void {
  cipher = next;
}
