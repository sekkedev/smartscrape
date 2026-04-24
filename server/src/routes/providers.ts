import { Router } from 'express';
import { z } from 'zod';
import { decrypt, encrypt } from '../config/encryption.js';
import { deleteForUser, findForUser, listByUser, PROVIDERS, upsertForUser } from '../db/apiKeys.js';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { testCredentials } from '../services/ai-providers.js';

export const providersRouter = Router();

const providerEnum = z.enum(PROVIDERS);

const upsertBody = z.object({
  provider: providerEnum,
  apiKey: z.string().min(10, 'API key looks too short').max(500),
});

const providerParams = z.object({
  provider: providerEnum,
});

providersRouter.use(requireAuth);

providersRouter.get('/', async (req, res) => {
  const rows = await listByUser(req.user!.id);
  res.status(200).json(ok({ providers: rows }));
});

providersRouter.post('/', validate(upsertBody), async (req, res) => {
  const { provider, apiKey } = req.body as z.infer<typeof upsertBody>;
  const encrypted = encrypt(apiKey);
  const row = await upsertForUser(req.user!.id, provider, encrypted);
  res.status(200).json(ok({ provider: row }));
});

providersRouter.delete('/:provider', validate(providerParams, 'params'), async (req, res) => {
  const { provider } = req.params as unknown as z.infer<typeof providerParams>;
  const removed = await deleteForUser(req.user!.id, provider);
  if (!removed) {
    res.status(404).json(fail('NOT_FOUND', 'No key stored for that provider'));
    return;
  }
  res.status(200).json(ok({ provider, removed: true }));
});

providersRouter.post('/:provider/test', validate(providerParams, 'params'), async (req, res) => {
  const { provider } = req.params as unknown as z.infer<typeof providerParams>;
  const row = await findForUser(req.user!.id, provider);
  if (!row) {
    res.status(404).json(fail('NOT_FOUND', 'No key stored for that provider'));
    return;
  }
  let apiKey: string;
  try {
    apiKey = decrypt(row.api_key_encrypted);
  } catch {
    res.status(500).json(fail('DECRYPT_FAILED', 'Stored key could not be decrypted'));
    return;
  }
  const result = await testCredentials(provider, apiKey);
  res.status(200).json(ok(result));
});
