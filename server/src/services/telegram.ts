import { env } from '../config/env.js';

const API_BASE = 'https://api.telegram.org';

export type TelegramSendResult = { ok: boolean; error?: string };

/** Send a plain-text message via the Telegram Bot API. Requires TELEGRAM_BOT_TOKEN. */
export async function sendTelegram(chatId: string, text: string): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN not configured' };
  try {
    const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) return { ok: false, error: json.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Returns the bot's link for user-onboarding. Works even when the bot token is not set locally. */
export async function getBotSetupInfo(): Promise<{ botUsername: string | null; link: string | null }> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  if (!token) return { botUsername: null, link: null };
  try {
    const res = await fetch(`${API_BASE}/bot${token}/getMe`);
    const json = (await res.json()) as { ok: boolean; result?: { username?: string } };
    if (!json.ok || !json.result?.username) return { botUsername: null, link: null };
    return {
      botUsername: json.result.username,
      link: `https://t.me/${json.result.username}`,
    };
  } catch {
    return { botUsername: null, link: null };
  }
}

// Type guard so unused env import in prod bundles doesn't tree-shake oddly.
export const _touch_env = env;
