import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

/**
 * Google Cloud KMS, used for exactly one thing (Step 6d): unwrapping the data
 * key that {@link createKeyedCipher} encrypts refresh tokens with.
 *
 * No new dependency — `googleapis` already carries the Cloud KMS v1 client and
 * `google-auth-library`. The Sheets and Gmail clients are per-user OAuth; this
 * one is the app's own service identity, so it authenticates separately.
 *
 * Called once at boot, never on the request path. The deployment holds only the
 * wrapped blob, which is inert without KMS access, which is what makes the
 * privacy policy's "key held in a separate key management service" true.
 */
const KMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';

export interface KmsConfig {
  /** Full resource name: projects/…/locations/…/keyRings/…/cryptoKeys/… */
  keyName: string;
  /** Service-account JSON. Empty falls back to Application Default Credentials. */
  credentialsJson?: string;
}

function authFor(config: KmsConfig): GoogleAuth {
  if (config.credentialsJson && config.credentialsJson.length > 0) {
    return new GoogleAuth({
      credentials: JSON.parse(config.credentialsJson) as Record<string, unknown>,
      scopes: [KMS_SCOPE],
    });
  }
  return new GoogleAuth({ scopes: [KMS_SCOPE] });
}

/** Decrypt a base64 KMS ciphertext into raw key material. */
export async function unwrapKey(config: KmsConfig, wrappedB64: string): Promise<Buffer> {
  const kms = google.cloudkms({ version: 'v1', auth: authFor(config) });
  const res = await kms.projects.locations.keyRings.cryptoKeys.decrypt({
    name: config.keyName,
    requestBody: { ciphertext: wrappedB64 },
  });
  const plaintext = res.data.plaintext;
  if (!plaintext) throw new Error('KMS returned no plaintext for the wrapped data key');
  const key = Buffer.from(plaintext, 'base64');
  if (key.length !== 32) {
    throw new Error(`Unwrapped data key is ${key.length} bytes; expected 32`);
  }
  return key;
}

/**
 * Wrap raw key material for storage in configuration. Not called by the running
 * app — this is the operator path used once to produce `TOKEN_KEY_WRAPPED`, and
 * it lives here rather than in a script so the two halves cannot drift.
 */
export async function wrapKey(config: KmsConfig, key: Buffer): Promise<string> {
  const kms = google.cloudkms({ version: 'v1', auth: authFor(config) });
  const res = await kms.projects.locations.keyRings.cryptoKeys.encrypt({
    name: config.keyName,
    requestBody: { plaintext: key.toString('base64') },
  });
  const ciphertext = res.data.ciphertext;
  if (!ciphertext) throw new Error('KMS returned no ciphertext when wrapping the data key');
  return ciphertext;
}
