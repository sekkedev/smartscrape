export function refreshCookieOptions(expiresAt: Date) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/api/auth',
    expires: expiresAt,
  };
}
