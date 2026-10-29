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

function initData(id = ALICE, { name = 'Аня', authDate = Math.floor(Date.now() / 1000), token = TOKEN, photoUrl, username = 'same-name-does-not-link', lang } = {}) {
  const fields = new Map([
    ['user', JSON.stringify({ id, first_name: name, username, ...(lang === undefined ? {} : { language_code: lang }), ...(photoUrl === undefined ? {} : { photo_url: photoUrl }) })],
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

test('signed Telegram photo follows its owner, refreshes and disappears when no longer shared', async t => {
  const app = await start(t);
  const photoUrl = 'https://t.me/i/userpic/320/signed-photo.svg';
  const alice = await app.login(ALICE, { photoUrl, username: 'texno_liv' });
  assert.equal(alice.body.user.avatarUrl, photoUrl);
  assert.equal(alice.body.user.admin, false, 'a signed username is metadata, never an admin rule');
  assert.equal((await app.call('/api/me', { cookie: alice.cookie })).body.user.avatarUrl, photoUrl);
  assert.equal((await app.login(BOB)).body.user.avatarUrl, undefined);
  assert.equal(app.db().users.find(u => u.id === alice.body.user.id).telegramUsername, 'texno_liv');
  await app.stop();
  const reopened = await start(t, { dir: app.dir });
  assert.equal((await reopened.call('/api/me', { cookie: alice.cookie })).body.user.avatarUrl, photoUrl);
  const changed = 'https://t.me/i/userpic/320/updated-photo.jpg';
  assert.equal((await reopened.login(ALICE, { photoUrl: changed })).body.user.avatarUrl, changed);
  const removed = await reopened.login(ALICE, {}, { photo_url: photoUrl, initDataUnsafe: { user: { photo_url: photoUrl } } });
  assert.equal(removed.body.user.avatarUrl, undefined);
  assert.equal((await reopened.call('/api/me', { cookie: removed.cookie })).body.user.avatarUrl, undefined);
});

test('unsafe optional photos fall back without fetching URLs or leaking the bot token', async t => {
  const app = await start(t);
  for (const photoUrl of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'http://t.me/a.jpg',
    'https://evil.example/photo.jpg', 'https://t.me.evil.example/photo.jpg', 'https://user:password@t.me/photo.jpg',
    'https://api.telegram.org/bot' + TOKEN + '/getFile', 'x'.repeat(2050)]) {
    const response = await app.login(ALICE, { photoUrl });
    assert.equal(response.status, 200);
    // Credential-bearing Bot API URLs must never become avatar URLs, even on a Telegram host.
    assert.equal(response.body.user.avatarUrl, undefined);
  }
  assert.ok(!app.logs().includes(TOKEN));
});

test('Telegram login creates normal isolated account, repeats same identity, survives restart', async t => {
  const app = await start(t);
  const config = await app.call('/api/config');
  assert.equal(config.body.telegram_login, true);
  assert.ok(!JSON.stringify(config.body).includes(TOKEN));
  const [first, concurrent] = await Promise.all([app.login(ALICE), app.login(ALICE)]);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, concurrent.body);
  assert.deepEqual(Object.keys(first.body.user).sort(), ['admin', 'id', 'name']);
  assert.match(first.body.user.id, /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(first.body.user.id, String(ALICE));
  assert.equal(first.body.user.admin, false);
  assert.ok(first.setCookie.some(value => value.includes('__Host-gymsid=') && value.includes('HttpOnly; Secure; SameSite=Lax')));
  assert.equal(app.db().users.length, 1);
  assert.equal(app.db().users[0].telegramId, String(ALICE));
  assert.deepEqual(app.db().creds, []);
  assert.deepEqual((await app.call('/api/me', { cookie: first.cookie })).body.user, first.body.user);
  // Client uid / user fields / guest state are ignored, never linked or migrated by this endpoint.
  const repeat = await app.login(ALICE, { name: 'Renamed' }, { uid: 'attacker', user: { id: BOB }, state: { workouts: [{ id: 'guest' }] } });
  assert.equal(repeat.body.user.id, first.body.user.id);
  assert.equal(repeat.body.user.name, 'Аня');
  assert.equal((await app.call('/api/data', { cookie: first.cookie })).body.state, null);
  await app.stop();
  const reopened = await start(t, { dir: app.dir });
  assert.deepEqual((await reopened.login(ALICE)).body, first.body);
  assert.ok(!app.logs().includes(TOKEN) && !reopened.logs().includes(TOKEN));
});

test('same display name never links accounts and both users have separate data', async t => {
  const existing = { id: 'existing-password-account', name: 'Аня', email: 'same@example.test' };
  const app = await start(t, { users: [existing] });
  const alice = await app.login(ALICE, { name: '<Аня>\n' });
  const bob = await app.login(BOB, { name: 'Аня' });
  assert.equal(alice.status, 200); assert.equal(bob.status, 200);
  assert.notEqual(alice.body.user.id, bob.body.user.id);
  assert.notEqual(alice.body.user.id, existing.id);
  assert.notEqual(alice.body.user.name, bob.body.user.name);
  assert.ok(!/[<>\r\n]/.test(alice.body.user.name));
  assert.equal(app.db().users.length, 3);
  assert.equal((await app.call('/api/data', { method: 'PUT', cookie: alice.cookie, body: {
    userId: bob.body.user.id, state: { unit: 'kg', workouts: [{ id: 'alice-workout', vol: 1000 }], routines: [] },
  } })).status, 200);
  assert.equal((await app.call('/api/data', { cookie: bob.cookie })).body.state, null);
  await app.call('/api/data', { method: 'PUT', cookie: bob.cookie,
    body: { state: { workouts: [{ id: 'bob-workout', vol: 2000 }], routines: [] } } });
  assert.equal((await app.call('/api/data', { cookie: alice.cookie })).body.state.workouts[0].id, 'alice-workout');
  assert.equal((await app.call('/api/data', { cookie: bob.cookie })).body.state.workouts[0].id, 'bob-workout');
  assert.equal((await app.call('/api/data')).status, 401);
});

test('disabled linked account gets no session or replacement account', async t => {
  const app = await start(t, { users: [{ id: 'disabled', name: 'Аня', telegramId: String(ALICE), disabled: true }] });
  const result = await app.login(ALICE);
  assert.equal(result.status, 403); assert.equal(result.body.code, 'disabled');
  assert.deepEqual(result.setCookie, []);
  assert.equal(app.db().users.length, 1);
});

test('captured user header refuses changed cookie identity without exposing state or writing', async t => {
  const app = await start(t);
  const alice = await app.login(ALICE);
  const bob = await app.login(BOB);
  const state = id => ({ workouts: [{ id }], routines: [] });
  await app.call('/api/data', { method: 'PUT', cookie: alice.cookie, body: { state: state('alice') } });
  await app.call('/api/data', { method: 'PUT', cookie: bob.cookie, body: { state: state('bob') } });
  for (const [session, captured] of [[alice, bob], [bob, alice]]) {
    for (const [route, method] of [['/api/data', 'GET'], ['/api/data/rev', 'GET'], ['/api/data', 'PUT']]) {
      const result = await app.call(route, { method, cookie: session.cookie,
        headers: { 'X-OpenGym-User': captured.body.user.id },
        ...(method === 'PUT' ? { body: { state: state('must-not-write') } } : {}) });
      assert.equal(result.status, 409);
      assert.deepEqual(result.body, { error: 'Account changed', code: 'account-changed' });
    }
  }
  for (const [session, id] of [[alice, 'alice'], [bob, 'bob']]) {
    const headers = { 'X-OpenGym-User': session.body.user.id };
    assert.equal((await app.call('/api/data', { cookie: session.cookie, headers })).body.state.workouts[0].id, id);
    assert.equal((await app.call('/api/data/rev', { cookie: session.cookie, headers })).status, 200);
    // Existing API clients remain valid without the captured-user header.
    assert.equal((await app.call('/api/data', { cookie: session.cookie })).body.state.workouts[0].id, id);
  }
});

test('ambiguous persisted Telegram links fail closed', async t => {
  const app = await start(t, { users: [
    { id: 'first', name: 'First', telegramId: ALICE }, { id: 'second', name: 'Second', telegramId: String(ALICE) },
  ] });
  assert.equal((await app.login(ALICE)).status, 403);
});

test('invalid, stale, future and initDataUnsafe credentials cannot create users', async t => {
  const app = await start(t);
  for (const body of [
    {}, { initDataUnsafe: { user: { id: ALICE } } }, { initData: { user: { id: ALICE } } },
    { initData: initData(ALICE, { token: 'wrong-server-secret' }) },
    { initData: initData(ALICE, { authDate: Math.floor(Date.now() / 1000) - 601 }) },
    { initData: initData(ALICE, { authDate: Math.floor(Date.now() / 1000) + 601 }) },
    { initData: initData() + '&%75ser=forged' }, { initData: 'x'.repeat(16385) },
  ]) {
    const result = await app.call('/api/telegram/login', { method: 'POST', body });
    assert.equal(result.status, 401); assert.deepEqual(result.setCookie, []);
  }
  assert.equal(app.db().users.length, 0);
  assert.ok(!app.logs().includes(TOKEN) && !app.logs().includes('wrong-server-secret'));
});

test('unconfigured token, malformed token and malformed allowlist disable Telegram entrance', async t => {
  for (const env of [
    { TELEGRAM_BOT_TOKEN: '' }, { TELEGRAM_BOT_TOKEN: 'not-a-token' },
    { TELEGRAM_BOT_TOKEN: TOKEN + '\n' }, { TELEGRAM_BOT_TOKEN: '1'.repeat(257) + ':' + 'a'.repeat(30) },
    { TELEGRAM_ALLOWED_IDS: '' }, { TELEGRAM_ALLOWED_IDS: '   ' },
    { TELEGRAM_ALLOWED_IDS: `${ALICE},garbage` }, { TELEGRAM_ALLOWED_IDS: `${ALICE},` },
    { TELEGRAM_ALLOWED_IDS: '0' }, { TELEGRAM_ALLOWED_IDS: '9007199254740992' },
  ]) {
    await t.test(JSON.stringify(Object.keys(env)), async t => {
      const app = await start(t, { env });
      assert.notEqual((await app.call('/api/config')).body.telegram_login, true);
      const result = await app.login(ALICE);
      assert.equal(result.status, 403); assert.deepEqual(result.setCookie, []);
      assert.equal(app.db().users.length, 0);
    });
  }
});

test('allowlist restricts both new users and existing links', async t => {
  const app = await start(t, { env: { TELEGRAM_ALLOWED_IDS: ` ${ALICE} ` },
    users: [{ id: 'bob-existing', name: 'Bob', telegramId: String(BOB) }] });
  assert.equal((await app.login(ALICE)).status, 200);
  const denied = await app.login(BOB);
  assert.equal(denied.status, 403); assert.deepEqual(denied.setCookie, []);
  assert.equal(app.db().users.length, 2);
});

test('invite-only registration requires explicit allowlist, existing account can relogin', async t => {
  const app = await start(t, { env: { INVITE_ONLY: '1' },
    users: [{ id: 'alice-existing', name: 'Alice', telegramId: String(ALICE) }] });
  assert.equal((await app.login(ALICE)).status, 200);
  const denied = await app.login(BOB);
  assert.equal(denied.status, 403); assert.equal(denied.body.code, 'invite');
  assert.equal(app.db().users.length, 1);
  await t.test('allowlist explicitly grants signup without granting administrator', async t => {
    const permitted = await start(t, { env: { INVITE_ONLY: '1', TELEGRAM_ALLOWED_IDS: String(BOB) } });
    const joined = await permitted.login(BOB);
    assert.equal(joined.status, 200); assert.equal(joined.body.user.admin, false);
    assert.equal((await permitted.login(ALICE)).status, 403);
  });
});

test('Telegram login keeps same-origin CSRF policy', async t => {
  const app = await start(t);
  const body = { initData: initData() };
  const rejected = await app.call('/api/telegram/login', { method: 'POST', body,
    headers: { Origin: 'https://attacker.example.test', 'Sec-Fetch-Site': 'same-site' } });
  assert.equal(rejected.status, 403); assert.deepEqual(rejected.setCookie, []);
  assert.equal(app.db().users.length, 0);
  assert.equal((await app.call('/api/telegram/login', { method: 'POST', body,
    headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('Telegram invalid-login attempts share early existing auth throttle', async t => {
  const app = await start(t);
  let paused = false;
  for (let i = 0; i < 25; i++) {
    const result = await app.call('/api/telegram/login', { method: 'POST', body: { initData: 'invalid' } });
    if (result.status === 429) { paused = true; break; }
    assert.equal(result.status, 401);
  }
  assert.ok(paused);
  assert.equal((await app.login(ALICE)).status, 429);
  assert.equal(app.db().users.length, 0);
});

test('signed language_code is stored as a bare subtag, kept when later omitted, never taken from the body', async t => {
  const app = await start(t);
  await app.login(ALICE, { lang: 'en-GB' });
  assert.equal(app.db().users[0].telegramLang, 'en');
  await app.login(ALICE, { lang: 'ru' });
  assert.equal(app.db().users[0].telegramLang, 'ru');
  await app.login(ALICE, {}, { language_code: 'de', lang: 'de' });
  assert.equal(app.db().users[0].telegramLang, 'ru', 'missing signed language_code keeps the last one; body fields are ignored');
});
