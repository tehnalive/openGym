#!/usr/bin/env node
// One minimal request to OpenRouter with the key from OPENROUTER_API_KEY, to see on the server
// that the key, the model and the network work before switching the Coach on. It prints the HTTP
// status, the model, the time and the rate-limit headers. It never prints the key, never reads it
// from a file or an argument, and sends no training data: the only prompt is a one-word question.
//
//   OPENROUTER_API_KEY=... node scripts/coach-openrouter-smoke.mjs
//   OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash node scripts/coach-openrouter-smoke.mjs
//
// Exit code 0 on a 2xx answer, 1 on any other outcome, 2 when there is no key.
import { fileURLToPath } from 'node:url';

export const BASE = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';

const scrub = (text, key) => String(text).split(key).join('[key]').slice(0, 300);

export async function smoke({ env = process.env, fetchImpl = globalThis.fetch, out = console.log, now = Date.now } = {}) {
  const key = (env.OPENROUTER_API_KEY || '').trim();
  if (!key) {
    out('OPENROUTER_API_KEY is not set. Create a key at https://openrouter.ai/keys and export it for this command only.');
    return 2;
  }
  const model = (env.OPENROUTER_MODEL || '').trim() || DEFAULT_MODEL;
  const started = now();
  let res;
  try {
    res = await fetchImpl(BASE + '/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', 'x-title': 'Zhimolost Coach smoke test' },
      body: JSON.stringify({ model, max_tokens: 16, temperature: 0, messages: [{ role: 'user', content: 'Reply with one word: ok' }] }),
      signal: AbortSignal.timeout(60000)
    });
  } catch (e) {
    out(`FAIL  could not reach openrouter.ai: ${scrub(e && e.message, key)}`);
    return 1;
  }
  const ms = now() - started;
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const limit = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'].map(h => [h, res.headers && res.headers.get && res.headers.get(h)]).filter(([, v]) => v);

  out(`model   ${model}`);
  out(`status  ${res.status}  (${ms} ms)`);
  for (const [h, v] of limit) out(`${h}  ${v}`);
  if (!res.ok) {
    const msg = data && data.error && (data.error.message || data.error);
    out(`FAIL  ${scrub(typeof msg === 'string' ? msg : '(no error message)', key)}`);
    out(hint(res.status));
    return 1;
  }
  const answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  out(`answer  ${scrub(typeof answer === 'string' ? answer.trim() : '(empty)', key)}`);
  out('OK');
  return 0;
}

function hint(status) {
  if (status === 401 || status === 403) return 'The key was refused: check that it was copied whole and has not been revoked at openrouter.ai/keys.';
  if (status === 402) return 'The account is out of credit; this model is not free.';
  if (status === 404 || status === 400) return 'The model name may be wrong or retired (compare with https://openrouter.ai/api/v1/models), or, for a free model, "No endpoints found": allow free endpoints in https://openrouter.ai/settings/privacy.';
  if (status === 429) return 'Rate limit: free models allow about 20 requests a minute and 50 a day on a new account. Wait, or add credit.';
  return 'The provider had a problem; try again in a minute.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  smoke().then(code => { process.exitCode = code; });
}
