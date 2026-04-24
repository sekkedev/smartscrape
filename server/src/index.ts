import express from 'express';
import { env } from './config/env.js';
import { closeDatabase } from './config/database.js';
import { closeRedis } from './config/redis.js';
import { healthRouter } from './routes/health.js';
import { fail } from './lib/response.js';

const app = express();

app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRouter);

app.use((_req, res) => {
  res.status(404).json(fail('NOT_FOUND', 'Route not found'));
});

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
