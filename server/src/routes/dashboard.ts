import { Router } from 'express';
import { getPool } from '../config/database.js';
import { ok } from '../lib/response.js';
import { requireAuth } from '../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/stats', async (req, res) => {
  const userId = req.user!.id;
  const pool = getPool();
  const [activeJobs, runsToday, itemsTracked, changesWeek] = await Promise.all([
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM scrape_jobs WHERE user_id = $1 AND enabled = true`,
      [userId],
    ),
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
         FROM scrape_runs r
         JOIN scrape_jobs j ON j.id = r.job_id
        WHERE j.user_id = $1
          AND r.started_at >= date_trunc('day', now())`,
      [userId],
    ),
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
         FROM extracted_data d
         JOIN scrape_jobs j ON j.id = d.job_id
        WHERE j.user_id = $1`,
      [userId],
    ),
    pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c
         FROM notification_log
        WHERE user_id = $1
          AND sent_at >= now() - interval '7 days'
          AND type = 'change_detected'`,
      [userId],
    ),
  ]);
  res.status(200).json(
    ok({
      active_jobs: activeJobs.rows[0]?.c ?? 0,
      runs_today: runsToday.rows[0]?.c ?? 0,
      items_tracked: itemsTracked.rows[0]?.c ?? 0,
      changes_this_week: changesWeek.rows[0]?.c ?? 0,
    }),
  );
});

dashboardRouter.get('/recent-activity', async (req, res) => {
  const userId = req.user!.id;
  const { rows } = await getPool().query<{
    run_id: string;
    job_id: string;
    job_name: string;
    status: string;
    items_extracted: number;
    tokens_used: number;
    started_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT r.id AS run_id, r.job_id, j.name AS job_name, r.status,
            r.items_extracted, r.tokens_used, r.started_at, r.completed_at
       FROM scrape_runs r
       JOIN scrape_jobs j ON j.id = r.job_id AND j.user_id = $1
      ORDER BY r.started_at DESC
      LIMIT 10`,
    [userId],
  );
  res.status(200).json(
    ok({
      items: rows.map((r) => ({
        run_id: r.run_id,
        job_id: r.job_id,
        job_name: r.job_name,
        status: r.status,
        items_extracted: r.items_extracted,
        tokens_used: r.tokens_used,
        started_at: r.started_at.toISOString(),
        completed_at: r.completed_at?.toISOString() ?? null,
      })),
    }),
  );
});

dashboardRouter.get('/usage', async (req, res) => {
  const userId = req.user!.id;
  const { rows } = await getPool().query<{
    day: string;
    provider: string;
    tokens: number;
  }>(
    `SELECT to_char(date_trunc('day', r.started_at), 'YYYY-MM-DD') AS day,
            j.ai_provider AS provider,
            SUM(r.tokens_used)::int AS tokens
       FROM scrape_runs r
       JOIN scrape_jobs j ON j.id = r.job_id AND j.user_id = $1
      WHERE r.started_at >= now() - interval '30 days'
      GROUP BY 1, 2
      ORDER BY 1`,
    [userId],
  );
  res.status(200).json(ok({ days: rows }));
});
