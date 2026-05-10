/**
 * Classify a run failure into one of the seven buckets surfaced on the run
 * row + webhook payload. The runner concentrates errors into string messages
 * at every failure site, so a regex-based classifier is the least invasive
 * way to retrofit typed failures — turning a `throw new Error("Page exceeded
 * 5242880 bytes")` into `'parse_error'` without rewriting the call sites.
 *
 * Order matters: more specific patterns first. `quota_error` and `ai_error`
 * are checked before generic network/timeout patterns because some upstream
 * SDKs throw "request failed" on rate-limit and we don't want to demote a
 * known-quota failure to `network_error`.
 */

export const ERROR_TYPES = [
  'timeout',
  'blocked',
  'parse_error',
  'ai_error',
  'network_error',
  'quota_error',
  'unknown',
] as const;

export type ErrorType = (typeof ERROR_TYPES)[number];

type Rule = { type: ErrorType; pattern: RegExp };

// Each rule tests against the lowercased message. Keep the patterns short
// and explicit — a one-line comment justifies any non-obvious string.
const RULES: Rule[] = [
  // Daily quota: emitted by the runner directly, plus 429 from any HTTP path.
  { type: 'quota_error', pattern: /daily run quota|quota_exceeded|too many requests|\b429\b/ },

  // AI provider misconfig + SDK-level failures. "no <provider> api key configured"
  // is the runner's own pre-flight message.
  {
    type: 'ai_error',
    pattern:
      /no \w+ api key configured|provider key|stored provider key|extraction failed|model returned|openai|anthropic|openrouter|insufficient_quota|context_length/,
  },

  // Anti-bot signals from the scraper / playwright path.
  {
    type: 'blocked',
    pattern: /\b403\b|forbidden|captcha|cloudflare|access denied|blocked by|robots\.txt|disallow/,
  },

  // Validation / structure errors from the AI extractor or page parser.
  {
    type: 'parse_error',
    pattern:
      /invalid json|fence|schema|exceeded \d+ bytes|too large|html parse|cheerio|empty response body/,
  },

  // Timeouts: native fetch, Playwright nav timeout, AbortController.
  {
    type: 'timeout',
    pattern: /\btimeout\b|timed? out|etimedout|aborted|deadline|navigation timeout/,
  },

  // Network: DNS, connection, transport.
  {
    type: 'network_error',
    pattern:
      /econnrefused|enotfound|econnreset|epipe|fetch failed|getaddrinfo|socket hang up|err_http2|tls|certificate/,
  },
];

export function classifyError(message: string | null | undefined): ErrorType {
  if (!message) return 'unknown';
  const lower = message.toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(lower)) return rule.type;
  }
  return 'unknown';
}
