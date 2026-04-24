import { getPool } from '../config/database.js';

export type Channel = 'email' | 'telegram';
export type NotifKind = 'change_detected' | 'job_failed' | 'job_completed';

export type NotificationRow = {
  id: string;
  user_id: string;
  job_id: string;
  run_id: string;
  channel: Channel;
  type: NotifKind;
  message: string | null;
  sent_at: Date;
};

export type NotificationDTO = Omit<NotificationRow, 'sent_at'> & {
  sent_at: string;
  job_name?: string;
};

export async function insertNotification(args: {
  userId: string;
  jobId: string;
  runId: string;
  channel: Channel;
  type: NotifKind;
  message: string;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO notification_log (user_id, job_id, run_id, channel, type, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [args.userId, args.jobId, args.runId, args.channel, args.type, args.message],
  );
}

export type ListOpts = { limit?: number; offset?: number; jobId?: string; channel?: Channel };

export async function listNotifications(userId: string, opts: ListOpts = {}): Promise<{ items: NotificationDTO[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [userId];
  let where = `WHERE n.user_id = $1`;
  if (opts.jobId) {
    params.push(opts.jobId);
    where += ` AND n.job_id = $${params.length}`;
  }
  if (opts.channel) {
    params.push(opts.channel);
    where += ` AND n.channel = $${params.length}`;
  }
  const { rows } = await getPool().query<NotificationRow & { job_name: string }>(
    `SELECT n.*, j.name AS job_name
       FROM notification_log n
       JOIN scrape_jobs j ON j.id = n.job_id
      ${where}
      ORDER BY n.sent_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const { rows: crows } = await getPool().query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM notification_log n ${where}`,
    params,
  );
  return {
    items: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      job_id: r.job_id,
      run_id: r.run_id,
      channel: r.channel,
      type: r.type,
      message: r.message,
      sent_at: r.sent_at.toISOString(),
      job_name: r.job_name,
    })),
    total: crows[0]?.total ?? 0,
  };
}
