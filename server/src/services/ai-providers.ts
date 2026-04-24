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
 * For all three providers that's a models-list call — no tokens consumed,
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

export function friendlyError(err: unknown): string {
  if (err instanceof OpenAI.APIError || err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) return 'Invalid API key';
    if (err.status === 429) return 'Rate limited by provider';
    return `${err.status ?? 'error'}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatUsage = { promptTokens: number; completionTokens: number };
export type ChatResult = { text: string; usage: ChatUsage };

export type ChatArgs = {
  provider: Provider;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** Force JSON-object output where supported. */
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
};

/** Provider-agnostic single-shot chat call. Returns assistant text + token usage. */
export async function chat(args: ChatArgs): Promise<ChatResult> {
  if (args.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: args.apiKey });
    const system = args.messages.find((m) => m.role === 'system')?.content;
    const nonSystem = args.messages.filter((m) => m.role !== 'system') as {
      role: 'user' | 'assistant';
      content: string;
    }[];
    const res = await client.messages.create({
      model: args.model,
      max_tokens: args.maxTokens ?? 4096,
      temperature: args.temperature ?? 0,
      system,
      messages: nonSystem,
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      usage: {
        promptTokens: res.usage.input_tokens,
        completionTokens: res.usage.output_tokens,
      },
    };
  }

  const baseURL = args.provider === 'openrouter' ? OPENROUTER_BASE_URL : undefined;
  const client = new OpenAI({ apiKey: args.apiKey, baseURL });
  const res = await client.chat.completions.create({
    model: args.model,
    temperature: args.temperature ?? 0,
    max_tokens: args.maxTokens ?? 4096,
    response_format: args.jsonMode ? { type: 'json_object' } : undefined,
    messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const choice = res.choices[0];
  const text = choice?.message?.content ?? '';
  return {
    text,
    usage: {
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    },
  };
}
