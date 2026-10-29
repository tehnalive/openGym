/* Words the server itself says to a lifter, in Russian and English.
 *
 * Two things the app's own packs cannot say, because they depend on the instance rather than on
 * the build: what the configured provider does with the data (the consent notice), and why a job
 * to a rate-limited free model failed. Everything else the Coach says stays in the app's locale
 * packs (frontend/src/locales). A language other than Russian gets English.
 *
 * Nothing here carries a key, a URL with credentials or a provider's raw error text. */

const ru = lang => /^ru\b/i.test(String(lang || ''));

/* Why a job failed, for the classes the app has no line for. The class is decided in jobs.js from
   the provider's status; the words never include the provider's own message. */
const FAILURES = {
  ratelimit: {
    ru: 'Нейросеть сейчас перегружена или лимит запросов исчерпан. Попробуйте через несколько минут; если не помогает, повторите позже.',
    en: 'The AI model is busy or its request limit is used up. Try again in a few minutes; if it keeps failing, try later.'
  },
  freeonly: {
    ru: 'Бесплатная нейросеть недоступна для Тренера на этом сервере. Владельцу сервера нужно выбрать платную модель OpenCode.',
    en: 'The free AI model is not available to the Coach on this server. The server owner needs to pick a paid OpenCode model.'
  },
  quota: {
    ru: 'У сервиса нейросети закончились средства на счёте. Владельцу сервера нужно проверить аккаунт OpenCode.',
    en: 'The AI service account is out of credit. The server owner needs to check the OpenCode account.'
  },
  modelgone: {
    ru: 'Выбранная нейросеть недоступна. Владельцу сервера нужно выбрать другую модель.',
    en: 'The chosen AI model is not available. The server owner needs to pick another one.'
  }
};
export const FAILURE_CLASSES = Object.keys(FAILURES);
export const failureMessage = (cls, lang) => (FAILURES[cls] ? FAILURES[cls][ru(lang) ? 'ru' : 'en'] : null);

/** The provider's status, as `invoke` reports it in stderr ("429 …"), to a class for the lifter. */
export function classifyProviderFailure(detail) {
  const status = /^(\d{3})\b/.exec(String(detail || '').trim());
  if (!status) return null;
  const n = +status[1];
  // The gateway answers 429 FreeUsageLimitError ("Free models work in OpenCode") to a free model
  // called from anywhere else; waiting would not help, another model would.
  if (n === 429 && /free usage limit|free models work in opencode/i.test(detail)) return 'freeonly';
  if (n === 429) return 'ratelimit';
  if ((n === 401 || n === 403) && /insufficient (balance|credit)|no (credits?|balance)|out of credit/i.test(detail)) return 'quota';
  if (n === 402) return 'quota';
  if (n === 404 || (n === 400 && /\bmodel\b.*(not available|not a valid|unknown|invalid)/i.test(detail))) return 'modelgone';
  return null;
}

/* The consent notice shown beside the provider's name. Honest about who receives the data and what
   the gateway's documentation (opencode.ai/docs/zen, privacy section, 2026-10-30) says about the
   chosen model: most models are zero-retention and not trained on, a few free ones are not. */
const TRAINS = /^(big-pickle|flint-40b-free|mimo-v2\.6-flash-free)$/;
const LOGGED = /^nemotron-.*-free$/;
const KEPT_30 = /^(beam-free|claude-.*|gpt-.*)$/;
export function retentionOf(model) {
  const m = String(model || '');
  if (TRAINS.test(m)) return 'training';
  if (LOGGED.test(m)) return 'logged';
  if (KEPT_30.test(m)) return 'kept30';
  return 'zero';
}
const NOTICE = {
  ru: {
    head: (name) => `Данные тренировок уходят на сервис OpenCode (opencode.ai), а оттуда в нейросеть: ${name}.`,
    training: 'По документации OpenCode, эта бесплатная модель может использовать ваши запросы для улучшения модели.',
    logged: 'По документации OpenCode, запросы к этой бесплатной модели записываются для безопасности и улучшения продукта.',
    kept30: 'По документации OpenCode, запросы к этой модели хранятся 30 дней.',
    zero: 'По документации OpenCode, провайдер этой модели не хранит запросы и не обучается на них; это условие провайдера, мы его проверить не можем.',
    free: 'Бесплатный период ограничен по времени.',
    tail: 'Не пишите Тренеру ничего, чем не готовы поделиться. Имя в Telegram и ваш идентификатор не отправляются.'
  },
  en: {
    head: (name) => `Your training data goes to OpenCode (opencode.ai) and from there to the model ${name}.`,
    training: 'According to OpenCode\'s documentation, this free model may use your requests to improve the model.',
    logged: 'According to OpenCode\'s documentation, requests to this free model are logged for security and product improvement.',
    kept30: 'According to OpenCode\'s documentation, requests to this model are kept for 30 days.',
    zero: 'According to OpenCode\'s documentation, this model\'s provider keeps no requests and does not train on them; that is the provider\'s promise and cannot be checked from here.',
    free: 'The free period is limited in time.',
    tail: 'Do not tell the Coach anything you are not happy to share. Your Telegram name and id are not sent.'
  }
};
export function providerNotice(provider, model) {
  if (provider !== 'opencode') return null;
  const name = model ? String(model).slice(0, 80) : 'AI';
  const free = /-free$/.test(String(model || ''));
  const mk = L => [NOTICE[L].head(name), NOTICE[L][retentionOf(model)], ...(free ? [NOTICE[L].free] : []), NOTICE[L].tail].join(' ');
  return { ru: mk('ru'), en: mk('en') };
}
