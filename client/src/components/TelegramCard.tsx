import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../stores/auth';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { FormField } from './ui/FormField';
import type { PublicUser } from '../types/api';

type SetupInfo = {
  botUsername: string | null;
  link: string | null;
  instructions: string[];
};

export function TelegramCard() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [chatId, setChatId] = useState(user?.telegram_chat_id ?? '');
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await api<SetupInfo>('/api/notifications/telegram/setup');
      if (res.success) setInfo(res.data);
    })();
  }, []);

  useEffect(() => {
    setChatId(user?.telegram_chat_id ?? '');
  }, [user?.telegram_chat_id]);

  async function save() {
    setStatus(null);
    setSaving(true);
    const res = await api<{ user: PublicUser }>('/api/auth/me', {
      method: 'PATCH',
      body: { telegram_chat_id: chatId.trim() || null },
    });
    setSaving(false);
    if (!res.success) {
      setStatus({ tone: 'error', message: res.error.message });
      return;
    }
    setUser(res.data.user);
    setStatus({ tone: 'success', message: 'Chat ID saved.' });
  }

  async function test() {
    setStatus(null);
    setTesting(true);
    const res = await api<{ sent: boolean }>('/api/notifications/test/telegram', { method: 'POST' });
    setTesting(false);
    if (!res.success) {
      setStatus({ tone: 'error', message: res.error.message });
      return;
    }
    setStatus({ tone: 'success', message: 'Test message sent. Check Telegram.' });
  }

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Telegram</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Receive notifications as direct messages from the SmartScrape bot.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            user?.telegram_chat_id
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              user?.telegram_chat_id ? 'bg-emerald-500' : 'bg-gray-400'
            }`}
          />
          {user?.telegram_chat_id ? 'Linked' : 'Not linked'}
        </span>
      </header>

      {info?.link ? (
        <ol className="mb-4 list-decimal space-y-0.5 pl-5 text-xs text-gray-600 dark:text-gray-400">
          {info.instructions.map((line) => (
            <li key={line}>
              {/^\d+\.\s/.test(line) ? line.replace(/^\d+\.\s*/, '') : line}
            </li>
          ))}
          <li>
            Bot:{' '}
            <a href={info.link} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
              {info.link}
            </a>
          </li>
        </ol>
      ) : (
        <p className="mb-4 text-xs text-gray-500">
          Bot not reachable. Check server config.
        </p>
      )}

      <FormField
        label="Your Telegram chat ID"
        value={chatId}
        onChange={(e) => setChatId(e.target.value)}
        placeholder="e.g. 123456789"
        autoComplete="off"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={save} loading={saving}>
          Save
        </Button>
        {user?.telegram_chat_id && (
          <Button variant="secondary" onClick={test} loading={testing}>
            Send test message
          </Button>
        )}
      </div>
      {status && (
        <div className="mt-3">
          <Alert tone={status.tone}>{status.message}</Alert>
        </div>
      )}
    </article>
  );
}
