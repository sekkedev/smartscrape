import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { EMPTY_FORM, JobForm, type JobFormValues } from '../components/JobForm';
import { api } from '../lib/api';
import type { Job } from '../types/api';

export default function NewJob() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(values: JobFormValues) {
    setSubmitting(true);
    setError(null);
    const res = await api<{ job: Job }>('/api/jobs', {
      method: 'POST',
      body: { ...values, setup_method: 'manual', urls: values.urls.filter((u) => u.trim()) },
    });
    setSubmitting(false);
    if (!res.success) {
      setError(res.error.details?.[0]?.message ?? res.error.message);
      return;
    }
    navigate(`/jobs/${res.data.job.id}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">New job</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manual setup. The AI-assisted setup wizard lands in the next release.
          </p>
        </div>
        <JobForm
          initial={EMPTY_FORM}
          submitLabel="Create job"
          submitting={submitting}
          error={error}
          onSubmit={onSubmit}
          onCancel={() => navigate('/jobs')}
        />
      </main>
    </div>
  );
}
