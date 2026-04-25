import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopNav } from '../components/layout/TopNav';
import { EMPTY_FORM, JobForm, type JobFormValues } from '../components/JobForm';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { api } from '../lib/api';
import type { ExtractionSchema, Job, NotificationRule, Provider } from '../types/api';

type AiSuggestion = {
  name: string;
  extraction_prompt: string;
  extraction_schema: ExtractionSchema | null;
  comparison_key: string | null;
  notification_rules: NotificationRule[];
  explanation: string;
};

type AiSetupResponse = {
  suggestion: AiSuggestion;
  usage: { promptTokens: number; completionTokens: number };
  scrape: { method: string; status: number; finalUrl: string; durationMs: number };
};

type Mode = 'wizard' | 'manual';
type WizardStep = 'ask' | 'review';

const EXAMPLE_GOALS = [
  'Track product prices on this page and alert me when anything drops below $500.',
  'Monitor this job board for new postings matching "senior frontend".',
  'Watch this page for new blog posts and email me when one is published.',
];

export default function NewJob() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('wizard');
  const [step, setStep] = useState<WizardStep>('ask');

  // Step-1 state
  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [provider, setProvider] = useState<Provider>('openrouter');
  const [model, setModel] = useState('openai/gpt-4o-mini');
  const [analyzing, setAnalyzing] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Step-2 state
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
  const [formValues, setFormValues] = useState<JobFormValues | null>(null);
  const [previewItems, setPreviewItems] = useState<Record<string, unknown>[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function analyze() {
    setStepError(null);
    setAnalyzing(true);
    const res = await api<AiSetupResponse>('/api/jobs/ai-setup', {
      method: 'POST',
      body: { url, goal, ai_provider: provider, ai_model: model },
    });
    setAnalyzing(false);
    if (!res.success) {
      setStepError(res.error.message);
      return;
    }
    const s = res.data.suggestion;
    setSuggestion(s);
    setFormValues({
      name: s.name,
      urls: [url],
      extraction_prompt: s.extraction_prompt,
      extraction_schema: s.extraction_schema,
      comparison_key: s.comparison_key,
      notification_rules: s.notification_rules,
      scrape_method: 'auto',
      schedule: null,
      notify_channels: [],
      ai_provider: provider,
      ai_model: model,
      google_sheet_id: null,
      sheet_tab_name: null,
      respect_robots_txt: true,
    });
    setStep('review');
  }

  async function preview() {
    if (!formValues) return;
    setPreviewing(true);
    setPreviewItems(null);
    const res = await api<{ items: Record<string, unknown>[] }>('/api/jobs/ai-setup/preview', {
      method: 'POST',
      body: {
        url: formValues.urls[0],
        extraction_prompt: formValues.extraction_prompt,
        extraction_schema: formValues.extraction_schema,
        ai_provider: formValues.ai_provider,
        ai_model: formValues.ai_model,
      },
    });
    setPreviewing(false);
    if (!res.success) {
      setFormError(res.error.message);
      return;
    }
    setPreviewItems(res.data.items);
  }

  async function confirm(values: JobFormValues) {
    if (!suggestion) return;
    setSubmitting(true);
    setFormError(null);
    const res = await api<{ job: Job }>('/api/jobs/ai-setup/confirm', {
      method: 'POST',
      body: {
        ...values,
        urls: values.urls.filter((u) => u.trim()),
        user_goal: goal,
        ai_suggestion: suggestion,
      },
    });
    setSubmitting(false);
    if (!res.success) {
      setFormError(res.error.details?.[0]?.message ?? res.error.message);
      return;
    }
    navigate(`/jobs/${res.data.job.id}`);
  }

  async function createManual(values: JobFormValues) {
    setSubmitting(true);
    setFormError(null);
    const res = await api<{ job: Job }>('/api/jobs', {
      method: 'POST',
      body: { ...values, setup_method: 'manual', urls: values.urls.filter((u) => u.trim()) },
    });
    setSubmitting(false);
    if (!res.success) {
      setFormError(res.error.details?.[0]?.message ?? res.error.message);
      return;
    }
    navigate(`/jobs/${res.data.job.id}`);
  }

  const previewTableKeys = previewItems && previewItems[0] ? Object.keys(previewItems[0]) : [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">New job</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {mode === 'wizard'
                ? 'Describe what you want to track and let AI suggest a config.'
                : 'Manual setup — fill every field yourself.'}
            </p>
          </div>
          <button
            onClick={() => {
              setMode(mode === 'wizard' ? 'manual' : 'wizard');
              setStep('ask');
              setSuggestion(null);
              setFormValues(null);
              setPreviewItems(null);
              setFormError(null);
            }}
            className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {mode === 'wizard' ? 'Manual setup' : 'Back to AI setup'}
          </button>
        </div>

        {mode === 'manual' && (
          <JobForm
            initial={EMPTY_FORM}
            submitLabel="Create job"
            submitting={submitting}
            error={formError}
            onSubmit={createManual}
            onCancel={() => navigate('/jobs')}
          />
        )}

        {mode === 'wizard' && step === 'ask' && (
          <div className="space-y-5">
            {stepError && <Alert tone="error">{stepError}</Alert>}
            <FormField
              label="URL to analyze"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/listings"
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Describe what you want to track
              </label>
              <textarea
                rows={4}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Example: Track laptop prices and notify me when any drop by more than 10%."
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900"
                required
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {EXAMPLE_GOALS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setGoal(ex)}
                    className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    {ex.length > 60 ? `${ex.slice(0, 60)}\u2026` : ex}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  AI provider
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </div>
              <FormField label="Model" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button onClick={analyze} loading={analyzing} disabled={!url || !goal}>
                Analyze
              </Button>
            </div>
            {analyzing && (
              <p className="text-xs text-gray-500">
                Scraping page &rarr; cleaning HTML &rarr; asking the model for a config&hellip;
              </p>
            )}
          </div>
        )}

        {mode === 'wizard' && step === 'review' && formValues && suggestion && (
          <div className="space-y-6">
            <Alert tone="info">
              <div className="font-medium">AI suggestion</div>
              <div className="mt-1 text-xs">{suggestion.explanation}</div>
            </Alert>

            <div className="flex items-center justify-between">
              <Button variant="secondary" loading={previewing} onClick={preview}>
                Preview extraction
              </Button>
              <button
                onClick={() => {
                  setStep('ask');
                  setPreviewItems(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
              >
                &larr; Back
              </button>
            </div>

            {previewItems && (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-950/40">
                  Preview ({previewItems.length} items)
                </div>
                {previewItems.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-gray-500">
                    No items extracted. Tweak the prompt or fields below and try again.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-800">
                          {previewTableKeys.map((k) => (
                            <th key={k} className="px-3 py-2 text-left font-medium text-gray-500">
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                        {previewItems.slice(0, 10).map((item, i) => (
                          <tr key={i}>
                            {previewTableKeys.map((k) => (
                              <td key={k} className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">
                                {renderValue(item[k])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <JobForm
              initial={formValues}
              submitLabel="Create job"
              submitting={submitting}
              error={formError}
              onSubmit={confirm}
              onCancel={() => navigate('/jobs')}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
  return String(v).slice(0, 80);
}
