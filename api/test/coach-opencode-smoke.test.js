/* The operator's smoke test never prints the key and never calls the network in this suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { smoke, DEFAULT_MODEL } from '../../scripts/coach-opencode-smoke.mjs';

const KEY = 'oc-SMOKETESTNOTAREALKEY00000000';
const run = async (env, fetchImpl) => {
  const lines = [];
  const code = await smoke({ env, fetchImpl, out: l => lines.push(l) });
  return { code, text: lines.join('\n') };
};
const res = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: h => headers[h] || null }, text: async () => JSON.stringify(body) });

test('without a key it asks for one and sends nothing', async () => {
  let called = false;
  const r = await run({}, async () => { called = true; });
  assert.equal(r.code, 2);
  assert.equal(called, false);
  assert.match(r.text, /OPENCODE_API_KEY is not set/);
});

test('a good answer: status, model and limits are printed, the key is not', async () => {
  let sent;
  const r = await run({ OPENCODE_API_KEY: KEY }, async (url, init) => {
    sent = { url, init };
    return res(200, { choices: [{ message: { content: 'ok' } }] }, { 'x-ratelimit-remaining': '19' });
  });
  assert.equal(r.code, 0);
  assert.equal(sent.url, 'https://opencode.ai/inference/openai/v1/chat/completions');
  assert.equal(sent.init.headers.authorization, 'Bearer ' + KEY);
  assert.equal(JSON.parse(sent.init.body).model, DEFAULT_MODEL);
  assert.match(r.text, /status  200/);
  assert.match(r.text, /x-ratelimit-remaining  19/);
  assert.ok(!r.text.includes(KEY));
});

test('a failure echoing the key back is scrubbed, and the status gets a hint', async () => {
  const r = await run({ OPENCODE_API_KEY: KEY, OPENCODE_MODEL: 'deepseek-v4.1-flash' }, async () => res(401, { error: { message: `bad key ${KEY}` } }));
  assert.equal(r.code, 1);
  assert.ok(!r.text.includes(KEY));
  assert.match(r.text, /\[key\]/);
  assert.match(r.text, /deepseek-v4\.1-flash/);
  assert.match(r.text, /refused/);
  const down = await run({ OPENCODE_API_KEY: KEY }, async () => { throw new Error(`connect failed for ${KEY}`); });
  assert.equal(down.code, 1);
  assert.ok(!down.text.includes(KEY));
});
