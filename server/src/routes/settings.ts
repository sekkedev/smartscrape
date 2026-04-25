import { Router } from 'express';
import { z } from 'zod';
import { listForUser, upsertMany } from '../db/settings.js';
import { ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { userGeneralLimiter } from '../middleware/rateLimit.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);
settingsRouter.use(userGeneralLimiter);

// Free-form key/value bag, but bound the size of each side so a single bad
// request can't fill the column. Keys mirror env-style identifiers.
const patchBody = z.record(
  z.string().regex(/^[a-z0-9_.-]{1,80}$/i, 'invalid setting key'),
  z.string().max(2000),
);

settingsRouter.get('/', async (req, res) => {
  const settings = await listForUser(req.user!.id);
  res.status(200).json(ok({ settings }));
});

settingsRouter.patch('/', validate(patchBody), async (req, res) => {
  const patch = req.body as z.infer<typeof patchBody>;
  const settings = await upsertMany(req.user!.id, patch);
  res.status(200).json(ok({ settings }));
});
