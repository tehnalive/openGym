import test from 'node:test';
import assert from 'node:assert/strict';
import { BotError, loadConfig, launchMessage, runBot, telegramCall } from './telegram-bot.mjs';

const token = '123456:abcdefghijklmnopqrstuvwxyz_123456';
const env = { TELEGRAM_BOT_TOKEN: token, TELEGRAM_MINI_APP_URL: 'https://gym.example/app' };
const config = loadConfig(env);
const update = (id, text = '/start', user = 17, type = 'private') => ({ update_id: id,
  message: { text, from: { id: user }, chat: { id: user, type } } });
const ok = result => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });
const quiet = { info() {}, warn() {} };

test('configuration requires token, HTTPS and a nonempty positive allowlist when supplied', () => {
  assert.equal(config.miniAppUrl, 'https://gym.example/app');
  assert.equal(config.allowedIds, null);
  assert.deepEqual([...loadConfig({ ...env, TELEGRAM_ALLOWED_IDS: '17, 19,17' }).allowedIds], [17, 19]);
  for (const value of ['', '17,', '0', '-1', '1.5', 'NaN', '9007199254740992']) {
    assert.throws(() => loadConfig({ ...env, TELEGRAM_ALLOWED_IDS: value }), { code: 'CONFIG_IDS' });
  }
  for (const value of ['', 'http://localhost:3000', 'javascript:alert(1)', 'https://user:pass@gym.example']) {
    assert.throws(() => loadConfig({ ...env, TELEGRAM_MINI_APP_URL: value }), { code: 'CONFIG_URL' });
  }
  assert.throws(() => loadConfig({ ...env, TELEGRAM_BOT_TOKEN: '' }), { code: 'CONFIG_TOKEN' });
});

test('only allowed private commands generate a Web App launch button', () => {
  const restricted = loadConfig({ ...env, TELEGRAM_ALLOWED_IDS: '17' });
  for (const text of ['/start', '/start invite', '/app', '/app\n']) {
    const body = launchMessage(update(1, text), restricted);
    assert.equal(body.chat_id, 17);
    assert.equal(body.reply_markup.inline_keyboard[0][0].web_app.url, config.miniAppUrl);
  }
  for (const candidate of [update(1, '/app', 18), update(1, '/start', 17, 'group'),
    update(1, '/start', 17, 'supergroup'), update(1, '/start', 17, 'channel'),
    update(1, 'hello'), update(1, '/startSomething'), update(1, '/app@otherbot'),
    { update_id: 1, edited_message: update(1).message },
    { ...update(1), message: { ...update(1).message, from: { id: 17, is_bot: true } } }]) {
    assert.equal(launchMessage(candidate, restricted), null);
  }
});

test('active webhook stops without deletion, polling, or sending', async () => {
  const calls = [];
  await assert.rejects(runBot(config, { logger: quiet, fetchImpl: async (url) => {
    calls.push(url.split('/').at(-1));
    return ok({ url: 'https://secret.example/private' });
  } }), { code: 'WEBHOOK_ACTIVE' });
  assert.deepEqual(calls, ['getWebhookInfo']);
});

test('offset advances for handled and ignored updates, deduplicates batch, aborts cleanly', async () => {
  const controller = new AbortController();
  const calls = [];
  let polls = 0;
  const result = await runBot(config, { logger: quiet, signal: controller.signal,
    fetchImpl: async (url, options) => {
      const method = url.split('/').at(-1);
      const body = JSON.parse(options.body);
      calls.push({ method, body });
      if (method === 'getWebhookInfo') return ok({ url: '' });
      if (method === 'sendMessage') return ok({ message_id: 123 });
      if (polls++ === 0) return ok([update(12, 'ignored'), update(10), update(10), update(11, '/app', 17, 'group')]);
      assert.equal(body.offset, 13);
      assert.equal(body.timeout, 30);
      assert.deepEqual(body.allowed_updates, ['message']);
      controller.abort();
      throw new Error(`aborted ${token}`);
    } });
  assert.equal(result.offset, 13);
  assert.equal(calls.filter(call => call.method === 'sendMessage').length, 1);
});

test('transient send failure retries the unacknowledged update, preserving earlier progress', async () => {
  const controller = new AbortController();
  const offsets = [];
  const waits = [];
  let sends = 0;
  let polls = 0;
  const result = await runBot(config, { logger: quiet, signal: controller.signal,
    sleep: async ms => { waits.push(ms); }, fetchImpl: async (url, options) => {
      const method = url.split('/').at(-1);
      if (method === 'getWebhookInfo') return ok({ url: '' });
      if (method === 'sendMessage') {
        if (sends++ === 0) throw new Error(`network ${token}`);
        return ok({ message_id: 1 });
      }
      offsets.push(JSON.parse(options.body).offset);
      if (polls++ === 0) return ok([update(5, 'ignore'), update(6)]);
      if (polls === 2) return ok([update(6)]);
      controller.abort();
      throw new Error('aborted');
    } });
  assert.deepEqual(offsets, [0, 6, 7]);
  assert.deepEqual(waits, [1000]);
  assert.equal(result.offset, 7);
});

test('API failures hide raw token, URL and Telegram description', async () => {
  for (const fetchImpl of [async () => { throw new Error(`https://api.telegram.org/bot${token}/sendMessage`); },
    async () => ({ ok: false, status: 401, json: async () => ({ ok: false, description: token }) }),
    async () => ({ ok: false, status: 409, json: async () => ({ ok: false, description: token }) }),
    async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: token }) }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error(token); } })]) {
    await assert.rejects(telegramCall(config, 'sendMessage', {}, { fetchImpl }), error => {
      assert.ok(error instanceof BotError);
      assert.ok(!error.stack.includes(token));
      assert.ok(!error.stack.includes('https://api.telegram.org'));
      return true;
    });
  }
});

test('429 honors retry_after; malformed updates stop safely', async () => {
  await assert.rejects(telegramCall(config, 'getUpdates', {}, { fetchImpl: async () => ({
    ok: false, status: 429, json: async () => ({ parameters: { retry_after: 9 } }),
  }) }), error => error.retryable && error.retryAfter === 9);
  await assert.rejects(runBot(config, { logger: quiet, fetchImpl: async url =>
    ok(url.endsWith('getWebhookInfo') ? { url: '' } : [{ update_id: 'bad' }]) }), { code: 'INVALID_RESPONSE' });
});

test('abort interrupts an in-flight long poll without error or extra sends', async () => {
  const controller = new AbortController();
  const methods = [];
  await runBot(config, { logger: quiet, signal: controller.signal, fetchImpl: async (url, options) => {
    const method = url.split('/').at(-1);
    methods.push(method);
    if (method === 'getWebhookInfo') return ok({ url: '' });
    const pending = new Promise((resolve, reject) => options.signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    controller.abort();
    return pending;
  } });
  assert.deepEqual(methods, ['getWebhookInfo', 'getUpdates']);
});

test('full loop silently skips unauthorized users and acknowledges their updates', async () => {
  const restricted = loadConfig({ ...env, TELEGRAM_ALLOWED_IDS: '17' });
  const controller = new AbortController();
  let polls = 0;
  const result = await runBot(restricted, { logger: quiet, signal: controller.signal,
    fetchImpl: async (url, options) => {
      if (url.endsWith('getWebhookInfo')) return ok({ url: '' });
      assert.ok(url.endsWith('getUpdates'), 'unauthorized user must receive no message');
      if (polls++ === 0) return ok([update(30, '/start', 18)]);
      assert.equal(JSON.parse(options.body).offset, 31);
      controller.abort();
      throw new Error('aborted');
    } });
  assert.equal(result.offset, 31);
});

test('polling auth/conflict errors stop and are never retried', async () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [409, 'CONFLICT']]) {
    const methods = [];
    await assert.rejects(runBot(config, { logger: quiet,
      sleep: async () => assert.fail('fatal failures must not retry'),
      fetchImpl: async url => {
        methods.push(url.split('/').at(-1));
        if (url.endsWith('getWebhookInfo')) return ok({ url: '' });
        return { ok: false, status, json: async () => ({ ok: false, error_code: status }) };
      } }), { code });
    assert.deepEqual(methods, ['getWebhookInfo', 'getUpdates']);
  }
});

test('abort during retry delay stops without another API call', async () => {
  const controller = new AbortController();
  const methods = [];
  const result = await runBot(config, { logger: quiet, signal: controller.signal,
    sleep: async () => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }, fetchImpl: async url => {
      methods.push(url.split('/').at(-1));
      if (url.endsWith('getWebhookInfo')) return ok({ url: '' });
      throw new Error('network');
    } });
  assert.equal(result.offset, 0);
  assert.deepEqual(methods, ['getWebhookInfo', 'getUpdates']);
});
