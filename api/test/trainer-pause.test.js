// Trainer mode (TG14): pause and archive of a client. The pure rules (pausedOn, isPaused, the reminder) are tested
// directly; the routes against a real server.js with Telegram sign-in on (the harness of trainer.test.js).
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
import {
  isPaused, pauseOf, pausedOn, pausedDays, checkPause, startPause, endPause, archiveLink, restoreLink, addDays, reminderDecision, PAUSES_KEEP,
} from '../trainer.js';

const API = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = '123456789:synthetic_telegram_test_token_not_a_secret';
const ORIGIN = 'https://gym.example.test';
const TG = { coach: 4_700_000_001, c1: 4_700_000_011, c2: 4_700_000_012, c3: 4_700_000_013, c4: 4_700_000_014, c5: 4_700_000_015, c6: 4_700_000_016, other: 4_700_000_002 };
const NAMES = { coach: 'Ирина', c1: 'Вася', c2: 'Петя', c3: 'Коля', c4: 'Саша', c5: 'Дима', c6: 'Лёша', other: 'Олег' };
const GRANTS = { history: true, measures: true, stats: true };
const TODAY = new Date().toISOString().slice(0, 10);   // the trainer's zone is set to UTC in these tests

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

async function start(t, existing) {
  const dir = existing || fs.mkdtempSync(path.join(os.tmpdir(), 'gym-pause-'));
  if (!existing) fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }));
  let tail = '';
  const childEnv = { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN, RP_ID: 'gym.example.test', TELEGRAM_BOT_TOKEN: TOKEN,
    INVITE_ONLY: '0', FIRST_USER_ADMIN: '0', PASSWORD_LOGIN: '0', COACH_DISABLED: '1', AUDIT_LOG: '1', ADMIN_UIDS: '' };
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

async function world(t, names = Object.keys(TG), existing) {
  const app = await start(t, existing);
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

const makeTrainer = async c => {
  assert.equal((await c.put('/api/trainer/me', { enabled: true, ageConfirmed: true })).status, 200);
};
async function telegramClient(coach, client) {
  const inv = await coach.post('/api/trainer/invites', {});
  assert.equal(inv.status, 200, inv.text);
  const r = await client.post('/api/trainer/invites/accept', { token: new URL(inv.body.link).searchParams.get('startapp'), ageConfirmed: true, grants: GRANTS });
  assert.equal(r.status, 200, r.text);
  return r.body.linkId;
}
async function managedClient(coach, name = 'Мама') {
  const r = await coach.post('/api/trainer/managed', { name, ageConfirmed: true });
  assert.equal(r.status, 200, r.text);
  return r.body.linkId;
}
const pause = (c, id, body) => c.put(`/api/trainer/links/${id}/pause`, body);
const archive = (c, id) => c.post(`/api/trainer/links/${id}/archive`, {});
const restore = (c, id) => c.post(`/api/trainer/links/${id}/restore`, {});
const list = async c => (await c.get('/api/trainer/clients')).body;
const setZone = (c, id) => c.put(`/api/trainer/links/${id}/schedule`, { days: [], tz: 'UTC' });   // the trainer's zone for the day counts

/** Stop the server, let `edit` change db.json, and start it again on the same data; the same people sign in again. */
async function restartWith(t, app, names, edit) {
  await app.stop();
  const file = path.join(app.dir, 'db.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(db);
  fs.writeFileSync(file, JSON.stringify(db));
  return world(t, names, app.dir);
}

// ---- the pure rules ----

test('a pause is over when its last day has passed; no end means it holds', () => {
  const link = { status: 'active', pause: { since: 'x', until: '2026-11-10' } };
  assert.equal(isPaused(link, '2026-11-09'), true);
  assert.equal(isPaused(link, '2026-11-10'), true, 'the last paused day is included');
  assert.equal(isPaused(link, '2026-11-11'), false);
  assert.equal(isPaused({ status: 'active', pause: { since: 'x', until: null } }, '2030-01-01'), true);
  assert.equal(isPaused({ status: 'active' }, '2026-11-09'), false);
  assert.equal(isPaused({ status: 'archived', pause: { since: 'x', until: null } }, '2026-11-09'), false, 'an archived link has no pause');
  assert.equal(isPaused(null, '2026-11-09'), false);
  assert.deepEqual(pauseOf(link, '2026-11-11'), null);
  assert.deepEqual(pauseOf({ status: 'active', pause: { since: 's', until: null, reason: 'Травма' } }, '2026-11-11'), { since: 's', until: null, reason: 'Травма' });
});

test('pausedOn and pausedDays answer from the history, days inclusive', () => {
  const link = { pauses: [{ from: '2026-10-05', to: '2026-10-11' }, { from: '2026-11-01', to: null }, { from: '2026-09-01', to: '2026-09-01', archived: true }] };
  assert.equal(pausedOn(link, '2026-10-04'), false);
  assert.equal(pausedOn(link, '2026-10-05'), true);
  assert.equal(pausedOn(link, '2026-10-11'), true);
  assert.equal(pausedOn(link, '2026-10-12'), false);
  assert.equal(pausedOn(link, '2026-09-01'), true, 'archived time counts');
  assert.equal(pausedOn(link, '2026-11-01'), true);
  assert.equal(pausedOn(link, '2099-01-01'), true, 'open: no end');
  assert.equal(pausedOn({}, '2026-10-05'), false);
  assert.equal(pausedOn(null, '2026-10-05'), false);
  assert.equal(pausedDays(link, '2026-10-01', '2026-10-31'), 7);
  assert.equal(pausedDays(link, '2026-10-08', '2026-11-03'), 4 + 3);
  assert.equal(pausedDays(link, '2026-10-31', '2026-10-01'), 0);
  assert.equal(pausedDays(link, 'bad', '2026-10-01'), 0);
});

test('start, change, end, archive and restore keep the history in step', () => {
  const link = { status: 'active' };
  startPause(link, { until: '2026-11-10', reason: 'Отпуск' }, '2026-11-03', '2026-11-03T08:00:00Z');
  assert.deepEqual(link.pause, { since: '2026-11-03T08:00:00Z', until: '2026-11-10', reason: 'Отпуск' });
  assert.deepEqual(link.pauses, [{ from: '2026-11-03', to: '2026-11-10' }]);
  // changing an ongoing pause moves its end, not its start
  startPause(link, { until: null, reason: '' }, '2026-11-05', 'later');
  assert.deepEqual(link.pause, { since: '2026-11-03T08:00:00Z', until: null });
  assert.deepEqual(link.pauses, [{ from: '2026-11-03', to: null }]);
  // taking it off on the 6th: the 5th was the last paused day
  endPause(link, '2026-11-06');
  assert.equal(link.pause, undefined);
  assert.deepEqual(link.pauses, [{ from: '2026-11-03', to: '2026-11-05' }]);
  // paused and resumed the same day: it never was
  startPause(link, { until: null, reason: '' }, '2026-11-07', 'x');
  endPause(link, '2026-11-07');
  assert.deepEqual(link.pauses, [{ from: '2026-11-03', to: '2026-11-05' }]);
  // a pause that ran out on its own is not touched by the end of it, and a new one starts after it
  startPause(link, { until: '2026-11-08', reason: '' }, '2026-11-07', 'x');
  assert.equal(isPaused(link, '2026-11-09'), false);
  startPause(link, { until: null, reason: '' }, '2026-11-09', 'y');
  assert.deepEqual(link.pauses.slice(-2), [{ from: '2026-11-07', to: '2026-11-08' }, { from: '2026-11-09', to: null }]);
  // archive: the pause is lifted, the archived time is in the history, restore closes it the day before
  archiveLink(link, '2026-11-12', 'z');
  assert.equal(link.status, 'archived'); assert.equal(link.pause, undefined); assert.equal(link.archivedAt, 'z');
  assert.deepEqual(link.pauses.slice(-2), [{ from: '2026-11-09', to: '2026-11-11' }, { from: '2026-11-12', to: null, archived: true }]);
  assert.equal(pausedOn(link, '2026-11-20'), true);
  restoreLink(link, '2026-11-15');
  assert.equal(link.status, 'active'); assert.equal(link.archivedAt, undefined);
  assert.deepEqual(link.pauses.slice(-1), [{ from: '2026-11-12', to: '2026-11-14', archived: true }]);
  assert.equal(pausedOn(link, '2026-11-14'), true); assert.equal(pausedOn(link, '2026-11-15'), false);
  // archived and restored the same day
  archiveLink(link, '2026-11-16', 'z'); restoreLink(link, '2026-11-16');
  assert.deepEqual(link.pauses.slice(-1), [{ from: '2026-11-12', to: '2026-11-14', archived: true }]);
});

test('the history keeps the last fifty periods', () => {
  const link = { status: 'active' };
  for (let i = 0; i < PAUSES_KEEP + 10; i++) {
    const day = addDays('2026-01-01', i * 3);
    startPause(link, { until: day, reason: '' }, day, 'x');
  }
  assert.equal(link.pauses.length, PAUSES_KEEP);
  assert.equal(link.pauses[PAUSES_KEEP - 1].from, addDays('2026-01-01', (PAUSES_KEEP + 9) * 3));
});

test('the body of a pause: a real day from today to a year, an optional reason', () => {
  const ok = (b) => checkPause(b, '2026-11-03');
  assert.deepEqual(ok({ until: null }), { until: null, reason: '' });
  assert.deepEqual(ok({ until: '2026-11-03' }), { until: '2026-11-03', reason: '' });
  assert.deepEqual(ok({ until: '2027-11-03', reason: '  Отпуск ' }), { until: '2027-11-03', reason: 'Отпуск' });
  assert.equal(ok({ until: '2026-11-02' }).error, 'until-past');
  assert.equal(ok({ until: '2027-11-04' }).error, 'until-far');
  assert.equal(ok({ until: '2026-02-30' }).error, 'until-invalid');
  assert.equal(ok({ until: 'soon' }).error, 'until-invalid');
  assert.equal(ok({ until: 5 }).error, 'until-invalid');
  assert.equal(ok({}).error, 'bad-request', 'no end must be asked for with null');
  assert.equal(ok(null).error, 'bad-request');
  assert.equal(ok({ until: null, reason: 5 }).error, 'bad-request');
  assert.equal(ok({ until: null, reason: 'я'.repeat(200) }).reason.length, 80);
});

test('no reminder on pause; the day after the pause it goes again', () => {
  const link = (extra = {}) => ({ status: 'active', schedule: { days: [1], time: '', remind: true }, ...extra });
  const at = (date) => ({ weekday: 1, hhmm: '09:00', date });
  assert.equal(reminderDecision(link(), at('2026-11-02')), 'send');
  assert.equal(reminderDecision(link({ pause: { since: 'x', until: '2026-11-09' } }), at('2026-11-02')), null);
  assert.equal(reminderDecision(link({ pause: { since: 'x', until: '2026-11-09' } }), at('2026-11-09')), null);
  assert.equal(reminderDecision(link({ pause: { since: 'x', until: '2026-11-01' } }), at('2026-11-02')), 'send', 'an old pause is over');
  assert.equal(reminderDecision(link({ pause: { since: 'x', until: null } }), at('2026-11-02')), null);
});

// ---- the routes ----

test('pause: set, shown in the list, changed, lifted; the place stays, the access stays; only the trainer of an active link', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'other']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const l1 = await telegramClient(who.coach, who.c1);
  await setZone(who.coach, l1);

  const until = addDays(TODAY, 14);
  const set = await pause(who.coach, l1, { until, reason: 'Отпуск' });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.body.pause.until, until); assert.equal(set.body.pause.reason, 'Отпуск');
  let row = (await list(who.coach)).clients.find(c => c.linkId === l1);
  assert.equal(row.pause.until, until);
  assert.deepEqual(app.db().trainerLinks.find(l => l.id === l1).pauses, [{ from: TODAY, to: until }]);
  // the access is not touched, and the client sees the pause
  assert.equal((await who.coach.get(`/api/trainer/clients/${l1}/data`)).status, 200);
  assert.equal((await who.coach.get(`/api/trainer/clients/${l1}/doc`)).status, 200);
  const asClient = (await who.c1.get('/api/trainer/me')).body.asClient;
  assert.equal(asClient.status, 'active'); assert.deepEqual(asClient.pause, { until }, 'the reason is a note of the trainer, not shown to the client');
  // changing the end
  assert.equal((await pause(who.coach, l1, { until: null })).body.pause.until, null);
  assert.equal(app.db().trainerLinks.find(l => l.id === l1).pauses.length, 1);
  // refused
  for (const bad of [{}, { until: addDays(TODAY, -1) }, { until: addDays(TODAY, 366) }, { until: 'x' }]) {
    assert.equal((await pause(who.coach, l1, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await pause(who.coach, l1, { until: addDays(TODAY, 365) })).status, 200, 'a year is allowed');
  // not another trainer's, not the client's own, not an unknown link
  assert.equal((await pause(who.other, l1, { until: null })).body.code, 'link-gone');
  assert.equal((await pause(who.c1, l1, { until: null })).status, 403);
  assert.equal((await pause(who.coach, 'nope-nope-1', { until: null })).status, 404);
  assert.equal((await who.other.del(`/api/trainer/links/${l1}/pause`)).status, 404);
  // lifted
  const off = await who.coach.del(`/api/trainer/links/${l1}/pause`);
  assert.equal(off.status, 200); assert.equal(off.body.pause, null);
  row = (await list(who.coach)).clients.find(c => c.linkId === l1);
  assert.equal(row.pause, null);
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient.pause, undefined);
  assert.equal(app.db().trainerLinks.find(l => l.id === l1).pause, undefined);
  // lifting a pause that is not there is not an error
  assert.equal((await who.coach.del(`/api/trainer/links/${l1}/pause`)).status, 200);
});

test('a pause that ran out is over without any timer: the list and the client no longer show it', async t => {
  const first = await world(t, ['coach', 'c1']);
  await makeTrainer(first.who.coach);
  const l1 = await telegramClient(first.who.coach, first.who.c1);
  await setZone(first.who.coach, l1);
  assert.equal((await pause(first.who.coach, l1, { until: TODAY })).status, 200);
  assert.ok((await list(first.who.coach)).clients[0].pause, 'the last day still holds');
  // the data says the pause ended yesterday (the pause is read lazily, nothing else changed)
  const { who } = await restartWith(t, first.app, ['coach', 'c1'], db => {
    const link = db.trainerLinks[0];
    link.pause.until = addDays(TODAY, -1); link.pauses[0].to = addDays(TODAY, -1);
  });
  assert.equal((await list(who.coach)).clients[0].pause, null);
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient.pause, undefined);
  // a new pause starts a new period after the old one
  assert.equal((await pause(who.coach, l1, { until: null })).status, 200);
  const link = first.app.db().trainerLinks[0];
  assert.deepEqual(link.pauses, [{ from: TODAY, to: addDays(TODAY, -1) }, { from: TODAY, to: null }]);
});

test('archive frees the place, closes the trainer\'s access, and keeps the client tied to the trainer', async t => {
  const { app, who } = await world(t);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const ids = {};
  for (const n of ['c1', 'c2', 'c3', 'c4', 'c5']) ids[n] = await telegramClient(who.coach, who[n]);
  await setZone(who.coach, ids.c1);
  assert.equal((await who.coach.post('/api/trainer/invites', {})).body.code, 'client-limit', 'full');
  assert.equal((await pause(who.coach, ids.c1, { until: null })).status, 200);

  const a = await archive(who.coach, ids.c1);
  assert.equal(a.status, 200, a.text);
  const link = app.db().trainerLinks.find(l => l.id === ids.c1);
  assert.equal(link.status, 'archived'); assert.ok(link.archivedAt); assert.equal(link.pause, undefined, 'the pause is lifted');
  // the list: four active, one archived without data; the place is free
  const l = await list(who.coach);
  assert.equal(l.clients.length, 4);
  assert.deepEqual(l.archived.map(x => Object.keys(x).sort()), [['archivedAt', 'linkId', 'managed', 'name']]);
  assert.equal(l.archived[0].name, 'Вася'); assert.equal(l.archived[0].managed, false);
  const me = (await who.coach.get('/api/trainer/me')).body.trainer;
  assert.equal(me.clients, 4); assert.equal(me.archived, 1);
  assert.equal((await who.coach.post('/api/trainer/invites', {})).status, 200, 'the place is free');
  // the trainer's access is closed, on every route that reads a client
  for (const route of [`/data`, `/doc`, `/doc/rev`]) {
    const r = await who.coach.get(`/api/trainer/clients/${ids.c1}${route}`);
    assert.equal(r.status, 404, route); assert.equal(r.body.code, 'client-gone', route);
  }
  assert.equal((await who.coach.get(`/api/trainer/managed/${ids.c1}`)).status, 404);
  assert.equal((await who.coach.put(`/api/trainer/links/${ids.c1}/schedule`, { days: [1] })).status, 404, 'no schedule for an archived client');
  assert.equal((await pause(who.coach, ids.c1, { until: null })).status, 404, 'no pause for an archived client');
  assert.equal((await archive(who.coach, ids.c1)).status, 404, 'archived twice');
  // not another trainer's
  assert.equal((await archive(who.other, ids.c2)).body.code, 'link-gone');
  assert.equal((await restore(who.other, ids.c1)).body.code, 'link-gone');
  assert.equal((await archive(who.c2, ids.c2)).status, 403, 'the client cannot archive');
  // the client still has the link: it shows as archived, and no other trainer can take them
  const asClient = (await who.c1.get('/api/trainer/me')).body.asClient;
  assert.equal(asClient.status, 'archived'); assert.equal(asClient.coachName, 'Ирина'); assert.equal(asClient.pause, undefined);
  const inv = await who.other.post('/api/trainer/invites', {});
  const token = new URL(inv.body.link).searchParams.get('startapp');
  const preview = await who.c1.get('/api/trainer/invites/preview?t=' + token);
  assert.equal(preview.status, 409); assert.equal(preview.body.code, 'has-trainer');
  assert.equal((await who.c1.post('/api/trainer/invites/accept', { token, ageConfirmed: true, grants: GRANTS })).body.code, 'has-trainer');
  // the client ends it, and is free
  assert.equal((await who.c1.del(`/api/trainer/links/${ids.c1}`)).status, 200);
  assert.equal(app.db().trainerLinks.find(l => l.id === ids.c1).status, 'revoked');
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient, null);
  assert.equal((await who.c1.post('/api/trainer/invites/accept', { token, ageConfirmed: true, grants: GRANTS })).status, 200);
  // and the trainer can no longer bring that one back
  assert.equal((await restore(who.coach, ids.c1)).status, 404);
});

test('restore needs a free place: 409 client-limit with the usual text; then it works, and the history shows the gap', async t => {
  const { app, who } = await world(t);
  await makeTrainer(who.coach);
  const ids = {};
  for (const n of ['c1', 'c2', 'c3', 'c4', 'c5']) ids[n] = await telegramClient(who.coach, who[n]);
  await setZone(who.coach, ids.c1);
  assert.equal((await archive(who.coach, ids.c1)).status, 200);
  const six = await telegramClient(who.coach, who.c6);   // takes the freed place
  const r = await restore(who.coach, ids.c1);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'client-limit');
  assert.equal(r.body.error, 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше');
  assert.equal(app.db().trainerLinks.find(l => l.id === ids.c1).status, 'archived', 'nothing changed');
  // a place frees up again
  assert.equal((await who.coach.del(`/api/trainer/links/${six}`)).status, 200);
  assert.equal((await restore(who.coach, ids.c1)).status, 200);
  const link = app.db().trainerLinks.find(l => l.id === ids.c1);
  assert.equal(link.status, 'active'); assert.equal(link.archivedAt, undefined);
  assert.equal((await who.coach.get(`/api/trainer/clients/${ids.c1}/data`)).status, 200, 'the access is back');
  assert.equal((await list(who.coach)).archived.length, 0);
  // archived and restored on the same day leaves no gap in the history
  assert.equal(link.pauses.length, 0);
});

test('an archived client without Telegram: the diary is closed, the export and the delete stay', async t => {
  const { app, who } = await world(t, ['coach', 'other']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const id = await managedClient(who.coach);
  await setZone(who.coach, id);
  const client = app.db().users.find(u => u.managedBy === who.coach.id);
  assert.equal((await archive(who.coach, id)).status, 200);
  const row = (await list(who.coach)).archived[0];
  assert.equal(row.managed, true); assert.equal(row.linkId, id);
  for (const r of [await who.coach.get(`/api/trainer/managed/${id}`), await who.coach.get(`/api/trainer/managed/${id}/data`), await who.coach.get(`/api/trainer/managed/${id}/data/rev`),
    await who.coach.post(`/api/trainer/managed/${id}/ops`, { ops: [{ op: 'bodyweight.set', d: TODAY, w: 70 }] }),
    await who.coach.put(`/api/trainer/managed/${id}/data`, { state: {} })]) {
    assert.equal(r.status, 404); assert.equal(r.body.code, 'client-gone');
  }
  // the export is still the trainer's, and nobody else's
  const ex = await who.coach.get(`/api/trainer/managed/${id}/export`);
  assert.equal(ex.status, 200, ex.text); assert.equal(ex.body.kind, 'managed-client-export');
  assert.equal((await who.other.get(`/api/trainer/managed/${id}/export`)).status, 404);
  assert.equal((await who.other.del(`/api/trainer/managed/${id}`, { confirm: true })).status, 404);
  // the telegram way of ending a link does not touch it
  assert.equal((await who.coach.del(`/api/trainer/links/${id}`)).body.code, 'managed-link');
  // the role cannot be turned off while it is in the archive
  const off = await who.coach.put('/api/trainer/me', { enabled: false });
  assert.equal(off.status, 409); assert.equal(off.body.code, 'has-clients');
  assert.equal(app.db().users.find(u => u.id === who.coach.id).trainer.enabled, true);
  // restore, archive again, delete from the archive
  assert.equal((await restore(who.coach, id)).status, 200);
  assert.equal((await who.coach.get(`/api/trainer/managed/${id}`)).status, 200);
  assert.equal((await archive(who.coach, id)).status, 200);
  assert.equal((await who.coach.del(`/api/trainer/managed/${id}`, {})).body.code, 'confirm-required');
  assert.equal((await who.coach.del(`/api/trainer/managed/${id}`, { confirm: true })).status, 200);
  assert.ok(!app.db().users.find(u => u.id === client.id));
  assert.equal(app.db().trainerLinks.length, 0);
  assert.equal((await list(who.coach)).archived.length, 0);
});

test('turning the trainer role off ends the archived Telegram clients', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  const l2 = await telegramClient(who.coach, who.c2);
  assert.equal((await archive(who.coach, l1)).status, 200);
  // an active client still blocks, as before
  assert.equal((await who.coach.put('/api/trainer/me', { enabled: false })).body.code, 'has-clients');
  assert.equal((await who.coach.del(`/api/trainer/links/${l2}`)).status, 200);
  const off = await who.coach.put('/api/trainer/me', { enabled: false });
  assert.equal(off.status, 200, off.text);
  const link = app.db().trainerLinks.find(l => l.id === l1);
  assert.equal(link.status, 'revoked'); assert.equal(link.revokedBy, 'coach'); assert.equal(link.archivedAt, undefined);
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient, null, 'the client is free');
});

test('the archive has a ceiling', async t => {
  const first = await world(t, ['coach', 'c1']);
  await makeTrainer(first.who.coach);
  const l1 = await telegramClient(first.who.coach, first.who.c1);
  const { app, who } = await restartWith(t, first.app, ['coach', 'c1'], db => {
    for (let i = 0; i < 50; i++) db.trainerLinks.push({ id: 'filler-' + i + '-xx', coachUid: db.users.find(u => u.telegramId).id, clientUid: 'gone-' + i, status: 'archived', managed: true, grants: {} });
  });
  const over = await archive(who.coach, l1);
  assert.equal(over.status, 409); assert.equal(over.body.code, 'archive-limit');
  assert.equal(app.db().trainerLinks.find(l => l.id === l1).status, 'active');
  // one place in the archive frees up
  assert.equal((await who.coach.del('/api/trainer/links/filler-0-xx')).status, 409, 'a managed link is deleted through its diary only');
});

test('the audit log has the pause and archive events', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  await setZone(who.coach, l1);
  await pause(who.coach, l1, { until: null, reason: 'Травма колена' });
  await who.coach.del(`/api/trainer/links/${l1}/pause`);
  await archive(who.coach, l1);
  await restore(who.coach, l1);
  const log = fs.readdirSync(app.dir).filter(f => /audit/.test(f)).map(f => fs.readFileSync(path.join(app.dir, f), 'utf8')).join('\n');
  for (const ev of ['trainer.link.pause', 'trainer.link.resume', 'trainer.link.archive', 'trainer.link.restore']) assert.ok(log.includes(ev), ev);
  assert.ok(!log.includes('Травма колена'), 'the reason is not logged');
});
