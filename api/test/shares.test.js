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
const ALICE = 4_500_000_001;
const BOB = 4_500_000_002;

function initData(id = ALICE, { name = 'Аня', authDate = Math.floor(Date.now() / 1000), token = TOKEN, photoUrl, username = 'same-name-does-not-link' } = {}) {
  const fields = new Map([
    ['user', JSON.stringify({ id, first_name: name, username, ...(photoUrl === undefined ? {} : { photo_url: photoUrl }) })],
    ['query_id', 'test-query'], ['auth_date', String(authDate)],
  ]);
  const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  fields.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return new URLSearchParams(fields).toString();
}

async function start(t, { env = {}, users = [], creds = [], dir: existing } = {}) {
  const dir = existing || fs.mkdtempSync(path.join(os.tmpdir(), 'gym-telegram-'));
  if (!existing) fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users, creds, subs: [], invites: [] }));
  let tail = '';
  const childEnv = { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN, RP_ID: 'gym.example.test',
    TELEGRAM_BOT_TOKEN: TOKEN, INVITE_ONLY: '0', FIRST_USER_ADMIN: '0',
    PASSWORD_LOGIN: '0', COACH_DISABLED: '1', AUDIT_LOG: '1', ADMIN_UIDS: '' };
  delete childEnv.TELEGRAM_ALLOWED_IDS;
  Object.assign(childEnv, env);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdout.on('data', chunk => { tail = (tail + chunk).slice(-16000); });
  child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-16000); });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  };
  t.after(async () => { await stop(); if (!existing) fs.rmSync(dir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => tail);
  async function call(route, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null,
      cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => !value.endsWith('=')).join('; '),
      setCookie: response.headers.getSetCookie() };
  }
  const login = (id, options = {}, extra = {}) => call('/api/telegram/login', {
    method: 'POST', body: { initData: initData(id, options), ...extra },
  });
  return { dir, call, login, stop, logs: () => tail, db: () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')) };
}


const BUNDLE = (over = {}) => ({ opengym_plan: 1, exported: '2026-10-30', name: 'Push/Pull', unit: 'kg', week: { 1: ['r1'] },
  routines: [{ id: 'r1', name: 'Push', emoji: '💪', ex: [{ id: 'bench-press', sets: 3, reps: 8 }, { id: 'c1', sets: 2, reps: 10 }] }],
  customEx: [{ id: 'c1', n: 'My row', bp: 'back' }], ...over });

async function two(t, env) {
  const app = await start(t, { env });
  const alice = await app.login(ALICE, { name: 'Аня' });
  const bob = await app.login(BOB, { name: 'Боб' });
  return { app, alice: alice.cookie, bob: bob.cookie };
}

test('a shared plan is created, read by a friend, counted and revoked by its author only', async t => {
  const { app, alice, bob } = await two(t, { TELEGRAM_BOT_USERNAME: 'Test_bot', TELEGRAM_MINI_APP_SHORT_NAME: 'gym' });
  const made = await app.call('/api/shares', { method: 'POST', cookie: alice, body: { bundle: BUNDLE() } });
  assert.equal(made.status, 200);
  assert.match(made.body.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(made.body.link, `https://t.me/Test_bot/gym?startapp=p_${made.body.id}`);
  assert.ok(Date.parse(made.body.expires) > Date.now() + 29 * 86400000);
  assert.ok(('p_' + made.body.id).length <= 512);

  const seen = await app.call(`/api/shares/${made.body.id}`, { cookie: bob });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.author, 'Аня');
  assert.equal(seen.body.mine, false);
  assert.equal(seen.body.opens, undefined, 'the counter is for the author');
  assert.equal(seen.body.bundle.routines[0].ex.length, 2);
  assert.ok(!JSON.stringify(seen.body).includes(String(ALICE)), 'no Telegram id in the answer');

  const own = await app.call(`/api/shares/${made.body.id}`, { cookie: alice });
  assert.equal(own.body.mine, true);
  assert.equal(own.body.opens, 1, 'the author opening it does not count');

  assert.equal((await app.call(`/api/shares/${made.body.id}`, { method: 'DELETE', cookie: bob })).status, 403);
  assert.equal((await app.call(`/api/shares/${made.body.id}`, { cookie: bob })).status, 200, 'a refused revoke removes nothing');
  assert.equal((await app.call(`/api/shares/${made.body.id}`, { method: 'DELETE', cookie: alice })).status, 200);
  const gone = await app.call(`/api/shares/${made.body.id}`, { cookie: bob });
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, 'share-gone');
  assert.equal((await app.call(`/api/shares/${made.body.id}`, { method: 'DELETE', cookie: alice })).status, 404);
  assert.deepEqual(app.db().shares, []);
});

test('an empty short name gives the main Mini App link, and a bad one falls back', async t => {
  const main = await two(t, { TELEGRAM_BOT_USERNAME: 'Test_bot', TELEGRAM_MINI_APP_SHORT_NAME: '' });
  const a = await main.app.call('/api/shares', { method: 'POST', cookie: main.alice, body: { bundle: BUNDLE() } });
  assert.equal(a.body.link, `https://t.me/Test_bot?startapp=p_${a.body.id}`);
  const bad = await two(t, { TELEGRAM_BOT_USERNAME: 'x/../y', TELEGRAM_MINI_APP_SHORT_NAME: 'a b' });
  const b = await bad.app.call('/api/shares', { method: 'POST', cookie: bad.alice, body: { bundle: BUNDLE() } });
  assert.equal(b.body.link, `https://t.me/Gym_statsbot/app?startapp=p_${b.body.id}`);
});

test('sharing needs a session', async t => {
  const { app } = await two(t);
  assert.equal((await app.call('/api/shares', { method: 'POST', body: { bundle: BUNDLE() } })).status, 401);
  assert.equal((await app.call('/api/shares/abcdefghijkl')).status, 401);
  assert.equal((await app.call('/api/shares/abcdefghijkl', { method: 'DELETE' })).status, 401);
});

test('garbage, empty and oversized plans are refused and nothing is stored', async t => {
  const { app, alice } = await two(t, { SHARE_MAX_PER_USER: '200' });
  const post = bundle => app.call('/api/shares', { method: 'POST', cookie: alice, body: { bundle } });
  const exs = n => Array.from({ length: n }, () => ({ id: 'bench-press', sets: 1 }));
  const bad = [undefined, null, 'x', 7, [], {}, { opengym_plan: 2, routines: [] }, BUNDLE({ routines: [] }),
    BUNDLE({ routines: [{ id: 'r', name: 'Empty', ex: [] }] }), BUNDLE({ routines: ['x'] }),
    BUNDLE({ routines: [{ id: 'r', ex: [null] }] }), BUNDLE({ routines: [{ id: 'r', ex: [{ id: 5 }] }] }),
    BUNDLE({ customEx: 'x' }), BUNDLE({ week: [] }),
    BUNDLE({ routines: Array.from({ length: 51 }, (_, i) => ({ id: 'r' + i, name: 'R', ex: exs(1) })) }),
    BUNDLE({ routines: [{ id: 'r', name: 'Big', ex: exs(601) }] }),
    BUNDLE({ name: 'x'.repeat(250 * 1024) })];
  // A refused request spends the hourly budget too, so the list is split over two servers.
  for (const item of bad.slice(0, 10)) {
    const r = await post(item);
    assert.equal(r.status, 400, JSON.stringify(item)?.slice(0, 60));
    assert.equal(r.body.code, 'share-invalid');
  }
  const { app: app2, alice: alice2 } = await two(t);
  for (const item of bad.slice(10)) {
    const r = await app2.call('/api/shares', { method: 'POST', cookie: alice2, body: { bundle: item } });
    assert.equal(r.status, 400, JSON.stringify(item)?.slice(0, 60));
    assert.equal(r.body.code, 'share-invalid');
  }
  assert.equal((await app2.call('/api/shares', { method: 'POST', cookie: alice2, body: 'nope' })).status, 400);
  assert.equal((await app2.call('/api/shares/' + 'x'.repeat(60), { cookie: alice2 })).status, 404);
  assert.equal((await app2.call('/api/shares/a%2Fb', { cookie: alice2 })).status, 404);
  assert.deepEqual(app.db().shares, []);
  assert.deepEqual(app2.db().shares, []);
});

test('unknown bundle fields are not stored', async t => {
  const { app, alice, bob } = await two(t);
  const made = await app.call('/api/shares', { method: 'POST', cookie: alice, body: { bundle: BUNDLE({ secret: 'x' }) } });
  const seen = await app.call(`/api/shares/${made.body.id}`, { cookie: bob });
  assert.equal(seen.body.bundle.secret, undefined);
  assert.equal(seen.body.bundle.name, 'Push/Pull');
});

test('a profile holds a limited number of links', async t => {
  const { app, alice, bob } = await two(t, { SHARE_MAX_PER_USER: '2' });
  const make = cookie => app.call('/api/shares', { method: 'POST', cookie, body: { bundle: BUNDLE() } });
  const first = await make(alice);
  assert.equal((await make(alice)).status, 200);
  const third = await make(alice);
  assert.equal(third.status, 409);
  assert.equal(third.body.code, 'share-limit');
  assert.equal((await make(bob)).status, 200, 'the limit is per profile');
  await app.call(`/api/shares/${first.body.id}`, { method: 'DELETE', cookie: alice });
  assert.equal((await make(alice)).status, 200, 'revoking frees a place');
});

test('creation is rate limited per profile', async t => {
  const { app, alice, bob } = await two(t, { SHARE_MAX_PER_USER: '200' });
  const make = cookie => app.call('/api/shares', { method: 'POST', cookie, body: { bundle: BUNDLE() } });
  for (let i = 0; i < 10; i++) assert.equal((await make(alice)).status, 200);
  assert.equal((await make(alice)).status, 429);
  assert.equal((await make(bob)).status, 200);
});

test('an expired link is gone, and is dropped from db.json on the next creation', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-shares-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [], shares: [
    { id: 'expiredlink1', userId: 'nobody', author: 'Старый', created: '2020-01-01T00:00:00.000Z', expires: '2020-01-31T00:00:00.000Z', opens: 0, bundle: BUNDLE() }] }));
  const app = await start(t, { dir });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const alice = await app.login(ALICE);
  assert.equal((await app.call('/api/shares/expiredlink1', { cookie: alice.cookie })).status, 404);
  assert.equal((await app.call('/api/shares', { method: 'POST', cookie: alice.cookie, body: { bundle: BUNDLE() } })).status, 200);
  assert.equal(app.db().shares.length, 1);
  assert.equal(app.db().shares.some(x => x.id === 'expiredlink1'), false);
});

test('a name made unique with the Telegram id shows without it', async t => {
  const app = await start(t);
  const first = await app.login(ALICE, { name: 'Аня' });
  const second = await app.login(BOB, { name: 'Аня' });
  assert.match(second.body.user.name, /·/);
  const made = await app.call('/api/shares', { method: 'POST', cookie: second.cookie, body: { bundle: BUNDLE() } });
  const seen = await app.call(`/api/shares/${made.body.id}`, { cookie: first.cookie });
  assert.equal(seen.body.author, 'Аня');
});
