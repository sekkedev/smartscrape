import { createHash, randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe random token and its SHA-256 hash.
 * Store the hash; return the plaintext once so it can be emailed/returned to the user.
 */
export function generateToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
