import { Router } from 'express';
import { pingDatabase } from '../config/database.js';
import { pingRedis } from '../config/redis.js';
import { ok } from '../lib/response.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const [db, redis] = await Promise.all([pingDatabase(), pingRedis()]);
  const status = db.ok && redis.ok ? 'healthy' : 'degraded';
  res.status(200).json(
    ok({
      status,
      checks: {
        database: db,
        redis,
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  );
});
