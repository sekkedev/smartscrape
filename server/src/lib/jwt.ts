import jwt from 'jsonwebtoken';
import { requireSecrets } from '../config/env.js';

export type AccessTokenPayload = {
  sub: string; // user id
  email: string;
};

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function signAccessToken(payload: AccessTokenPayload): string {
  const { jwtAccessSecret } = requireSecrets();
  return jwt.sign(payload, jwtAccessSecret, { expiresIn: ACCESS_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const { jwtAccessSecret } = requireSecrets();
  const decoded = jwt.verify(token, jwtAccessSecret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid access token payload');
  }
  return decoded as AccessTokenPayload;
}

/**
 * Refresh tokens are opaque random strings (not JWTs) stored hashed in the DB.
 * We use jsonwebtoken only for access tokens. See lib/tokens.ts for opaque-token helpers.
 * This signed variant is kept for possible future short-lived refresh verification,
 * but the canonical refresh token is opaque.
 */
export function signRefreshJwt(payload: { sub: string; jti: string }): string {
  const { jwtRefreshSecret } = requireSecrets();
  return jwt.sign(payload, jwtRefreshSecret, { expiresIn: REFRESH_TTL });
}
