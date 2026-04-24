import { Router } from 'express';
import { z } from 'zod';
import { fail, ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { findRun, listDataForRun, toDTO as toRunDTO } from '../db/runs.js';
import { diffRun } from '../services/change-detector.js';

export const runsRouter = Router();
runsRouter.use(requireAuth);

const idParam = z.object({ id: z.string().uuid() });

runsRouter.get('/:id', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const row = await findRun(req.user!.id, id);
  if (!row) {
    res.status(404).json(fail('NOT_FOUND', 'Run not found'));
    return;
  }
  res.status(200).json(ok({ run: toRunDTO(row) }));
});

runsRouter.get('/:id/diff', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const diff = await diffRun(req.user!.id, id);
  if (!diff) {
    res.status(404).json(fail('NOT_FOUND', 'Run not found'));
    return;
  }
  res.status(200).json(ok({ diff }));
});

runsRouter.get('/:id/data', validate(idParam, 'params'), async (req, res) => {
  const { id } = req.params as unknown as z.infer<typeof idParam>;
  const run = await findRun(req.user!.id, id);
  if (!run) {
    res.status(404).json(fail('NOT_FOUND', 'Run not found'));
    return;
  }
  const data = await listDataForRun(req.user!.id, id);
  res.status(200).json(ok({ data }));
});
