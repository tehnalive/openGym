export const MUSCLE_NAMES = Object.freeze({
  en: {
    trapezius: 'traps', deltoids: 'shoulders', chest: 'chest', 'upper-back': 'upper back',
    serratus: 'serratus', biceps: 'biceps', triceps: 'triceps', forearm: 'forearms',
    abs: 'abs', obliques: 'obliques', 'lower-back': 'lower back', gluteal: 'glutes',
    quadriceps: 'quads', hamstring: 'hamstrings', adductors: 'adductors',
    'hip-flexors': 'hip flexors', calves: 'calves', tibialis: 'shins',
  },
  ru: {
    trapezius: 'трапеции', deltoids: 'плечи', chest: 'грудь', 'upper-back': 'верх спины',
    serratus: 'зубчатые мышцы', biceps: 'бицепс', triceps: 'трицепс', forearm: 'предплечья',
    abs: 'пресс', obliques: 'косые мышцы', 'lower-back': 'низ спины', gluteal: 'ягодицы',
    quadriceps: 'квадрицепс', hamstring: 'бицепс бедра', adductors: 'приводящие мышцы',
    'hip-flexors': 'сгибатели бедра', calves: 'икры', tibialis: 'передняя часть голени',
  },
});

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isWarmup = set => set?.warmup === true || set?.phase === 'warmup';
const isSideSet = set => isObject(set?.sides) && isObject(set.sides.L) && isObject(set.sides.R);
const repsVolume = set => {
  if (!set?.done) return 0;
  const drops = Array.isArray(set.drops) ? set.drops : [];
  return (Number(set.w) || 0) * (Number(set.r) || 0)
    + drops.reduce((sum, drop) => sum + (Number(drop?.w) || 0) * (Number(drop?.r) || 0), 0);
};
const setVolume = set => isSideSet(set)
  ? repsVolume(set.sides.L) + repsVolume(set.sides.R)
  : repsVolume(set);
const completedUnits = set => isSideSet(set)
  ? Number(set.sides.L.done === true) + Number(set.sides.R.done === true)
  : Number(set?.done === true);
const cleanText = (value, max = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const localized = lang => String(lang || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

// Language of bot messages. Order: a language the user picked in the app (en/ru), then the
// language_code from the last signed Telegram initData, then Russian (this service's default).
// The profile's default 'en' (langAuto) is not a choice and must not win over Telegram.
export function notificationLang(user, state) {
  const picked = typeof state?.lang === 'string' ? state.lang.toLowerCase() : '';
  if (state?.langAuto !== true && (picked === 'ru' || picked.startsWith('ru-') || picked === 'en' || picked.startsWith('en-'))) return localized(picked);
  const tg = typeof user?.telegramLang === 'string' ? user.telegramLang : '';
  return tg ? localized(tg) : 'ru';
}

// Only the bare language subtag of a verified Telegram language_code is stored.
export function telegramLangCode(value) {
  const code = typeof value === 'string' ? value.toLowerCase().split(/[-_]/)[0] : '';
  return /^[a-z]{2,3}$/.test(code) ? code : '';
}

// 1 подход, 2 подхода, 5 подходов, 11 подходов, 21 подход
export function ruPlural(n, one, few, many) {
  const abs = Math.abs(Math.trunc(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
const enPlural = (n, one, many) => (n === 1 ? one : many);
const COUNT = {
  sets: { ru: n => `${n} ${ruPlural(n, 'рабочий подход', 'рабочих подхода', 'рабочих подходов')}`, en: n => `${n} ${enPlural(n, 'working set', 'working sets')}` },
  exercises: { ru: n => `${n} ${ruPlural(n, 'упражнение', 'упражнения', 'упражнений')}`, en: n => `${n} ${enPlural(n, 'exercise', 'exercises')}` },
  workouts: { ru: n => `${n} ${ruPlural(n, 'тренировка', 'тренировки', 'тренировок')}`, en: n => `${n} ${enPlural(n, 'workout', 'workouts')}` },
};
export const countText = (kind, n, lang) => COUNT[kind][lang === 'ru' ? 'ru' : 'en'](n);
const fmt = (number, lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 }).format(Math.round(number));

export function statsForWorkout(workout) {
  const entries = Array.isArray(workout?.entries) ? workout.entries.filter(isObject) : [];
  let sets = 0;
  let volume = 0;
  let exercises = 0;
  const muscles = {};
  for (const entry of entries) {
    const rows = Array.isArray(entry.sets) ? entry.sets : [];
    const before = sets;
    const weights = entry.muscleSnapshot?.muscleWeights;
    for (const set of rows) {
      if (!isObject(set) || isWarmup(set)) continue;
      const units = completedUnits(set);
      if (!units) continue;
      sets += units;
      volume += setVolume(set);
      if (isObject(weights)) for (const [muscle, weight] of Object.entries(weights)) {
        const n = Number(weight);
        if (n > 0 && Number.isFinite(n)) muscles[muscle] = (muscles[muscle] || 0) + units * n;
      }
    }
    if (sets > before) exercises += 1;
  }
  if (Number.isFinite(workout?.vol) && workout.vol >= 0) volume = workout.vol;
  return { sets, volume, exercises, muscles };
}

function topMuscles(scores, lang, count = 4) {
  const names = MUSCLE_NAMES[lang];
  return Object.entries(scores || {})
    .filter(([key, value]) => names[key] && Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key]) => names[key]);
}

function volumeLine(volume, unit, lang) {
  if (!(volume > 0)) return null;
  const unitName = unit === 'lb' ? 'lb' : lang === 'ru' ? 'кг' : 'kg';
  return lang === 'ru' ? `Тоннаж: ${fmt(volume, lang)} ${unitName}` : `Volume: ${fmt(volume, lang)} ${unitName}`;
}

export function workoutNotificationText(workout, state, langOverride) {
  const lang = langOverride ? localized(langOverride) : localized(state?.lang);
  const stats = statsForWorkout(workout);
  const muscleList = topMuscles(stats.muscles, lang, 3);
  const title = cleanText(workout?.name, 80);
  const volume = volumeLine(stats.volume, state?.unit, lang);
  if (lang === 'ru') return [
    '✅ Тренировка записана',
    title ? `«${title}»` : null,
    `${countText('exercises', stats.exercises, lang)} · ${countText('sets', stats.sets, lang)}`,
    volume,
    muscleList.length ? `Группы мышц: ${muscleList.join(', ')}` : null,
    'Отличная работа — продолжай в своём темпе 💪',
  ].filter(Boolean).join('\n');
  return [
    '✅ Workout saved', title || null,
    `${countText('exercises', stats.exercises, lang)} · ${countText('sets', stats.sets, lang)}`, volume,
    muscleList.length ? `Muscle groups: ${muscleList.join(', ')}` : null,
    'Great work — keep building at your own pace 💪',
  ].filter(Boolean).join('\n');
}

export function weekStart(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - weekday + 1);
  return day.toISOString().slice(0, 10);
}

const shiftDate = (date, days) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function previousWeekRange(currentMonday) {
  return { from: shiftDate(currentMonday, -7), to: shiftDate(currentMonday, -1) };
}

export function weeklySummaryText(workouts, state, range, langOverride) {
  const lang = langOverride ? localized(langOverride) : localized(state?.lang);
  const list = Array.isArray(workouts) ? workouts.filter(isObject) : [];
  if (!list.length) return null;
  let sets = 0;
  let volume = 0;
  const muscles = {};
  for (const workout of list) {
    const stats = statsForWorkout(workout);
    sets += stats.sets;
    volume += stats.volume;
    for (const [muscle, weight] of Object.entries(stats.muscles)) muscles[muscle] = (muscles[muscle] || 0) + weight;
  }
  const muscleList = topMuscles(muscles, lang, 4);
  const volumeText = volumeLine(volume, state?.unit, lang);
  if (lang === 'ru') return [
    '📊 Итоги прошлой недели',
    `${range.from} — ${range.to}`,
    `${countText('workouts', list.length, lang)} · ${countText('sets', sets, lang)}`,
    volumeText,
    muscleList.length ? `Группы мышц: ${muscleList.join(', ')}` : null,
    list.length >= 3 ? 'Отличный ритм — ты стабильно двигаешься к цели 🔥' : 'Каждая тренировка засчитывается. Хорошая работа 💪',
  ].filter(Boolean).join('\n');
  return [
    '📊 Last week’s training', `${range.from} — ${range.to}`,
    `${countText('workouts', list.length, lang)} · ${countText('sets', sets, lang)}`, volumeText,
    muscleList.length ? `Most trained: ${muscleList.join(', ')}` : null,
    list.length >= 3 ? 'Great rhythm — you’re making steady progress 🔥' : 'Every workout counts. Nice work 💪',
  ].filter(Boolean).join('\n');
}

export function validNotificationPreferences(body) {
  if (!isObject(body) || typeof body.workoutUpdates !== 'boolean'
    || typeof body.weeklySummary !== 'boolean' || typeof body.timezone !== 'string'
    || body.timezone.length > 128) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }).format(new Date()); return true; }
  catch { return false; }
}

export function publicNotificationPreferences(user) {
  const prefs = isObject(user?.telegramNotifications) ? user.telegramNotifications : {};
  return {
    workoutUpdates: prefs.workoutUpdates === true,
    weeklySummary: prefs.weeklySummary === true,
    timezone: typeof prefs.timezone === 'string' ? prefs.timezone : 'UTC',
  };
}

export function notificationState(user) {
  if (!isObject(user.telegramNotifications)) user.telegramNotifications = {};
  const prefs = user.telegramNotifications;
  if (!Array.isArray(prefs.attemptedWorkoutIds)) prefs.attemptedWorkoutIds = [];
  if (prefs.attemptedWorkoutIds.length > 500) prefs.attemptedWorkoutIds = prefs.attemptedWorkoutIds.slice(-500);
  return prefs;
}
