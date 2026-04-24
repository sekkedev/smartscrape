import { useEffect, useState } from 'react';

type HealthCheck = { ok: boolean; error?: string };
type HealthResponse = {
  success: boolean;
  data: {
    status: 'healthy' | 'degraded';
    checks: { database: HealthCheck; redis: HealthCheck };
    uptime: number;
    timestamp: string;
  } | null;
  error: { code: string; message: string } | null;
};

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<HealthResponse>)
      .then(setHealth)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">SmartScrape</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        AI-powered web scraping with structured extraction, change detection, and notifications.
      </p>

      <section className="mt-10 rounded-lg border border-gray-200 p-5 dark:border-gray-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Backend status</h2>
        {loadError && (
          <p className="mt-3 font-mono text-sm text-red-600">Failed to reach /api/health: {loadError}</p>
        )}
        {!loadError && !health && <p className="mt-3 text-sm text-gray-500">Loading&hellip;</p>}
        {health?.data && (
          <dl className="mt-3 space-y-2 font-mono text-sm">
            <Row label="status" value={health.data.status} tone={health.data.status === 'healthy' ? 'good' : 'warn'} />
            <Row label="database" value={health.data.checks.database.ok ? 'ok' : `down${health.data.checks.database.error ? ` \u2014 ${health.data.checks.database.error}` : ''}`} tone={health.data.checks.database.ok ? 'good' : 'bad'} />
            <Row label="redis" value={health.data.checks.redis.ok ? 'ok' : `down${health.data.checks.redis.error ? ` \u2014 ${health.data.checks.redis.error}` : ''}`} tone={health.data.checks.redis.ok ? 'good' : 'bad'} />
            <Row label="uptime" value={`${health.data.uptime.toFixed(1)}s`} />
          </dl>
        )}
      </section>
    </main>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bad'
          ? 'text-red-600 dark:text-red-400'
          : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={toneClass}>{value}</dd>
    </div>
  );
}
