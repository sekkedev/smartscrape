import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { Provider } from '../db/apiKeys.js';

export type TestResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
};

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Make the cheapest possible authenticated call to verify the API key.
 * For all three providers that's a models-list call \u2014 no tokens consumed,
 * but requires a valid key. Network/auth errors are caught and surfaced
 * as a user-friendly message rather than crashing the request.
 */
export async function testCredentials(provider: Provider, apiKey: string): Promise<TestResult> {
  const started = Date.now();
  try {
    if (provider === 'openai') {
      const client = new OpenAI({ apiKey });
      await client.models.list();
    } else if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey });
      await client.models.list({ limit: 1 });
    } else {
      // OpenRouter implements the OpenAI spec.
      const client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
      await client.models.list();
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: friendlyError(err),
    };
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof OpenAI.APIError || err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) return 'Invalid API key';
    if (err.status === 429) return 'Rate limited by provider';
    return `${err.status ?? 'error'}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
