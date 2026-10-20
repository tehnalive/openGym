import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const messages = Object.freeze({
  CONFIG_TOKEN: 'TELEGRAM_BOT_TOKEN must be a valid bot token.',
  CONFIG_URL: 'TELEGRAM_MINI_APP_URL must be an absolute HTTPS URL without credentials.',
  CONFIG_IDS: 'TELEGRAM_ALLOWED_IDS must contain comma-separated positive safe integer IDs.',
  WEBHOOK_ACTIVE: 'A Telegram webhook is configured. Stop this launcher; explicitly remove the webhook before using long polling.',
  UNAUTHORIZED: 'Telegram rejected the bot credentials. Check the server secret.',
  CONFLICT: 'Telegram polling conflict. Check for a configured webhook or another polling process.',
  API_FAILURE: 'Telegram API request failed; no response details are logged.',
  INVALID_RESPONSE: 'Telegram returned an invalid response.',
});

export class BotError extends Error {
  constructor(code, retryable = false, retryAfter = 1) {
    super(messages[code] ?? messages.API_FAILURE);
    this.name = 'BotError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

export function loadConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (typeof token !== 'string' || !/^[1-9][0-9]*:[A-Za-z0-9_-]{20,200}$/.test(token)) {
    throw new BotError('CONFIG_TOKEN');
  }
  let url;
  try { url = new URL(env.TELEGRAM_MINI_APP_URL); } catch { throw new BotError('CONFIG_URL'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new BotError('CONFIG_URL');
  }
  let allowedIds = null;
  // Omission means public access; an explicitly empty value is a configuration error.
  if (env.TELEGRAM_ALLOWED_IDS !== undefined) {
    const parts = env.TELEGRAM_ALLOWED_IDS.split(',').map(part => part.trim());
    if (!parts.length || parts.some(part => !/^[1-9][0-9]*$/.test(part)
      || !Number.isSafeInteger(Number(part)))) throw new BotError('CONFIG_IDS');
    allowedIds = new Set(parts.map(Number));
  }
  return { token, miniAppUrl: url.href, allowedIds };
}

/** Never propagate fetch errors, Telegram descriptions, response bodies, or URLs. */
export async function telegramCall(config, method, body, { fetchImpl = fetch, signal } = {}) {
  let response;
  let data;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(40_000)]),
    });
    data = await response.json();
  } catch {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    throw new BotError('API_FAILURE', true);
  }
  if (response.ok && data?.ok === true) return data.result;
  const status = response.status;
  const code = Number.isInteger(data?.error_code) ? data.error_code : status;
  if (status === 401 || code === 401) throw new BotError('UNAUTHORIZED');
  if (status === 409 || code === 409) throw new BotError('CONFLICT');
  if (status === 429 || code === 429) {
    const seconds = data?.parameters?.retry_after;
    throw new BotError('API_FAILURE', true,
      Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 1);
  }
  if (status >= 500 || code >= 500) throw new BotError('API_FAILURE', true);
  throw new BotError('API_FAILURE');
}

export function launchMessage(update, config) {
  const message = update?.message;
  if (!message || message.chat?.type !== 'private' || message.from?.is_bot
    || !Number.isSafeInteger(message.from?.id) || message.from.id <= 0
    || message.chat.id !== message.from.id
    || typeof message.text !== 'string'
    || !/^\/(?:start|app)(?:\s|$)/.test(message.text)) return null;
  if (config.allowedIds && !config.allowedIds.has(message.from.id)) return null;
  return {
    chat_id: message.chat.id,
    text: 'Привет! Здесь вы ведёте дневник тренировок и следите за прогрессом.\nНажмите «Открыть дневник», чтобы войти через Telegram и записать тренировку.',
    reply_markup: { inline_keyboard: [[{
      text: 'Открыть дневник', web_app: { url: config.miniAppUrl },
    }]] },
  };
}

/** One process per token. Offset is acknowledged only after handling each update. */
export async function runBot(config, { fetchImpl = fetch, signal, logger = console,
  sleep = (ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }),
} = {}) {
  const call = (method, body) => telegramCall(config, method, body, { fetchImpl, signal });
  let offset = 0;
  try {
    const webhook = await call('getWebhookInfo', {});
    if (!webhook || typeof webhook.url !== 'string') throw new BotError('INVALID_RESPONSE');
    if (webhook.url) throw new BotError('WEBHOOK_ACTIVE');
    logger.info('Telegram launcher started; waiting for private /start or /app commands.');
    while (!signal?.aborted) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
        if (!Array.isArray(updates) || updates.some(update =>
          !Number.isSafeInteger(update?.update_id) || update.update_id < 0
          || update.update_id >= Number.MAX_SAFE_INTEGER)) throw new BotError('INVALID_RESPONSE');
        for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
          if (signal?.aborted) break;
          if (update.update_id < offset) continue;
          const message = launchMessage(update, config);
          if (message) await call('sendMessage', message);
          offset = update.update_id + 1;
        }
      } catch (error) {
        if (signal?.aborted) break;
        if (!(error instanceof BotError) || !error.retryable) throw error;
        logger.warn(error.message);
        await sleep(error.retryAfter * 1000, signal);
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
  logger.info('Telegram launcher stopped.');
  return { offset };
}

export async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await runBot(loadConfig(), { signal: controller.signal });
  } catch (error) {
    console.error(error instanceof BotError ? error.message : 'Telegram launcher stopped after an internal error.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
