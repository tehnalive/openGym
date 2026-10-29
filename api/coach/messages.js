/* Words the server itself says to a lifter, in Russian and English.
 *
 * Two things the app's own packs cannot say, because they depend on the instance rather than on
 * the build: what the configured provider does with the data (the consent notice), and why a job
 * to a rate-limited free model failed. Everything else the Coach says stays in the app's locale
 * packs (frontend/src/locales). A language other than Russian gets English.
 *
 * Nothing here carries a key, a URL with credentials or a provider's raw error text. */

import { REFUSAL } from './core/guard.js';

const ru = lang => /^ru\b/i.test(String(lang || ''));

/* Why a job failed, for the classes the app has no line for. The class is decided in jobs.js from
   the provider's status; the words never include the provider's own message. */
const FAILURES = {
  ratelimit: {
    ru: 'Бесплатная нейросеть сейчас перегружена или лимит запросов исчерпан. Попробуйте через несколько минут; если не помогает, лимит закончился на сегодня, повторите завтра.',
    en: 'The free AI model is busy or its request limit is used up. Try again in a few minutes; if it keeps failing, the limit is spent for today.'
  },
  offtopic: {
    ru: REFUSAL,
    en: REFUSAL
  },
  quota: {
    ru: 'У сервиса нейросети закончились средства на счёте. Владельцу сервера нужно проверить аккаунт OpenRouter.',
    en: 'The AI service account is out of credit. The server owner needs to check the OpenRouter account.'
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
  if (n === 429) return 'ratelimit';
  if (n === 402) return 'quota';
  if (n === 404 || (n === 400 && /\bmodel\b.*(not available|not a valid|unknown|invalid)/i.test(detail))) return 'modelgone';
  return null;
}

/* The consent notice shown beside the provider's name. Honest about who receives the data and, on
   a free model, that the model's operator may log it and learn from it. */
export function providerNotice(provider, model) {
  if (provider !== 'openrouter') return null;
  return { ru: noticeIn('ru', model), en: noticeIn('en', model) };
}
function noticeIn(lang, model) {
  const free = /:free$/.test(String(model || '')) || /^openrouter\/free$/.test(String(model || ''));
  const name = model ? String(model).slice(0, 80) : 'AI';
  if (lang === 'ru') {
    return [
      `Данные тренировок уходят на сервис OpenRouter (openrouter.ai), а оттуда в нейросеть: ${name}.`,
      free
        ? 'Это бесплатная модель: её владелец может сохранять ваши запросы и использовать их для обучения. Не пишите Тренеру ничего, чем не готовы поделиться.'
        : 'Это платная модель; у неё свои правила хранения запросов. Не пишите Тренеру ничего, чем не готовы поделиться.',
      'Имя в Telegram и ваш идентификатор не отправляются.'
    ].join(' ');
  }
  return [
    `Your training data goes to OpenRouter (openrouter.ai) and from there to the model ${name}.`,
    free
      ? 'This is a free model: its operator may keep your requests and use them for training. Do not tell the Coach anything you are not happy to share.'
      : 'This is a paid model with its own retention rules. Do not tell the Coach anything you are not happy to share.',
    'Your Telegram name and id are not sent.'
  ].join(' ');
}
