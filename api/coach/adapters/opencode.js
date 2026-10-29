/* OpenCode (the Zen gateway, opencode.ai/docs/zen): Chat Completions at
 * {base}/openai/v1/chat/completions, the model list at {base}/v1/models, bearer key. Two paths
 * under one base is how the gateway documents itself, so the spec states both.
 *
 * What only this server needs:
 *   - the key is read from OPENCODE_API_KEY in the job env and from nowhere else (config.js
 *     credentialFor), never from coach.json;
 *   - OPENCODE_MODEL names the model, OPENCODE_BASE_URL the address (default
 *     https://opencode.ai/inference), and OPENCODE_FALLBACK_MODEL (unset by default) the one to try
 *     once when the first is refused for quota, limit or availability. A paid model goes there
 *     only when the operator put it there.
 *
 * Lives under api/coach/adapters, not core: it reads process.env, and core also runs on a phone. */
import { httpAdapter } from '../core/adapters/http.js';
import { chatCompletionsSpec } from '../core/adapters/openai.js';
import { validateBaseUrl } from '../core/providers.js';

const base = chatCompletionsSpec('opencode', { maxTokensField: 'max_tokens', temperature: 0.2 });

export const opencodeSpec = {
  ...base,
  path: () => '/openai/v1/chat/completions',
  modelsPath: '/v1/models'
};

/** The operator's address from OPENCODE_BASE_URL when it is a valid URL, else null. */
export function envBaseUrl() {
  const v = validateBaseUrl(process.env.OPENCODE_BASE_URL);
  return v.ok && v.value ? v.value : null;
}
const withBase = cfg => {
  const url = envBaseUrl();
  return url ? { ...cfg, providerOptions: { ...(cfg && cfg.providerOptions), opencode: { ...((cfg && cfg.providerOptions && cfg.providerOptions.opencode) || {}), baseUrl: url } } } : cfg;
};

const inner = httpAdapter(opencodeSpec);

// Out of credit (402), a limit (429, including the gateway's "free models work in OpenCode"), the
// model gone (404) or the upstream down (5xx). Not a timeout (the next model would be as slow)
// and not 401/403 (a fallback cannot fix the key).
const FALLBACK_ON = /^(402|404|429|5\d\d)\b/;

export const fallbackModel = () => (process.env.OPENCODE_FALLBACK_MODEL || '').trim() || null;

const adapter = {
  ...inner,
  baseUrl: cfg => inner.baseUrl(withBase(cfg)),
  check: (cfg, env, opts) => inner.check(withBase(cfg), env, opts),
  models: (cfg, env, opts) => inner.models(withBase(cfg), env, opts),
  async invoke(opts = {}) {
    const o = { ...opts, cfg: withBase(opts.cfg) };
    const first = await inner.invoke(o);
    const next = fallbackModel();
    if (first.code === 0 || first.timedOut || first.spawnError || !next || next === (opts.model || null)) return first;
    if (!FALLBACK_ON.test(String(first.stderr || ''))) return first;
    if (opts.signal && opts.signal.aborted) return first;
    return inner.invoke({ ...o, model: next });
  }
};

export default adapter;
