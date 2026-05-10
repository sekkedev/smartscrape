import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { refreshCookieOptions } from '../lib/session.js';
import {
  createUser,
  clearResetToken,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserByResetToken,
  findUserByVerificationToken,
  markEmailVerified,
  setResetToken,
  toPublic,
  updatePassword,
  updateProfile,
} from '../db/users.js';
import {
  createRefreshToken,
  findActiveByHash,
  revokeAllForUser,
  revokeById,
} from '../db/refreshTokens.js';
import {
  createToken as createPat,
  listForUser as listPats,
  revoke as revokePat,
  toDTO as toPatDTO,
} from '../db/personalAccessTokens.js';
import { PAT_PREFIX } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signAccessToken, REFRESH_TTL_MS } from '../lib/jwt.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { fail, ok } from '../lib/response.js';
import { validate } from '../middleware/validate.js';
import { authEntryLimiter, userGeneralLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';

export const authRouter = Router();

// ---------- schemas ----------

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password too long');

const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: passwordSchema,
  name: z.string().trim().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

const verifyEmailSchema = z.object({
  token: z.string().min(10),
});

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase()),
});

const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  telegram_chat_id: z.string().trim().max(64).nullable().optional(),
});

// ---------- helpers ----------

async function issueSession(user: { id: string; email: string }): Promise<{
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}> {
  const accessToken = signAccessToken({ sub: user.id, email: user.email });
  const { token, hash } = generateToken(48);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await createRefreshToken({ userId: user.id, tokenHash: hash, expiresAt });
  return {
    accessToken,
    refreshToken: token,
    refreshExpiresAt: expiresAt.toISOString(),
  };
}

function setRefreshCookie(res: import('express').Response, token: string, expiresAt: Date): void {
  res.cookie('refreshToken', token, refreshCookieOptions(expiresAt));
}

function clearRefreshCookie(res: import('express').Response): void {
  res.clearCookie('refreshToken', refreshCookieOptions(new Date(0)));
}

function verificationUrl(token: string): string {
  return `${env.appUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`;
}

function resetUrl(token: string): string {
  return `${env.appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
}

// ---------- routes ----------

authRouter.post('/register', authEntryLimiter, validate(registerSchema), async (req, res) => {
  const { email, password, name } = req.body as z.infer<typeof registerSchema>;

  const existing = await findUserByEmail(email);
  if (existing) {
    res.status(409).json(fail('EMAIL_TAKEN', 'Email is already registered'));
    return;
  }

  const passwordHash = await hashPassword(password);
  const { token, hash } = generateToken(32);
  const user = await createUser({
    email,
    passwordHash,
    name: name ?? null,
    verificationTokenHash: hash,
  });

  const link = verificationUrl(token);
  await sendEmail({
    to: user.email,
    subject: 'Verify your SmartScrape email',
    text: `Welcome to SmartScrape. Verify your email by opening: ${link}`,
  });

  res.status(201).json(
    ok({
      user: toPublic(user),
      // In dev (console email transport) we surface the token so flows are testable.
      devToken: env.nodeEnv === 'development' ? token : undefined,
    }),
  );
});

authRouter.post('/verify-email', validate(verifyEmailSchema), async (req, res) => {
  const { token } = req.body as z.infer<typeof verifyEmailSchema>;
  const user = await findUserByVerificationToken(hashToken(token));
  if (!user) {
    res.status(400).json(fail('INVALID_TOKEN', 'Invalid or expired verification token'));
    return;
  }
  if (user.email_verified) {
    res.status(200).json(ok({ user: toPublic(user) }));
    return;
  }
  await markEmailVerified(user.id);
  const refreshed = await findUserById(user.id);
  res.status(200).json(ok({ user: toPublic(refreshed!) }));
});

authRouter.post('/login', authEntryLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const user = await findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    // Uniform error to avoid user-existence disclosure.
    res.status(401).json(fail('INVALID_CREDENTIALS', 'Invalid email or password'));
    return;
  }
  const session = await issueSession({ id: user.id, email: user.email });
  setRefreshCookie(res, session.refreshToken, new Date(session.refreshExpiresAt));
  res.status(200).json(
    ok({
      user: toPublic(user),
      accessToken: session.accessToken,
      refreshExpiresAt: session.refreshExpiresAt,
    }),
  );
});

authRouter.post('/refresh', async (req, res) => {
  // Cookie-only since the HttpOnly migration in #82. The previous JSON-body
  // fallback was preserved for backward compatibility but defeated the
  // migration's point — an XSS-captured token could still be replayed via
  // body. The current client (`client/src/lib/api.ts`) uses
  // `credentials: 'include'` and never sends the token in the body.
  const presentedToken: string | undefined = req.cookies?.refreshToken;
  if (!presentedToken) {
    res.status(401).json(fail('INVALID_REFRESH', 'Refresh token is invalid or expired'));
    return;
  }
  const row = await findActiveByHash(hashToken(presentedToken));
  if (!row) {
    res.status(401).json(fail('INVALID_REFRESH', 'Refresh token is invalid or expired'));
    return;
  }
  const user = await findUserById(row.user_id);
  if (!user) {
    res.status(401).json(fail('INVALID_REFRESH', 'Refresh token is invalid or expired'));
    return;
  }
  // Rotate: revoke the presented token, issue a fresh pair.
  await revokeById(row.id);
  const session = await issueSession({ id: user.id, email: user.email });
  setRefreshCookie(res, session.refreshToken, new Date(session.refreshExpiresAt));
  res
    .status(200)
    .json(ok({ accessToken: session.accessToken, refreshExpiresAt: session.refreshExpiresAt }));
});

authRouter.post('/logout', async (req, res) => {
  // Idempotent: revoke the cookie's refresh token if it maps to an active
  // row, then always clear the cookie and return 200. We never leak whether
  // the presented token was valid — every call returns the same shape so
  // an attacker can't probe token validity through this endpoint.
  const cookieToken: string | undefined = req.cookies?.refreshToken;
  if (cookieToken) {
    const row = await findActiveByHash(hashToken(cookieToken));
    if (row) {
      await revokeById(row.id);
    }
  }
  clearRefreshCookie(res);
  res.status(200).json(ok({ logout: true }));
});

authRouter.post(
  '/forgot-password',
  authEntryLimiter,
  validate(forgotPasswordSchema),
  async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotPasswordSchema>;
    const user = await findUserByEmail(email);
    if (user) {
      const { token, hash } = generateToken(32);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await setResetToken(user.id, hash, expiresAt);
      await sendEmail({
        to: user.email,
        subject: 'Reset your SmartScrape password',
        text: `Reset your password: ${resetUrl(token)}\nThis link expires in 1 hour.`,
      });
    }
    // Always return success to avoid disclosing which emails are registered.
    res.status(200).json(ok({ sent: true }));
  },
);

authRouter.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
  const { token, password } = req.body as z.infer<typeof resetPasswordSchema>;
  const user = await findUserByResetToken(hashToken(token));
  if (!user) {
    res.status(400).json(fail('INVALID_TOKEN', 'Invalid or expired reset token'));
    return;
  }
  const passwordHash = await hashPassword(password);
  await updatePassword(user.id, passwordHash);
  await clearResetToken(user.id);
  // Invalidate all existing sessions after a password change.
  await revokeAllForUser(user.id);
  res.status(200).json(ok({ reset: true }));
});

authRouter.get('/me', requireAuth, userGeneralLimiter, async (req, res) => {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json(fail('NOT_FOUND', 'User not found'));
    return;
  }
  res.status(200).json(ok({ user: toPublic(user) }));
});

authRouter.patch(
  '/me',
  requireAuth,
  userGeneralLimiter,
  validate(updateProfileSchema),
  async (req, res) => {
    const input = req.body as z.infer<typeof updateProfileSchema>;
    const updated = await updateProfile(req.user!.id, {
      name: input.name,
      telegramChatId: input.telegram_chat_id,
    });
    res.status(200).json(ok({ user: toPublic(updated) }));
  },
);

authRouter.delete('/me', requireAuth, userGeneralLimiter, async (req, res) => {
  await revokeAllForUser(req.user!.id);
  clearRefreshCookie(res);
  await deleteUser(req.user!.id);
  res.status(200).json(ok({ deleted: true }));
});

// ---------- personal access tokens ----------

const createPatSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

const patIdParam = z.object({ id: z.string().uuid() });

/**
 * Format: `sst_<base64url-22chars>`. Prefix makes the token grep-able in logs
 * and obviously different from JWTs (which look like `eyJ…`). 22 chars of
 * base64url = 132 bits of entropy, well past brute-force territory.
 */
function newAccessToken(): { plaintext: string; hash: string; prefix: string } {
  const { token } = generateToken(16);
  const plaintext = `${PAT_PREFIX}${token}`;
  // Hash the *prefixed* plaintext so the auth-middleware lookup hashes the
  // exact same string the client sends.
  return { plaintext, hash: hashToken(plaintext), prefix: plaintext.slice(0, 12) };
}

authRouter.get('/access-tokens', requireAuth, userGeneralLimiter, async (req, res) => {
  const rows = await listPats(req.user!.id);
  res.status(200).json(ok({ tokens: rows.map(toPatDTO) }));
});

authRouter.post(
  '/access-tokens',
  requireAuth,
  userGeneralLimiter,
  validate(createPatSchema),
  async (req, res) => {
    const { name } = req.body as z.infer<typeof createPatSchema>;
    const { plaintext, hash, prefix } = newAccessToken();
    const row = await createPat({ userId: req.user!.id, name, tokenHash: hash, prefix });
    // Plaintext is returned exactly once — clients must persist it now or
    // mint a new token.
    res.status(201).json(ok({ token: { ...toPatDTO(row), plaintext } }));
  },
);

authRouter.delete(
  '/access-tokens/:id',
  requireAuth,
  userGeneralLimiter,
  validate(patIdParam, 'params'),
  async (req, res) => {
    const { id } = req.params as unknown as z.infer<typeof patIdParam>;
    const ok_ = await revokePat(req.user!.id, id);
    if (!ok_) {
      res.status(404).json(fail('NOT_FOUND', 'Access token not found'));
      return;
    }
    res.status(200).json(ok({ revoked: true }));
  },
);
