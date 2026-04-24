import express from 'express';
import { env, requireSecrets } from './config/env.js';
import { closeDatabase } from './config/database.js';
import { closeRedis } from './config/redis.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { providersRouter } from './routes/providers.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { fail } from './lib/response.js';

// Fail fast if any runtime secret is missing or a placeholder.
requireSecrets();

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// Health stays outside the rate limiter so uptime probes never 429.
app.use('/api/health', healthRouter);

app.use('/api', generalLimiter);
app.use('/api/auth', authRouter);
app.use('/api/providers', providersRouter);

app.use((_req, res) => {
  res.status(404).json(fail('NOT_FOUND', 'Route not found'));
});

// Centralised error handler so uncaught promise rejections in async handlers
// still return the consistent envelope instead of Express's default HTML.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('[server] unhandled error', err);
    res
      .status(500)
      .json(fail('INTERNAL_ERROR', env.nodeEnv === 'production' ? 'Internal server error' : err.message));
  },
);

const server = app.listen(env.port, () => {
  console.log(`[server] listening on http://localhost:${env.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] received ${signal}, shutting down`);
  server.close(() => undefined);
  await Promise.allSettled([closeDatabase(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { app };
