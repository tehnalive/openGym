import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationLang, ruPlural, telegramLangCode, workoutNotificationText, weeklySummaryText, statsForWorkout,
} from '../telegram-notifications.mjs';

const workout = {
  name: 'Грудь', vol: 4200,
  entries: [
    { muscleSnapshot: { muscleWeights: { chest: 1, triceps: 0.5 } }, sets: [{ done: true, w: 60, r: 10 }, { done: true, w: 60, r: 10 }] },
    { muscleSnapshot: { muscleWeights: { deltoids: 1 } }, sets: [{ done: true, w: 20, r: 12 }] },
  ],
};

test('ruPlural covers 1, 2-4, 5-20, 21, 11-14', () => {
  const f = n => ruPlural(n, 'подход', 'подхода', 'подходов');
  const expect = { 0: 'подходов', 1: 'подход', 2: 'подхода', 4: 'подхода', 5: 'подходов', 11: 'подходов', 12: 'подходов', 14: 'подходов', 21: 'подход', 22: 'подхода', 25: 'подходов', 101: 'подход', 111: 'подходов', 112: 'подходов' };
  for (const [n, word] of Object.entries(expect)) assert.equal(f(Number(n)), word, `n=${n}`);
});

test('stats count exercises with completed sets', () => {
  const stats = statsForWorkout(workout);
  assert.equal(stats.sets, 3);
  assert.equal(stats.exercises, 2);
});

test('notificationLang: picked language > Telegram language > Russian', () => {
  assert.equal(notificationLang({}, { lang: 'en', langAuto: true }), 'ru');
  assert.equal(notificationLang({ telegramLang: 'en' }, { lang: 'en', langAuto: true }), 'en');
  assert.equal(notificationLang({ telegramLang: 'ru' }, { lang: 'en', langAuto: true }), 'ru');
  assert.equal(notificationLang({ telegramLang: 'ru' }, { lang: 'en' }), 'en');
  assert.equal(notificationLang({ telegramLang: 'en' }, { lang: 'ru' }), 'ru');
  assert.equal(notificationLang({ telegramLang: 'uk' }, { lang: 'de' }), 'en');
  assert.equal(notificationLang(null, null), 'ru');
});

test('telegramLangCode keeps only a safe language subtag', () => {
  assert.equal(telegramLangCode('ru'), 'ru');
  assert.equal(telegramLangCode('pt-BR'), 'pt');
  assert.equal(telegramLangCode('<script>'), '');
  assert.equal(telegramLangCode(5), '');
});

test('workout message is Russian with correct declensions', () => {
  const text = workoutNotificationText(workout, { unit: 'kg', lang: 'en' }, 'ru');
  assert.match(text, /Тренировка записана/);
  assert.match(text, /2 упражнения · 3 рабочих подхода/);
  assert.match(text, /Тоннаж: 4\s?200 кг/);
  assert.match(text, /Группы мышц: грудь, плечи, трицепс/);
  assert.doesNotMatch(text, /Workout|Volume|sets/);
  const one = workoutNotificationText({ entries: [{ sets: [{ done: true, w: 1, r: 1 }] }] }, {}, 'ru');
  assert.match(one, /1 упражнение · 1 рабочий подход/);
  const five = workoutNotificationText({ entries: Array.from({ length: 5 }, () => ({ sets: [{ done: true, w: 1, r: 1 }] })) }, {}, 'ru');
  assert.match(five, /5 упражнений · 5 рабочих подходов/);
});

test('workout message stays English when asked', () => {
  const text = workoutNotificationText(workout, { unit: 'lb' }, 'en');
  assert.match(text, /Workout saved/);
  assert.match(text, /2 exercises · 3 working sets/);
  assert.match(text, /lb/);
});

test('weekly summary is Russian with declensions', () => {
  const range = { from: '2026-10-19', to: '2026-10-25' };
  const text = weeklySummaryText([workout, workout, workout], { unit: 'kg' }, range, 'ru');
  assert.match(text, /Итоги прошлой недели/);
  assert.match(text, /3 тренировки · 9 рабочих подходов/);
  assert.match(text, /Отличный ритм/);
  const one = weeklySummaryText([workout], {}, range, 'ru');
  assert.match(one, /1 тренировка · 3 рабочих подхода/);
  assert.match(weeklySummaryText([workout], {}, range, 'en'), /1 workout · 3 working sets/);
  assert.equal(weeklySummaryText([], {}, range, 'ru'), null);
});
