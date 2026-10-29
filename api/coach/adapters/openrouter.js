/* OpenRouter: the Chat Completions shape (core/adapters/openai.js) against openrouter.ai/api/v1,
 * with the three things only this server needs:
 *
 *   - the key is read from OPENROUTER_API_KEY in the job env and from nowhere else (config.js
 *     credentialFor), never from coach.json;
 *   - OPENROUTER_MODEL names the model, and OPENROUTER_FALLBACK_MODEL (unset by default) names the
 *     one to try once when the first is out of quota, overloaded or gone. The fallback is where a
 *     paid model goes, so it is only used when the operator put it there;
 *   - COACH_OPENROUTER_NO_TRAINING=1 asks OpenRouter to route only to providers that do not
 *     collect or train on prompts (`provider.data_collection: deny`). Free models mostly have no
 *     such endpoint, so on a free model it turns "slow" into "unavailable"; off by default.
 *
 * Lives under api/coach/adapters, not core: it reads process.env, and core also runs on a phone. */
import { httpAdapter } from '../core/adapters/http.js';
import { chatCompletionsSpec } from '../core/adapters/openai.js';

const base = chatCompletionsSpec('openrouter', { maxTokensField: 'max_tokens', temperature: 0.2 });
const on = v => /^(1|true|yes|on)$/i.test(v || '');

export const openrouterSpec = {
  ...base,
  // OpenRouter's optional attribution headers; ASCII only, they carry no user data.
  headers: key => ({ ...base.headers(key), 'x-title': 'Zhimolost Coach' }),
  body: args => {
    const body = base.body(args);
    return on(process.env.COACH_OPENROUTER_NO_TRAINING) ? { ...body, provider: { data_collection: 'deny' } } : body;
  }
};

const inner = httpAdapter(openrouterSpec);

// Out of free requests (429), out of credit (402), the model gone or its upstream down (404/5xx).
// Not a timeout (the next model would be as slow) and not 401/403 (a fallback cannot fix the key).
const FALLBACK_ON = /^(402|404|429|5\d\d)\b/;

export const fallbackModel = () => (process.env.OPENROUTER_FALLBACK_MODEL || '').trim() || null;

const adapter = {
  ...inner,
  async invoke(opts = {}) {
    const first = await inner.invoke(opts);
    const next = fallbackModel();
    const asked = opts.model || null;
    if (first.code === 0 || first.timedOut || first.spawnError || !next || next === asked) return first;
    if (!FALLBACK_ON.test(String(first.stderr || ''))) return first;
    if (opts.signal && opts.signal.aborted) return first;
    return inner.invoke({ ...opts, model: next });
  }
};

export default adapter;
