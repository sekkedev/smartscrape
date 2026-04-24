import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { api } from '../lib/api';
import type { NotificationItem } from '../types/api';

type Channel = 'email' | 'telegram';

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [channel, setChannel] = useState<'all' | Channel>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (channel !== 'all') params.set('channel', channel);
    const res = await api<{ items: NotificationItem[]; total: number }>(`/api/notifications?${params.toString()}`);
    if (res.success) {
      setItems(res.data.items);
      setTotal(res.data.total);
      setError(null);
    } else {
      setError(res.error.message);
    }
  }, [channel]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Notifications</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Everything dispatched by your jobs. {total > 0 && `${total} total.`}
            </p>
          </div>
          <div className="inline-flex rounded-md border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">
            {(['all', 'email', 'telegram'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                  channel === c
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                {c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {items === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 p-10 text-center dark:border-gray-700 dark:bg-gray-900/40">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">No notifications yet</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Once a scheduled run detects changes, dispatches show up here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-950/40">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Job</th>
                  <th className="px-4 py-3">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {items.map((n) => (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">
                      {new Date(n.sent_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          n.channel === 'telegram'
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        }`}
                      >
                        {n.channel === 'telegram' ? '📨' : '✉'} {n.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/jobs/${n.job_id}`} className="text-indigo-600 hover:underline dark:text-indigo-400">
                        {n.job_name ?? n.job_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{n.message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
