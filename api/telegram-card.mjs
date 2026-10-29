// The workout report card (design A, 1080x1080) sent with sendPhoto after a workout is saved.
//   cardModel        — what the card says, from a saved workout (pure)
//   workoutCardSvg   — the card as an SVG string (pure; every dynamic string is XML-escaped)
//   renderCardPng    — SVG to PNG with @resvg/resvg-js, loaded on first use
// If the renderer cannot be loaded or fails, the caller sends the plain text message instead.
// The body outlines are card-assets/body-male.json, derived from MuscleMap (MIT, see NOTICE.md);
// nothing from catalogue/media is used. Fonts are Inter (SIL OFL), shipped in card-assets/.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { statsForWorkout, ruPlural, MUSCLE_NAMES } from './telegram-notifications.mjs';

const ASSETS = new URL('./card-assets/', import.meta.url);
const readJson = name => JSON.parse(fs.readFileSync(new URL(name, ASSETS), 'utf8'));
let bodyCache = null;
let namesCache = null;
const bodyPaths = () => (bodyCache ??= readJson('body-male.json'));
const exerciseNames = () => (namesCache ??= readJson('exercise-names.json'));

export const CARD_SIZE = 1080;

export const PHRASES = Object.freeze({
  ru: [
    'Круто, что ты потренировался!', 'Каждая тренировка приближает к цели.', 'Сегодня ты сильнее, чем вчера.',
    'Регулярность сильнее мотивации.', 'Твоё тело скажет спасибо.', 'Отличная работа, так держать!',
    'Сегодня ты выбрал себя.', 'Ещё один шаг в копилку.', 'Дисциплина — это тоже сила.',
    'Прогресс складывается из таких дней.', 'Горжусь твоим упорством.', 'Отдыхай — ты это заслужил.',
  ],
  en: [
    'Great that you showed up!', 'Every workout moves you closer to the goal.', 'You are stronger than yesterday.',
    'Consistency beats motivation.', 'Your body will thank you.', 'Great work, keep it up!',
    'Today you chose yourself.', 'One more step in the bank.', 'Discipline is strength too.',
    'Progress is made of days like this.', 'Proud of your effort.', 'Rest up, you earned it.',
  ],
});

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const upperFirst = text => (text ? text[0].toLocaleUpperCase() + text.slice(1) : text);

export const phraseFor = (lang, index) => {
  const list = PHRASES[lang === 'ru' ? 'ru' : 'en'];
  const i = Number.isSafeInteger(index) && index >= 0 ? index : 0;
  return list[i % list.length];
};

const doneSides = set => (isObject(set?.sides) && isObject(set.sides.L) && isObject(set.sides.R)
  ? [set.sides.L, set.sides.R] : [set]).filter(side => side?.done === true);
const isWarmup = set => set?.warmup === true || set?.phase === 'warmup';

// Exercise display name: a custom exercise from the profile, else the catalogue pack.
export function exerciseName(id, state, lang) {
  const key = String(id ?? '');
  const custom = Array.isArray(state?.customEx) ? state.customEx.find(ex => isObject(ex) && String(ex.id) === key) : null;
  if (custom && typeof custom.name === 'string' && custom.name.trim()) return cleanText(custom.name, 60);
  const names = exerciseNames()[key];
  if (!names) return '';
  return upperFirst(cleanText(lang === 'ru' && names[1] ? names[1] : names[0], 60));
}

// The heaviest completed work set of the workout (more reps wins a tie).
export function bestSet(workout, state, lang) {
  let best = null;
  for (const entry of Array.isArray(workout?.entries) ? workout.entries : []) {
    for (const set of Array.isArray(entry?.sets) ? entry.sets : []) {
      if (!isObject(set) || isWarmup(set)) continue;
      for (const side of doneSides(set)) {
        const w = Number(side.w);
        const r = Number(side.r);
        if (!(w > 0) || !(r > 0) || !Number.isFinite(w) || !Number.isFinite(r)) continue;
        if (!best || w > best.w || (w === best.w && r > best.r)) best = { id: entry.id, w, r };
      }
    }
  }
  if (!best) return null;
  const name = exerciseName(best.id, state, lang);
  return name ? { name, w: best.w, r: best.r } : null;
}

const levelOf = (score, max) => (score > 0 && max > 0 ? Math.min(4, Math.max(1, Math.ceil((score / max) * 4))) : 0);

function repsTotal(workout) {
  let reps = 0;
  for (const entry of Array.isArray(workout?.entries) ? workout.entries : []) {
    for (const set of Array.isArray(entry?.sets) ? entry.sets : []) {
      if (!isObject(set) || isWarmup(set)) continue;
      for (const side of doneSides(set)) reps += Number(side.r) > 0 ? Number(side.r) : 0;
    }
  }
  return reps;
}

const DAYS = {
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  en: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
};
const MONTHS = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
};
function dateLabel(workout, lang) {
  const day = typeof workout?.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(workout.d) ? workout.d
    : Number.isFinite(workout?.end) ? new Date(workout.end).toISOString().slice(0, 10) : '';
  const date = day ? new Date(`${day}T12:00:00Z`) : null;
  if (!date || !Number.isFinite(date.getTime())) return '';
  const l = lang === 'ru' ? 'ru' : 'en';
  const text = l === 'ru'
    ? `${DAYS.ru[date.getUTCDay()]} · ${date.getUTCDate()} ${MONTHS.ru[date.getUTCMonth()]}`
    : `${DAYS.en[date.getUTCDay()]} · ${MONTHS.en[date.getUTCMonth()]} ${date.getUTCDate()}`;
  return text.toUpperCase();
}

const formatNumber = (n, lang) => new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 1 }).format(n)
  .replace(/ | /g, ' ');

export function cardModel(workout, state, lang, phraseIndex = 0) {
  const l = lang === 'ru' ? 'ru' : 'en';
  const stats = statsForWorkout(workout);
  const unit = state?.unit === 'lb' ? 'lb' : l === 'ru' ? 'кг' : 'kg';
  const max = Math.max(0, ...Object.values(stats.muscles));
  const levels = {};
  for (const [muscle, score] of Object.entries(stats.muscles)) levels[muscle] = levelOf(score, max);
  const names = MUSCLE_NAMES[l];
  const muscleNames = Object.entries(stats.muscles).filter(([key, v]) => names[key] && v > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key]) => names[key]);
  const durationMs = Number.isFinite(workout?.start) && Number.isFinite(workout?.end) ? workout.end - workout.start : 0;
  const minutes = durationMs >= 60_000 ? Math.round(durationMs / 60_000) : 0;
  const best = bestSet(workout, state, l);
  const journal = Array.isArray(state?.workouts) ? state.workouts.length : 0;
  return {
    lang: l,
    title: cleanText(workout?.name, 60),
    date: dateLabel(workout, l),
    phrase: phraseFor(l, phraseIndex),
    duration: minutes ? (l === 'ru'
      ? (minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`)
      : (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`)) : '',
    volume: stats.volume > 0 ? `${formatNumber(Math.round(stats.volume), l)} ${unit}` : '',
    sets: stats.sets,
    reps: repsTotal(workout),
    levels,
    muscleNames: muscleNames.map(upperFirst),
    record: best ? { name: best.name, text: `${formatNumber(best.w, l)} ${unit} × ${best.r}` } : null,
    journal: journal > 0 ? journal : 0,
  };
}

const LABELS = {
  ru: {
    brand: 'Жимолость', muscles: 'МЫШЦЫ В РАБОТЕ', duration: 'длительность', volume: 'общий тоннаж',
    sets: n => ruPlural(n, 'подход', 'подхода', 'подходов'), reps: n => ruPlural(n, 'повторение', 'повторения', 'повторений'),
    record: 'РЕКОРД ТРЕНИРОВКИ · МАКСИМАЛЬНЫЙ ВЕС',
    journal: n => `${n}-я тренировка в журнале`, saved: 'Тренировка сохранена', fallbackTitle: 'Тренировка',
  },
  en: {
    brand: 'Жимолость', muscles: 'MUSCLES WORKED', duration: 'duration', volume: 'total volume',
    sets: n => (n === 1 ? 'set' : 'sets'), reps: n => (n === 1 ? 'rep' : 'reps'),
    record: 'WORKOUT RECORD · HEAVIEST WEIGHT',
    journal: n => `Workout #${n} in your log`, saved: 'Workout saved', fallbackTitle: 'Workout',
  },
};

const COLORS = { bg: '#000000', panel: '#1c1c1e', low: '#0e0e10', line: '#353538', white: '#ffffff', muted: '#98989f', green: '#30d158', soft: '#112c18', dim: '#55555b' };
const SHADES = ['#2c2c2e', '#194b25', '#217c35', '#28a545', '#30d158'];
const INERT = new Set(['head', 'hair', 'neck', 'hands', 'feet', 'knees', 'ankles']);

export const xmlEscape = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ' ')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Inter averages about 0.58 em per Latin/Cyrillic character in bold: shrink to fit, then cut.
function fit(text, size, maxWidth, min = 34, factor = 0.6) {
  let s = size;
  while (s > min && text.length * s * factor > maxWidth) s -= 2;
  const maxChars = Math.floor(maxWidth / (s * factor));
  return { text: text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…` : text, size: s };
}

export function workoutCardSvg(model) {
  const L = LABELS[model.lang];
  const out = [];
  const rect = (x, y, w, h, fill, r = 0) => out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`);
  // y is the top of the text box as in the design; the baseline sits 0.9 em below it.
  const text = (value, x, y, size, fill, bold = false, anchor = 'start') => out.push(
    `<text x="${x}" y="${Math.round(y + size * 0.9)}" font-size="${size}" font-weight="${bold ? 700 : 400}" fill="${fill}" text-anchor="${anchor}">${xmlEscape(value)}</text>`);
  const stat = (value, label, x, y, size) => { text(value, x, y, size, COLORS.white, true); text(label, x, y + size + 8, 25, COLORS.muted); };

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_SIZE}" height="${CARD_SIZE}" viewBox="0 0 ${CARD_SIZE} ${CARD_SIZE}" font-family="Inter">`);
  rect(0, 0, CARD_SIZE, CARD_SIZE, COLORS.bg);

  // Header: logo, name, date.
  rect(64, 54, 48, 48, COLORS.green, 14);
  out.push('<g stroke="#000" stroke-width="3" stroke-linecap="round" fill="none"><path d="M79 78H97M82 70V86M94 70V86M76 74V82M100 74V82"/></g>');
  text(L.brand, 128, 55, 30, COLORS.white, true);
  if (model.date) text(model.date, 1016, 62, 24, COLORS.muted, false, 'end');

  // Title and the motivating phrase.
  const title = fit(model.title || L.fallbackTitle, 60, 952);
  text(title.text, 64, 132, title.size, COLORS.white, true);
  const phrase = fit(model.phrase, 28, 952, 22, 0.52);
  text(phrase.text, 64, 211, phrase.size, COLORS.muted);

  // Body panel.
  rect(64, 277, 455, 461, COLORS.low, 26);
  text(L.muscles, 90, 301, 23, COLORS.muted, true);
  const body = bodyPaths();
  let ox = 85;
  for (const side of ['front', 'back']) {
    const view = body[side];
    const [vx, vy, vw, vh] = view.vb.split(' ').map(Number);
    const s = 302 / vh;
    out.push(`<g transform="translate(${(ox - vx * s).toFixed(2)} ${(352 - vy * s).toFixed(2)}) scale(${s.toFixed(5)})">`);
    for (const [muscle, paths] of Object.entries(view.p)) {
      const fill = INERT.has(muscle) ? COLORS.line : SHADES[Math.min(4, Math.max(0, model.levels[muscle] | 0))];
      for (const d of paths) out.push(`<path d="${d}" fill="${fill}"/>`);
    }
    out.push('</g>');
    ox += vw * s + 10;
  }
  const first = fit(model.muscleNames.slice(0, 2).join(' · '), 28, 395, 20, 0.56);
  const second = fit(model.muscleNames.slice(2, 4).join(' · '), 25, 395, 18, 0.56);
  if (first.text) text(first.text, 94, 672, first.size, COLORS.white, true);
  if (second.text) text(second.text, 94, 709, second.size, COLORS.muted);

  // Numbers: up to two big ones on the right, then sets and reps.
  const big = [];
  if (model.duration) big.push([model.duration, L.duration, 73]);
  if (model.volume) big.push([model.volume, L.volume, model.duration ? 65 : 73]);
  let y = 290;
  big.slice(0, 2).forEach(([value, label, size], i) => {
    const f = fit(value, size, 453, 40, 0.58);
    if (i) { rect(563, y - 26, 453, 1, COLORS.line); }
    stat(f.text, label, 563, y, f.size);
    y += i ? 0 : 163;
  });
  const smallY = big.length >= 2 ? 602 : big.length === 1 ? 453 : 290;
  rect(563, smallY - 27, 453, 1, big.length ? COLORS.line : COLORS.bg);
  stat(String(model.sets), L.sets(model.sets), 563, smallY, 54);
  if (model.reps > 0) stat(String(model.reps), L.reps(model.reps), 795, smallY, 54);

  // Record of this workout.
  if (model.record) {
    rect(64, 775, 952, 136, COLORS.soft, 22);
    out.push('<g stroke="#30d158" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M96 806H138V826Q138 844 117 848Q96 844 96 826ZM96 812H86V822Q88 830 96 832M138 812H148V822Q146 830 138 832M117 848V858M105 860H129"/></g>');
    text(L.record, 160, 792, 23, COLORS.green, true);
    text(model.record.text, 160, 820, 44, COLORS.white, true);
    const name = fit(model.record.name, 25, 830, 20, 0.56);
    text(name.text, 160, 876, name.size, COLORS.muted);
  }

  if (model.journal) {
    out.push('<path d="M66 961L73 968L88 953" stroke="#30d158" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>');
    text(L.journal(model.journal), 103, 938, 29, COLORS.white, true);
  }

  // Footer.
  rect(64, 998, 952, 1, COLORS.line);
  out.push('<path d="M66 1031L73 1038L88 1023" stroke="#30d158" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>');
  text(L.saved, 98, 1016, 23, COLORS.muted);
  out.push('</svg>');
  return out.join('');
}

let resvgLoad = null;
let fontFiles = null;
const loadResvg = () => (resvgLoad ??= import('@resvg/resvg-js').then(mod => mod.Resvg ?? mod.default?.Resvg));

// PNG bytes, or null if the renderer is unavailable or fails. Never throws.
export async function renderCardPng(svg) {
  try {
    const Resvg = await loadResvg();
    if (typeof Resvg !== 'function') return null;
    fontFiles ??= ['Inter_400Regular.ttf', 'Inter_700Bold.ttf'].map(name => fileURLToPath(new URL(name, ASSETS)));
    const resvg = new Resvg(svg, {
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Inter' },
      fitTo: { mode: 'width', value: CARD_SIZE },
    });
    return Buffer.from(resvg.render().asPng());
  } catch {
    resvgLoad = null;
    return null;
  }
}
