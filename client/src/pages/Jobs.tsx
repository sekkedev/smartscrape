import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import type { JobListItem, RunStatus } from '../types/api';

type Filter = 'all' | 'active' | 'paused' | 'failed';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'failed', label: 'Failed' },
];

export default function Jobs() {
  const [jobs, setJobs] = useState<JobListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async (f: Filter) => {
    const res = await api<{ items: JobListItem[]; total: number }>(`/api/jobs?filter=${f}`);
    if (!res.success) setError(res.error.message);
    else {
      setJobs(res.data.items);
      setError(null);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  async function toggle(id: string) {
    await api(`/api/jobs/${id}/toggle`, { method: 'PATCH' });
    void load(filter);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Jobs</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Scrape configurations, their schedules, and most recent runs.
            </p>
          </div>
          <Button onClick={() => navigate('/jobs/new')}>New job</Button>
        </div>

        <div className="mb-4 inline-flex rounded-md border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                filter === f.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        {jobs === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
              />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-950/40">
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">URLs</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Last run</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3">Enabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">
                      <Link to={`/jobs/${job.id}`} onClick={(e) => e.stopPropagation()}>
                        {job.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{job.urls.length}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{job.schedule ?? 'Manual'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.last_run_status} />
                      {job.last_run_at && (
                        <span className="ml-2 text-xs text-gray-500">
                          {new Date(job.last_run_at).toLocaleString()}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{job.last_run_items ?? '—'}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <label className="inline-flex cursor-pointer items-center">
                        <input
                          type="checkbox"
                          checked={job.enabled}
                          onChange={() => void toggle(job.id)}
                          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </label>
                    </td>
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

function StatusBadge({ status }: { status: RunStatus | null }) {
  if (!status) return <span className="text-xs text-gray-400">no runs yet</span>;
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

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white/60 p-10 text-center dark:border-gray-700 dark:bg-gray-900/40">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">No jobs yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
        A job watches one or more URLs, extracts structured data with your AI provider, and tells you when things change.
      </p>
      <div className="mt-4">
        <Link
          to="/jobs/new"
          className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Create your first job
        </Link>
      </div>
    </div>
  );
}
