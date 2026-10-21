// Isolated local Bot API + real API/Vite/Chromium check. No .env, real token or external polling.
// Pass a Playwright package path if it is provided by the desktop runtime rather than this repo.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { boundPort } from '../api/test/helpers.mjs';
import { loadConfig, runBot } from '../integration/telegram-bot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(path.join(root, '.cache'), { recursive: true });
const data = mkdtempSync(path.join(root, '.cache', 'telegram-check-'));
const token = '123456789:synthetic_telegram_test_token_not_a_secret';
const adminId = 'local-telegram-admin';
const alice = 4500000001, bob = 4500000002;
const photo = 'https://t.me/i/userpic/320/local-check.svg';
writeFileSync(path.join(data, 'db.json'), JSON.stringify({ users: [
  { id: adminId, name: 'Локальный администратор', telegramId: String(alice), admin: true },
], creds: [], subs: [], invites: [] }));
const signed = (id, photoUrl) => {
  const q = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: id === alice ? 'Локальный администратор' : 'Подопечный',
      username: 'texno_liv', language_code: 'ru', ...(photoUrl ? { photo_url: photoUrl } : {}) }) });
  const check = [...q].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  q.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return q.toString();
};

let api, vite, browser, botApi;
const passed = [], errors = [], sent = [], external = [];
try {
  // Exercise the launcher against an actual local HTTP Bot API, with a synthetic credential.
  const stopBot = new AbortController();
  botApi = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    let result;
    if (req.url === '/getWebhookInfo') result = { url: '' };
    else if (req.url === '/getUpdates') result = [{ update_id: 1, message: {
      from: { id: alice }, chat: { id: alice, type: 'private' }, text: '/start',
    } }];
    else if (req.url === '/sendMessage') { sent.push(body); result = { message_id: 1 }; }
    else { res.writeHead(404); res.end('{}'); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result }));
  });
  botApi.listen(0, '127.0.0.1'); await once(botApi, 'listening');
  const botPort = botApi.address().port;
  await runBot(loadConfig({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_MINI_APP_URL: 'https://local.example.test/' }), {
    signal: stopBot.signal, logger: { info() {}, warn() {} },
    fetchImpl: async (url, options) => {
      const method = url.split('/').at(-1);
      const response = await fetch(`http://127.0.0.1:${botPort}/${method}`, { ...options, signal: undefined });
      if (method === 'sendMessage') stopBot.abort();
      return response;
    },
  });
  assert.equal(sent.length, 1); assert.match(sent[0].text, /Жимолость/);
  assert.doesNotMatch(sent[0].text, /openGym|Safari|Android|APK/i);
  assert.equal(sent[0].reply_markup.inline_keyboard[0][0].web_app.url, 'https://local.example.test/');
  passed.push('local bot /start, branded message and Mini App button');

  const env = { ...process.env, PORT: '0', DATA_DIR: data, ORIGIN: 'http://localhost:8080',
    RP_ID: 'localhost', TELEGRAM_BOT_TOKEN: token, FIRST_USER_ADMIN: '0', ADMIN_UIDS: '',
    INVITE_ONLY: '0', ALLOW_GUEST: '0', COACH_DISABLED: '1', MEDIA_UPLOADS: '0',
    PASSWORD_LOGIN: '0', DEFAULT_LANG: 'ru', TRUST_PROXY: '0' };
  delete env.TELEGRAM_ALLOWED_IDS;
  api = spawn(process.execPath, ['server.js'], { cwd: path.join(root, 'api'), env,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let tail = ''; api.stdout.on('data', b => { tail = (tail + b).slice(-4000); });
  api.stderr.on('data', b => { tail = (tail + b).slice(-4000); });
  const apiPort = await boundPort(api, () => tail);
  process.env.API_TARGET = `http://127.0.0.1:${apiPort}`;
  process.env.API_ORIGIN = 'http://localhost:8080';
  const { createServer: createVite } = await import('../frontend/node_modules/vite/dist/node/index.js');
  vite = await createVite({ root: path.join(root, 'frontend'), logLevel: 'error',
    server: { port: 0, host: '127.0.0.1' } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.argv[2] || 'playwright');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });

  async function pageFor(id, photoUrl) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
    await context.route('https://t.me/**', route => route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#8558e8"/><text x="40" y="55" text-anchor="middle" font-size="45" fill="white">T</text></svg>' }));
    await context.route('https://evil.example/**', route => { external.push(route.request().url()); return route.abort(); });
    await context.addInitScript(({ raw }) => {
      window.Telegram = { WebApp: { initData: raw, initDataUnsafe: { user: { id: 99, photo_url: 'https://evil.example/not-trusted.jpg' } },
        ready() {}, expand() {}, onEvent() {}, offEvent() {}, contentSafeAreaInset: { top: 0, bottom: 0 } } };
    }, { raw: signed(id, photoUrl) });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.waitForSelector('.telegram-entry', { state: 'hidden' });
    const skip = page.getByRole('button', { name: /Пропустить настройку|Skip setup/ });
    if (await skip.isVisible()) await skip.click();
    return { page, context };
  }
  const a = await pageFor(alice, photo);
  await a.page.goto(origin + '/#/settings');
  const img = a.page.locator('.sp-avatar img'); await img.waitFor();
  assert.equal(await img.getAttribute('src'), photo);
  await a.page.waitForFunction(() => document.querySelector('.sp-avatar img')?.naturalWidth > 0);
  assert.equal(await a.page.title(), 'Жимолость');
  await a.page.screenshot({ path: path.join(data, 'avatar-settings.png'), fullPage: true, animations: 'disabled' });
  passed.push('signed Telegram avatar rendered; unsafe SDK identity ignored');
  await a.page.goto(origin + '/#/settings/about');
  const about = await a.page.locator('body').innerText();
  assert.match(about, /Жимолость/); assert.match(about, /Сервис создан на основе openGym/);
  assert.match(about, /Media licensed for use in openGym only/);
  assert.doesNotMatch(about, /Safari|Android|APK|Home Screen|Chrome:|скачать приложение/i);
  await a.page.screenshot({ path: path.join(data, 'about.png'), fullPage: true, animations: 'disabled' });
  passed.push('About has attribution and no APK/PWA prompts');
  await a.page.goto(origin + '/#/settings/account');
  assert.match(await a.page.locator('body').innerText(), /Панель администратора|Admin dashboard/);
  assert.equal((await a.page.request.get(origin + '/api/admin/users')).status(), 200);
  await a.page.goto(origin + '/#/admin');
  await a.page.getByText('Локальный администратор', { exact: true }).first().waitFor();
  passed.push('admin menu and server guard work for assigned role');
  const b = await pageFor(bob);
  await b.page.goto(origin + '/#/settings');
  await b.page.locator('.sp-avatar').waitFor();
  assert.equal(await b.page.locator('.sp-avatar img').count(), 0);
  await b.page.goto(origin + '/#/settings/account');
  assert.doesNotMatch(await b.page.locator('body').innerText(), /Панель администратора|Admin dashboard/);
  assert.equal((await b.page.request.get(origin + '/api/admin/users')).status(), 403);
  passed.push('same Telegram username grants no role; other profile has no inherited avatar');
  await a.page.goto(origin + '/#/settings'); await a.page.reload();
  await a.page.locator('.sp-avatar img').waitFor();
  passed.push('avatar restored after reload');
  assert.deepEqual(external, []); assert.deepEqual(errors, []);
  const result = { passed, pageErrors: errors.length, screenshots: data, liveTelegram: false };
  writeFileSync(path.join(data, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close(); await vite?.close();
  if (api && api.exitCode === null) { const ended = once(api, 'exit'); api.kill(); await ended; }
  if (botApi?.listening) await new Promise(resolve => botApi.close(resolve));
}
