import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildTestPayload, deliver, signPayload, type WebhookPayload } from './webhooks.js';

// SSRF guard is real DNS / IP gating; we always point tests at example.com,
// which resolves to a public IP. That keeps the safety guard exercised without
// mocking it.

vi.mock('../config/encryption.js', () => ({
  // Tests don't go through the real encryption — return the input plaintext.
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

function fakePayload(): WebhookPayload {
  return {
    event: 'run.completed',
    job_id: 'job-1',
    job_name: 'unit-test',
    run_id: 'run-1',
    status: 'completed',
    items_count: 2,
    urls_scraped: 1,
    tokens_used: 100,
    error_message: null,
    started_at: '2026-05-10T20:00:00.000Z',
    completed_at: '2026-05-10T20:00:05.000Z',
    changes: { added: 1, removed: 0, changed: 1 },
    items: [{ name: 'Widget', price: 9.99 }],
  };
}

describe('signPayload', () => {
  it('produces the expected SHA-256 HMAC envelope', () => {
    const sig = signPayload('topsecret', 'hello world');
    const expected =
      'sha256=' + createHmac('sha256', 'topsecret').update('hello world').digest('hex');
    expect(sig).toBe(expected);
  });
});

describe('deliver', () => {
  it('POSTs the payload, succeeds on 2xx in one attempt', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await deliver({
      url: 'https://example.com/hook',
      secretEncrypted: 'topsecret',
      payload: fakePayload(),
      fetchImpl,
      sleepMs: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    const { init } = calls[0]!;
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-webhook-signature']).toMatch(/^sha256=[0-9a-f]+$/);
    expect(headers['x-webhook-timestamp']).toBeTruthy();
    // The signature must verify against the exact body we sent.
    const sentBody = init.body as string;
    expect(headers['x-webhook-signature']).toBe(signPayload('topsecret', sentBody));
  });

  it('omits the signature header when no secret is configured', async () => {
    let seen: Record<string, string> = {};
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      // 200 (not 204) — node's Response constructor rejects a body on 204.
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const result = await deliver({
      url: 'https://example.com/hook',
      secretEncrypted: null,
      payload: fakePayload(),
      fetchImpl,
      sleepMs: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(seen['x-webhook-signature']).toBeUndefined();
    expect(seen['x-webhook-timestamp']).toBeUndefined();
  });

  it('retries up to 3 times on 5xx and reports the final failure', async () => {
    const responses = [500, 502, 503];
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      const status = responses[i++];
      return new Response('boom', { status: status ?? 503 });
    }) as unknown as typeof fetch;

    const result = await deliver({
      url: 'https://example.com/hook',
      secretEncrypted: null,
      payload: fakePayload(),
      fetchImpl,
      sleepMs: noSleep,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.status).toBe(503);
    expect(result.error).toMatch(/HTTP 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries network errors then succeeds before hitting the cap', async () => {
    let i = 0;
    const fetchImpl = vi.fn(async () => {
      i += 1;
      if (i < 2) throw new Error('ECONNRESET');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const result = await deliver({
      url: 'https://example.com/hook',
      secretEncrypted: null,
      payload: fakePayload(),
      fetchImpl,
      sleepMs: noSleep,
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('rejects unsafe URLs without attempting any HTTP', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await deliver({
      url: 'http://127.0.0.1/hook',
      secretEncrypted: null,
      payload: fakePayload(),
      fetchImpl,
      sleepMs: noSleep,
    });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(result.error).toMatch(/Unsafe webhook URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('buildTestPayload', () => {
  it('returns a webhook.test event with the job identity zeroed elsewhere', () => {
    const job = {
      id: 'job-9',
      name: 'My Job',
    } as unknown as Parameters<typeof buildTestPayload>[0];
    const p = buildTestPayload(job);
    expect(p.event).toBe('webhook.test');
    expect(p.job_id).toBe('job-9');
    expect(p.job_name).toBe('My Job');
    expect(p.items_count).toBe(0);
    expect(p.items).toEqual([]);
    expect(p.run_id).toBe('00000000-0000-0000-0000-000000000000');
  });
});
