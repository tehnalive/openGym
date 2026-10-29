import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = '123456789:synthetic_telegram_test_token_not_a_secret';
const ORIGIN = 'https://gym.example.test';

function initData(id) {
  const fields = new Map([
    ['user', JSON.stringify({ id, first_name: 'Аня' })],
    ['query_id', 'q'], ['auth_date', String(Math.floor(Date.now() / 1000))],
  ]);
  const check = [...fields].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  fields.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return new URLSearchParams(fields).toString();
}

async function start(t, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-tgonly-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  let tail = '';
  const childEnv = { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN, RP_ID: 'gym.example.test',
    TELEGRAM_BOT_TOKEN: TOKEN, INVITE_ONLY: '0', PASSWORD_LOGIN: '1', COACH_DISABLED: '1', ADMIN_UIDS: '', ...env };
  delete childEnv.TELEGRAM_ALLOWED_IDS;
  if (env.TELEGRAM_ONLY === undefined) delete childEnv.TELEGRAM_ONLY;
  const child = spawn(process.execPath, ['server.js'], { cwd: API, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', c => { tail = (tail + c).slice(-8000); });
  child.stderr.on('data', c => { tail = (tail + c).slice(-8000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const port = await boundPort(child, () => tail);
  return async (route, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null,
      cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).filter(v => !v.endsWith('=')).join('; ') };
  };
}

const REFUSED = [
  ['POST', '/api/register/options'], ['POST', '/api/register/verify'], ['POST', '/api/register/password'],
  ['POST', '/api/login/options'], ['POST', '/api/login/verify'], ['POST', '/api/login/password'],
  ['POST', '/api/login/password-reset'], ['POST', '/api/device-link/options'], ['POST', '/api/device-link/verify'],
  ['POST', '/api/pair/create'], ['POST', '/api/pair/redeem'], ['POST', '/api/account/passkeys/options'],
  ['POST', '/api/account/passkeys/verify'], ['POST', '/api/account/device-link'],
  ['POST', '/api/account/password'], ['POST', '/api/account/email'],
];

test('TELEGRAM_ONLY refuses every other way to make or enter a profile, and Telegram still works', async t => {
  const call = await start(t, { TELEGRAM_ONLY: '1' });
  for (const [method, route] of REFUSED) {
    const r = await call(route, { method, body: {} });
    assert.equal(r.status, 403, route);
    assert.equal(r.body.code, 'telegram-only', route);
  }
  const login = await call('/api/telegram/login', { method: 'POST', body: { initData: initData(4_600_000_001) } });
  assert.equal(login.status, 200);
  const me = await call('/api/me', { cookie: login.cookie });
  assert.equal(me.status, 200);
  assert.ok((await call('/api/data', { cookie: login.cookie })).status < 400);
  assert.equal((await call('/api/logout', { method: 'POST', cookie: login.cookie })).status, 200);
});

test('without TELEGRAM_ONLY nothing is refused with that code (plain openGym is unchanged)', async t => {
  const call = await start(t, {});
  for (const [method, route] of REFUSED) {
    const r = await call(route, { method, body: {} });
    assert.notEqual(r.body?.code, 'telegram-only', route);
  }
});
