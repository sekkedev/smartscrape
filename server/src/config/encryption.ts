import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { requireSecrets } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16;

function keyBuffer(): Buffer {
  const { encryptionKey } = requireSecrets();
  return Buffer.from(encryptionKey, 'hex');
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM. Returns a self-contained
 * base64url-encoded payload of `iv | authTag | ciphertext` so rotation
 * of stored values doesn't need a schema change.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuffer(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64url');
  if (buf.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, keyBuffer(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
