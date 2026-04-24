import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import type { Job, Run, RunStatus } from '../types/api';

export default function JobDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<Job | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [runningNow, setRunningNow] = useState(false);

  const load = useCallback(async () => {
    const [jr, rr] = await Promise.all([
      api<{ job: Job }>(`/api/jobs/${id}`),
      api<{ runs: Run[] }>(`/api/jobs/${id}/runs`),
    ]);
    if (!jr.success) {
      setError(jr.error.message);
      return;
    }
    setJob(jr.data.job);
    if (rr.success) setRuns(rr.data.runs);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // While any run is in-flight, poll every 3s so the UI tracks the lifecycle.
  useEffect(() => {
    const inFlight = runs?.some((r) =>
      ['pending', 'scraping', 'extracting', 'exporting'].includes(r.status),
    );
    if (!inFlight) return;
    const t = setInterval(() => void load(), 3_000);
    return () => clearInterval(t);
  }, [runs, load]);

  async function runNow() {
    setRunningNow(true);
    const res = await api<{ run: Run }>(`/api/jobs/${id}/run`, { method: 'POST' });
    setRunningNow(false);
    if (!res.success) setError(res.error.message);
    else void load();
  }

  async function remove() {
    if (!confirm('Delete this job and all its runs? This cannot be undone.')) return;
    setDeleting(true);
    const res = await api(`/api/jobs/${id}`, { method: 'DELETE' });
    setDeleting(false);
    if (res.success) navigate('/jobs');
    else setError(res.error.message);
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <TopNav />
        <main className="mx-auto max-w-4xl px-6 py-10">
          <Alert tone="error">{error}</Alert>
        </main>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <TopNav />
        <main className="mx-auto max-w-4xl px-6 py-10">
          <p className="text-sm text-gray-500">Loading…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">{job.name}</h1>
            <p className="mt-1 font-mono text-xs text-gray-500">
              {job.urls.length} URL{job.urls.length === 1 ? '' : 's'} · {job.schedule ?? 'Manual'} · {job.ai_provider}/{job.ai_model}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={runNow} loading={runningNow}>
              Run now
            </Button>
            <Link to={`/jobs/${job.id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button variant="danger" loading={deleting} onClick={remove}>
              Delete
            </Button>
          </div>
        </div>

        <Card title="Extraction">
          <p className="font-mono text-sm text-gray-900 dark:text-gray-100">{job.extraction_prompt}</p>
          {job.extraction_schema && (
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
              {Object.entries(job.extraction_schema).map(([k, t]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-indigo-600 dark:text-indigo-400">{t}</span>
                </div>
              ))}
            </div>
          )}
          {job.comparison_key && (
            <p className="mt-3 text-xs text-gray-500">
              Comparison key: <span className="font-mono">{job.comparison_key}</span>
            </p>
          )}
        </Card>

        <Card title="URLs">
          <ul className="space-y-1 font-mono text-xs">
            {job.urls.map((u) => (
              <li key={u} className="truncate text-gray-700 dark:text-gray-300">
                {u}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Run history">
          {!runs ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-gray-500">No runs yet. Scheduling lands next release.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2">Status</th>
                  <th className="py-2">Items</th>
                  <th className="py-2">Tokens</th>
                  <th className="py-2">Duration</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 font-mono text-xs">{r.items_extracted}</td>
                    <td className="py-2 font-mono text-xs">{r.tokens_used}</td>
                    <td className="py-2 font-mono text-xs">
                      {r.completed_at
                        ? `${Math.round(
                            (new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 100,
                          ) / 10}s`
                        : '—'}
                    </td>
                    <td className="py-2 font-mono text-xs text-gray-500">{new Date(r.started_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </main>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      {children}
    </section>
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
