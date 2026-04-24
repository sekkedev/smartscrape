import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';

type Status = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  expires_at: string | null;
};

export function GoogleSheetsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const res = await api<Status>('/api/google/status');
    if (res.success) setStatus(res.data);
    else setError(res.error.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Surface success/failure from the /api/google/callback redirect once.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('google_connected') === '1') {
      setNote('Connected to Google. Reloading status…');
      void load();
      navigate('/settings', { replace: true });
    }
    const err = params.get('google_error');
    if (err) {
      setError(`Google connection failed: ${err}`);
      navigate('/settings', { replace: true });
    }
  }, [location.search, load, navigate]);

  async function connect() {
    setWorking(true);
    setError(null);
    const res = await api<{ url: string }>('/api/google/connect');
    setWorking(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    window.location.href = res.data.url;
  }

  async function disconnect() {
    if (!confirm('Disconnect Google? Existing jobs with a linked Sheet will stop exporting.')) return;
    setWorking(true);
    const res = await api<{ disconnected: boolean }>('/api/google/disconnect', { method: 'DELETE' });
    setWorking(false);
    if (!res.success) {
      setError(res.error.message);
      return;
    }
    void load();
  }

  const connected = Boolean(status?.connected);

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Google Sheets</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Append extracted rows to a sheet after each run.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
            connected
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </header>

      {status && !status.configured && (
        <Alert tone="info">
          Google OAuth isn't configured on this server. Ask the admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
        </Alert>
      )}

      {status?.email && (
        <p className="mb-3 font-mono text-xs text-gray-500 dark:text-gray-400">
          Connected as {status.email}
        </p>
      )}

      {error && <Alert tone="error" className="mb-3">{error}</Alert>}
      {note && <Alert tone="success" className="mb-3">{note}</Alert>}

      <div className="flex flex-wrap gap-2">
        {!connected ? (
          <Button onClick={connect} loading={working} disabled={!status?.configured}>
            Connect Google
          </Button>
        ) : (
          <Button variant="ghost" onClick={disconnect} loading={working}>
            Disconnect
          </Button>
        )}
      </div>

      {connected && (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          To export to a sheet, paste the Sheet ID and tab name into a job's config. The Sheet ID is the long path
          segment in the URL: <span className="font-mono">/spreadsheets/d/<span className="text-indigo-600 dark:text-indigo-400">SHEET_ID</span>/edit</span>.
        </p>
      )}
    </article>
  );
}
