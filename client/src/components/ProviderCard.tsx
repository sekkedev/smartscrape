import { useState } from 'react';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { FormField } from './ui/FormField';
import { api } from '../lib/api';
import { toast } from '../stores/toast';
import type { Provider, ProviderSummary, ProviderTestResult } from '../types/api';

type Props = {
  provider: Provider;
  label: string;
  description: string;
  summary: ProviderSummary | undefined;
  onChange: () => void;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'testing' }
  | { kind: 'removing' }
  | { kind: 'tested'; result: ProviderTestResult }
  | { kind: 'error'; message: string };

export function ProviderCard({ provider, label, description, summary, onChange }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const connected = Boolean(summary?.connected);

  async function save() {
    if (!apiKey.trim()) return;
    setStatus({ kind: 'saving' });
    const res = await api<{ provider: ProviderSummary }>('/api/providers', {
      method: 'POST',
      body: { provider, apiKey: apiKey.trim() },
    });
    if (!res.success) {
      const msg = res.error.details?.[0]?.message ?? res.error.message;
      setStatus({ kind: 'error', message: msg });
      toast.error(`${label}: ${msg}`);
      return;
    }
    setApiKey('');
    setStatus({ kind: 'idle' });
    toast.success(`${label} key saved.`);
    onChange();
  }

  async function test() {
    setStatus({ kind: 'testing' });
    const res = await api<ProviderTestResult>(`/api/providers/${provider}/test`, { method: 'POST' });
    if (!res.success) {
      setStatus({ kind: 'error', message: res.error.message });
      return;
    }
    setStatus({ kind: 'tested', result: res.data });
  }

  async function remove() {
    setStatus({ kind: 'removing' });
    const res = await api<{ removed: boolean }>(`/api/providers/${provider}`, { method: 'DELETE' });
    if (!res.success) {
      setStatus({ kind: 'error', message: res.error.message });
      toast.error(res.error.message);
      return;
    }
    setStatus({ kind: 'idle' });
    toast.success(`${label} key removed.`);
    onChange();
  }

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            connected
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              connected ? 'bg-emerald-500' : 'bg-gray-400'
            }`}
          />
          {connected ? 'Connected' : 'Not configured'}
        </span>
      </header>

      {connected && summary && (
        <p className="mt-3 font-mono text-xs text-gray-500 dark:text-gray-400">
          Added {new Date(summary.created_at).toLocaleString()}
        </p>
      )}

      <div className="mt-4">
        <FormField
          label={connected ? 'Replace API key' : 'API key'}
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={connected ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (enter to replace)' : 'Paste key'}
          hint={connected ? 'Saved keys are never displayed. Enter a new key to replace.' : undefined}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={save} loading={status.kind === 'saving'} disabled={!apiKey.trim()}>
          {connected ? 'Replace' : 'Save'}
        </Button>
        {connected && (
          <>
            <Button variant="secondary" onClick={test} loading={status.kind === 'testing'}>
              Test
            </Button>
            <Button variant="ghost" onClick={remove} loading={status.kind === 'removing'}>
              Remove
            </Button>
          </>
        )}
      </div>

      {status.kind === 'tested' && (
        <div className="mt-4">
          {status.result.ok ? (
            <Alert tone="success">
              Credentials valid \u2014 <span className="font-mono">{status.result.latencyMs}ms</span>
            </Alert>
          ) : (
            <Alert tone="error">
              {status.result.error ?? 'Test failed'} (<span className="font-mono">{status.result.latencyMs}ms</span>)
            </Alert>
          )}
        </div>
      )}
      {status.kind === 'error' && (
        <div className="mt-4">
          <Alert tone="error">{status.message}</Alert>
        </div>
      )}
    </article>
  );
}
