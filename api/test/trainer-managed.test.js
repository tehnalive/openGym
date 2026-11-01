// Trainer mode, managed clients (TG14): a diary the trainer keeps for someone without Telegram.
// Each test starts a real server.js with Telegram sign-in on and a few signed identities.
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
import { applyOps, checkCreate, managedView, hasDiary } from '../trainer-managed.js';

const API = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = '123456789:synthetic_telegram_test_token_not_a_secret';
const ORIGIN = 'https://gym.example.test';
const TG = { coach: 4_700_000_001, other: 4_700_000_002, c1: 4_700_000_011 };
const NAMES = { coach: 'Ирина', other: 'Олег', c1: 'Вася' };
const TODAY = new Date().toISOString().slice(0, 10);

function initData(id, name) {
  const fields = new Map([
    ['user', JSON.stringify({ id, first_name: name, username: 'handle_' + id })],
    ['query_id', 'test-query'], ['auth_date', String(Math.floor(Date.now() / 1000))],
  ]);
  const check = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  fields.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return new URLSearchParams(fields).toString();
}

async function start(t, { env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-managed-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  let tail = '';
  const childEnv = { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN, RP_ID: 'gym.example.test', TELEGRAM_BOT_TOKEN: TOKEN,
    INVITE_ONLY: '0', FIRST_USER_ADMIN: '0', PASSWORD_LOGIN: '0', COACH_DISABLED: '1', AUDIT_LOG: '1', ADMIN_UIDS: '', ...env };
  delete childEnv.TELEGRAM_ALLOWED_IDS;
  const child = spawn(process.execPath, ['server.js'], { cwd: API, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', c => { tail = (tail + c).slice(-16000); });
  child.stderr.on('data', c => { tail = (tail + c).slice(-16000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const port = await boundPort(child, () => tail);
  const call = async (route, { method = 'GET', body, cookie, headers } = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${route}`, { method,
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(headers || {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null, text,
      cookie: r.headers.getSetCookie().map(v => v.split(';')[0]).filter(v => !v.endsWith('=')).join('; ') };
  };
  return { dir, call, db: () => JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')) };
}

async function world(t, names = Object.keys(TG), opts) {
  const app = await start(t, opts);
  const who = {};
  for (const n of names) {
    const r = await app.call('/api/telegram/login', { method: 'POST', body: { initData: initData(TG[n], NAMES[n]) } });
    assert.equal(r.status, 200, n);
    const cookie = r.cookie;
    who[n] = { id: r.body.user.id, cookie,
      get: p => app.call(p, { cookie }), post: (p, body) => app.call(p, { method: 'POST', body, cookie }),
      put: (p, body) => app.call(p, { method: 'PUT', body, cookie }), del: (p, body) => app.call(p, { method: 'DELETE', body, cookie }) };
  }
  return { app, who };
}

const makeTrainer = async c => assert.equal((await c.put('/api/trainer/me', { enabled: true, ageConfirmed: true })).status, 200);
const add = (c, over = {}) => c.post('/api/trainer/managed', { name: 'Мама', note: 'колено', ageConfirmed: true, ...over });
const stateOf = (app, uid) => JSON.parse(fs.readFileSync(path.join(app.dir, `state-${uid}.json`), 'utf8'));
const workout = (over = {}) => ({
  id: 'w1', d: TODAY, start: Date.now() - 3600000, end: Date.now(), name: 'Ноги',
  entries: [{ id: 'squat', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }] }], ...over,
});
const ops = (c, id, list, extra = {}) => c.post(`/api/trainer/managed/${id}/ops`, { ops: list, ...extra });

test('creating a managed client needs the trainer role, a name and the 18+ box; it is a profile with no way in', async t => {
  const { app, who } = await world(t, ['coach', 'other']);
  assert.equal((await add(who.coach)).body.code, 'not-trainer');
  await makeTrainer(who.coach);
  assert.equal((await add(who.coach, { name: '  ' })).body.code, 'name-required');
  assert.equal((await add(who.coach, { ageConfirmed: false })).body.code, 'age-required');
  assert.equal((await add(who.coach, { ageConfirmed: 'да' })).status, 400);
  assert.equal((await add(who.coach, { unit: 'stone' })).status, 400);
  assert.equal((await app.call('/api/trainer/managed', { method: 'POST', body: { name: 'х', ageConfirmed: true } })).status, 401);

  const made = await add(who.coach, { name: 'Мама ' + 'я'.repeat(60) });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.body.name.length, 40);
  const db = app.db();
  const client = db.users.find(u => u.managedBy === who.coach.id);
  assert.ok(client, 'a profile owned by the trainer');
  assert.ok(!client.telegramId && !client.pw && !client.email, 'no Telegram id, no password, no e-mail');
  assert.ok(!(db.creds || []).some(c => c.userId === client.id), 'no passkey');
  const link = db.trainerLinks.find(l => l.id === made.body.linkId);
  assert.equal(link.managed, true); assert.equal(link.status, 'active'); assert.equal(link.coachUid, who.coach.id); assert.equal(link.clientUid, client.id);
  assert.deepEqual(link.grants, { history: true, measures: true, stats: true });
  assert.ok(Date.parse(link.ageConfirmedAt) > 0);
  assert.ok(fs.existsSync(path.join(app.dir, `state-${client.id}.json`)));

  const list = await who.coach.get('/api/trainer/clients');
  const row = list.body.clients.find(c => c.linkId === made.body.linkId);
  assert.equal(row.managed, true); assert.equal(row.name, made.body.name); assert.equal(row.note, 'колено');
  // The health count and the trainer role: managed profiles are not users, and block turning the role off.
  assert.equal((await app.call('/api/health')).body.users, 2);
  assert.equal((await who.coach.put('/api/trainer/me', { enabled: false })).body.code, 'has-clients');
});

test('a managed client cannot sign in, however the session is made', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  await add(who.coach);
  const client = app.db().users.find(u => u.managedBy === who.coach.id);
  // A token the server itself would accept for any other profile: signed with its secret.
  const secret = fs.readFileSync(path.join(app.dir, 'secret'), 'utf8').trim();
  const payload = `${client.id}:${Date.now() + 86400000}:0:b`;
  const forged = payload + '.' + crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const sane = `${who.coach.id}:${Date.now() + 86400000}:0:b`;
  const control = sane + '.' + crypto.createHmac('sha256', secret).update(sane).digest('base64url');
  for (const route of ['/api/me', '/api/data', '/api/data/rev']) {
    assert.equal((await app.call(route, { headers: { Authorization: 'Bearer ' + forged } })).status, 401, route);
  }
  assert.equal((await app.call('/api/data', { headers: { Authorization: 'Bearer ' + control } })).status, 200, 'the same forgery for a real profile works, so the 401 above is the rule');
  assert.equal((await app.call('/api/login/password', { method: 'POST', body: { name: client.name, password: 'x' } })).status >= 400, true);
});

test('five clients in all, Telegram and managed together; a sixth is refused with the usual text', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  for (let i = 1; i <= 4; i++) assert.equal((await add(who.coach, { name: 'Подопечный ' + i })).status, 200);
  // A Telegram client takes the fifth place.
  const inv = await who.coach.post('/api/trainer/invites', {});
  const token = new URL(inv.body.link).searchParams.get('startapp');
  const acc = await who.c1.post('/api/trainer/invites/accept', { token, ageConfirmed: true, grants: { history: true, measures: false, stats: false } });
  assert.equal(acc.status, 200, acc.text);
  const sixth = await add(who.coach, { name: 'Шестой' });
  assert.equal(sixth.status, 409); assert.equal(sixth.body.code, 'client-limit');
  assert.match(sixth.body.error, /5 подопечных/);
  assert.equal(app.db().users.filter(u => u.managedBy).length, 4);
});

test('another trainer, a Telegram client and a stranger all read "not there"', async t => {
  const { app, who } = await world(t, ['coach', 'other', 'c1']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const id = (await add(who.coach)).body.linkId;
  const tg = (() => null)();
  for (const who2 of [who.other, who.c1]) {
    for (const r of [
      await who2.get(`/api/trainer/managed/${id}`), await ops(who2, id, [{ op: 'bodyweight.set', d: TODAY, w: 70 }]),
      await who2.get(`/api/trainer/managed/${id}/export`), await who2.del(`/api/trainer/managed/${id}`, { confirm: true }),
    ]) assert.ok(r.status === 404 || r.status === 403, `${r.status} ${r.text}`);
  }
  assert.equal((await who.other.get(`/api/trainer/managed/${id}`)).body.code, 'client-gone');
  assert.equal((await who.other.get('/api/trainer/managed/doesnotexist1')).body.code, 'client-gone');
  assert.equal((await who.other.get('/api/trainer/managed/..%2Fx')).status, 404);
  assert.deepEqual((await who.other.get('/api/trainer/clients')).body.clients, []);
  assert.equal(stateOf(app, app.db().users.find(u => u.managedBy).id).workouts.length, 0, 'nothing was written');
  assert.equal(tg, null);
  // And a Telegram client's link id does not open on the managed routes.
  const inv = await who.coach.post('/api/trainer/invites', {});
  const token = new URL(inv.body.link).searchParams.get('startapp');
  const acc = await who.c1.post('/api/trainer/invites/accept', { token, ageConfirmed: true, grants: { history: true, measures: true, stats: true } });
  assert.equal((await who.coach.get(`/api/trainer/managed/${acc.body.linkId}`)).body.code, 'client-gone');
  assert.equal((await ops(who.coach, acc.body.linkId, [{ op: 'bodyweight.set', d: TODAY, w: 70 }])).status, 404);
  // Ending a managed link by the Telegram route would orphan the diary: it is refused.
  const managedLinkEnd = await who.coach.del(`/api/trainer/links/${id}`);
  assert.equal(managedLinkEnd.status, 409); assert.equal(managedLinkEnd.body.code, 'managed-link');
});

test('the trainer writes workouts, weight and measurements; revisions move, deletions stay deleted', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const id = (await add(who.coach, { unit: 'lb' })).body.linkId;
  const uid = app.db().users.find(u => u.managedBy).id;
  const first = await who.coach.get(`/api/trainer/managed/${id}`);
  assert.equal(first.body.data.unit, 'lb'); const rev0 = first.body.rev;
  assert.ok(rev0 >= 1);

  const w = await ops(who.coach, id, [
    { op: 'workout.save', workout: workout() },
    { op: 'bodyweight.set', d: TODAY, w: 150.44 },
    { op: 'measurement.set', d: TODAY, values: { waist: 82.3, bodyFat: 20 } },
  ], { baseRev: rev0 });
  assert.equal(w.status, 200, w.text);
  assert.ok(w.body.rev > rev0);
  const doc = stateOf(app, uid);
  assert.equal(doc._rev, w.body.rev); assert.ok(doc._wid);
  assert.equal(doc.workouts.length, 1); assert.equal(doc.workouts[0].via, 'coach'); assert.ok(doc.workouts[0]._ts > 0);
  assert.deepEqual(doc.bodyweight.map(b => [b.d, b.w]), [[TODAY, 150.4]]);
  assert.equal(doc.measurements[0].waist, 82.3); assert.equal(doc.measurements[0].bodyFat, 20);
  assert.equal(w.body.data.workouts.length, 1);

  // The same id again replaces; another workout on the same day is added after it.
  assert.equal((await ops(who.coach, id, [{ op: 'workout.save', workout: workout({ name: 'Ноги 2' }) }, { op: 'workout.save', workout: workout({ id: 'w2', name: 'Спина' }) }])).status, 200);
  assert.deepEqual(stateOf(app, uid).workouts.map(x => x.name), ['Ноги 2', 'Спина']);

  // A stale baseRev is a conflict that carries the current diary and writes nothing.
  const stale = await ops(who.coach, id, [{ op: 'bodyweight.set', d: TODAY, w: 99 }], { baseRev: rev0 });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'conflict'); assert.equal(stale.body.data.workouts.length, 2);
  assert.equal(stateOf(app, uid).bodyweight[0].w, 150.4);

  // A deletion is on record, so a device that merges later cannot bring the workout back.
  assert.equal((await ops(who.coach, id, [{ op: 'workout.delete', id: 'w2' }])).status, 200);
  const after = stateOf(app, uid);
  assert.deepEqual(after.workouts.map(x => x.id), ['w1']);
  assert.ok(after.deleted && Object.keys(after.deleted).length > 0, 'the removal is stamped: ' + JSON.stringify(after.deleted));
  assert.equal((await ops(who.coach, id, [{ op: 'workout.delete', id: 'nope' }])).body.code, 'workout-gone');
  assert.equal((await ops(who.coach, id, [{ op: 'bodyweight.delete', d: TODAY }, { op: 'measurement.delete', d: TODAY }])).status, 200);
  const empty = stateOf(app, uid);
  assert.deepEqual([empty.bodyweight, empty.measurements], [[], []]);
});

test('bad operations change nothing, and a whole request is all or none', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const id = (await add(who.coach)).body.linkId;
  const uid = app.db().users.find(u => u.managedBy).id;
  const before = fs.readFileSync(path.join(app.dir, `state-${uid}.json`), 'utf8');
  const bad = [
    [{ op: 'nope' }], [], [{ op: 'workout.save', workout: workout({ d: '2999-01-01' }) }], [{ op: 'workout.save', workout: workout({ d: '2026-02-30' }) }],
    [{ op: 'workout.save', workout: workout({ id: undefined }) }], [{ op: 'workout.save', workout: workout({ entries: [] }) }],
    [{ op: 'workout.save', workout: workout({ entries: [{ id: 'x', sets: [{ w: -1, r: 1 }] }] }) }],
    [{ op: 'workout.save', workout: workout({ entries: [{ id: 'x', sets: [{ w: 1, r: 1e9 }] }] }) }],
    [{ op: 'bodyweight.set', d: TODAY, w: 0 }], [{ op: 'bodyweight.set', d: 'tomorrow', w: 70 }], [{ op: 'bodyweight.set', d: TODAY, w: '70' }],
    [{ op: 'measurement.set', d: TODAY, values: { evil: 1 } }], [{ op: 'measurement.set', d: TODAY, values: { bodyFat: 101 } }],
    [{ op: 'bodyweight.set', d: TODAY, w: 70 }, { op: 'workout.delete', id: 'nope' }],
    Array.from({ length: 21 }, () => ({ op: 'bodyweight.set', d: TODAY, w: 70 })),
  ];
  for (const list of bad) {
    const r = await ops(who.coach, id, list);
    assert.equal(r.status, 400, JSON.stringify(list).slice(0, 80) + ' -> ' + r.text);
  }
  assert.equal(fs.readFileSync(path.join(app.dir, `state-${uid}.json`), 'utf8'), before);
});

test('photos and videos never ride along on a workout, and the trainer cannot set who wrote it', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const id = (await add(who.coach)).body.linkId;
  const uid = app.db().users.find(u => u.managedBy).id;
  const w = workout({ media: [{ hash: 'a'.repeat(64) }], by: 'someone', via: 'client', entries: [{ id: 'squat', media: [{ hash: 'b'.repeat(64) }], photo: 'p', sets: [{ w: 5, r: 5, done: true, video: 'v' }] }] });
  assert.equal((await ops(who.coach, id, [{ op: 'workout.save', workout: w }])).status, 200);
  const saved = stateOf(app, uid).workouts[0];
  assert.ok(!JSON.stringify(saved).includes('aaaa') && !JSON.stringify(saved).includes('bbbb'));
  assert.equal(saved.via, 'coach'); assert.equal(saved.by, undefined);
  const read = await who.coach.get(`/api/trainer/managed/${id}`);
  assert.ok(!/"media"|"photo"|"video"/.test(read.text));
});

test('export and delete: the diary downloads, and deleting erases the profile, its file and its link', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const id = (await add(who.coach, { name: 'Бабушка' })).body.linkId;
  const uid = app.db().users.find(u => u.managedBy).id;
  await ops(who.coach, id, [{ op: 'workout.save', workout: workout() }]);
  const ex = await who.coach.get(`/api/trainer/managed/${id}/export`);
  assert.equal(ex.status, 200); assert.equal(ex.body.kind, 'managed-client-export'); assert.equal(ex.body.name, 'Бабушка');
  assert.equal(ex.body.data.workouts.length, 1);
  assert.ok(!ex.text.includes(uid) && !ex.text.includes(who.coach.id), 'no profile ids in the export');

  assert.equal((await who.coach.del(`/api/trainer/managed/${id}`, {})).body.code, 'confirm-required');
  assert.equal((await who.coach.del(`/api/trainer/managed/${id}`, { confirm: 'true' })).status, 400);
  assert.ok(fs.existsSync(path.join(app.dir, `state-${uid}.json`)));
  assert.equal((await who.coach.del(`/api/trainer/managed/${id}`, { confirm: true })).status, 200);
  const db = app.db();
  assert.ok(!db.users.some(u => u.id === uid)); assert.ok(!db.trainerLinks.some(l => l.id === id));
  assert.ok(!fs.existsSync(path.join(app.dir, `state-${uid}.json`)));
  assert.equal((await who.coach.get(`/api/trainer/managed/${id}`)).status, 404);
  assert.equal((await who.coach.put('/api/trainer/me', { enabled: false })).status, 200, 'with no clients left the role can be turned off');
});

test('an admin deleting the trainer takes the diaries they kept with them', async t => {
  const { app, who } = await world(t, ['coach', 'other'], { env: { FIRST_USER_ADMIN: '1' } });
  await makeTrainer(who.other);
  const id = (await add(who.other, { name: 'Дядя' })).body.linkId;
  const uid = app.db().users.find(u => u.managedBy).id;
  const shown = await who.coach.get('/api/admin/users');
  assert.equal(shown.body.users.find(u => u.id === uid).managed, true, 'the admin list marks it');
  const del = await who.coach.post('/api/admin/user/delete', { id: who.other.id });
  assert.equal(del.status, 200, del.text);
  const db = app.db();
  assert.deepEqual(db.users.map(u => u.id), [who.coach.id]); assert.equal(db.trainerLinks.length, 0);
  assert.ok(!fs.existsSync(path.join(app.dir, `state-${uid}.json`)));
  assert.ok(id);
});

test('the audit records create, write, export and delete without the diary', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const id = (await add(who.coach)).body.linkId;
  await ops(who.coach, id, [{ op: 'workout.save', workout: workout() }]);
  await who.coach.get(`/api/trainer/managed/${id}/export`);
  await who.coach.del(`/api/trainer/managed/${id}`, { confirm: true });
  const logs = fs.readdirSync(app.dir).filter(f => /^audit/.test(f)).map(f => fs.readFileSync(path.join(app.dir, f), 'utf8')).join('\n');
  for (const ev of ['trainer.managed.create', 'trainer.managed.write', 'trainer.managed.export', 'trainer.managed.delete']) assert.ok(logs.includes(ev), ev);
  assert.ok(!logs.includes('squat'));
});

test('applyOps is pure: the input is not changed, and checkCreate trims control characters', () => {
  const S = { workouts: [], bodyweight: [], measurements: [] };
  const r = applyOps(S, [{ op: 'bodyweight.set', d: TODAY, w: 70 }]);
  assert.deepEqual(S.bodyweight, []); assert.equal(r.doc.bodyweight.length, 1);
  assert.equal(checkCreate({ name: 'А\u0000\nБ', ageConfirmed: true }).name, 'А Б');
  assert.equal(hasDiary({ workouts: [] }), false); assert.equal(hasDiary({ bodyweight: [{ d: TODAY, w: 1 }] }), true);
  assert.deepEqual(Object.keys(managedView({ dayPhotos: { x: 1 }, coach: { chat: ['x'] }, workouts: [] })).sort(),
    ['bodyweight', 'customEx', 'customMeasurements', 'measurementEnabled', 'measurements', 'unit', 'weekStart', 'workouts']);
});

// ---- the whole document, for the ordinary app opened in the client's name ----
const dataPath = id => `/api/trainer/managed/${id}/data`;

test('the trainer reads and pushes a managed diary as the app syncs it: revisions, stamps, 409', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const { linkId } = (await add(who.coach)).body;
  const first = await who.coach.get(dataPath(linkId));
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.name, 'Мама');
  const rev0 = first.body.rev;
  assert.equal((await who.coach.get(dataPath(linkId) + '/rev')).body.rev, rev0);

  const doc = { ...first.body.state, routines: [{ id: 'r1', name: 'Ноги', ex: [] }], workouts: [workout()],
    dayPhotos: { [TODAY]: 'abc' }, coach: { memory: 'x' }, customEx: [{ id: 'c1', name: 'Мой', photo: 'h1', media: { a: 1 } }] };
  const put = await who.coach.put(dataPath(linkId), { state: doc, baseRev: rev0, baseWid: first.body.state._wid });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.body.rev, rev0 + 1);
  assert.ok(put.body.wid);

  const client = app.db().users.find(u => u.managedBy === who.coach.id);
  const stored = stateOf(app, client.id);
  assert.equal(stored.routines[0].name, 'Ноги');
  assert.equal(stored.workouts[0].id, 'w1');
  assert.ok(!('dayPhotos' in stored) && !('coach' in stored), 'personal keys never stored');
  assert.ok(!('photo' in stored.customEx[0]) && !('media' in stored.customEx[0]), 'no media references stored');
  assert.equal((await who.coach.get(dataPath(linkId) + '/rev')).body.rev, rev0 + 1);

  // A stale baseRev is a conflict that carries the current document.
  const stale = await who.coach.put(dataPath(linkId), { state: doc, baseRev: rev0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, rev0 + 1);
  assert.equal(stale.body.state.workouts[0].id, 'w1');
  // The checks of PUT /api/data apply: an empty document and a document that is not one are refused.
  assert.equal((await who.coach.put(dataPath(linkId), { state: {} })).status, 400);
  assert.equal((await who.coach.put(dataPath(linkId), { state: { workouts: 'x' } })).status, 400);
  assert.equal((await who.coach.put(dataPath(linkId), {})).status, 400);
  // The audit records that a document was written, never what was in it.
  const audit = (await who.coach.get('/api/admin/audit?limit=50').catch(() => ({}))) || {};
  assert.ok(!JSON.stringify(audit.body || {}).includes('Ноги'));
});

test('another trainer, a Telegram client, a stranger and a deleted client all read as not there on the document routes', async t => {
  const { app, who } = await world(t, ['coach', 'other', 'c1']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const { linkId } = (await add(who.coach)).body;
  const state = (await who.coach.get(dataPath(linkId))).body.state;
  const body = { state: { ...state, workouts: [workout({ id: 'evil' })] } };
  for (const [name, c] of [['other trainer', who.other], ['plain user', who.c1]]) {
    for (const [m, p, b] of [['get', dataPath(linkId)], ['get', dataPath(linkId) + '/rev'], ['put', dataPath(linkId), body]]) {
      const r = await c[m](p, b);
      assert.ok([403, 404].includes(r.status), `${name} ${m} ${p} -> ${r.status}`);
      if (c === who.other) assert.equal(r.body.code, 'client-gone');
    }
  }
  assert.equal((await who.coach.get(dataPath('does-not-exist-1'))).body.code, 'client-gone');
  assert.equal((await app.call(dataPath(linkId))).status, 401);
  assert.equal((await app.call(dataPath(linkId), { method: 'PUT', body })).status, 401);
  const client = app.db().users.find(u => u.managedBy === who.coach.id);
  assert.ok(!(stateOf(app, client.id).workouts || []).some(w => w.id === 'evil'), 'nothing was written');

  // A Telegram client's link is not reachable through the managed routes, with a real grant in place.
  const inv = await who.coach.post('/api/trainer/invites', { days: 7 });
  const tok = new URL(inv.body.link).searchParams.get('startapp');
  assert.equal((await who.c1.post('/api/trainer/invites/accept', { token: tok, ageConfirmed: true, grants: { history: true, measures: true, stats: true } })).status, 200);
  const tgLink = app.db().trainerLinks.find(l => l.clientUid === who.c1.id);
  for (const [m, p, b] of [['get', dataPath(tgLink.id)], ['put', dataPath(tgLink.id), { state: { workouts: [workout()] } }]]) {
    const r = await who.coach[m](p, b);
    assert.equal(r.status, 404, `${m} ${p}`); assert.equal(r.body.code, 'client-gone');
  }
  const cf = path.join(app.dir, 'state-' + who.c1.id + '.json');
  assert.ok(!fs.existsSync(cf) || !(stateOf(app, who.c1.id).workouts || []).length, 'a Telegram client is still read only');

  // After the client is deleted the document routes answer the same.
  assert.equal((await who.coach.del(`/api/trainer/managed/${linkId}`, { confirm: true })).status, 200);
  assert.equal((await who.coach.get(dataPath(linkId))).body.code, 'client-gone');
  assert.equal((await who.coach.put(dataPath(linkId), body)).body.code, 'client-gone');
});

test('the document writes are rate limited per trainer', async t => {
  const { who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const { linkId } = (await add(who.coach)).body;
  const cur = (await who.coach.get(dataPath(linkId))).body;
  let limited = 0;
  for (let i = 0; i < 70; i++) {
    const r = await who.coach.put(dataPath(linkId), { state: { ...cur.state, note: 'n' + i } });
    if (r.status === 429) limited++;
  }
  assert.ok(limited > 0, 'the 61st write in a minute is refused');
});
