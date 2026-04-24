import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import type { PublicUser, RunStatus } from '../types/api';

type Stats = {
  active_jobs: number;
  runs_today: number;
  items_tracked: number;
  changes_this_week: number;
};

type ActivityRow = {
  run_id: string;
  job_id: string;
  job_name: string;
  status: RunStatus;
  items_extracted: number;
  tokens_used: number;
  started_at: string;
  completed_at: string | null;
};

type UsageRow = { day: string; provider: string; tokens: number };

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: '#6366f1',
  openai: '#10b981',
  anthropic: '#f59e0b',
};

export default function Home() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api<{ user: PublicUser }>('/api/auth/me');
      if (res.success) setUser(res.data.user);
    })();
  }, [setUser]);

  useEffect(() => {
    void (async () => {
      const [s, a, u] = await Promise.all([
        api<Stats>('/api/dashboard/stats'),
        api<{ items: ActivityRow[] }>('/api/dashboard/recent-activity'),
        api<{ days: UsageRow[] }>('/api/dashboard/usage'),
      ]);
      if (s.success) setStats(s.data);
      if (a.success) setActivity(a.data.items);
      if (u.success) setUsage(u.data.days);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {user?.name ? `Hi, ${user.name}` : 'Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Overview of your jobs, recent runs, and AI usage.
          </p>
        </div>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Active jobs" value={stats?.active_jobs} />
          <StatCard label="Runs today" value={stats?.runs_today} />
          <StatCard label="Items tracked" value={stats?.items_tracked} />
          <StatCard label="Changes this week" value={stats?.changes_this_week} />
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recent activity</h2>
            <Link to="/jobs" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              All jobs
            </Link>
          </div>
          {activity === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-sm text-gray-500">
              No runs yet. <Link to="/jobs/new" className="text-indigo-600 hover:underline">Create your first job</Link>.
            </p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2">Job</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Items</th>
                  <th className="py-2">Tokens</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {activity.map((r) => (
                  <tr key={r.run_id}>
                    <td className="py-2">
                      <Link to={`/jobs/${r.job_id}`} className="text-indigo-600 hover:underline">
                        {r.job_name}
                      </Link>
                    </td>
                    <td className="py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 font-mono text-xs">{r.items_extracted}</td>
                    <td className="py-2 font-mono text-xs">{r.tokens_used.toLocaleString()}</td>
                    <td className="py-2 font-mono text-xs text-gray-500">{new Date(r.started_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">AI usage (last 30 days)</h2>
          {usage === null ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <UsageChart data={usage} />
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-gray-900 dark:text-gray-100">
        {value === undefined ? '—' : value.toLocaleString()}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: RunStatus }) {
  const classes: Record<RunStatus, string> = {
    pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    scraping: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    extracting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    exporting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${classes[status]}`}>
      {status}
    </span>
  );
}

function UsageChart({ data }: { data: UsageRow[] }) {
  // Build a 30-day range ending today.
  const today = new Date();
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const byDay = new Map<string, Record<string, number>>();
  for (const d of days) byDay.set(d, {});
  let max = 0;
  for (const row of data) {
    const bucket = byDay.get(row.day) ?? {};
    bucket[row.provider] = (bucket[row.provider] ?? 0) + Number(row.tokens ?? 0);
    byDay.set(row.day, bucket);
  }
  for (const bucket of byDay.values()) {
    const total = Object.values(bucket).reduce((s, v) => s + v, 0);
    if (total > max) max = total;
  }

  const providers = Array.from(new Set(data.map((d) => d.provider)));

  if (max === 0) {
    return <p className="text-sm text-gray-500">No AI usage in the last 30 days.</p>;
  }

  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {days.map((d) => {
          const bucket = byDay.get(d) ?? {};
          const total = Object.values(bucket).reduce((s, v) => s + v, 0);
          const heightPct = (total / max) * 100;
          return (
            <div key={d} className="group relative flex flex-1 flex-col justify-end">
              <div className="flex flex-col-reverse" style={{ height: `${heightPct || 0}%` }}>
                {providers.map((p) => {
                  const v = bucket[p] ?? 0;
                  const share = total > 0 ? (v / total) * 100 : 0;
                  return (
                    <div
                      key={p}
                      style={{ height: `${share}%`, backgroundColor: PROVIDER_COLORS[p] ?? '#9ca3af' }}
                      className="w-full first:rounded-t"
                    />
                  );
                })}
              </div>
              <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-[10px] text-white opacity-0 shadow group-hover:opacity-100">
                {d} · {total.toLocaleString()} tokens
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs">
        {providers.map((p) => (
          <div key={p} className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400">
            <span className="inline-block h-2 w-2 rounded" style={{ backgroundColor: PROVIDER_COLORS[p] ?? '#9ca3af' }} />
            {p}
          </div>
        ))}
      </div>
    </div>
  );
}
