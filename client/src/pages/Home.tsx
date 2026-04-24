import { useEffect, useState } from 'react';
import { TopNav } from '../components/layout/TopNav';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import type { HealthStatus, PublicUser } from '../types/api';

export default function Home() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Refresh the user on mount in case the persisted profile is stale.
  useEffect(() => {
    void (async () => {
      const res = await api<{ user: PublicUser }>('/api/auth/me');
      if (res.success) setUser(res.data.user);
    })();
  }, [setUser]);

  useEffect(() => {
    void (async () => {
      const res = await api<HealthStatus>('/api/health', { skipAuth: true });
      if (res.success) setHealth(res.data);
      else setHealthError(res.error.message);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Welcome{user?.name ? `, ${user.name}` : ''}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Dashboard, Jobs, and Notifications land in upcoming releases. For now, backend wiring.
          </p>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Account</h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 font-mono text-sm">
            <Row label="email" value={user?.email ?? '\u2014'} />
            <Row
              label="verified"
              value={user?.email_verified ? 'yes' : 'no'}
              tone={user?.email_verified ? 'good' : 'warn'}
            />
            <Row label="name" value={user?.name ?? '\u2014'} />
            <Row label="telegram" value={user?.telegram_chat_id ?? '\u2014'} />
          </dl>
        </section>

        <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Backend status</h2>
          {healthError && <p className="mt-3 font-mono text-sm text-red-600">{healthError}</p>}
          {!healthError && !health && <p className="mt-3 text-sm text-gray-500">Loading&hellip;</p>}
          {health && (
            <dl className="mt-3 space-y-2 font-mono text-sm">
              <Row
                label="status"
                value={health.status}
                tone={health.status === 'healthy' ? 'good' : 'warn'}
              />
              <Row
                label="database"
                value={
                  health.checks.database.ok
                    ? 'ok'
                    : `down${health.checks.database.error ? ` \u2014 ${health.checks.database.error}` : ''}`
                }
                tone={health.checks.database.ok ? 'good' : 'bad'}
              />
              <Row
                label="redis"
                value={
                  health.checks.redis.ok
                    ? 'ok'
                    : `down${health.checks.redis.error ? ` \u2014 ${health.checks.redis.error}` : ''}`
                }
                tone={health.checks.redis.ok ? 'good' : 'bad'}
              />
              <Row label="uptime" value={`${health.uptime.toFixed(1)}s`} />
            </dl>
          )}
        </section>
      </main>
    </div>
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
