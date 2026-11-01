// Trainer mode, stage 1 (TG14): link, consent, read only access. Each test starts a real server.js
// with Telegram sign-in on (the same harness as telegram-login.test.js) and several signed identities.
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
const TG = { coach: 4_600_000_001, c1: 4_600_000_011, c2: 4_600_000_012, c3: 4_600_000_013, c4: 4_600_000_014, c5: 4_600_000_015,
  c6: 4_600_000_016, other: 4_600_000_002, stranger: 4_600_000_003 };
const NAMES = { coach: 'Ирина', c1: 'Вася', c2: 'Петя', c3: 'Коля', c4: 'Саша', c5: 'Дима', c6: 'Лёша', other: 'Олег', stranger: 'Чужой' };
const GRANTS = { history: true, measures: true, stats: true };

// Telegram pictures by Telegram id, for the avatar tests; a login without an entry sends none.
const PHOTOS = {};
function initData(id, name) {
  const fields = new Map([
    ['user', JSON.stringify({ id, first_name: name, username: 'handle_' + id, ...(PHOTOS[id] ? { photo_url: PHOTOS[id] } : {}) })],
    ['query_id', 'test-query'], ['auth_date', String(Math.floor(Date.now() / 1000))],
  ]);
  const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  fields.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return new URLSearchParams(fields).toString();
}

async function start(t, { env = {}, dir: existing } = {}) {
  const dir = existing || fs.mkdtempSync(path.join(os.tmpdir(), 'gym-trainer-'));
  if (!existing) fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  let tail = '';
  const childEnv = { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN, RP_ID: 'gym.example.test', TELEGRAM_BOT_TOKEN: TOKEN,
    INVITE_ONLY: '0', FIRST_USER_ADMIN: '0', PASSWORD_LOGIN: '0', COACH_DISABLED: '1', AUDIT_LOG: '1', ADMIN_UIDS: '', ...env };
  delete childEnv.TELEGRAM_ALLOWED_IDS;
  const child = spawn(process.execPath, ['server.js'], { cwd: API, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', c => { tail = (tail + c).slice(-16000); });
  child.stderr.on('data', c => { tail = (tail + c).slice(-16000); });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  };
  t.after(async () => { await stop(); if (!existing) fs.rmSync(dir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => tail);
  const call = async (route, { method = 'GET', body, cookie } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method,
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, text,
      cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).filter(v => !v.endsWith('=')).join('; ') };
  };
  return { dir, call, stop, db: () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')) };
}

/** A running server plus signed-in people: `who.coach.cookie`, `who.coach.id`, and a `get/post/put/del` of their own. */
async function world(t, names = Object.keys(TG), opts) {
  const app = await start(t, opts);
  const who = {};
  for (const n of names) {
    const r = await app.call('/api/telegram/login', { method: 'POST', body: { initData: initData(TG[n], NAMES[n]) } });
    assert.equal(r.status, 200, n);
    const cookie = r.cookie;
    who[n] = { id: r.body.user.id, cookie,
      get: (p) => app.call(p, { cookie }), post: (p, body) => app.call(p, { method: 'POST', body, cookie }),
      put: (p, body) => app.call(p, { method: 'PUT', body, cookie }), del: p => app.call(p, { method: 'DELETE', cookie }) };
  }
  return { app, who };
}

const tokenOf = link => new URL(link).searchParams.get('startapp');
const makeTrainer = async c => { const r = await c.put('/api/trainer/me', { enabled: true, ageConfirmed: true }); assert.equal(r.status, 200); };
async function invite(coach, extra = {}) {
  const r = await coach.post('/api/trainer/invites', extra);
  assert.equal(r.status, 200, r.text);
  return { ...r.body, token: tokenOf(r.body.link) };
}
const accept = (client, token, over = {}) => client.post('/api/trainer/invites/accept', { token, ageConfirmed: true, grants: GRANTS, ...over });
async function link(coach, client, grants = GRANTS) {
  const inv = await invite(coach);
  const r = await accept(client, inv.token, { grants });
  assert.equal(r.status, 200, r.text);
  return r.body.linkId;
}
const writeState = (app, uid, S) => fs.writeFileSync(path.join(app.dir, `state-${uid}.json`), JSON.stringify(S));

const CLIENT_STATE = {
  unit: 'kg', _rev: 3, _wid: 'w1', theme: 'dark',
  workouts: [{ id: 'a', d: '2026-10-20', media: [{ hash: 'x' }], entries: [{ id: 'bench', media: [{ hash: 'y' }], sets: [{ done: true, w: 60, r: 8 }] }] }],
  bodyweight: [{ d: '2026-10-19', w: 80 }],
  measurements: [{ d: '2026-10-19', waist: 82 }], customMeasurements: [],
  dayPhotos: { '2026-10-19': [{ hash: 'secret-photo' }] }, coach: { chat: ['private AI coach talk'] }, exNotes: { bench: 'private note' },
  gymCards: [{ id: 'g', label: 'card', value: '12345' }], dayNotes: { '2026-10-20': { text: 'private day note' } },
};

test('the trainer role needs the 18+ box, can be turned off, and is Telegram only', async t => {
  const { app, who } = await world(t, ['coach']);
  assert.equal((await app.call('/api/trainer/me')).status, 401);
  const me = await who.coach.get('/api/trainer/me');
  assert.equal(me.body.trainer.enabled, false);
  for (const body of [{ enabled: true }, { enabled: true, ageConfirmed: false }, { enabled: true, ageConfirmed: 'yes' }]) {
    const r = await who.coach.put('/api/trainer/me', body);
    assert.equal(r.status, 400); assert.equal(r.body.code, 'age-required');
  }
  assert.equal((await who.coach.get('/api/trainer/me')).body.trainer.enabled, false);
  assert.equal((await who.coach.post('/api/trainer/invites', {})).body.code, 'not-trainer');
  assert.equal((await who.coach.get('/api/trainer/clients')).status, 403);
  await makeTrainer(who.coach);
  const user = app.db().users.find(u => u.id === who.coach.id);
  assert.equal(user.trainer.enabled, true);
  assert.ok(Date.parse(user.trainer.ageConfirmedAt) > 0, 'the time of the confirmation is stored');
  const open = await invite(who.coach);
  assert.equal((await who.coach.put('/api/trainer/me', { enabled: false })).status, 200);
  assert.equal((await who.coach.get('/api/trainer/me')).body.trainer.enabled, false);
  assert.equal((await who.coach.get('/api/trainer/invites')).status, 403);
  assert.ok(app.db().trainerInvites.find(i => i.id === open.id).revokedAt, 'turning the role off revokes open invitations');
});

test('the invite link, the consent and one use only', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2', 'other']);
  await makeTrainer(who.coach);
  const inv = await invite(who.coach, { label: 'Вася, жим' });
  assert.match(inv.link, /^https:\/\/t\.me\/Gym_statsbot\/zhim\?startapp=t_[A-Za-z0-9_-]{22}$/);
  const stored = app.db().trainerInvites[0];
  assert.equal(stored.hash, crypto.createHash('sha256').update(inv.token).digest('hex'));
  assert.ok(!JSON.stringify(app.db()).includes(inv.token), 'only the hash of the token is stored');
  assert.ok(Math.abs(Date.parse(inv.expires) - Date.now() - 7 * 86400000) < 60000, 'seven days by default');

  const preview = await who.c1.get('/api/trainer/invites/preview?t=' + inv.token);
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.grants, ['history', 'measures', 'stats']);
  assert.equal(preview.body.coachName, 'Ирина');
  assert.ok(!/handle_|4600000/.test(preview.text), 'neither the handle nor the Telegram id is shown');
  assert.equal((await who.coach.get('/api/trainer/invites/preview?t=' + inv.token)).body.code, 'self-invite');
  assert.equal((await who.c1.get('/api/trainer/invites/preview?t=t_notAtokenAtAllNotAToken')).body.code, 'invite-gone');
  assert.equal((await who.c1.get('/api/trainer/invites/preview?t=junk')).status, 404);

  // the consent: the box, and something to open
  assert.equal((await accept(who.c1, inv.token, { ageConfirmed: false })).body.code, 'age-required');
  assert.equal((await who.c1.post('/api/trainer/invites/accept', { token: inv.token, grants: GRANTS })).body.code, 'age-required');
  assert.equal((await accept(who.c1, inv.token, { grants: { history: false, measures: false, stats: false } })).body.code, 'grants-required');
  assert.equal((await accept(who.c1, inv.token, { grants: {} })).body.code, 'grants-required');
  assert.equal((await accept(who.c1, inv.token, { grants: { stats: true } })).body.code, 'grants-invalid');
  assert.equal((await accept(who.c1, inv.token, { grants: { history: 'yes' } })).body.code, 'grants-invalid');
  assert.equal(app.db().trainerLinks.length, 0, 'nothing was linked by the refusals');
  assert.equal((await accept(who.coach, inv.token)).body.code, 'self-invite');

  const ok = await accept(who.c1, inv.token, { grants: { history: true, measures: false, stats: true } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.grants, { history: true, measures: false, stats: true });
  const row = app.db().trainerLinks[0];
  assert.equal(row.status, 'active'); assert.equal(row.coachUid, who.coach.id); assert.equal(row.clientUid, who.c1.id);
  assert.ok(row.ageConfirmedAt && row.consentAt && row.consentVersion === 1);
  assert.ok(!ok.text.includes('4600000'));

  // one use: the second person and the same person again
  const again = await accept(who.c2, inv.token);
  assert.equal(again.status, 410); assert.equal(again.body.code, 'invite-used');
  assert.equal((await who.c2.get('/api/trainer/invites/preview?t=' + inv.token)).body.code, 'invite-used');
  assert.equal((await who.coach.get('/api/trainer/invites')).body.invites.length, 0);
  // a client has one trainer
  await makeTrainer(who.other);
  const second = await invite(who.other);
  const dup = await accept(who.c1, second.token);
  assert.equal(dup.status, 409); assert.equal(dup.body.code, 'has-trainer');
  // revoking an invitation closes it, and a used one cannot be revoked
  const third = await invite(who.coach);
  assert.equal((await who.other.del('/api/trainer/invites/' + third.id)).status, 404, 'not someone else\'s');
  assert.equal((await who.coach.del('/api/trainer/invites/' + third.id)).status, 200);
  assert.equal((await accept(who.c2, third.token)).body.code, 'invite-gone');
  assert.equal((await who.coach.del('/api/trainer/invites/' + inv.id)).body.code, 'invite-used');
});

test('an expired invitation is refused', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const inv = await invite(who.coach, { days: 1 });
  assert.ok(Math.abs(Date.parse(inv.expires) - Date.now() - 86400000) < 60000);
  assert.equal((await who.coach.post('/api/trainer/invites', { days: 2 })).body.code, 'days-invalid');
  await app.stop();
  const db = app.db();
  db.trainerInvites[0].expires = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(app.dir, 'db.json'), JSON.stringify(db));
  const again = await start(t, { dir: app.dir });
  const r = await again.call('/api/trainer/invites/preview?t=' + inv.token, { cookie: who.c1.cookie });
  assert.equal(r.status, 410); assert.equal(r.body.code, 'invite-expired');
  const a = await again.call('/api/trainer/invites/accept', { method: 'POST', cookie: who.c1.cookie, body: { token: inv.token, ageConfirmed: true, grants: GRANTS } });
  assert.equal(a.body.code, 'invite-expired');
  assert.equal(again.db().trainerLinks.length, 0);
});

test('at most five active clients; the sixth invitation is refused with the Russian message', async t => {
  const { app, who } = await world(t);
  await makeTrainer(who.coach);
  const spare = await invite(who.coach);   // issued while there was room
  for (const n of ['c1', 'c2', 'c3', 'c4', 'c5']) await link(who.coach, who[n]);
  const six = await who.coach.post('/api/trainer/invites', {});
  assert.equal(six.status, 409); assert.equal(six.body.code, 'client-limit');
  assert.equal(six.body.error, 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше');
  // the invitation that was already out cannot take the sixth place either, and does not burn
  const late = await accept(who.c6, spare.token);
  assert.equal(late.status, 409); assert.equal(late.body.code, 'coach-full');
  assert.ok(!app.db().trainerInvites.find(i => i.id === spare.id).usedAt);
  // a place frees up when a client leaves
  const links = (await who.coach.get('/api/trainer/clients')).body.clients;
  assert.equal(links.length, 5);
  assert.equal((await who.coach.del('/api/trainer/links/' + links[0].linkId)).status, 200);
  assert.equal((await accept(who.c6, spare.token)).status, 200);
  assert.equal((await who.coach.post('/api/trainer/invites', {})).body.code, 'client-limit');
});

test('a trainer reads only what the client opened, only while the link is active', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2', 'other', 'stranger']);
  await makeTrainer(who.coach);
  writeState(app, who.c1.id, CLIENT_STATE);
  writeState(app, who.c2.id, { ...CLIENT_STATE, bodyweight: [{ d: '2026-10-01', w: 999 }] });
  const l1 = await link(who.coach, who.c1, { history: true, measures: false, stats: true });
  const l2 = await link(who.coach, who.c2, { history: false, measures: true, stats: false });

  const list = (await who.coach.get('/api/trainer/clients')).body;
  assert.deepEqual(list.clients.map(c => c.name).sort(), ['Вася', 'Петя']);
  assert.equal(list.clients.find(c => c.linkId === l1).workouts, 1);
  assert.equal(list.clients.find(c => c.linkId === l1).lastWorkout, '2026-10-20');
  assert.equal(list.clients.find(c => c.linkId === l2).workouts, undefined, 'no history grant, no history facts');

  const a = await who.coach.get(`/api/trainer/clients/${l1}/data`);
  assert.equal(a.status, 200);
  assert.equal(a.body.data.workouts.length, 1);
  assert.deepEqual(Object.keys(a.body.data).sort(), ['customEx', 'unit', 'weekStart', 'workouts']);
  assert.ok(!('bodyweight' in a.body.data) && !('measurements' in a.body.data), 'measures were not opened');
  assert.ok(!a.text.includes('secret-photo') && !a.text.includes('private') && !a.text.includes('12345') && !a.text.includes('"hash"'),
    'photos, the AI coach, notes, cards and media never leave');
  assert.ok(!a.text.includes('4600000') && !a.text.includes('handle_') && !a.text.includes(who.c1.id));

  const b = await who.coach.get(`/api/trainer/clients/${l2}/data`);
  assert.deepEqual(Object.keys(b.body.data).sort(), ['bodyweight', 'customMeasurements', 'measurementEnabled', 'measurements', 'unit', 'weekStart']);
  assert.ok(!('workouts' in b.body.data));
  assert.equal(b.body.data.bodyweight[0].w, 999, 'each link reads its own client');

  // nobody else gets in: a stranger, another trainer, the client, forged ids
  assert.equal((await who.stranger.get(`/api/trainer/clients/${l1}/data`)).status, 403);
  await makeTrainer(who.other);
  for (const id of [l1, l2, who.c1.id, 'AAAAAAAAAAAA', '..%2f..%2fapi%2fdata']) {
    const r = await who.other.get(`/api/trainer/clients/${id}/data`);
    assert.equal(r.status, 404, id); assert.equal(r.body.code, 'client-gone');
  }
  assert.equal((await who.other.get('/api/trainer/clients')).body.clients.length, 0, 'a trainer sees only their own clients');
  assert.equal((await who.c1.get(`/api/trainer/clients/${l1}/data`)).status, 403, 'a client is not a trainer');
  assert.equal((await who.coach.get(`/api/trainer/clients/${who.c1.id}/data`)).status, 404, 'a user id is not a link id');
  assert.equal((await app.call(`/api/trainer/clients/${l1}/data`)).status, 401);
  assert.deepEqual((await who.c1.get('/api/trainer/me')).body.asClient.grants, { history: true, measures: false, stats: true });
  assert.ok(!(await who.c1.get('/api/trainer/me')).text.includes('Петя'), 'a client does not see the other clients');
  assert.equal((await who.c2.get('/api/trainer/me')).body.trainer.enabled, false);

  // read only: nothing a trainer can send changes a client's data
  for (const [method, p] of [['PUT', `/api/trainer/clients/${l1}/data`], ['POST', `/api/trainer/clients/${l1}/data`], ['DELETE', `/api/trainer/clients/${l1}/data`]]) {
    const r = await app.call(p, { method, cookie: who.coach.cookie, body: { workouts: [] } });
    assert.equal(r.status, 404, method);
  }
  const put = await who.coach.put('/api/data', { state: { workouts: [{ id: 'mine', d: '2026-10-21', entries: [] }] } });
  assert.ok(put.status < 500);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.dir, `state-${who.c1.id}.json`), 'utf8')).workouts.length, 1, 'the client\'s file is untouched');
});

test('revoking ends the access at once, from either side, and only for those in the link', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2', 'stranger']);
  await makeTrainer(who.coach);
  writeState(app, who.c1.id, CLIENT_STATE);
  const l1 = await link(who.coach, who.c1);
  const l2 = await link(who.coach, who.c2);
  assert.equal((await who.coach.get(`/api/trainer/clients/${l1}/data`)).status, 200);
  assert.equal((await who.stranger.del('/api/trainer/links/' + l1)).status, 404);
  assert.equal((await who.c2.del('/api/trainer/links/' + l1)).status, 404, 'another client cannot end it');
  assert.equal((await who.c1.del('/api/trainer/links/' + l1)).status, 200);
  const gone = await who.coach.get(`/api/trainer/clients/${l1}/data`);
  assert.equal(gone.status, 404); assert.equal(gone.body.code, 'client-gone');
  assert.equal((await who.coach.get('/api/trainer/clients')).body.clients.length, 1);
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient, null);
  assert.equal(app.db().trainerLinks.find(l => l.id === l1).revokedBy, 'client');
  assert.equal((await who.c1.del('/api/trainer/links/' + l1)).status, 404, 'already ended');
  // the trainer ends the other one; with no clients left the role can be turned off
  assert.equal((await who.coach.put('/api/trainer/me', { enabled: false })).body.code, 'has-clients');
  assert.equal((await who.coach.del('/api/trainer/links/' + l2)).status, 200);
  assert.equal(app.db().trainerLinks.find(l => l.id === l2).revokedBy, 'coach');
  assert.equal((await who.coach.put('/api/trainer/me', { enabled: false })).status, 200);
  assert.equal((await who.coach.get(`/api/trainer/clients/${l2}/data`)).status, 403);
  // after ending, the client can join another trainer
  assert.equal(CLIENT_STATE.workouts.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(app.dir, `state-${who.c1.id}.json`), 'utf8')).bodyweight.length, 1, 'the data stays with the client');
});

test('the audit log has the trainer events and no values, and invitations are budgeted', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const l = await link(who.coach, who.c1);
  await who.coach.get(`/api/trainer/clients/${l}/data`);
  await who.coach.get(`/api/trainer/clients/${l}/data`);
  await who.coach.get('/api/trainer/clients/AAAAAAAAAAAA/data');
  await who.c1.del('/api/trainer/links/' + l);
  const audit = fs.readFileSync(path.join(app.dir, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.ev.startsWith('trainer.'));
  const evs = audit.map(e => e.ev);
  for (const ev of ['trainer.enable', 'trainer.invite.create', 'trainer.invite.accept', 'trainer.read', 'trainer.denied', 'trainer.link.revoke']) assert.ok(evs.includes(ev), ev);
  assert.equal(evs.filter(e => e === 'trainer.read').length, 1, 'polling is logged once per ten minutes');
  assert.ok(!JSON.stringify(audit).includes('4600000'));
  // ten new invitations an hour
  const { who: w2 } = await world(t, ['coach']);
  await makeTrainer(w2.coach);
  for (let i = 0; i < 10; i++) assert.equal((await w2.coach.post('/api/trainer/invites', {})).status, 200);
  assert.equal((await w2.coach.post('/api/trainer/invites', {})).status, 429);
});

test('the trainer gets the Telegram picture of a client with an active link, and of nobody else', async t => {
  PHOTOS[TG.c1] = 'https://t.me/i/userpic/320/abc123.jpg';
  PHOTOS[TG.c2] = 'https://evil.example/pic.jpg';
  PHOTOS[TG.stranger] = 'https://cdn5.telegram-cdn.org/file/xyz.jpg';
  t.after(() => { delete PHOTOS[TG.c1]; delete PHOTOS[TG.c2]; delete PHOTOS[TG.stranger]; });
  const { app, who } = await world(t, ['coach', 'c1', 'c2', 'other', 'stranger']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const l1 = await link(who.coach, who.c1, { history: true, measures: false, stats: false });
  const l2 = await link(who.coach, who.c2, { history: true, measures: false, stats: false });
  const l3 = await link(who.coach, who.stranger, { history: true, measures: false, stats: false });
  const made = await who.coach.post('/api/trainer/managed', { name: 'Мама', ageConfirmed: true });
  const list = (await who.coach.get('/api/trainer/clients')).body.clients;
  assert.equal(list.find(c => c.linkId === l1).avatarUrl, 'https://t.me/i/userpic/320/abc123.jpg');
  assert.equal(list.find(c => c.linkId === l2).avatarUrl, undefined, 'a picture from another host is never kept or sent');
  assert.equal(list.find(c => c.linkId === l3).avatarUrl, 'https://cdn5.telegram-cdn.org/file/xyz.jpg');
  assert.equal(list.find(c => c.linkId === made.body.linkId).avatarUrl, undefined, 'a managed client has none');
  assert.equal((await who.coach.get('/api/trainer/clients/' + l1 + '/data')).body.avatarUrl, 'https://t.me/i/userpic/320/abc123.jpg');
  // Another trainer sees nothing of it, and neither does the client list of a trainer without a link.
  assert.equal((await who.other.get('/api/trainer/clients')).body.clients.length, 0);
  assert.equal((await who.other.get('/api/trainer/clients/' + l1 + '/data')).status, 404);
  // Once the link ends the picture is no longer served to the trainer.
  assert.equal((await who.c1.del('/api/trainer/links/' + l1)).status, 200);
  assert.ok(!(await who.coach.get('/api/trainer/clients')).body.clients.some(c => c.linkId === l1));
  assert.equal((await who.coach.get('/api/trainer/clients/' + l1 + '/data')).status, 404);
  // The profile keeps only a checked URL, refreshed at every login.
  const db = app.db();
  assert.equal(db.users.find(u => u.id === who.c1.id).telegramPhotoUrl, 'https://t.me/i/userpic/320/abc123.jpg');
  assert.ok(!db.users.find(u => u.id === who.c2.id).telegramPhotoUrl);
});

test('the trainer sets the days a client comes; only for their own active link; the list and /api/me carry it', async t => {
  const { who } = await world(t, ['coach', 'c1', 'other']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const l1 = await link(who.coach, who.c1, { history: true, measures: false, stats: false });
  const made = await who.coach.post('/api/trainer/managed', { name: 'Мама', ageConfirmed: true });
  const put = (c, id, body) => c.put(`/api/trainer/links/${id}/schedule`, body);

  const ok = await put(who.coach, l1, { days: [5, 1, 3, 3], time: '18:30', remind: true, tz: 'Europe/Moscow' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.body.schedule, { days: [1, 3, 5], time: '18:30', remind: true });
  const list = (await who.coach.get('/api/trainer/clients')).body.clients;
  assert.deepEqual(list.find(c => c.linkId === l1).schedule, { days: [1, 3, 5], time: '18:30', remind: true });
  assert.equal(list.find(c => c.linkId === made.body.linkId).schedule, null);
  // A managed client's link takes a schedule too; an empty day list switches the reminder off whatever was asked.
  const m = await put(who.coach, made.body.linkId, { days: [], remind: true });
  assert.deepEqual(m.body.schedule, { days: [], time: '', remind: false });
  // Bad input is refused and nothing changes.
  for (const bad of [{}, { days: 'x' }, { days: [0] }, { days: [8] }, { days: [1.5] }, { days: [1], time: '25:00' }, { days: [1], time: '9:5' }, { days: [1], remind: 'yes' }, { days: [1, 2, 3, 4, 5, 6, 7, 1] }]) {
    assert.equal((await put(who.coach, l1, bad)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual((await who.coach.get('/api/trainer/clients')).body.clients.find(c => c.linkId === l1).schedule, { days: [1, 3, 5], time: '18:30', remind: true });
  // Not another trainer's, not the client's own, not an unknown or ended link.
  assert.equal((await put(who.other, l1, { days: [2] })).status, 404);
  assert.equal((await put(who.c1, l1, { days: [2] })).status, 403);
  assert.equal((await put(who.coach, 'nope-nope-1', { days: [2] })).status, 404);
  assert.equal((await who.c1.del('/api/trainer/links/' + l1)).status, 200);
  assert.equal((await put(who.coach, l1, { days: [2] })).status, 404);
  // The app learns from /api/me that this profile is a trainer's.
  assert.equal((await who.coach.get('/api/me')).body.user.trainer, true);
  assert.equal((await who.c1.get('/api/me')).body.user.trainer, undefined);
});

test('the reminder goes once, before the booked time, on the booked days, and not for what has passed', async () => {
  const { reminderDecision, reminderText } = await import('../trainer.js');
  const link = (over = {}) => ({ status: 'active', schedule: { days: [1, 3], time: '18:00', remind: true, ...over } });
  const at = (weekday, hhmm, date = '2026-11-02') => ({ weekday, hhmm, date });
  assert.equal(reminderDecision(link(), at(1, '16:59')), null, 'an hour before, not earlier');
  assert.equal(reminderDecision(link(), at(1, '17:00')), 'send');
  assert.equal(reminderDecision(link(), at(1, '18:20')), 'send');
  assert.equal(reminderDecision(link(), at(1, '18:31')), 'skip', 'the moment has passed: marked, not sent');
  assert.equal(reminderDecision(link(), at(2, '17:30')), null, 'Tuesday is not a booked day');
  assert.equal(reminderDecision(link({ days: [7] }), at(0, '17:30')), 'send', 'Sunday is 0 for the clock and 7 for the plan');
  assert.equal(reminderDecision({ ...link(), lastRemindDate: '2026-11-02' }, at(1, '17:30')), null, 'once a day');
  assert.equal(reminderDecision({ ...link(), lastRemindDate: '2026-10-26' }, at(1, '17:30')), 'send', 'a week later it goes again');
  assert.equal(reminderDecision(link({ remind: false }), at(1, '17:30')), null);
  assert.equal(reminderDecision({ ...link(), status: 'revoked' }, at(1, '17:30')), null);
  // No booked time: the morning.
  assert.equal(reminderDecision(link({ time: '' }), at(1, '07:59')), null);
  assert.equal(reminderDecision(link({ time: '' }), at(1, '08:00')), 'send');
  assert.equal(reminderDecision(link({ time: '' }), at(1, '23:00')), 'send');
  assert.equal(reminderText('Вася', '18:00'), 'Сегодня к вам придёт Вася в 18:00.');
  assert.equal(reminderText('Вася', ''), 'Сегодня у вас занятие: Вася.');
});
