import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

/** Marks the keyed payload format. Anything without it is read as the legacy format. */
const V2_PREFIX = 'v2:';

export interface TokenCipher {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

/** One key in the ring. `id` is stored in the payload so a rotated-out key can still decrypt. */
export interface CipherKey {
  id: string;
  key: Buffer;
}

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be at least 16 characters');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptWith(key: Buffer, plaintext: string): { iv: Buffer; tag: Buffer; enc: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), enc };
}

function decryptWith(key: Buffer, ivB64: string, tagB64: string, encB64: string): string {
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * AES-256-GCM cipher for refresh tokens at rest. The key is derived from a
 * shared secret (an env var). This interface is the seam; see
 * {@link createKeyedCipher} for the KMS-backed implementation that replaces it
 * in production without touching call sites.
 * Payload format: `${ivB64}.${tagB64}.${ciphertextB64}`.
 */
export function createAesGcmCipher(secret: string): TokenCipher {
  return {
    encrypt(plaintext: string): string {
      const { iv, tag, enc } = encryptWith(deriveKey(secret), plaintext);
      return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
    },
    decrypt(payload: string): string {
      const [ivB64, tagB64, encB64] = payload.split('.');
      if (!ivB64 || !tagB64 || !encB64) throw new Error('Malformed encrypted payload');
      return decryptWith(deriveKey(secret), ivB64, tagB64, encB64);
    },
  };
}

/**
 * The production cipher (Step 6d). Same AES-256-GCM as above, but the key
 * material comes from a ring rather than a config string, and the payload names
 * the key that wrote it — `v2:${keyId}.${iv}.${tag}.${ciphertext}` — so a key
 * can be rotated out of `activeId` while rows it wrote still decrypt.
 *
 * The interface stays **synchronous** on purpose. A refresh token is decrypted
 * on every account read, so a KMS round trip per operation would put a network
 * call on the request path. Instead the data key is unwrapped by KMS once at
 * boot (see `kms.ts`) and held in memory for the process lifetime: KMS holds
 * the key, the deployment holds only a wrapped blob that is useless without it.
 *
 * A `legacySecret` keeps rows written by {@link createAesGcmCipher} readable
 * through the cutover, since those payloads carry no key id.
 */
export function createKeyedCipher(
  keys: CipherKey[],
  activeId: string,
  legacySecret?: string,
): TokenCipher {
  const byId = new Map(keys.map((k) => [k.id, k.key]));
  const active = byId.get(activeId);
  if (!active) throw new Error(`Active cipher key "${activeId}" is not in the ring`);
  for (const k of keys) {
    if (k.key.length !== 32) throw new Error(`Cipher key "${k.id}" must be 32 bytes`);
  }
  return {
    encrypt(plaintext: string): string {
      const { iv, tag, enc } = encryptWith(active, plaintext);
      return `${V2_PREFIX}${activeId}.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
    },
    decrypt(payload: string): string {
      if (!payload.startsWith(V2_PREFIX)) {
        if (!legacySecret) throw new Error('Unkeyed payload and no legacy secret configured');
        return createAesGcmCipher(legacySecret).decrypt(payload);
      }
      const [keyId, ivB64, tagB64, encB64] = payload.slice(V2_PREFIX.length).split('.');
      if (!keyId || !ivB64 || !tagB64 || !encB64) throw new Error('Malformed encrypted payload');
      const key = byId.get(keyId);
      if (!key) throw new Error('Encrypted payload names an unknown key');
      return decryptWith(key, ivB64, tagB64, encB64);
    },
  };
}
