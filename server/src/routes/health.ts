import { Router } from 'express';
import { pingDatabase } from '../config/database.js';
import { pingRedis } from '../config/redis.js';
import { ok } from '../lib/response.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const [db, redis] = await Promise.all([pingDatabase(), pingRedis()]);
  const status = db.ok && redis.ok ? 'healthy' : 'degraded';
  // 503 on degraded so the Docker healthcheck and external uptime monitors
  // actually fire on a DB/Redis outage — a 200 'degraded' is invisible to both.
  res.status(status === 'healthy' ? 200 : 503).json(
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
