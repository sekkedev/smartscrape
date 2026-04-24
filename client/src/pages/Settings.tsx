import { useCallback, useEffect, useState } from 'react';
import { TopNav } from '../components/layout/TopNav';
import { GoogleSheetsCard } from '../components/GoogleSheetsCard';
import { ProviderCard } from '../components/ProviderCard';
import { TelegramCard } from '../components/TelegramCard';
import { api } from '../lib/api';
import type { Provider, ProviderSummary } from '../types/api';

type ProviderSpec = {
  provider: Provider;
  label: string;
  description: string;
};

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    description: 'Used for GPT-family extraction models. Create a key at platform.openai.com.',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models. Create a key at console.anthropic.com.',
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    description: 'Unified gateway to many models. Create a key at openrouter.ai.',
  },
];

export default function Settings() {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await api<{ providers: ProviderSummary[] }>('/api/providers');
    if (res.success) {
      setProviders(res.data.providers);
      setError(null);
    } else {
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byProvider = new Map(providers?.map((p) => [p.provider, p]) ?? []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">Settings</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage AI provider keys and account preferences.
          </p>
        </div>

        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                AI providers
              </h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Keys are encrypted at rest with AES-256-GCM. Smart\u00adScrape never logs or exposes them.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}

          {providers === null ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {PROVIDER_SPECS.map((s) => (
                <div
                  key={s.provider}
                  className="h-40 animate-pulse rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {PROVIDER_SPECS.map((s) => (
                <ProviderCard
                  key={s.provider}
                  provider={s.provider}
                  label={s.label}
                  description={s.description}
                  summary={byProvider.get(s.provider)}
                  onChange={refresh}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Integrations</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <GoogleSheetsCard />
            <TelegramCard />
          </div>
        </section>
      </main>
    </div>
  );
}
