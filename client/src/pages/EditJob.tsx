import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { JobForm, jobToFormValues, type JobFormValues } from '../components/JobForm';
import { api } from '../lib/api';
import type { Job } from '../types/api';

export default function EditJob() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<JobFormValues | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api<{ job: Job }>(`/api/jobs/${id}`);
      if (res.success) setInitial(jobToFormValues(res.data.job));
      else setError(res.error.message);
    })();
  }, [id]);

  async function onSubmit(values: JobFormValues) {
    setSubmitting(true);
    setError(null);
    const res = await api<{ job: Job }>(`/api/jobs/${id}`, {
      method: 'PATCH',
      body: { ...values, urls: values.urls.filter((u) => u.trim()) },
    });
    setSubmitting(false);
    if (!res.success) {
      setError(res.error.details?.[0]?.message ?? res.error.message);
      return;
    }
    navigate(`/jobs/${id}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Edit job</h1>
        </div>
        {initial ? (
          <JobForm
            initial={initial}
            submitLabel="Save"
            submitting={submitting}
            error={error}
            onSubmit={onSubmit}
            onCancel={() => navigate(`/jobs/${id}`)}
          />
        ) : (
          <p className="text-sm text-gray-500">Loading…</p>
        )}
      </main>
    </div>
  );
}
