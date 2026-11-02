// Trainer mode (TG14): the plan compliance on the trainer's routes. The formula is in trainer-compliance.test.js; here:
// who gets it (the history opened, a managed client, no other trainer), where it appears, and that the numbers follow
// the schedule and the pause the routes already keep. A real server.js with Telegram sign-in on (the harness of
// trainer-pause.test.js).
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
import { addDays } from '../trainer.js';

const API = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = '123456789:synthetic_telegram_test_token_not_a_secret';
const ORIGIN = 'https://gym.example.test';
const TG = { coach: 4_800_000_001, c1: 4_800_000_011, c2: 4_800_000_012, other: 4_800_000_002 };
const NAMES = { coach: 'Ирина', c1: 'Вася', c2: 'Петя', other: 'Олег' };
const ALL = { history: true, measures: true, stats: true };
const TODAY = new Date().toISOString().slice(0, 10);   // the trainer's zone is UTC in these tests
const EVERY = [1, 2, 3, 4, 5, 6, 7];

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
  const dir = existing || fs.mkdtempSync(path.join(os.tmpdir(), 'gym-compl-'));
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

async function world(t, names, existing) {
  const app = await start(t, existing);
  const who = {};
  for (const n of names) {
    const r = await app.call('/api/telegram/login', { method: 'POST', body: { initData: initData(TG[n], NAMES[n]) } });
    assert.equal(r.status, 200, n);
    const cookie = r.cookie;
    who[n] = { id: r.body.user.id, get: p => app.call(p, { cookie }), post: (p, body) => app.call(p, { method: 'POST', body, cookie }),
      put: (p, body) => app.call(p, { method: 'PUT', body, cookie }), del: (p, body) => app.call(p, { method: 'DELETE', body, cookie }) };
  }
  return { app, who };
}

/** Stop the server, let `edit` change db.json, start it again on the same data; the same people sign in again. */
async function restartWith(t, app, names, edit) {
  await app.stop();
  const file = path.join(app.dir, 'db.json');
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(db);
  fs.writeFileSync(file, JSON.stringify(db));
  return world(t, names, app.dir);
}

const makeTrainer = async c => assert.equal((await c.put('/api/trainer/me', { enabled: true, ageConfirmed: true })).status, 200);
async function telegramClient(coach, client, grants = ALL) {
  const inv = await coach.post('/api/trainer/invites', {});
  const r = await client.post('/api/trainer/invites/accept', { token: new URL(inv.body.link).searchParams.get('startapp'), ageConfirmed: true, grants });
  assert.equal(r.status, 200, r.text);
  return r.body.linkId;
}
const writeState = (app, uid, workouts) => fs.writeFileSync(path.join(app.dir, `state-${uid}.json`),
  JSON.stringify({ unit: 'kg', _rev: 1, workouts: workouts.map((d, i) => ({ id: 'w' + i, d, entries: [] })) }));
const lastDays = (n, from = TODAY) => Array.from({ length: n }, (_, i) => addDays(from, -1 - i));   // the n days ending yesterday
const setSchedule = (c, id, days) => c.put(`/api/trainer/links/${id}/schedule`, { days, tz: 'UTC' });
const row = async (c, id) => (await c.get('/api/trainer/clients')).body.clients.find(x => x.linkId === id);
const old = db => { for (const l of db.trainerLinks) l.createdAt = '2026-01-01T10:00:00.000Z'; };   // links that began long ago

test('the client list: compliance for a client with the history open, null (and nothing else) without it', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  const l2 = await telegramClient(who.coach, who.c2, { history: false, measures: true, stats: false });
  writeState(app, who.c1.id, lastDays(3)); writeState(app, who.c2.id, lastDays(3));
  for (const id of [l1, l2]) assert.equal((await setSchedule(who.coach, id, EVERY)).status, 200);
  const w2 = await restartWith(t, app, ['coach', 'c1', 'c2'], old);

  const a = await row(w2.who.coach, l1);
  assert.deepEqual(Object.keys(a.compliance).sort(), ['attention', 'd30', 'd7', 'd90', 'daysSinceLast', 'hasSchedule', 'lastWorkout']);
  assert.deepEqual([a.compliance.lastWorkout, a.compliance.daysSinceLast, a.compliance.hasSchedule], [addDays(TODAY, -1), 1, true]);
  assert.deepEqual([a.compliance.d7.planned, a.compliance.d7.done, a.compliance.d7.pct], [7, 3, 43]);
  assert.equal(a.compliance.d90.planned, 90);
  const b = await row(w2.who.coach, l2);
  assert.ok('compliance' in b); assert.equal(b.compliance, null, 'no history: null');
  assert.equal(b.workouts, undefined); assert.equal(b.lastWorkout, undefined, 'and no workout facts at all, as before');
});

test('a new link is measured from its first day: not 0 % on the first morning', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  await setSchedule(who.coach, l1, EVERY);
  writeState(app, who.c1.id, [TODAY]);
  const c = (await row(who.coach, l1)).compliance;
  assert.deepEqual([c.d7.planned, c.d7.done, c.d7.pct, c.d7.from, c.d7.to], [1, 1, 100, TODAY, TODAY], 'only today, which has a workout');
  writeState(app, who.c1.id, []);
  const none = (await row(who.coach, l1)).compliance;
  assert.deepEqual([none.d7.planned, none.d7.pct, none.attention], [0, null, null], 'nothing to measure yet: not 0 %');
});

test('a pause silences the signal and takes its days out of the plan; the archive does the same', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  await setSchedule(who.coach, l1, EVERY);
  writeState(app, who.c1.id, []);
  const w2 = await restartWith(t, app, ['coach', 'c1'], old);
  const { coach } = w2.who;

  let c = (await row(coach, l1)).compliance;
  assert.deepEqual([c.d7.planned, c.d7.pct, c.attention], [7, 0, 'quiet'], 'a month old link, a plan and nothing done');
  // On pause today: no signal, the same numbers (today is not in the window).
  assert.equal((await coach.put(`/api/trainer/links/${l1}/pause`, { until: null, tz: 'UTC' })).status, 200);
  const paused = await row(coach, l1);
  assert.ok(paused.pause);
  assert.deepEqual([paused.compliance.attention, paused.compliance.d7.planned], [null, 7]);
  assert.equal((await coach.del(`/api/trainer/links/${l1}/pause`, { tz: 'UTC' })).status, 200);
  assert.equal((await row(coach, l1)).compliance.attention, 'quiet', 'lifted the same day: the history has no gap, the signal is back');

  // A closed pause of days -10 .. -4, and an archived stretch before it: the history says which days were not expected.
  const w3 = await restartWith(t, w2.app, ['coach', 'c1'], db => {
    db.trainerLinks.find(l => l.id === l1).pauses = [
      { from: addDays(TODAY, -40), to: addDays(TODAY, -31), archived: true }, { from: addDays(TODAY, -10), to: addDays(TODAY, -4) }];
  });
  c = (await row(w3.who.coach, l1)).compliance;
  assert.deepEqual([c.d7.planned, c.d30.planned, c.d90.planned], [3, 23, 73], 'days -7..-4 of the week are off; 7 of the 30; 10 + 7 of the 90');
  assert.equal(c.attention, null, 'the client came back three days ago: the quiet count starts there');
});

test('a client without Telegram: the same numbers in the list and on the data screen', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const made = await who.coach.post('/api/trainer/managed', { name: 'Мама', ageConfirmed: true });
  assert.equal(made.status, 200, made.text);
  const link = app.db().trainerLinks.find(l => l.id === made.body.linkId);
  await setSchedule(who.coach, made.body.linkId, EVERY);
  writeState(app, link.clientUid, lastDays(2));
  const w2 = await restartWith(t, app, ['coach'], old);
  const { coach } = w2.who;

  const listed = await row(coach, made.body.linkId);
  assert.equal(listed.managed, true);
  assert.deepEqual([listed.compliance.d7.planned, listed.compliance.d7.done, listed.compliance.d7.pct], [7, 2, 29]);
  const screen = await coach.get(`/api/trainer/managed/${made.body.linkId}`);
  assert.equal(screen.status, 200, screen.text);
  assert.deepEqual(screen.body.compliance, listed.compliance, 'one object, from the same function');
  assert.deepEqual(screen.body.schedule.days, EVERY, 'with the schedule, to open its sheet from the screen');
});

test('the data screen and the read only document carry it; a closed history does not', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  const l2 = await telegramClient(who.coach, who.c2, { history: false, measures: true, stats: false });
  await setSchedule(who.coach, l1, EVERY);
  writeState(app, who.c1.id, lastDays(1)); writeState(app, who.c2.id, lastDays(1));
  const w2 = await restartWith(t, app, ['coach', 'c1', 'c2'], old);
  const { coach } = w2.who;

  const listed = (await row(coach, l1)).compliance;
  const data = await coach.get(`/api/trainer/clients/${l1}/data`);
  assert.equal(data.status, 200, data.text);
  assert.deepEqual(data.body.compliance, listed);
  assert.deepEqual(data.body.schedule.days, EVERY);
  const doc = await coach.get(`/api/trainer/clients/${l1}/doc`);
  assert.deepEqual(doc.body.compliance, listed);
  // History closed: the screens answer as they did, with null.
  assert.equal((await coach.get(`/api/trainer/clients/${l2}/data`)).body.compliance, null);
  assert.equal((await coach.get(`/api/trainer/clients/${l2}/doc`)).body.compliance, null);
});

test('the client does not see it, and another trainer does not reach it', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'other']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const l1 = await telegramClient(who.coach, who.c1);
  await setSchedule(who.coach, l1, EVERY);
  writeState(app, who.c1.id, lastDays(2));
  // The client's side: their own link, their own data and the trainer's status carry no percentage of theirs.
  const me = await who.c1.get('/api/trainer/me');
  assert.equal(me.status, 200);
  assert.ok(!/compliance|"d7"|"d30"|"d90"/.test(me.text), 'GET /api/trainer/me');
  const mine = await who.c1.get('/api/data');
  assert.ok(!/compliance/.test(mine.text), 'GET /api/data');
  // Another trainer: not in the list, and the client's routes read as not there.
  const theirs = await who.other.get('/api/trainer/clients');
  assert.deepEqual(theirs.body.clients, []);
  for (const p of [`/api/trainer/clients/${l1}/data`, `/api/trainer/clients/${l1}/doc`]) {
    const r = await who.other.get(p);
    assert.equal(r.status, 404, p);
    assert.ok(!/compliance/.test(r.text));
  }
  // The client cannot read the trainer's routes at all.
  assert.equal((await who.c1.get('/api/trainer/clients')).status, 403);
  assert.equal((await who.c1.get(`/api/trainer/clients/${l1}/data`)).status, 403);
});

test('an unreadable document is null, not a number; a missing one is a client with no workouts', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  const l2 = await telegramClient(who.coach, who.c2);
  fs.writeFileSync(path.join(app.dir, `state-${who.c1.id}.json`), '{not json');
  fs.rmSync(path.join(app.dir, `state-${who.c2.id}.json`), { force: true });
  const clients = (await who.coach.get('/api/trainer/clients')).body.clients;
  assert.equal(clients.find(c => c.linkId === l1).compliance, null);
  const none = clients.find(c => c.linkId === l2).compliance;
  assert.deepEqual([none.lastWorkout, none.daysSinceLast, none.d7.pct], [null, null, null]);
});
