import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

type SendArgs = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

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

/**
 * Send an email via SMTP when configured; otherwise log it. The console
 * fallback keeps dev flows (verify email, password reset) working without
 * forcing SMTP setup.
 */
export async function sendEmail({ to, subject, text, html }: SendArgs): Promise<void> {
  const tx = transporter();
  if (!tx) {
    console.log('[email:dev-console]', {
      from: env.smtp.from,
      to,
      subject,
      text,
    });
    return;
  }
  await tx.sendMail({ from: env.smtp.from, to, subject, text, html });
}
