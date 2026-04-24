import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { DiffResult } from '../types/api';

export function RunDiff({ runId }: { runId: string }) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await api<{ diff: DiffResult }>(`/api/runs/${runId}/diff`);
      if (cancelled) return;
      if (res.success) setDiff(res.data.diff);
      else setError(res.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!diff) return <p className="text-xs text-gray-500">Loading…</p>;

  if (!diff.previous_run) {
    return (
      <p className="text-xs text-gray-500">
        First run for this job — {diff.added.length} item{diff.added.length === 1 ? '' : 's'} as the baseline.
      </p>
    );
  }

  const nothing = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;

  return (
    <div className="space-y-3 text-xs">
      <p className="font-mono text-gray-500">
        vs run {diff.previous_run.id.slice(0, 8)} · {new Date(diff.previous_run.started_at).toLocaleString()}
      </p>
      {nothing && <p className="text-gray-500">No changes since the previous run.</p>}
      {diff.added.length > 0 && <Group tone="added" label={`Added (${diff.added.length})`} items={diff.added} />}
      {diff.removed.length > 0 && (
        <Group tone="removed" label={`Removed (${diff.removed.length})`} items={diff.removed} />
      )}
      {diff.changed.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="mb-2 font-medium text-amber-800 dark:text-amber-300">Changed ({diff.changed.length})</p>
          <ul className="space-y-2">
            {diff.changed.map((c, i) => (
              <li key={i} className="border-l-2 border-amber-300 pl-2 font-mono text-[11px]">
                <div className="text-amber-900 dark:text-amber-200">key: {c.key}</div>
                <ul className="mt-1 space-y-0.5">
                  {c.field_diffs.map((f, j) => (
                    <li key={j}>
                      <span className="text-gray-500">{f.field}:</span>{' '}
                      <span className="line-through opacity-70">{renderValue(f.old)}</span>{' '}
                      <span className="text-amber-900 dark:text-amber-200">→ {renderValue(f.new)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Group({
  tone,
  label,
  items,
}: {
  tone: 'added' | 'removed';
  label: string;
  items: Record<string, unknown>[];
}) {
  const cls =
    tone === 'added'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
      : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200';
  return (
    <div className={`rounded-md border p-3 ${cls}`}>
      <p className="mb-2 font-medium">{label}</p>
      <ul className="space-y-1 font-mono text-[11px]">
        {items.slice(0, 10).map((item, i) => (
          <li key={i} className="truncate">
            {Object.entries(item)
              .slice(0, 4)
              .map(([k, v]) => `${k}=${renderValue(v)}`)
              .join('  ·  ')}
          </li>
        ))}
        {items.length > 10 && <li className="text-xs opacity-70">+ {items.length - 10} more</li>}
      </ul>
    </div>
  );
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
  return String(v).slice(0, 60);
}
