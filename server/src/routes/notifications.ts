import { Router } from 'express';
import { z } from 'zod';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { userGeneralLimiter } from '../middleware/rateLimit.js';
import { findUserById } from '../db/users.js';
import { listNotifications } from '../db/notifications.js';
import { sendEmail } from '../services/email.js';
import { sendTelegram, getBotSetupInfo } from '../services/telegram.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.use(userGeneralLimiter);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  channel: z.enum(['email', 'telegram']).optional(),
  job_id: z.string().uuid().optional(),
});

notificationsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof listQuery>;
  const result = await listNotifications(req.user!.id, {
    limit: q.limit,
    offset: q.offset,
    channel: q.channel,
    jobId: q.job_id,
  });
  res.status(200).json(ok(result));
});

notificationsRouter.post('/test/email', async (req, res) => {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json(fail('NOT_FOUND', 'User not found'));
    return;
  }
  try {
    const result = await sendEmail({
      to: user.email,
      subject: '[SmartScrape] Test email',
      text: 'If you received this, your email channel is working.',
    });
    if (!result.delivered) {
      res.status(200).json(
        ok({
          sent: false,
          warning:
            'SMTP is not configured on this server. The test message was written to the server log instead of delivered. Set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS to send real email.',
        }),
      );
      return;
    }
    res.status(200).json(ok({ sent: true }));
  } catch (err) {
    res.status(502).json(fail('EMAIL_FAILED', err instanceof Error ? err.message : 'Email failed'));
  }
});

notificationsRouter.post('/test/telegram', async (req, res) => {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json(fail('NOT_FOUND', 'User not found'));
    return;
  }
  if (!user.telegram_chat_id) {
    res.status(400).json(fail('NO_CHAT_ID', 'Link a Telegram chat_id in Settings first'));
    return;
  }
  const result = await sendTelegram(
    user.telegram_chat_id,
    'SmartScrape test message \u2014 your Telegram channel is working.',
  );
  if (!result.ok) {
    res.status(502).json(fail('TELEGRAM_FAILED', result.error ?? 'Telegram send failed'));
    return;
  }
  res.status(200).json(ok({ sent: true }));
});

notificationsRouter.get('/telegram/setup', async (_req, res) => {
  const info = await getBotSetupInfo();
  res.status(200).json(
    ok({
      ...info,
      instructions: info.link
        ? [
            `1. Open ${info.link} in Telegram and press Start.`,
            '2. Send /start to the bot.',
            '3. Visit https://t.me/userinfobot to get your numeric chat_id.',
            '4. Paste that chat_id into SmartScrape Settings.',
          ]
        : ['TELEGRAM_BOT_TOKEN is not configured on this server. Ask an admin to set it.'],
    }),
  );
});
