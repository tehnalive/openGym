/* The OpenRouter provider: configured from the environment, refused without a key, and silent
 * about the key everywhere it could leak. No test here leaves the machine: the adapter tests hand
 * in a fake fetch, and the job tests point the provider at a throwaway server on 127.0.0.1. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const KEY = 'sk-or-v1-TESTONLYNOTAREALKEY0123456789';
delete process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_MODEL;
delete process.env.OPENROUTER_FALLBACK_MODEL;
delete process.env.COACH_OPENROUTER_NO_TRAINING;

const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const { coachRoutes } = await import('../coach/routes.js');
const adapter = (await import('../coach/adapters/openrouter.js')).default;
const { failureMessage, classifyProviderFailure, providerNotice } = await import('../coach/messages.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

const reply = (status, body) => ({
  ok: status < 300, status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});
const completion = text => reply(200, { choices: [{ message: { content: text }, finish_reason: 'stop' }] });
const OK = completion('{"coach_contract":1,"ok":true}');

/* ---------- the adapter ---------- */

test('a request goes to openrouter.ai/api/v1 with the key as a bearer token and the chosen model', async () => {
  const seen = [];
  const r = await adapter.invoke({
    cfg: cfg.load(), prompt: 'hi', model: 'some/model:free', env: { OPENROUTER_API_KEY: KEY },
    fetch: async (url, init) => { seen.push({ url, init }); return completion('{"coach_contract":1,"ok":true}'); }
  });
  assert.equal(r.code, 0);
  assert.equal(seen[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen[0].init.headers.authorization, 'Bearer ' + KEY);
  assert.equal(JSON.parse(seen[0].init.body).model, 'some/model:free');
  assert.equal(JSON.parse(seen[0].init.body).provider, undefined, 'prompt collection is not restricted unless asked');
  assert.ok(!seen[0].init.body.includes(KEY), 'the key is a header, never part of the body');
});

test('without a key nothing is sent', async () => {
  let called = false;
  const r = await adapter.invoke({ cfg: cfg.load(), prompt: 'hi', model: 'm', env: {}, fetch: async () => { called = true; return OK; } });
  assert.equal(r.spawnError, true);
  assert.match(r.stderr, /no API key/);
  assert.equal(called, false);
});

test('COACH_OPENROUTER_NO_TRAINING asks for providers that do not collect prompts', async () => {
  process.env.COACH_OPENROUTER_NO_TRAINING = '1';
  try {
    let body;
    await adapter.invoke({ cfg: cfg.load(), prompt: 'hi', model: 'm', env: { OPENROUTER_API_KEY: KEY }, fetch: async (u, init) => { body = JSON.parse(init.body); return OK; } });
    assert.deepEqual(body.provider, { data_collection: 'deny' });
  } finally { delete process.env.COACH_OPENROUTER_NO_TRAINING; }
});

test('a rate-limited free model fails with its status, and the key is not in the failure text', async () => {
  const r = await adapter.invoke({
    cfg: cfg.load(), prompt: 'hi', model: 'm:free', env: { OPENROUTER_API_KEY: KEY }, retryDelayMs: 0,
    fetch: async () => reply(429, { error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } })
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^429 /);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('the fallback model is tried once on 429, only when the operator set one', async () => {
  const models = [];
  const fetch = async (u, init) => {
    const m = JSON.parse(init.body).model; models.push(m);
    return m === 'paid/fallback' ? OK : reply(429, { error: { message: 'Rate limit exceeded' } });
  };
  const base = { cfg: cfg.load(), prompt: 'hi', model: 'free/one:free', env: { OPENROUTER_API_KEY: KEY }, retryDelayMs: 0, fetch };

  const none = await adapter.invoke(base);
  assert.equal(none.code, 1, 'no fallback configured: the failure stands');
  assert.ok(models.every(m => m === 'free/one:free'));

  process.env.OPENROUTER_FALLBACK_MODEL = 'paid/fallback';
  try {
    models.length = 0;
    const withFallback = await adapter.invoke(base);
    assert.equal(withFallback.code, 0);
    assert.equal(models.at(-1), 'paid/fallback');

    // A bad key is not something another model fixes.
    models.length = 0;
    const bad = await adapter.invoke({ ...base, fetch: async (u, init) => { models.push(JSON.parse(init.body).model); return reply(401, { error: { message: 'No auth credentials found' } }); } });
    assert.match(bad.stderr, /^401/);
    assert.deepEqual(models, ['free/one:free']);
  } finally { delete process.env.OPENROUTER_FALLBACK_MODEL; }
});

/* ---------- configuration from the environment ---------- */

test('the key, model and caps come from the environment', () => {
  cfg.save({ enabled: true, provider: 'openrouter' });

  assert.equal(cfg.credentialFor('u1').ok, false, 'no key in the environment: no credential');
  assert.equal(cfg.credentialFor('u1').reason, 'no-credential');
  assert.equal(cfg.isConnected(), false);
  assert.equal(cfg.publicConfig(), null, 'and no Coach UI anywhere');

  process.env.OPENROUTER_API_KEY = KEY;
  try {
    const c = cfg.credentialFor('u1');
    assert.equal(c.ok, true);
    assert.equal(c.type, 'apikey');
    assert.equal(cfg.credentialFor('u2').ok, true, 'a shared key: no per-profile binding');
    assert.equal(cfg.isConnected(), true);
    assert.equal(cfg.jobEnv('/tmp', c).OPENROUTER_API_KEY, KEY, 'the key travels only down the job env');
    assert.equal(cfg.publicConfig().provider, 'openrouter');
    assert.ok(!JSON.stringify(cfg.publicConfig()).includes(KEY));
    assert.ok(!JSON.stringify(cfg.accountFor('u1')).includes(KEY));
  } finally { delete process.env.OPENROUTER_API_KEY; }

  assert.equal(cfg.modelFor(), 'nvidia/nemotron-3.5-super-vl:free');
  process.env.OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';
  try { assert.equal(cfg.modelFor(), 'deepseek/deepseek-v4.1-flash'); } finally { delete process.env.OPENROUTER_MODEL; }

  cfg.save({ caps: { perProfileDaily: 50, instanceDaily: 0 } });
  process.env.COACH_PER_USER_DAILY_MAX = '5';
  process.env.COACH_INSTANCE_DAILY_MAX = '20';
  try {
    assert.deepEqual(cfg.effectiveCaps(), { perProfileDaily: 5, instanceDaily: 20 }, 'the admin cannot raise a cap past the operator\'s');
    cfg.save({ caps: { perProfileDaily: 2, instanceDaily: 0 } });
    assert.deepEqual(cfg.effectiveCaps(), { perProfileDaily: 2, instanceDaily: 20 }, 'but may lower it; unlimited ends at the ceiling');
  } finally {
    delete process.env.COACH_PER_USER_DAILY_MAX; delete process.env.COACH_INSTANCE_DAILY_MAX;
    cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
  }
});

test('the phone\'s own-key picker never offers the server-only provider', async () => {
  const { HTTP_PROVIDER_IDS, HTTP_PROVIDERS } = await import('../coach/core/providers.js');
  assert.ok(HTTP_PROVIDERS.openrouter);
  assert.ok(!HTTP_PROVIDER_IDS.includes('openrouter'));
});

/* ---------- routes ---------- */

function routesWith({ admin = true } = {}) {
  const out = [];
  const json = (res, status, body) => { out.push({ status, body }); };
  const r = coachRoutes({
    json, readBody: async () => res.body, readSession: () => ({ id: 'u-admin' }), requireAdmin: () => admin
  });
  const res = { body: {} };
  return { r, out, call: async (route, body = {}) => { res.body = body; out.length = 0; await r[route]({ url: '/x' }, res); return out[0]; } };
}

test('the disclosure names OpenRouter and the model in Russian and English, and says free models may log', async () => {
  cfg.save({ enabled: true, provider: 'openrouter' });
  const { call } = routesWith();
  const { body } = await call('GET /api/coach/disclosure');
  assert.equal(body.provider, 'openrouter');
  assert.equal(body.host, 'openrouter.ai');
  assert.match(body.notice.ru, /OpenRouter/);
  assert.match(body.notice.ru, /nvidia\/nemotron-3\.5-super-vl:free/);
  assert.match(body.notice.ru, /для обучения/);
  assert.match(body.notice.en, /may keep your requests/);
  assert.ok(!/telegram/i.test(JSON.stringify(body.notice)) || /Telegram name and id are not sent/.test(body.notice.en));
  assert.equal(providerNotice('openai', 'gpt'), null);
  assert.match(providerNotice('openrouter', 'deepseek/deepseek-v4.1-flash').ru, /платная модель/);
});

test('the admin card never shows the key and the key cannot be pasted into the database', async () => {
  process.env.OPENROUTER_API_KEY = KEY;
  try {
    cfg.save({ enabled: true, provider: 'openrouter' });
    const { call } = routesWith();
    const card = await call('GET /api/admin/coach');
    assert.equal(card.status, 200);
    assert.ok(!JSON.stringify(card.body).includes(KEY));
    assert.deepEqual(card.body.auth, { state: 'connected', type: 'apikey', account: 'server environment', connectedAt: null });
    const row = card.body.providers.find(p => p.id === 'openrouter');
    assert.equal(row.apiKey, false);
    assert.equal(row.envKey, 'OPENROUTER_API_KEY');

    const refused = await call('POST /api/admin/coach/connect', { provider: 'openrouter', type: 'apikey', token: 'sk-or-pasted' });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /OPENROUTER_API_KEY/);
    assert.equal(cfg.authFor(cfg.load(), 'openrouter'), null, 'nothing stored');
    assert.ok(!fs.readFileSync(path.join(DIR, 'coach.json'), 'utf8').includes('sk-or-'));
  } finally { delete process.env.OPENROUTER_API_KEY; }
});

/* ---------- the whole job against a throwaway server ---------- */

async function withServer(handler, fn) {
  const requests = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => (b += d));
    req.on('end', () => { requests.push({ url: req.url, auth: req.headers.authorization, body: b }); handler(req, res, requests.length); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}/api/v1`, requests); }
  finally { await new Promise(r => srv.close(r)); }
}
async function settle(uid, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}

test('a question is answered through the provider, and the key reaches only the Authorization header', async () => {
  process.env.OPENROUTER_API_KEY = KEY;
  const uid = 'u-answer';
  writeState(DIR, uid, sampleState());
  try {
    await withServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ coach_contract: 1, answer: 'Добавляйте вес, когда все подходы сделаны.' }) }, finish_reason: 'stop' }] }));
    }, async (base, requests) => {
      cfg.save({ enabled: true, provider: 'openrouter', caps: { perProfileDaily: 10, instanceDaily: 0 } });
      cfg.saveOptions('openrouter', { baseUrl: base });
      jobs.enqueue(uid, { kind: 'ask', note: 'Когда добавлять вес?', lang: 'ru' });
      const s = await settle(uid);
      assert.equal(s.pending?.answer, 'Добавляйте вес, когда все подходы сделаны.');
      assert.equal(requests[0].url, '/api/v1/chat/completions');
      assert.equal(requests[0].auth, 'Bearer ' + KEY);
      assert.ok(!requests[0].body.includes(KEY), 'the key is not in what is sent');
      const sent = JSON.parse(requests[0].body);
      assert.equal(sent.model, 'nvidia/nemotron-3.5-super-vl:free');
      assert.ok(sent.max_tokens > 0);
    });
    // Nothing the server writes holds the key.
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(DIR)) assert.ok(!fs.readFileSync(f, 'utf8').includes(KEY), f + ' holds the key');
  } finally { delete process.env.OPENROUTER_API_KEY; }
});

test('a free model out of requests ends the job with a plain Russian line, not the provider\'s words', async () => {
  process.env.OPENROUTER_API_KEY = KEY;
  const uid = 'u-limit';
  writeState(DIR, uid, sampleState());
  const logs = [];
  const origErr = console.error, origLog = console.log;
  console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' '));
  try {
    await withServer((req, res) => {
      res.statusCode = 429;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { message: 'Rate limit exceeded: free-models-per-day', code: 429 } }));
    }, async base => {
      cfg.save({ enabled: true, provider: 'openrouter', caps: { perProfileDaily: 10, instanceDaily: 0 } });
      cfg.saveOptions('openrouter', { baseUrl: base });
      jobs.enqueue(uid, { kind: 'ask', note: 'Привет', lang: 'ru' });
      const s = await settle(uid, 30000);
      assert.equal(s.last.outcome, 'failed');
      assert.equal(s.last.errorClass, 'ratelimit');
      assert.match(s.last.message, /Бесплатная нейросеть/);
      assert.ok(!/free-models-per-day/.test(JSON.stringify(s)), 'the provider\'s own message stays off the user\'s screen');
    });
    assert.ok(!logs.join('\n').includes(KEY), 'nothing logged holds the key');
  } finally {
    console.error = origErr; console.log = origLog;
    delete process.env.OPENROUTER_API_KEY;
  }
});

test('a job is refused before any request when the key is missing', async () => {
  const uid = 'u-nokey';
  writeState(DIR, uid, sampleState());
  cfg.save({ enabled: true, provider: 'openrouter' });
  assert.throws(() => jobs.enqueue(uid, { kind: 'ask', note: 'Привет' }), e => e.code === 'off');
});

/* ---------- the words ---------- */

test('failure lines exist in Russian and English for the classes the app has no string for', () => {
  for (const cls of ['ratelimit', 'quota', 'modelgone']) {
    assert.ok(failureMessage(cls, 'ru'), cls);
    assert.match(failureMessage(cls, 'ru'), /[а-я]/i);
    assert.ok(!/[а-я]/i.test(failureMessage(cls, 'en')));
    assert.equal(failureMessage(cls, undefined), failureMessage(cls, 'en'));
  }
  assert.equal(failureMessage('provider', 'ru'), null, 'the app\'s own lines keep covering the rest');
  assert.equal(classifyProviderFailure('429 Rate limit exceeded'), 'ratelimit');
  assert.equal(classifyProviderFailure('402 Insufficient credits'), 'quota');
  assert.equal(classifyProviderFailure('404 the model "x" is not available to this key'), 'modelgone');
  assert.equal(classifyProviderFailure('500 upstream error'), null);
  assert.equal(classifyProviderFailure('could not reach openrouter.ai'), null);
});
