import { type FormEvent, useState } from 'react';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { FormField } from './ui/FormField';
import type {
  ExtractionSchema,
  FieldType,
  Job,
  NotificationRule,
  NotifyChannel,
  Provider,
  ScrapeMethod,
} from '../types/api';

export type JobFormValues = {
  name: string;
  urls: string[];
  extraction_prompt: string;
  extraction_schema: ExtractionSchema | null;
  scrape_method: ScrapeMethod;
  schedule: string | null;
  comparison_key: string | null;
  notify_channels: NotifyChannel[];
  notification_rules: NotificationRule[];
  ai_provider: Provider;
  ai_model: string;
  google_sheet_id: string | null;
  sheet_tab_name: string | null;
};

const SCHEDULE_OPTIONS: { label: string; value: string | null }[] = [
  { label: 'Manual', value: null },
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily', value: '0 9 * * *' },
  { label: 'Weekly', value: '0 9 * * 1' },
];

const FIELD_TYPES: FieldType[] = ['string', 'number', 'boolean', 'array', 'object'];

export function jobToFormValues(job: Job): JobFormValues {
  return {
    name: job.name,
    urls: job.urls,
    extraction_prompt: job.extraction_prompt,
    extraction_schema: job.extraction_schema,
    scrape_method: job.scrape_method,
    schedule: job.schedule,
    comparison_key: job.comparison_key,
    notify_channels: job.notify_channels,
    notification_rules: job.notification_rules,
    ai_provider: job.ai_provider,
    ai_model: job.ai_model,
    google_sheet_id: job.google_sheet_id,
    sheet_tab_name: job.sheet_tab_name,
  };
}

/**
 * Accept anything the user pastes and return the bare sheet ID. Users often
 * paste the whole URL (https://docs.google.com/spreadsheets/d/XYZ/edit?\u2026)
 * rather than the ID.
 */
function extractSheetId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const match = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1]!;
  return s;
}

export const EMPTY_FORM: JobFormValues = {
  name: '',
  urls: [''],
  extraction_prompt: '',
  extraction_schema: null,
  scrape_method: 'auto',
  schedule: null,
  comparison_key: null,
  notify_channels: [],
  notification_rules: [],
  ai_provider: 'openrouter',
  ai_model: 'openai/gpt-4o-mini',
  google_sheet_id: null,
  sheet_tab_name: null,
};

type Props = {
  initial: JobFormValues;
  submitLabel: string;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (values: JobFormValues) => void;
  onCancel?: () => void;
};

export function JobForm({ initial, submitLabel, submitting, error, onSubmit, onCancel }: Props) {
  const [v, setV] = useState<JobFormValues>(initial);
  const [schemaFields, setSchemaFields] = useState(
    initial.extraction_schema
      ? Object.entries(initial.extraction_schema).map(([name, type]) => ({ name, type }))
      : [],
  );

  function handle(e: FormEvent) {
    e.preventDefault();
    const schema =
      schemaFields.length > 0
        ? Object.fromEntries(schemaFields.filter((f) => f.name).map((f) => [f.name, f.type]))
        : null;
    onSubmit({ ...v, extraction_schema: schema });
  }

  function setUrls(i: number, val: string) {
    setV((s) => ({ ...s, urls: s.urls.map((u, idx) => (idx === i ? val : u)) }));
  }

  function addField() {
    setSchemaFields((s) => [...s, { name: '', type: 'string' }]);
  }
  function updateField(i: number, patch: { name?: string; type?: FieldType }) {
    setSchemaFields((s) => s.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setSchemaFields((s) => s.filter((_, idx) => idx !== i));
  }

  function toggleChannel(ch: NotifyChannel) {
    setV((s) => ({
      ...s,
      notify_channels: s.notify_channels.includes(ch)
        ? s.notify_channels.filter((c) => c !== ch)
        : [...s.notify_channels, ch],
    }));
  }

  function addRule() {
    setV((s) => ({
      ...s,
      notification_rules: [...s.notification_rules, { type: 'any_change' }],
    }));
  }
  function updateRule(i: number, rule: NotificationRule) {
    setV((s) => ({
      ...s,
      notification_rules: s.notification_rules.map((r, idx) => (idx === i ? rule : r)),
    }));
  }
  function removeRule(i: number) {
    setV((s) => ({
      ...s,
      notification_rules: s.notification_rules.filter((_, idx) => idx !== i),
    }));
  }

  return (
    <form onSubmit={handle} className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <Section title="Basics">
        <FormField
          label="Job name"
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          placeholder="Track GPU prices on example.com"
        />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">URLs</label>
          <div className="space-y-2">
            {v.urls.map((url, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  required
                  onChange={(e) => setUrls(i, e.target.value)}
                  placeholder="https://..."
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900"
                />
                {v.urls.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setV({ ...v, urls: v.urls.filter((_, idx) => idx !== i) })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            {v.urls.length < 10 && (
              <Button type="button" variant="secondary" onClick={() => setV({ ...v, urls: [...v.urls, ''] })}>
                + Add URL
              </Button>
            )}
          </div>
        </div>
      </Section>

      <Section title="Extraction">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            What should the AI extract?
          </label>
          <textarea
            value={v.extraction_prompt}
            onChange={(e) => setV({ ...v, extraction_prompt: e.target.value })}
            rows={3}
            required
            placeholder="Describe the data in plain English, e.g. 'Extract each product card with name, price in USD, and stock status.'"
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900"
          />
        </div>

        <div>
          <div className="mb-2 flex items-end justify-between">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Fields (optional)
            </label>
            <Button type="button" variant="ghost" onClick={addField}>
              + Add field
            </Button>
          </div>
          <div className="space-y-2">
            {schemaFields.map((f, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={f.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                  placeholder="field_name"
                  className="block flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                />
                <select
                  value={f.type}
                  onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="ghost" onClick={() => removeField(i)}>
                  Remove
                </Button>
              </div>
            ))}
            {schemaFields.length === 0 && (
              <p className="text-xs text-gray-500">
                Leave empty to let the AI infer fields, or add explicit fields to tighten the output.
              </p>
            )}
          </div>
        </div>

        <FormField
          label="Comparison key (for change detection)"
          hint="Name of the field that uniquely identifies each item across runs. Example: url, sku, id."
          value={v.comparison_key ?? ''}
          onChange={(e) => setV({ ...v, comparison_key: e.target.value || null })}
        />
      </Section>

      <Section title="Scraping + scheduling">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Scrape method
            </label>
            <select
              value={v.scrape_method}
              onChange={(e) => setV({ ...v, scrape_method: e.target.value as ScrapeMethod })}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="auto">Auto (static, fall back to browser)</option>
              <option value="cheerio">Cheerio only (static)</option>
              <option value="playwright">Playwright only (browser)</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Schedule</label>
            <select
              value={v.schedule ?? ''}
              onChange={(e) => setV({ ...v, schedule: e.target.value === '' ? null : e.target.value })}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              {SCHEDULE_OPTIONS.map((opt) => (
                <option key={opt.label} value={opt.value ?? ''}>
                  {opt.label}
                </option>
              ))}
              <option value="custom">Custom cron...</option>
            </select>
            {v.schedule &&
              !SCHEDULE_OPTIONS.some((o) => o.value === v.schedule) && (
                <input
                  value={v.schedule}
                  onChange={(e) => setV({ ...v, schedule: e.target.value })}
                  placeholder="Cron expression"
                  className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              )}
          </div>
        </div>
      </Section>

      <Section title="AI model">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Provider</label>
            <select
              value={v.ai_provider}
              onChange={(e) => setV({ ...v, ai_provider: e.target.value as Provider })}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          <FormField
            label="Model"
            value={v.ai_model}
            onChange={(e) => setV({ ...v, ai_model: e.target.value })}
            placeholder="openai/gpt-4o-mini"
          />
        </div>
      </Section>

      <Section title="Google Sheets (optional)">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          After each run, extracted rows are appended to the sheet. Connect Google in Settings first, then paste the
          Sheet ID here.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            label="Sheet ID"
            value={v.google_sheet_id ?? ''}
            onChange={(e) => setV({ ...v, google_sheet_id: extractSheetId(e.target.value) })}
            placeholder="Paste the full URL or just the ID"
          />
          <FormField
            label="Tab name"
            value={v.sheet_tab_name ?? ''}
            onChange={(e) => setV({ ...v, sheet_tab_name: e.target.value || null })}
            placeholder="Sheet1"
          />
        </div>
      </Section>

      <Section title="Notifications">
        <div className="flex flex-wrap gap-3">
          {(['email', 'telegram'] as NotifyChannel[]).map((ch) => (
            <label key={ch} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.notify_channels.includes(ch)}
                onChange={() => toggleChannel(ch)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="capitalize">{ch}</span>
            </label>
          ))}
        </div>

        <div className="space-y-3">
          {v.notification_rules.map((rule, i) => (
            <RuleEditor key={i} rule={rule} onChange={(r) => updateRule(i, r)} onRemove={() => removeRule(i)} />
          ))}
          <Button type="button" variant="secondary" onClick={addRule}>
            + Add notification rule
          </Button>
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3 pt-4">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-b border-gray-200 pb-6 dark:border-gray-800">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  );
}

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: NotificationRule;
  onChange: (r: NotificationRule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={rule.type}
          onChange={(e) => {
            const type = e.target.value as NotificationRule['type'];
            if (type === 'field_threshold') {
              onChange({ type, field: '', operator: 'less_than', value: 0 });
            } else if (type === 'field_change') {
              onChange({ type, field: '' });
            } else {
              onChange({ type });
            }
          }}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="any_change">Any change</option>
          <option value="new_items">New items appear</option>
          <option value="removed_items">Items disappear</option>
          <option value="field_threshold">Field crosses threshold</option>
          <option value="field_change">Field value changes</option>
        </select>

        {(rule.type === 'field_threshold' || rule.type === 'field_change') && (
          <input
            value={rule.field}
            onChange={(e) => onChange({ ...rule, field: e.target.value })}
            placeholder="field name"
            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        )}

        {rule.type === 'field_threshold' && (
          <>
            <select
              value={rule.operator}
              onChange={(e) =>
                onChange({ ...rule, operator: e.target.value as typeof rule.operator })
              }
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
            >
              <option value="less_than">&lt;</option>
              <option value="less_than_or_equal">&le;</option>
              <option value="equals">=</option>
              <option value="not_equals">&ne;</option>
              <option value="greater_than_or_equal">&ge;</option>
              <option value="greater_than">&gt;</option>
            </select>
            <input
              value={String(rule.value)}
              onChange={(e) => {
                const asNum = Number(e.target.value);
                onChange({ ...rule, value: Number.isFinite(asNum) && e.target.value !== '' ? asNum : e.target.value });
              }}
              placeholder="value"
              className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
            />
          </>
        )}

        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-xs text-gray-500 hover:text-red-600"
        >
          Remove
        </button>
      </div>
      <input
        value={rule.message ?? ''}
        onChange={(e) => onChange({ ...rule, message: e.target.value || undefined })}
        placeholder="Optional message template. Use {field_name}, {old}, {new}, {count}, {url}."
        className="mt-2 block w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm dark:border-gray-800 dark:bg-gray-950"
      />
    </div>
  );
}
