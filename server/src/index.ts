import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, requireSecrets } from './config/env.js';
import { closeDatabase } from './config/database.js';
import { closeRedis } from './config/redis.js';
import { closeQueue, startWorker } from './services/job-queue.js';
import { closeScraper } from './services/scraper.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { dashboardRouter } from './routes/dashboard.js';
import { googleRouter } from './routes/google.js';
import { jobsRouter } from './routes/jobs.js';
import { notificationsRouter } from './routes/notifications.js';
import { providersRouter } from './routes/providers.js';
import { runsRouter } from './routes/runs.js';
import { settingsRouter } from './routes/settings.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { fail } from './lib/response.js';

// Fail fast if any runtime secret is missing or a placeholder.
requireSecrets();

const app = express();

app.set('trust proxy', 1);

// Helmet sets defensive HTTP headers (CSP off — the API serves JSON only,
// the SPA is hosted separately by Vite/static and brings its own CSP).
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS is locked to APP_URL. Server-to-server callers (no Origin header) and
// the Google OAuth redirect (same-origin to API) are allowed through.
// `cb(null, false)` blocks without throwing — the disallowed-origin response
// is handled below as a clean 403 with our standard envelope.
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin === env.appUrl) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  }),
);

// Explicit reject for cross-origin requests so the client gets a 403 with the
// standard envelope instead of a CORS-failed fetch the browser can't surface.
// Same-origin requests have no Origin header and skip this entirely.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin !== env.appUrl) {
    res.status(403).json(fail('CORS_FORBIDDEN', `Origin not allowed: ${origin}`));
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Health stays outside the rate limiter so uptime probes never 429.
app.use('/api/health', healthRouter);

app.use('/api', generalLimiter);
app.use('/api/auth', authRouter);
app.use('/api/providers', providersRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/runs', runsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/google', googleRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/settings', settingsRouter);

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

// Start the BullMQ worker in-process. For production deployments this would
// typically run in its own service; single-process is fine for dev + v1.
if (env.redisUrl) {
  try {
    startWorker();
    console.log('[queue] worker started');
  } catch (err) {
    console.error('[queue] failed to start worker', err);
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] received ${signal}, shutting down`);
  server.close(() => undefined);
  await Promise.allSettled([closeQueue(), closeDatabase(), closeRedis(), closeScraper()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { app };
