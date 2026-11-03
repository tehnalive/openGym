// Trainer templates and copying routines to clients (TG14, docs/telegram/TRAINER_MODE.md section 17).
// Pure helpers first, then a real server.js with Telegram sign-in on and a few signed identities.
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
  buildTemplate, changeTemplate, cleanContent, copyContent, addToDoc, freeName, convertWeight, buildOffer, pushOffer, summaryOf, offerView,
  readTemplates, writeTemplates, removeTemplates, templatesFile, TEMPLATES_MAX, TEMPLATE_ROUTINES_MAX, OFFERS_MAX, OFFER_BYTES_MAX,
} from '../trainer-templates.js';

// ---- pure ----
const squat = (over = {}) => ({ id: 'squat', sets: 3, reps: 5, weight: 100, inc: 2.5, _ts: 5, ...over });
const routine = (over = {}) => ({ id: 'r1', name: 'Тяни', emoji: 'x', _ts: 1, _f: { name: 1 }, ex: [squat(), { id: 'c_mine', sets: 2, reps: 10, photo: 'h', media: { a: 1 } }], ...over });
const custom = (over = {}) => ({ id: 'c_mine', n: 'Моё', bp: 'back', custom: true, _ts: 9, photo: 'h1', ...over });

test('a template keeps routines without bookkeeping or media, and only the custom exercises they use', () => {
  const made = buildTemplate({ name: '  Тяни-Толкай  ', note: 'для\nновичков', routines: [routine()], customEx: [custom(), custom({ id: 'c_other', n: 'Чужое' })] });
  assert.ok(!made.error, made.text);
  const t = made.template;
  assert.equal(t.name, 'Тяни-Толкай'); assert.equal(t.note, 'для новичков'); assert.equal(t.unit, 'kg');
  assert.deepEqual(t.customEx.map(c => c.id), ['c_mine']);
  const text = JSON.stringify(t);
  for (const bad of ['_ts', '_f', 'photo', 'media']) assert.ok(!text.includes(`"${bad}"`), bad);
  assert.equal(t.routines[0].ex[0].weight, 100);
  assert.ok(Date.parse(t.createdAt) > 0 && t.updatedAt === t.createdAt);
});

test('a template needs a name and routines, within the limits', () => {
  assert.equal(buildTemplate({ name: '', routines: [routine()] }).error, 'name-required');
  assert.equal(buildTemplate({ name: 'a', routines: [] }).error, 'routines-required');
  assert.equal(buildTemplate({ name: 'a' }).error, 'routines-required');
  assert.equal(buildTemplate({ name: 'a', routines: Array.from({ length: TEMPLATE_ROUTINES_MAX + 1 }, (_, i) => routine({ id: 'r' + i })) }).error, 'too-many-routines');
  assert.equal(buildTemplate({ name: 'a', routines: [{ id: 'r', name: '', ex: [] }] }).error, 'routine-invalid');
  assert.equal(buildTemplate({ name: 'a', routines: [{ id: 'r', name: 'x', ex: [{ sets: 1 }] }] }).error, 'routine-invalid');
  assert.equal(buildTemplate({ name: 'a', routines: [routine()], note: 5 }).error, 'bad-request');
  assert.equal(buildTemplate({ name: 'a'.repeat(100), routines: [routine()] }).template.name.length, 60);
  const huge = routine({ ex: Array.from({ length: 60 }, (_, i) => ({ id: 'e' + i, note: 'я'.repeat(1500) })) });
  const big = buildTemplate({ name: 'a', routines: [huge, { ...huge, id: 'r2' }, { ...huge, id: 'r3' }] });
  assert.equal(big.error, 'template-too-big'); assert.equal(big.status, 413);
  // The same id twice becomes two routines.
  const twice = buildTemplate({ name: 'a', routines: [routine(), routine()] });
  assert.equal(new Set(twice.template.routines.map(r => r.id)).size, 2);
});

test('a template is changed by name, note, or by taking routines out and moving them', () => {
  const { template } = buildTemplate({ name: 'a', routines: [routine({ id: 'a1', name: 'A', ex: [squat()] }), routine({ id: 'b1', name: 'B', ex: [{ id: 'c_mine', sets: 1 }] }), routine({ id: 'c1', name: 'C', ex: [squat()] })], customEx: [custom()] });
  const moved = changeTemplate(template, { routineIds: ['c1', 'a1'] }, Date.now() + 5000);
  assert.deepEqual(moved.template.routines.map(r => r.id), ['c1', 'a1']);
  assert.deepEqual(moved.template.customEx, [], 'B was the only one using the custom exercise');
  assert.notEqual(moved.template.updatedAt, template.updatedAt);
  assert.equal(template.routines.length, 3, 'the original is not mutated');
  assert.equal(changeTemplate(template, { routineIds: [] }).error, 'routines-required');
  assert.equal(changeTemplate(template, { routineIds: ['zz'] }).error, 'routine-gone');
  assert.equal(changeTemplate(template, { name: ' ' }).error, 'name-required');
  assert.equal(changeTemplate(template, {}).error, 'bad-request');
  assert.equal(changeTemplate(template, { name: 'Новое', note: 'n' }).template.name, 'Новое');
  assert.deepEqual(summaryOf(template), { id: template.id, name: 'a', note: '', unit: 'kg', routineCount: 3, routineNames: ['A', 'B', 'C'], exerciseCount: 3, updatedAt: template.updatedAt });
});

test('a free name gets (2), (3)... without case, within the length limit', () => {
  assert.equal(freeName('Тяни', ['Ноги']), 'Тяни');
  assert.equal(freeName('Тяни', ['тяни']), 'Тяни (2)');
  assert.equal(freeName('Тяни', ['Тяни', 'Тяни (2)']), 'Тяни (3)');
  assert.ok(freeName('я'.repeat(80), ['я'.repeat(80)]).length <= 80);
});

test('copies get new ids, a free name, the custom exercise under a new id, and are not linked to the template', () => {
  const { template } = buildTemplate({ name: 'Т', routines: [routine()], customEx: [custom()] });
  const doc = { unit: 'kg', routines: [{ id: 'old', name: 'Тяни', ex: [] }], customEx: [], workouts: [{ id: 'w' }] };
  const before = JSON.stringify(doc);
  const out = addToDoc(doc, template, { templateId: template.id, now: 1000 });
  assert.equal(JSON.stringify(doc), before, 'the input document is untouched');
  assert.equal(out.doc.routines.length, 2);
  const copy = out.doc.routines[1];
  assert.notEqual(copy.id, 'r1'); assert.equal(copy.name, 'Тяни (2)'); assert.equal(copy.fromTemplate, template.id); assert.equal(copy._ts, 1000);
  const mine = out.doc.customEx[0];
  assert.notEqual(mine.id, 'c_mine'); assert.equal(mine.n, 'Моё'); assert.equal(mine.custom, true);
  assert.equal(copy.ex[1].id, mine.id, 'the routine points at the new custom exercise');
  assert.equal(copy.ex[0].id, 'squat', 'a catalogue exercise keeps its id');
  assert.deepEqual(out.doc.workouts, [{ id: 'w' }]);
  // Again: the custom exercise is reused by name and body part, the routine is a third one.
  const again = addToDoc(out.doc, template, { templateId: template.id });
  assert.equal(again.doc.customEx.length, 1);
  assert.deepEqual(again.doc.routines.map(r => r.name), ['Тяни', 'Тяни (2)', 'Тяни (3)']);
  assert.equal(again.doc.routines[2].ex[1].id, mine.id);
  assert.equal(again.doc.routines[1].id, copy.id, 'the first copy is the same');
});

test('weights follow the unit of the diary they land in', () => {
  const { template } = buildTemplate({ name: 'Т', unit: 'kg', routines: [routine({ ex: [squat({ pyramidWeight: [60, 0, 80], warmup: [{ weight: 40 }] })] })] });
  const lb = copyContent(template, { unit: 'lb', routines: [], customEx: [] });
  const e = lb.routines[0].ex[0];
  assert.equal(e.weight, convertWeight(100, 'kg', 'lb')); assert.equal(e.weight, 220.5);
  assert.equal(e.inc, 5.5); assert.deepEqual(e.pyramidWeight, [132.5, 0, 176.5]); assert.equal(e.warmup[0].weight, 88);
  assert.equal(copyContent(template, { unit: 'kg', routines: [], customEx: [] }).routines[0].ex[0].weight, 100);
});

test('offers: the newest five stay, an offer of the same template replaces the older one, a big one is refused', () => {
  const { template } = buildTemplate({ name: 'Т', routines: [routine()] });
  let offers = [];
  for (let i = 0; i < 7; i++) offers = pushOffer(offers, buildOffer(template, { templateId: 't' + i, templateName: 'П' + i }).offer);
  assert.equal(offers.length, OFFERS_MAX);
  assert.deepEqual(offers.map(o => o.templateName), ['П2', 'П3', 'П4', 'П5', 'П6']);
  const again = buildOffer(template, { templateId: 't4', templateName: 'П4 новое' }).offer;
  offers = pushOffer(offers, again);
  assert.equal(offers.length, OFFERS_MAX); assert.equal(offers.at(-1).templateName, 'П4 новое');
  assert.deepEqual(offers.map(o => o.templateName), ['П2', 'П3', 'П5', 'П6', 'П4 новое']);
  const view = offerView(again);
  assert.equal(view.routineCount, 1); assert.deepEqual(view.routineNames, ['Тяни']); assert.ok(!('templateId' in view));
  const huge = { routines: [routine({ ex: Array.from({ length: 60 }, (_, i) => ({ id: 'e' + i, note: 'я'.repeat(1200) })) })], customEx: [] };
  assert.ok(JSON.stringify(huge).length > OFFER_BYTES_MAX);
  assert.equal(buildOffer(huge, {}).error, 'offer-too-big');
});

test('the file store: absent is empty, a corrupt file is unreadable and left alone, remove deletes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-tpl-'));
  try {
    assert.deepEqual(readTemplates(dir, 'u1'), []);
    const { template } = buildTemplate({ name: 'Т', routines: [routine()] });
    writeTemplates(dir, 'u1', [template]);
    assert.equal(readTemplates(dir, 'u1')[0].id, template.id);
    assert.ok(!fs.existsSync(templatesFile(dir, 'u1') + '.tmp'));
    fs.writeFileSync(templatesFile(dir, 'u2'), '{ not json');
    assert.equal(readTemplates(dir, 'u2'), null);
    removeTemplates(dir, 'u1'); removeTemplates(dir, 'nobody');
    assert.ok(!fs.existsSync(templatesFile(dir, 'u1')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cleanContent rejects a bad custom list and unique ids hold', () => {
  assert.equal(cleanContent({ routines: [routine()], customEx: 'x' }).error, 'custom-invalid');
  assert.equal(cleanContent({ routines: [routine()], customEx: [custom({ n: '' })] }).error, 'custom-invalid');
});

// ---- the server ----
const API = fileURLToPath(new URL('../', import.meta.url));
const TOKEN = '123456789:synthetic_telegram_test_token_not_a_secret';
const ORIGIN = 'https://gym.example.test';
const TG = { coach: 4_800_000_001, other: 4_800_000_002, c1: 4_800_000_011, c2: 4_800_000_012 };
const NAMES = { coach: 'Анна', other: 'Олег', c1: 'Мария', c2: 'Игорь' };

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-tpl-'));
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

async function world(t, names, opts) {
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
const addManaged = async (c, name = 'Мама', unit = 'kg') => (await c.post('/api/trainer/managed', { name, note: '', ageConfirmed: true, unit })).body.linkId;
const stateFile = (app, uid) => path.join(app.dir, `state-${uid}.json`);
const stateOf = (app, uid) => JSON.parse(fs.readFileSync(stateFile(app, uid), 'utf8'));
const clientOfLink = (app, linkId) => app.db().trainerLinks.find(l => l.id === linkId).clientUid;
async function telegramClient(coach, client) {
  const inv = await coach.post('/api/trainer/invites', {});
  const token = new URL(inv.body.link).searchParams.get('startapp');
  const acc = await client.post('/api/trainer/invites/accept', { token, ageConfirmed: true, grants: { history: true, measures: false, stats: false } });
  assert.equal(acc.status, 200, acc.text);
  return acc.body.linkId;
}
// A managed client's diary with routines, as the trainer's app pushes it.
async function seedDiary(c, linkId, routines, customEx = []) {
  const first = await c.get(`/api/trainer/managed/${linkId}/data`);
  const put = await c.put(`/api/trainer/managed/${linkId}/data`, { state: { ...first.body.state, routines, customEx }, baseRev: first.body.rev, baseWid: first.body.state._wid });
  assert.equal(put.status, 200, put.text);
}
const trainerRoutines = () => [
  routine({ id: 'tr1', name: 'Тяни', ex: [squat(), { id: 'c_mine', sets: 2, reps: 10 }] }),
  routine({ id: 'tr2', name: 'Толкай', ex: [{ id: 'bench', sets: 3, reps: 8, weight: 60 }] }),
];
const make = (c, over = {}) => c.post('/api/trainer/templates', { name: 'Тяни-Толкай', note: 'база', routines: trainerRoutines(), customEx: [custom()], ...over });

test('only a trainer has templates, and each trainer sees only their own', async t => {
  const { app, who } = await world(t, ['coach', 'other', 'c1']);
  for (const r of [await who.coach.get('/api/trainer/templates'), await make(who.coach), await who.coach.get('/api/trainer/templates/abcdefgh1234')]) {
    assert.equal(r.status, 403); assert.equal(r.body.code, 'not-trainer');
  }
  assert.equal((await app.call('/api/trainer/templates')).status, 401);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const made = await make(who.coach);
  assert.equal(made.status, 200, made.text);
  const id = made.body.template.id;
  assert.deepEqual((await who.other.get('/api/trainer/templates')).body.templates, []);
  for (const r of [await who.other.get('/api/trainer/templates/' + id), await who.other.put('/api/trainer/templates/' + id, { name: 'x' }),
    await who.other.del('/api/trainer/templates/' + id), await who.other.post(`/api/trainer/templates/${id}/assign`, { linkIds: ['abcdefgh1234'] })]) {
    assert.equal(r.status, 404, r.text); assert.equal(r.body.code, 'template-gone');
  }
  assert.equal((await who.coach.get('/api/trainer/templates/' + id)).status, 200, 'still there');
  assert.equal((await who.coach.get('/api/trainer/templates/..%2Fx')).status, 404);
});

test('a template: create, list, read, rename, take a routine out, delete; the file is the trainer\'s own', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  assert.deepEqual((await who.coach.get('/api/trainer/templates')).body, { templates: [], limit: TEMPLATES_MAX });
  const made = await make(who.coach);
  const tpl = made.body.template;
  assert.equal(tpl.routines.length, 2); assert.deepEqual(tpl.customEx.map(c => c.id), ['c_mine']);
  assert.ok(fs.existsSync(path.join(app.dir, `trainer-templates-${who.coach.id}.json`)));
  const list = (await who.coach.get('/api/trainer/templates')).body.templates;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: tpl.id, name: 'Тяни-Толкай', note: 'база', unit: 'kg', routineCount: 2, routineNames: ['Тяни', 'Толкай'], exerciseCount: 3, updatedAt: tpl.updatedAt });
  assert.equal((await who.coach.get('/api/trainer/templates/' + tpl.id)).body.template.routines[0].ex.length, 2);

  const ren = await who.coach.put('/api/trainer/templates/' + tpl.id, { name: 'ТТ', note: '' });
  assert.equal(ren.body.template.name, 'ТТ');
  const cut = await who.coach.put('/api/trainer/templates/' + tpl.id, { routineIds: [tpl.routines[1].id] });
  assert.deepEqual(cut.body.template.routines.map(r => r.name), ['Толкай']);
  assert.deepEqual(cut.body.template.customEx, []);
  assert.equal((await who.coach.put('/api/trainer/templates/' + tpl.id, { routineIds: [] })).body.code, 'routines-required');
  assert.equal((await who.coach.put('/api/trainer/templates/' + tpl.id, {})).status, 400);

  assert.equal((await who.coach.del('/api/trainer/templates/' + tpl.id)).status, 200);
  assert.equal((await who.coach.del('/api/trainer/templates/' + tpl.id)).body.code, 'template-gone');
  assert.deepEqual((await who.coach.get('/api/trainer/templates')).body.templates, []);
  // The routes need the right method and a path of the right shape.
  assert.equal((await who.coach.put('/api/trainer/templates', { name: 'x' })).status, 404);
  assert.equal((await who.coach.post('/api/trainer/templates/' + tpl.id, {})).status, 404);
});

test('limits: fifty templates, twenty routines, 200 KB', async t => {
  const { who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const one = [routine({ id: 'a', name: 'A' })];
  const t21 = await who.coach.post('/api/trainer/templates', { name: 'x', routines: Array.from({ length: 21 }, (_, i) => routine({ id: 'r' + i })) });
  assert.equal(t21.body.code, 'too-many-routines');
  for (let i = 0; i < TEMPLATES_MAX; i++) assert.equal((await who.coach.post('/api/trainer/templates', { name: 'Ш' + i, routines: one })).status, 200, 'template ' + i);
  const over = await who.coach.post('/api/trainer/templates', { name: 'Лишний', routines: one });
  assert.equal(over.status, 409); assert.equal(over.body.code, 'templates-limit');
  assert.equal((await who.coach.get('/api/trainer/templates')).body.templates.length, TEMPLATES_MAX);
});

test('a template over 200 KB is refused', async t => {
  const { who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const huge = routine({ ex: Array.from({ length: 60 }, (_, i) => ({ id: 'e' + i, note: 'я'.repeat(1500) })) });
  const r = await who.coach.post('/api/trainer/templates', { name: 'x', routines: [huge, { ...huge, id: 'r2' }, { ...huge, id: 'r3' }] });
  assert.equal(r.status, 413); assert.equal(r.body.code, 'template-too-big');
});

test('assigning to a client without Telegram adds independent copies with new ids; again adds another and touches nothing else', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const link = await addManaged(who.coach);
  const uid = clientOfLink(app, link);
  const tpl = (await make(who.coach)).body.template;
  const own = { id: 'mine1', name: 'Тяни', ex: [{ id: 'squat', sets: 1 }] };
  await seedDiary(who.coach, link, [own]);
  const before = stateOf(app, uid);

  const r1 = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  assert.equal(r1.status, 200, r1.text);
  assert.deepEqual(r1.body.results, [{ linkId: link, result: 'added', routineCount: 2 }]);
  const doc = stateOf(app, uid);
  assert.equal(doc._rev, before._rev + 1);
  assert.deepEqual(doc.routines.map(r => r.name), ['Тяни', 'Тяни (2)', 'Толкай'], 'a name taken gets a suffix');
  assert.deepEqual(doc.routines[0], before.routines[0], 'their own routine is untouched');
  const added = doc.routines.slice(1);
  for (const r of added) {
    assert.ok(!['tr1', 'tr2'].includes(r.id), 'new id'); assert.equal(r.fromTemplate, tpl.id);
    assert.ok(Number(r._ts) > 0, 'stamped');
  }
  assert.equal(doc.customEx.length, 1);
  assert.notEqual(doc.customEx[0].id, 'c_mine'); assert.equal(doc.customEx[0].n, 'Моё'); assert.equal(doc.customEx[0].custom, true);
  assert.equal(added[0].ex[1].id, doc.customEx[0].id, 'the routine points at the new custom exercise');
  assert.equal(added[0].ex[0].weight, 100);
  // The template is a snapshot: nothing of it changed.
  assert.equal((await who.coach.get('/api/trainer/templates/' + tpl.id)).body.template.routines[0].id, 'tr1');

  const r2 = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  assert.equal(r2.body.results[0].result, 'added');
  const doc2 = stateOf(app, uid);
  assert.deepEqual(doc2.routines.map(r => r.name), ['Тяни', 'Тяни (2)', 'Толкай', 'Тяни (3)', 'Толкай (2)']);
  assert.deepEqual(doc2.routines.slice(0, 3), doc.routines, 'the first copies are byte for byte what they were');
  assert.equal(doc2.customEx.length, 1, 'the custom exercise is reused');
  // The client's diary is read back by the trainer's app as a normal document, with the copies in it.
  assert.equal((await who.coach.get(`/api/trainer/managed/${link}/data`)).body.state.routines.length, 5);
});

test('weights are converted when the diary is in pounds', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const link = await addManaged(who.coach, 'Боб', 'lb');
  const tpl = (await make(who.coach)).body.template;
  await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  const doc = stateOf(app, clientOfLink(app, link));
  assert.equal(doc.routines[0].ex[0].weight, 220.5); assert.equal(doc.routines[0].ex[0].inc, 5.5);
});

test('a client with Telegram gets an offer, and their document is not written', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const link = await telegramClient(who.coach, who.c1);
  // The client has a diary of their own.
  const put = await who.c1.put('/api/data', { state: { unit: 'kg', routines: [{ id: 'mine', name: 'Моя', ex: [] }], workouts: [] } });
  assert.equal(put.status, 200, put.text);
  const file = stateFile(app, who.c1.id);
  const bytes = fs.readFileSync(file, 'utf8');
  const stat = fs.statSync(file).mtimeMs;
  const tpl = (await make(who.coach)).body.template;

  const r = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  assert.deepEqual(r.body.results, [{ linkId: link, result: 'offered' }]);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'the client document is byte for byte what it was');
  assert.equal(fs.statSync(file).mtimeMs, stat);

  const me = (await who.c1.get('/api/trainer/me')).body.asClient;
  assert.equal(me.coachName, 'Анна');
  assert.equal(me.offers.length, 1);
  const offer = me.offers[0];
  assert.equal(offer.templateName, 'Тяни-Толкай'); assert.equal(offer.routineCount, 2); assert.deepEqual(offer.routineNames, ['Тяни', 'Толкай']);
  assert.equal(offer.routines.length, 2); assert.deepEqual(offer.customEx.map(c => c.id), ['c_mine']);
  assert.ok(!('templateId' in offer));
  // The trainer's own /me does not carry the offers, and neither does the list of clients.
  assert.ok(!JSON.stringify((await who.coach.get('/api/trainer/clients')).body).includes('offers'));

  // The same template again replaces the open offer instead of piling up.
  await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient.offers.length, 1);
});

test('accept and decline: only the client of the link; the server removes the offer and answers with it', async t => {
  const { app, who } = await world(t, ['coach', 'c1', 'c2', 'other']);
  await makeTrainer(who.coach);
  const l1 = await telegramClient(who.coach, who.c1);
  const l2 = await telegramClient(who.coach, who.c2);
  const tpl = (await make(who.coach)).body.template;
  const second = (await make(who.coach, { name: 'Второй' })).body.template;
  await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [l1, l2] });
  await who.coach.post(`/api/trainer/templates/${second.id}/assign`, { linkIds: [l1] });
  const offers1 = (await who.c1.get('/api/trainer/me')).body.asClient.offers;
  const offers2 = (await who.c2.get('/api/trainer/me')).body.asClient.offers;
  assert.equal(offers1.length, 2); assert.equal(offers2.length, 1);

  // Not the trainer, not a stranger, not the other client.
  for (const c of [who.coach, who.other, who.c2]) {
    const r = await c.post(`/api/trainer/offers/${offers1[0].id}/accept`, {});
    assert.equal(r.status, 404, r.text); assert.equal(r.body.code, 'offer-gone');
    assert.equal((await c.post(`/api/trainer/offers/${offers1[0].id}/decline`, {})).status, 404);
  }
  assert.equal((await app.call(`/api/trainer/offers/${offers1[0].id}/accept`, { method: 'POST', body: {} })).status, 401);
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient.offers.length, 2, 'nothing was taken');

  const acc = await who.c1.post(`/api/trainer/offers/${offers1[0].id}/accept`, {});
  assert.equal(acc.status, 200, acc.text);
  assert.equal(acc.body.offer.id, offers1[0].id); assert.equal(acc.body.offer.routines.length, 2);
  assert.equal((await who.c1.post(`/api/trainer/offers/${offers1[0].id}/accept`, {})).body.code, 'offer-gone', 'a second accept finds nothing');
  const dec = await who.c1.post(`/api/trainer/offers/${offers1[1].id}/decline`, {});
  assert.equal(dec.status, 200); assert.equal(dec.body.offer, undefined);
  assert.deepEqual((await who.c1.get('/api/trainer/me')).body.asClient.offers, []);
  assert.equal((await who.c2.get('/api/trainer/me')).body.asClient.offers.length, 1, 'the other client keeps theirs');
  // Neither wrote the client's document.
  assert.ok(!fs.existsSync(stateFile(app, who.c1.id)) || !('fromTemplate' in JSON.stringify(stateOf(app, who.c1.id))));
});

test('at most five open offers on a link', async t => {
  const { who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const link = await telegramClient(who.coach, who.c1);
  for (let i = 0; i < 7; i++) {
    const tpl = (await make(who.coach, { name: 'П' + i })).body.template;
    assert.equal((await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] })).body.results[0].result, 'offered');
  }
  const offers = (await who.c1.get('/api/trainer/me')).body.asClient.offers;
  assert.deepEqual(offers.map(o => o.templateName), ['П2', 'П3', 'П4', 'П5', 'П6']);
});

test('assign: results per client, others\' links and unknown ids are errors, nothing leaks', async t => {
  const { app, who } = await world(t, ['coach', 'other', 'c1']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const mine = await addManaged(who.coach, 'Мой');
  const foreign = await addManaged(who.other, 'Чужой');
  const tg = await telegramClient(who.coach, who.c1);
  const tpl = (await make(who.coach)).body.template;
  const r = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [mine, foreign, tg, 'nonexistent1', mine] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.results.map(x => [x.linkId, x.result, x.code]), [[mine, 'added', undefined], [foreign, 'error', 'client-gone'], [tg, 'offered', undefined], ['nonexistent1', 'error', 'client-gone']]);
  assert.deepEqual(stateOf(app, clientOfLink(app, foreign)).routines, [], 'the other trainer\'s client got nothing');
  for (const bad of [{}, { linkIds: [] }, { linkIds: 'x' }, { linkIds: [1] }, { linkIds: Array.from({ length: 21 }, (_, i) => 'link' + i) }]) {
    const e = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, bad);
    assert.equal(e.status, 400, JSON.stringify(bad)); assert.equal(e.body.code, 'links-required');
  }
  // A link that ended is gone.
  await who.c1.del(`/api/trainer/links/${tg}`);
  assert.equal((await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [tg] })).body.results[0].code, 'client-gone');
});

test('from a client: routines of a client without Telegram become a template; a Telegram client\'s are never given', async t => {
  const { app, who } = await world(t, ['coach', 'other', 'c1']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const link = await addManaged(who.coach, 'Мама');
  await seedDiary(who.coach, link, [
    { ...routine({ id: 'm1', name: 'Мамина', ex: [squat(), { id: 'c_x', sets: 1 }] }), by: 'zz' },
    { id: 'm2', name: 'Вторая', ex: [{ id: 'bench', sets: 3 }] },
  ], [custom({ id: 'c_x', n: 'Её' }), custom({ id: 'c_unused', n: 'Лишнее' })]);
  const names = await who.coach.get(`/api/trainer/managed/${link}/routines`);
  assert.deepEqual(names.body.routines, [{ id: 'm1', name: 'Мамина', exerciseCount: 2 }, { id: 'm2', name: 'Вторая', exerciseCount: 1 }]);
  assert.equal((await who.other.get(`/api/trainer/managed/${link}/routines`)).status, 404);
  const made = await who.coach.post(`/api/trainer/templates/from-client/${link}`, { name: 'От мамы', routineIds: ['m2', 'm1'] });
  assert.equal(made.status, 200, made.text);
  const tpl = made.body.template;
  assert.deepEqual(tpl.routines.map(r => r.name), ['Вторая', 'Мамина'], 'in the order asked');
  assert.deepEqual(tpl.customEx.map(c => c.id), ['c_x']);
  const text = JSON.stringify(tpl);
  assert.ok(!text.includes('"_ts"') && !text.includes('"by"') && !text.includes('"_f"') && !text.includes('"photo"'));
  assert.equal((await who.coach.get('/api/trainer/templates')).body.templates.length, 1);

  assert.equal((await who.coach.post(`/api/trainer/templates/from-client/${link}`, { name: 'x', routineIds: ['nope'] })).body.code, 'routine-gone');
  assert.equal((await who.coach.post(`/api/trainer/templates/from-client/${link}`, { name: 'x', routineIds: [] })).body.code, 'routines-required');
  assert.equal((await who.coach.post(`/api/trainer/templates/from-client/${link}`, { name: '', routineIds: ['m1'] })).body.code, 'name-required');
  const stranger = await who.other.post(`/api/trainer/templates/from-client/${link}`, { name: 'x', routineIds: ['m1'] });
  assert.equal(stranger.status, 404); assert.equal(stranger.body.code, 'client-gone');

  const tg = await telegramClient(who.coach, who.c1);
  await who.c1.put('/api/data', { state: { unit: 'kg', routines: [{ id: 'secret1', name: 'Секретная', ex: [] }], workouts: [] } });
  const peek = await who.coach.get(`/api/trainer/managed/${tg}/routines`);
  assert.equal(peek.status, 404); assert.equal(peek.body.code, 'client-gone'); assert.ok(!peek.text.includes('Секретная'));
  const refused = await who.coach.post(`/api/trainer/templates/from-client/${tg}`, { name: 'x', routineIds: ['secret1'] });
  assert.equal(refused.status, 403); assert.equal(refused.body.code, 'client-private');
  assert.ok(!refused.text.includes('Секретная'));
  assert.equal((await who.coach.get('/api/trainer/templates')).body.templates.length, 1, 'no template was made');
  assert.equal(app.db().trainerLinks.length, 2);
});

test('copying routines between clients: from a client without Telegram to a managed client and to an offer; never from a Telegram client', async t => {
  const { app, who } = await world(t, ['coach', 'other', 'c1']);
  await makeTrainer(who.coach); await makeTrainer(who.other);
  const a = await addManaged(who.coach, 'Первый');
  const b = await addManaged(who.coach, 'Второй');
  const tg = await telegramClient(who.coach, who.c1);
  await seedDiary(who.coach, a, [routine({ id: 'a1', name: 'Тяни', ex: [squat(), { id: 'c_mine', sets: 2 }] }), { id: 'a2', name: 'Толкай', ex: [] }], [custom()]);
  const copy = (id, body) => who.coach.post(`/api/trainer/managed/${id}/routines/copy`, body);

  const r = await copy(a, { routineIds: ['a1'], toLinkIds: [b, tg, a, 'nonexistent1'] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body.results.map(x => [x.result, x.code]), [['added', undefined], ['offered', undefined], ['error', 'same-client'], ['error', 'client-gone']]);
  const docB = stateOf(app, clientOfLink(app, b));
  assert.deepEqual(docB.routines.map(x => x.name), ['Тяни']);
  assert.notEqual(docB.routines[0].id, 'a1'); assert.ok(!('fromTemplate' in docB.routines[0]), 'not from a template');
  assert.equal(docB.customEx.length, 1); assert.equal(docB.routines[0].ex[1].id, docB.customEx[0].id);
  assert.equal(stateOf(app, clientOfLink(app, a)).routines.length, 2, 'the source is as it was');
  const offers = (await who.c1.get('/api/trainer/me')).body.asClient.offers;
  assert.equal(offers.length, 1); assert.deepEqual(offers[0].routineNames, ['Тяни']);

  assert.equal((await copy(a, { routineIds: ['zzz'], toLinkIds: [b] })).body.code, 'routine-gone');
  assert.equal((await copy(a, { routineIds: [], toLinkIds: [b] })).body.code, 'routines-required');
  assert.equal((await copy(a, { routineIds: ['a1'], toLinkIds: [] })).body.code, 'links-required');
  // Source rules: a stranger and a Telegram client's link are "not there".
  assert.equal((await who.other.post(`/api/trainer/managed/${a}/routines/copy`, { routineIds: ['a1'], toLinkIds: [b] })).status, 404);
  const fromTg = await copy(tg, { routineIds: ['x'], toLinkIds: [b] });
  assert.equal(fromTg.status, 404); assert.equal(fromTg.body.code, 'client-gone');
  assert.equal(stateOf(app, clientOfLink(app, b)).routines.length, 1);
});

test('deleting the trainer\'s account deletes the templates file', async t => {
  const { app, who } = await world(t, ['other', 'coach'], { env: { FIRST_USER_ADMIN: '1' } });
  await makeTrainer(who.coach);
  await make(who.coach);
  const file = path.join(app.dir, `trainer-templates-${who.coach.id}.json`);
  assert.ok(fs.existsSync(file));
  const gone = await who.other.post('/api/admin/user/delete', { id: who.coach.id });
  assert.equal(gone.status, 200, gone.text);
  assert.ok(!fs.existsSync(file), 'the file went with the account');
});

test('the audit log names the actions and never the content of a template', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const link = await telegramClient(who.coach, who.c1);
  const managed = await addManaged(who.coach, 'Мама');
  const tpl = (await make(who.coach, { name: 'Секретный шаблон' })).body.template;
  await who.coach.put('/api/trainer/templates/' + tpl.id, { note: 'тайная заметка' });
  await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link, managed] });
  const offer = (await who.c1.get('/api/trainer/me')).body.asClient.offers[0];
  await who.c1.post(`/api/trainer/offers/${offer.id}/accept`, {});
  await who.coach.del('/api/trainer/templates/' + tpl.id);
  const logs = fs.readdirSync(app.dir).filter(f => /^audit/.test(f)).map(f => fs.readFileSync(path.join(app.dir, f), 'utf8')).join('\n');
  for (const ev of ['trainer.template.create', 'trainer.template.update', 'trainer.template.assign', 'trainer.template.delete', 'trainer.offer.accept']) assert.ok(logs.includes(ev), ev);
  for (const secret of ['Секретный шаблон', 'тайная заметка', 'Толкай', 'squat', 'c_mine']) assert.ok(!logs.includes(secret), secret);
});

test('a managed write by assignment carries no "written by the trainer" mark on routines and keeps revisions consistent', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const link = await addManaged(who.coach);
  const tpl = (await make(who.coach)).body.template;
  const first = await who.coach.get(`/api/trainer/managed/${link}/data`);
  await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  const after = await who.coach.get(`/api/trainer/managed/${link}/data`);
  assert.equal(after.body.rev, first.body.rev + 1);
  // The trainer's app, holding the old revision, gets a conflict and merges, as for any write.
  const stale = await who.coach.put(`/api/trainer/managed/${link}/data`, { state: first.body.state, baseRev: first.body.rev });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.state.routines.length, 2);
  // The next push on the fresh revision goes through and keeps the routines.
  const ok = await who.coach.put(`/api/trainer/managed/${link}/data`, { state: after.body.state, baseRev: after.body.rev, baseWid: after.body.state._wid });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(stateOf(app, clientOfLink(app, link)).routines.length, 2);
});

// ---- templates with pause and archive (TG14, sections 14 and 17 together) ----

test('an archived client gets no offer: the open ones are withdrawn, the client sees none, accept and decline read "not there", and a restore brings none back', async t => {
  const { app, who } = await world(t, ['coach', 'c1']);
  await makeTrainer(who.coach);
  const link = await telegramClient(who.coach, who.c1);
  const tpl = (await make(who.coach)).body.template;
  assert.equal((await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] })).body.results[0].result, 'offered');
  const offers = (await who.c1.get('/api/trainer/me')).body.asClient.offers;
  assert.equal(offers.length, 1);

  assert.equal((await who.coach.post(`/api/trainer/links/${link}/archive`, {})).status, 200);
  assert.equal(app.db().trainerLinks.find(l => l.id === link).offers, undefined, 'the offers are gone from the link');
  const me = (await who.c1.get('/api/trainer/me')).body.asClient;
  assert.equal(me.status, 'archived'); assert.deepEqual(me.offers, []);
  for (const verb of ['accept', 'decline']) {
    const r = await who.c1.post(`/api/trainer/offers/${offers[0].id}/${verb}`, {});
    assert.equal(r.status, 404, r.text); assert.equal(r.body.code, 'offer-gone');
  }
  // A new assignment to the archived link reads as "client-gone" and leaves nothing on it.
  const again = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] });
  assert.deepEqual([again.body.results[0].result, again.body.results[0].code], ['error', 'client-gone']);
  assert.equal(app.db().trainerLinks.find(l => l.id === link).offers, undefined);

  assert.equal((await who.coach.post(`/api/trainer/links/${link}/restore`, {})).status, 200);
  assert.deepEqual((await who.c1.get('/api/trainer/me')).body.asClient.offers, [], 'a restore does not bring the old offer back');
  assert.equal((await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] })).body.results[0].result, 'offered');
  assert.equal((await who.c1.get('/api/trainer/me')).body.asClient.offers.length, 1);
});

test('an archived managed client is out of templates and copying: not a target, not a source, the diary untouched; a paused one is both', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const a = await addManaged(who.coach, 'Первый');
  const b = await addManaged(who.coach, 'Второй');
  await seedDiary(who.coach, a, [routine({ id: 'a1', name: 'Тяни', ex: [squat()] })]);
  const tpl = (await make(who.coach)).body.template;

  // On pause the place and the access stay: it takes a template and gives its routines.
  assert.equal((await who.coach.put(`/api/trainer/links/${b}/pause`, { until: null, tz: 'UTC' })).status, 200);
  assert.equal((await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [b] })).body.results[0].result, 'added');
  assert.equal((await who.coach.post(`/api/trainer/managed/${a}/routines/copy`, { routineIds: ['a1'], toLinkIds: [b] })).body.results[0].result, 'added');
  const paused = await who.coach.get(`/api/trainer/managed/${b}/routines`);
  assert.equal(paused.status, 200);
  assert.equal((await who.coach.post(`/api/trainer/templates/from-client/${b}`, { name: 'С паузы', routineIds: [paused.body.routines[0].id] })).status, 200);
  const onPause = (await who.coach.get('/api/trainer/clients')).body.clients.find(c => c.linkId === b);
  assert.ok(onPause && onPause.pause, 'the list carries the pause that the picker names');

  // Archived: as a target it is "client-gone" and its diary does not move.
  assert.equal((await who.coach.post(`/api/trainer/links/${b}/archive`, {})).status, 200);
  const frozen = JSON.stringify(stateOf(app, clientOfLink(app, b)));
  const viaTemplate = await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [a, b] });
  assert.deepEqual(viaTemplate.body.results.map(r => r.result), ['added', 'error']);
  assert.equal(viaTemplate.body.results[1].code, 'client-gone');
  const viaCopy = await who.coach.post(`/api/trainer/managed/${a}/routines/copy`, { routineIds: ['a1'], toLinkIds: [b] });
  assert.equal(viaCopy.body.results[0].code, 'client-gone');
  assert.equal(JSON.stringify(stateOf(app, clientOfLink(app, b))), frozen);

  // Archived as a source: its routines are not read, listed, copied or made into a template.
  const before = (await who.coach.get('/api/trainer/templates')).body.templates.length;
  for (const r of [await who.coach.get(`/api/trainer/managed/${b}/routines`),
    await who.coach.post(`/api/trainer/managed/${b}/routines/copy`, { routineIds: ['a1'], toLinkIds: [a] }),
    await who.coach.post(`/api/trainer/templates/from-client/${b}`, { name: 'Из архива', routineIds: ['a1'] })]) {
    assert.equal(r.status, 404, r.text); assert.equal(r.body.code, 'client-gone');
  }
  assert.equal((await who.coach.get('/api/trainer/templates')).body.templates.length, before);
  // The list for the picker has no archived client; their data can still be saved by the trainer.
  const listed = (await who.coach.get('/api/trainer/clients')).body;
  assert.ok(!listed.clients.some(c => c.linkId === b) && listed.archived.some(c => c.linkId === b));
  assert.equal((await who.coach.get(`/api/trainer/managed/${b}/export`)).status, 200);
});

test('the "written by the trainer" mark and the revision rules hold across assign, archive and restore', async t => {
  const { app, who } = await world(t, ['coach']);
  await makeTrainer(who.coach);
  const link = await addManaged(who.coach);
  const client = clientOfLink(app, link);
  const data = `/api/trainer/managed/${link}/data`;
  const first = await who.coach.get(data);
  const w = { id: 'w1', d: new Date().toISOString().slice(0, 10), start: Date.now() - 3600000, end: Date.now(), name: 'Ноги', _ts: Date.now(),
    entries: [{ id: 'squat', sets: [{ w: 60, r: 8, done: true }] }] };
  const wrote = await who.coach.put(data, { state: { ...first.body.state, workouts: [w] }, baseRev: first.body.rev, stamped: true });
  assert.equal(wrote.status, 200, wrote.text);
  assert.equal(stateOf(app, client).workouts[0].via, 'coach');

  const beforeAssign = (await who.coach.get(data)).body.rev;   // the mark the writer did not send moves the stored revision one further
  const tpl = (await make(who.coach)).body.template;
  assert.equal((await who.coach.post(`/api/trainer/templates/${tpl.id}/assign`, { linkIds: [link] })).body.results[0].result, 'added');
  const afterAssign = stateOf(app, client);
  assert.equal(afterAssign.workouts[0].via, 'coach', 'an assignment keeps the mark of the earlier workout');
  assert.equal(afterAssign.routines.length, 2);
  assert.ok(afterAssign.routines.every(r => !('via' in r) && !('by' in r)), 'routines carry no mark');
  assert.equal(afterAssign._rev, beforeAssign + 1, 'one revision for the assignment');

  // Archive and restore touch no document: the revision, the mark and the routines stand as they were.
  await who.coach.post(`/api/trainer/links/${link}/archive`, {});
  assert.equal((await who.coach.get(data)).status, 404);
  assert.equal((await who.coach.put(data, { state: afterAssign, baseRev: afterAssign._rev })).status, 404);
  await who.coach.post(`/api/trainer/links/${link}/restore`, {});
  const back = await who.coach.get(data);
  assert.equal(back.body.rev, afterAssign._rev);
  assert.equal(back.body.state.workouts[0].via, 'coach');
  const again = await who.coach.put(data, { state: back.body.state, baseRev: back.body.rev, baseWid: back.body.state._wid, stamped: true });
  assert.equal(again.status, 200, again.text);
  assert.equal(stateOf(app, client).workouts[0].via, 'coach');
  assert.equal(stateOf(app, client).routines.length, 2);
});
