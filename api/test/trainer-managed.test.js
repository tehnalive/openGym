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
import { applyOps, applyCoachMarks, checkCreate, managedView, managedExport, hasDiary } from '../trainer-managed.js';

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
  assert.equal(saved.via, 'coach'); assert.equal(saved.by, who.coach.id, 'the mark is the server, not the one sent');
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
    ['bodyweight', 'customEx', 'customMeasurements', 'measurementEnabled', 'measurements', 'routines', 'unit', 'weekStart', 'workouts']);
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
  // The server marked the new workout, so it is one revision further than the answer said: the app reads it again.
  assert.equal((await who.coach.get(dataPath(linkId) + '/rev')).body.rev, rev0 + 2);

  // A stale baseRev is a conflict that carries the current document.
  const stale = await who.coach.put(dataPath(linkId), { state: doc, baseRev: rev0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.rev, rev0 + 2);
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

// ---- the mark «written by the trainer» (section 16) ----
test('applyCoachMarks: the trainer\'s new and changed workouts are marked, a person\'s own write cannot add one, stored marks stay', () => {
  const stored = { workouts: [{ id: 'a', d: '2026-01-01', name: 'A', _ts: 1, via: 'coach', by: 'T' }, { id: 'b', d: '2026-01-02', name: 'B', _ts: 1 }] };
  const send = () => ({ workouts: [{ id: 'a', d: '2026-01-01', name: 'A' }, { id: 'b', d: '2026-01-02', name: 'B', via: 'coach', by: 'forged' }, { id: 'c', d: '2026-01-03', name: 'C' }] });
  // Trainer: the new one is marked, the unchanged one gets nothing it did not have, a stored mark comes back.
  const t = applyCoachMarks(stored, send(), { coachUid: 'T2' });
  assert.deepEqual(t.workouts.map(w => [w.via, w.by]), [['coach', 'T'], [undefined, undefined], ['coach', 'T2']]);
  const edited = send(); edited.workouts[1] = { id: 'b', d: '2026-01-02', name: 'B changed', _ts: 9 };
  assert.equal(applyCoachMarks(stored, edited, { coachUid: 'T2' }).workouts[1].via, 'coach');
  // The person: nothing can be added to a workout the stored copy holds or to a new one without a mark; a stored mark stays.
  const o = applyCoachMarks(stored, send(), {});
  assert.deepEqual(o.workouts.map(w => [w.via, w.by]), [['coach', 'T'], [undefined, undefined], [undefined, undefined]]);
  // A copy exported from the trainer's diary and imported keeps the mark on workouts the profile does not hold yet.
  const imp = applyCoachMarks({ workouts: [] }, { workouts: [{ id: 'z', d: '2026-01-01', via: 'coach' }, { id: 'y', d: '2026-01-01', via: 'client', by: 'x' }] }, {});
  assert.deepEqual(imp.workouts.map(w => [w.via, w.by]), [['coach', undefined], [undefined, undefined]]);
  // A stamping writer gets the new mark stamped like its own edit.
  const st = applyCoachMarks(stored, { workouts: [{ id: 'b', d: '2026-01-02', name: 'B2', _ts: 50, _f: { name: 50 } }] }, { coachUid: 'T', stamped: true, now: 10 });
  assert.deepEqual(st.workouts[0]._f, { name: 50, via: 50, by: 50 });
  assert.deepEqual(applyCoachMarks({}, { unit: 'kg' }, { coachUid: 'T' }), { unit: 'kg' });
});

test('the managed document PUT marks what the trainer wrote; repeated pushes keep it without conflicts; the client cannot forge it', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const { linkId } = (await add(who.coach)).body;
  const client = app.db().users.find(u => u.managedBy === who.coach.id);
  const first = await who.coach.get(dataPath(linkId));
  const w1 = workout({ _ts: Date.now(), via: 'forged', by: 'forged' });
  const p1 = await who.coach.put(dataPath(linkId), { state: { ...first.body.state, workouts: [w1] }, baseRev: first.body.rev, stamped: true });
  assert.equal(p1.status, 200, p1.text);
  const s1 = stateOf(app, client.id);
  assert.equal(s1.workouts[0].via, 'coach'); assert.equal(s1.workouts[0].by, who.coach.id);

  // The app pulls and pushes the same workout again, without the mark: no change, same mark, no 409.
  const second = await who.coach.get(dataPath(linkId));
  assert.equal(second.body.state.workouts[0].via, 'coach', 'the trainer sees the mark');
  assert.ok(!('by' in second.body.state.workouts[0]), 'the profile id stays on the server');
  const bare = { ...second.body.state, workouts: [{ ...second.body.state.workouts[0] }] };
  delete bare.workouts[0].via; delete bare.workouts[0].by;
  const p2 = await who.coach.put(dataPath(linkId), { state: bare, baseRev: second.body.rev, baseWid: second.body.state._wid, stamped: true });
  assert.equal(p2.status, 200, p2.text);
  assert.equal(stateOf(app, client.id).workouts[0].via, 'coach');
  const third = await who.coach.get(dataPath(linkId));
  const p3 = await who.coach.put(dataPath(linkId), { state: third.body.state, baseRev: third.body.rev, baseWid: third.body.state._wid, stamped: true });
  assert.equal(p3.status, 200, 'an unchanged document is not a conflict');
  assert.deepEqual(stateOf(app, client.id).workouts[0], s1.workouts[0], 'the workout is what it was');

  // An unchanged workout next to a new one: the new one is marked too.
  const fourth = await who.coach.get(dataPath(linkId));
  const doc = fourth.body.state;
  doc.workouts = [doc.workouts[0], workout({ id: 'w2', name: 'Спина' })];
  const p4 = await who.coach.put(dataPath(linkId), { state: doc, baseRev: fourth.body.rev, stamped: true });
  assert.equal(p4.status, 200, p4.text);
  assert.deepEqual(stateOf(app, client.id).workouts.map(w => w.via), ['coach', 'coach']);
});

test('PUT /api/data cannot add the mark to a workout, and keeps one that is stored', async t => {
  const { app, who } = await world(t, ['c1']);
  const c = who.c1;
  const doc = { unit: 'kg', routines: [], bodyweight: [], measurements: [], customEx: [], workouts: [workout({ id: 'own', via: 'coach', by: 'x' }), workout({ id: 'own2' })] };
  // A new workout arriving with the mark is an import of a copy; the unmarked one is not made a trainer's.
  const p1 = await c.put('/api/data', { state: doc });
  assert.equal(p1.status, 200, p1.text);
  let s = stateOf(app, c.id);
  assert.deepEqual(s.workouts.map(w => [w.id, w.via]), [['own', 'coach'], ['own2', undefined]]);
  // Adding the mark to the stored unmarked one is cut; leaving it out of the marked one does not remove it.
  const get = await c.get('/api/data');
  const next = get.body.state;
  next.workouts = [{ ...next.workouts[0] }, { ...next.workouts[1], via: 'coach' }];
  delete next.workouts[0].via;
  const p2 = await c.put('/api/data', { state: next, baseRev: get.body.rev });
  assert.equal(p2.status, 200, p2.text);
  s = stateOf(app, c.id);
  assert.deepEqual(s.workouts.map(w => [w.id, w.via]), [['own', 'coach'], ['own2', undefined]]);
  const get2 = await c.get('/api/data');
  assert.equal((await c.put('/api/data', { state: get2.body.state, baseRev: get2.body.rev })).status, 200, 'no false conflict');
});

test('the export keeps the mark (and not the trainer\'s id), so an imported copy still shows who wrote it', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const id = (await add(who.coach)).body.linkId;
  await ops(who.coach, id, [{ op: 'workout.save', workout: workout() }]);
  const ex = await who.coach.get(`/api/trainer/managed/${id}/export`);
  assert.equal(ex.body.data.workouts[0].via, 'coach');
  assert.ok(!ex.text.includes(who.coach.id), 'no profile ids in the export');
  assert.equal(managedExport('x', { workouts: [{ id: 1, via: 'coach', by: 'u' }] }).data.workouts[0].by, undefined);
  assert.equal(managedView({ workouts: [{ id: 1, via: 'coach' }] }).workouts[0].via, 'coach');
});

test('the export carries the routines of the diary, without bookkeeping, media or the trainer id', () => {
  const S = { routines: [{ id: 'r1', name: 'Ноги', ex: [{ id: 'squat', sets: 3 }], _ts: 5, _f: { name: 5 }, _u: 'x', by: 'coach-uid', photo: 'p.jpg' }, 'junk', null], workouts: [] };
  const out = managedExport('x', S).data;
  assert.equal(out.routines.length, 1);
  assert.deepEqual(out.routines[0], { id: 'r1', name: 'Ноги', ex: [{ id: 'squat', sets: 3 }], _ts: 5 });
  assert.ok(!JSON.stringify(out).includes('coach-uid'));
  assert.deepEqual(managedExport('x', {}).data.routines, []);
});

// ---- the mark: review fixes ----
const seed = (app, uid, patch) => {
  const f = path.join(app.dir, `state-${uid}.json`);
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), ...patch }));
};
const managedWorld = async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const { linkId } = (await add(who.coach)).body;
  return { app, who, linkId, uid: app.db().users.find(u => u.managedBy === who.coach.id).id };
};

test('the mark moves the revision one further than the push answered, so the app reads the document again; nothing moves when there is no mark to set', async t => {
  const { app, who, linkId, uid } = await managedWorld(t);
  const first = await who.coach.get(dataPath(linkId));
  const put = await who.coach.put(dataPath(linkId), { state: { ...first.body.state, workouts: [workout({ _ts: 5 })] }, baseRev: first.body.rev, stamped: true });
  assert.equal(put.status, 200, put.text);
  const rev = (await who.coach.get(dataPath(linkId) + '/rev')).body.rev;
  assert.equal(rev, put.body.rev + 1, 'the app sees a different revision and pulls');
  const read = await who.coach.get(dataPath(linkId));
  assert.equal(read.body.state.workouts[0].via, 'coach');
  // The pulled document pushed back: nothing to set, the answer is the revision stored.
  const again = await who.coach.put(dataPath(linkId), { state: read.body.state, baseRev: read.body.rev, baseWid: read.body.state._wid, stamped: true });
  assert.equal((await who.coach.get(dataPath(linkId) + '/rev')).body.rev, again.body.rev);
  assert.equal(stateOf(app, uid).workouts[0].via, 'coach');
});

test('a conflict on the document PUT carries no profile id and no personal keys', async t => {
  const { app, who, linkId, uid } = await managedWorld(t);
  const first = await who.coach.get(dataPath(linkId));
  await who.coach.put(dataPath(linkId), { state: { ...first.body.state, workouts: [workout()] }, baseRev: first.body.rev });
  seed(app, uid, { dayPhotos: { [TODAY]: 'abc' }, coach: { memory: 'x' } });
  const stale = await who.coach.put(dataPath(linkId), { state: first.body.state, baseRev: first.body.rev });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.state.workouts[0].via, 'coach');
  assert.ok(!stale.text.includes(who.coach.id) && !('dayPhotos' in stale.body.state) && !('coach' in stale.body.state), stale.text);
});

test('ops on a workout the diary already held, unmarked: a changed one is marked, an unchanged one is not', async t => {
  const { app, who, linkId, uid } = await managedWorld(t);
  const own = { id: 'w1', d: TODAY, start: 1, end: 2, name: 'Своя', entries: [{ id: 'squat', sets: [{ w: 60, r: 8, done: true }] }], _ts: 3 };
  seed(app, uid, { workouts: [own] });
  assert.equal((await ops(who.coach, linkId, [{ op: 'workout.save', workout: { ...own } }])).status, 200);
  assert.equal(stateOf(app, uid).workouts[0].via, undefined, 'saved as it was: still the person\'s');
  assert.equal((await ops(who.coach, linkId, [{ op: 'workout.save', workout: { ...own, name: 'Поправил тренер' } }])).status, 200);
  const w = stateOf(app, uid).workouts[0];
  assert.equal(w.via, 'coach'); assert.equal(w.by, who.coach.id);
});

for (const stamped of [false, true]) {
  test(`the trainer's edit of an unmarked workout, pushed ${stamped ? 'stamped' : 'unstamped'}: marked, stamped per field, not undone`, async t => {
    const { app, who, linkId, uid } = await managedWorld(t);
    const own = { id: 'w1', d: TODAY, start: 1, end: 2, name: 'Своя', entries: [{ id: 'squat', sets: [{ w: 60, r: 8, done: true }] }], _ts: 3, _f: { name: 3 } };
    seed(app, uid, { workouts: [own] });
    const cur = await who.coach.get(dataPath(linkId));
    const edited = { ...cur.body.state.workouts[0], name: 'Поправил тренер', ...(stamped ? { _ts: Date.now(), _f: { name: Date.now() } } : {}) };
    const put = await who.coach.put(dataPath(linkId), { state: { ...cur.body.state, workouts: [edited] }, baseRev: cur.body.rev, baseWid: cur.body.state._wid, stamped });
    assert.equal(put.status, 200, put.text);
    const w = stateOf(app, uid).workouts[0];
    assert.equal(w.name, 'Поправил тренер'); assert.equal(w.via, 'coach'); assert.equal(w.by, who.coach.id);
    assert.ok(w._f.via > 0 && w._f.by > 0, JSON.stringify(w._f));
    assert.equal(w._f.via, w._f.by);
  });
}

test('a workout without an id follows the same rule, by its day and start', async t => {
  const { app, who, linkId, uid } = await managedWorld(t);
  const noId = { d: TODAY, start: 77, end: 99, name: 'Старая', entries: [{ id: 'squat', sets: [{ w: 1, r: 1, done: true }] }] };
  seed(app, uid, { workouts: [noId] });
  const cur = await who.coach.get(dataPath(linkId));
  const forged = { ...cur.body.state.workouts[0], via: 'coach' };
  // Nobody can add the mark to the stored, unmarked one, not even the trainer, who did not change it.
  await who.coach.put(dataPath(linkId), { state: { ...cur.body.state, workouts: [forged] }, baseRev: cur.body.rev });
  assert.equal(stateOf(app, uid).workouts[0].via, undefined);
  // A changed one, or a new one, is the trainer's.
  const cur2 = await who.coach.get(dataPath(linkId));
  const next = [{ ...cur2.body.state.workouts[0], name: 'Новая' }, { d: TODAY, start: 5, name: 'Ещё', entries: [] }];
  await who.coach.put(dataPath(linkId), { state: { ...cur2.body.state, workouts: next }, baseRev: cur2.body.rev });
  assert.deepEqual(stateOf(app, uid).workouts.map(w => w.via), ['coach', 'coach']);
});

test('PUT /api/data: a new workout arriving with the mark keeps `via` only, and a stored unmarked one without an id cannot get it', async t => {
  const { app, who } = await world(t, ['c1']);
  const c = who.c1;
  const noId = { d: TODAY, start: 5, name: 'Без номера', entries: [] };
  assert.equal((await c.put('/api/data', { state: { unit: 'kg', routines: [], workouts: [workout({ id: 'n1', via: 'coach', by: 'x' }), noId] } })).status, 200);
  let s = stateOf(app, c.id);
  assert.equal(s.workouts[0].via, 'coach'); assert.ok(!('by' in s.workouts[0]));
  const get = await c.get('/api/data');
  const ws = get.body.state.workouts.map(w => (w.id ? w : { ...w, via: 'coach' }));
  assert.equal((await c.put('/api/data', { state: { ...get.body.state, workouts: ws }, baseRev: get.body.rev })).status, 200);
  s = stateOf(app, c.id);
  assert.equal(s.workouts.find(w => !w.id).via, undefined);
});
