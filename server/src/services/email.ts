import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

type SendArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendResult =
  /** Delivered to SMTP. */
  | { delivered: true }
  /** No SMTP configured; message was written to the server log instead. */
  | { delivered: false; reason: 'smtp_not_configured' };

let cached: Transporter | null = null;

function transporter(): Transporter | null {
  if (cached) return cached;
  if (!env.smtp.host) return null;
  cached = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth:
      env.smtp.user && env.smtp.pass
        ? { user: env.smtp.user, pass: env.smtp.pass }
        : undefined,
  });
  return cached;
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.smtp.host);
}

/**
 * Send an email via SMTP when configured; otherwise log it. The console
 * fallback keeps dev flows (verify email, password reset) working without
 * forcing SMTP setup. Returns a discriminant so callers (e.g. the test-email
 * route) can tell the user their message went to the log, not an inbox.
 */
export async function sendEmail({ to, subject, text, html }: SendArgs): Promise<SendResult> {
  const tx = transporter();
  if (!tx) {
    console.log('[email:dev-console]', {
      from: env.smtp.from,
      to,
      subject,
      text,
    });
    return { delivered: false, reason: 'smtp_not_configured' };
  }
  await tx.sendMail({ from: env.smtp.from, to, subject, text, html });
  return { delivered: true };
}
