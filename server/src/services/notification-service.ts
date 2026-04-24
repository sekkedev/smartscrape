import type { DiffResult } from './change-detector.js';
import type { JobRow, NotificationRule } from '../db/jobs.js';
import { insertNotification, type Channel } from '../db/notifications.js';
import { findUserById } from '../db/users.js';
import { sendEmail } from './email.js';
import { sendTelegram } from './telegram.js';

export type EvaluatedNotification = {
  type: 'change_detected' | 'job_failed' | 'job_completed';
  message: string;
};

// ---------- variable substitution ----------

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    if (name in vars) return formatValue(vars[name]);
    return `{${name}}`;
  });
}

// ---------- rule evaluation ----------

function compare(operator: string, lhs: unknown, rhs: number | string): boolean {
  const l = typeof lhs === 'string' && !Number.isNaN(Number(lhs)) ? Number(lhs) : lhs;
  const r = typeof rhs === 'string' && !Number.isNaN(Number(rhs)) ? Number(rhs) : rhs;
  switch (operator) {
    case 'less_than':
      return typeof l === 'number' && typeof r === 'number' && l < r;
    case 'less_than_or_equal':
      return typeof l === 'number' && typeof r === 'number' && l <= r;
    case 'greater_than':
      return typeof l === 'number' && typeof r === 'number' && l > r;
    case 'greater_than_or_equal':
      return typeof l === 'number' && typeof r === 'number' && l >= r;
    case 'equals':
      return l === r;
    case 'not_equals':
      return l !== r;
    default:
      return false;
  }
}

/** Cap per-item rules so a huge batch can't flood a user. */
const PER_RULE_ITEM_CAP = 3;

function capPerItem(
  rule: NotificationRule,
  matches: EvaluatedNotification[],
): EvaluatedNotification[] {
  if (matches.length <= PER_RULE_ITEM_CAP) return matches;
  const head = matches.slice(0, PER_RULE_ITEM_CAP);
  head.push({
    type: 'change_detected',
    message: `\u2026and ${matches.length - PER_RULE_ITEM_CAP} more matches for rule "${rule.type}".`,
  });
  return head;
}

export function evaluateRules(job: JobRow, diff: DiffResult): EvaluatedNotification[] {
  const out: EvaluatedNotification[] = [];
  const rules: NotificationRule[] = job.notification_rules;
  const globals = { job_name: job.name };
  // First run (no predecessor) = "initial inventory", not a change. Skip rules
  // that only make sense across runs so users don't get flooded on day one.
  const isFirstRun = diff.previous_run === null;

  for (const rule of rules) {
    switch (rule.type) {
      case 'any_change': {
        if (isFirstRun) break;
        if (diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0) {
          const url = String((diff.added[0] ?? diff.changed[0]?.after ?? diff.removed[0])?.url ?? '');
          out.push({
            type: 'change_detected',
            message: interpolate(rule.message ?? 'Data changed on {job_name}', { ...globals, url }),
          });
        }
        break;
      }
      case 'new_items': {
        if (isFirstRun) break;
        if (diff.added.length > 0) {
          out.push({
            type: 'change_detected',
            message: interpolate(rule.message ?? 'Found {count} new items on {job_name}', {
              ...globals,
              count: diff.added.length,
            }),
          });
        }
        break;
      }
      case 'removed_items': {
        if (isFirstRun) break;
        if (diff.removed.length > 0) {
          out.push({
            type: 'change_detected',
            message: interpolate(rule.message ?? '{count} items were removed from {job_name}', {
              ...globals,
              count: diff.removed.length,
            }),
          });
        }
        break;
      }
      case 'field_threshold': {
        // Skip on first run: every baseline item would match and spam the user.
        if (isFirstRun) break;
        // Only alert on NEW items crossing the threshold, not every existing match.
        const candidates = [...diff.added, ...diff.changed.map((c) => c.after)];
        const matches: EvaluatedNotification[] = [];
        for (const item of candidates) {
          const value = (item as Record<string, unknown>)[rule.field];
          if (compare(rule.operator, value, rule.value)) {
            matches.push({
              type: 'change_detected',
              message: interpolate(
                rule.message ?? `{job_name}: ${rule.field} is ${value} ({operator} ${rule.value})`,
                {
                  ...globals,
                  [rule.field]: value,
                  operator: rule.operator,
                  value: rule.value,
                  url: (item as Record<string, unknown>).url,
                },
              ),
            });
          }
        }
        out.push(...capPerItem(rule, matches));
        break;
      }
      case 'field_change': {
        // field_change can never fire on first run (no `changed` items yet).
        const matches: EvaluatedNotification[] = [];
        for (const ch of diff.changed) {
          const match = ch.field_diffs.find((f) => f.field === rule.field);
          if (!match) continue;
          matches.push({
            type: 'change_detected',
            message: interpolate(rule.message ?? '{job_name}: {field_name} changed from {old} to {new}', {
              ...globals,
              field_name: rule.field,
              old: match.old,
              new: match.new,
              url: (ch.after as Record<string, unknown>).url,
            }),
          });
        }
        out.push(...capPerItem(rule, matches));
        break;
      }
    }
  }
  return out;
}

// ---------- dispatch ----------

export async function dispatch(
  job: JobRow,
  runId: string,
  notifs: EvaluatedNotification[],
): Promise<void> {
  if (notifs.length === 0) return;
  const channels = job.notify_channels as Channel[];
  if (channels.length === 0) return;
  const user = await findUserById(job.user_id);
  if (!user) return;

  for (const n of notifs) {
    for (const channel of channels) {
      let sent = false;
      if (channel === 'email') {
        try {
          await sendEmail({
            to: user.email,
            subject: `[SmartScrape] ${job.name}`,
            text: n.message,
          });
          sent = true;
        } catch (err) {
          console.error('[notif] email failed', err);
        }
      } else if (channel === 'telegram') {
        if (!user.telegram_chat_id) continue; // skip channel if user hasn't linked
        const res = await sendTelegram(user.telegram_chat_id, `${job.name}\n\n${n.message}`);
        if (!res.ok) {
          console.error('[notif] telegram failed', res.error);
          continue;
        }
        sent = true;
      }
      if (sent) {
        await insertNotification({
          userId: job.user_id,
          jobId: job.id,
          runId,
          channel,
          type: n.type,
          message: n.message,
        });
      }
    }
  }
}
