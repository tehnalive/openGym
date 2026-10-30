// Trainer mode, managed clients (TG14, stage 1.5): a client without Telegram whom the trainer keeps the
// diary for. Pure helpers here; the routes and the storage are in server.js.
//
// A managed client is a real profile (db.users[] with `managedBy`) that has no way to sign in: no
// telegramId, no passkey, no password, and sessionUser refuses it. Its document is the usual
// state-<uid>.json, and the trainer changes it only through the small operations below, applied on the
// server and written with the same revision rules as PUT /api/data.
import crypto from 'node:crypto';

export const MANAGED_NAME_MAX = 40;
export const MANAGED_NOTE_MAX = 200;
export const OPS_MAX = 20;
export const OP_BYTES_MAX = 100 * 1024;       // one workout, as JSON
export const DOC_BYTES_MAX = 5 * 1024 * 1024; // the same ceiling as a whole PUT /api/data body
export const HANDOVER_DAYS = 7;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRec = x => !!x && typeof x === 'object' && !Array.isArray(x);
const list = v => (Array.isArray(v) ? v : []);
const clone = v => JSON.parse(JSON.stringify(v));

// The body measurements the app knows (frontend lib/measurements.js MEASUREMENT_FIELDS), cm except body fat.
export const MEASUREMENT_KEYS = [
  'neck', 'shoulders', 'chest', 'waist', 'hips', 'abdomen', 'upperArmLeft', 'upperArmRight', 'forearmLeft', 'forearmRight',
  'wristLeft', 'wristRight', 'thighLeft', 'thighRight', 'calfLeft', 'calfRight', 'ankleLeft', 'ankleRight', 'bodyFat',
];

export const isManaged = user => !!user && typeof user.managedBy === 'string' && user.managedBy.length > 0;

export const managedLinks = (db, coachUid) => (db.trainerLinks || []).filter(l => l.coachUid === coachUid && l.managed === true && l.status === 'active');

/** The link a trainer may operate on: theirs, managed and active. Anything else reads as not there. */
export function managedLinkFor(db, coachUid, id) {
  if (typeof id !== 'string') return null;
  return (db.trainerLinks || []).find(l => l.id === id && l.managed === true && l.status === 'active' && l.coachUid === coachUid) || null;
}

const plainText = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The body of "add a client without Telegram", or an error code with its text. */
export function checkCreate(body) {
  if (!isRec(body)) return { error: 'bad-request', text: 'Не указаны данные подопечного' };
  const name = plainText(body.name, MANAGED_NAME_MAX);
  if (!name) return { error: 'name-required', text: 'Укажите имя подопечного' };
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') return { error: 'bad-request', text: 'Заметка должна быть текстом' };
  if (body.ageConfirmed !== true) return { error: 'age-required', text: 'Нужно подтвердить, что подопечному есть 18 лет и он согласен, что вы ведёте его дневник' };
  if (body.unit !== undefined && body.unit !== 'kg' && body.unit !== 'lb') return { error: 'bad-request', text: 'Единицы: kg или lb' };
  return { name, note: plainText(body.note, MANAGED_NOTE_MAX), unit: body.unit === 'lb' ? 'lb' : 'kg' };
}

/** A fresh document for a profile nobody has written to yet. */
export const emptyManagedDoc = unit => ({ unit, weekStart: 1, workouts: [], bodyweight: [], measurements: [], customEx: [], routines: [] });

/** Whether a document holds anything of a diary; a handover is only for a profile that holds nothing yet. */
export function hasDiary(S) {
  if (!isRec(S)) return false;
  return ['workouts', 'bodyweight', 'measurements', 'routines', 'customEx'].some(k => list(S[k]).some(isRec));
}

// Media never travels in an operation: the trainer cannot attach a photo to someone else's diary.
const STRIP = new Set(['media', 'photo', 'photos', 'video', 'videos', 'img', 'image', '_f', '_u', 'by', 'via']);
function stripDeep(v, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.map(x => stripDeep(x, depth + 1)).filter(x => x !== undefined);
  if (isRec(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (STRIP.has(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const y = stripDeep(x, depth + 1);
      if (y !== undefined) out[k] = y;
    }
    return out;
  }
  if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return undefined;
  if (typeof v === 'number' && !Number.isFinite(v)) return undefined;
  return v;
}

const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const validDate = d => typeof d === 'string' && DATE.test(d) && new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d;
const key = w => (w?.id != null ? w.id : `${w?.d}|${w?.start}`);

function cleanWorkout(raw, now) {
  if (!isRec(raw)) return { error: 'workout-invalid', text: 'Тренировка записана неверно' };
  if (!(typeof raw.id === 'string' || Number.isSafeInteger(raw.id)) || String(raw.id).length > 64 || !String(raw.id)) return { error: 'workout-invalid', text: 'У тренировки нет номера' };
  if (!validDate(raw.d)) return { error: 'workout-invalid', text: 'Дата тренировки неверна' };
  if (raw.d > new Date(now + 36 * 3600000).toISOString().slice(0, 10)) return { error: 'workout-invalid', text: 'Тренировка не может быть в будущем' };
  const entries = list(raw.entries);
  if (!Array.isArray(raw.entries) || !entries.length || entries.length > 40) return { error: 'workout-invalid', text: 'В тренировке от 1 до 40 упражнений' };
  const w = stripDeep(raw);
  if (JSON.stringify(w).length > OP_BYTES_MAX) return { error: 'workout-too-big', text: 'Тренировка слишком большая' };
  for (const e of w.entries) {
    if (!isRec(e) || typeof e.id !== 'string' || !e.id || e.id.length > 100) return { error: 'workout-invalid', text: 'Упражнение записано неверно' };
    if (!Array.isArray(e.sets) || e.sets.length > 50) return { error: 'workout-invalid', text: 'В упражнении до 50 подходов' };
    for (const s of e.sets) {
      if (!isRec(s)) return { error: 'workout-invalid', text: 'Подход записан неверно' };
      if (s.w != null && !num(s.w, 0, 5000)) return { error: 'workout-invalid', text: 'Вес подхода неверен' };
      if (s.r != null && !num(s.r, 0, 1000)) return { error: 'workout-invalid', text: 'Повторы подхода неверны' };
      if (s.sec != null && !num(s.sec, 0, 6 * 3600)) return { error: 'workout-invalid', text: 'Время подхода неверно' };
    }
  }
  for (const k of ['start', 'end']) if (w[k] != null && !num(w[k], 0, 8.64e15)) return { error: 'workout-invalid', text: 'Время тренировки неверно' };
  if (w.name != null) w.name = plainText(w.name, 80);
  if (w.note != null) w.note = plainText(w.note, 500);
  w.via = 'coach';
  w._ts = now;
  return { workout: w };
}

const round1 = n => Math.round(n * 10) / 10;

/**
 * Apply `ops` to a copy of the client's document `S` at time `now`.
 * Returns { doc, changes } with the new document, or { error, text } (nothing applied: all or none).
 *
 *   workout.save {workout}        add the workout, or replace the one with the same id
 *   workout.delete {id}
 *   bodyweight.set {d, w}         a weigh-in in the profile's unit; one per day
 *   bodyweight.delete {d}
 *   measurement.set {d, values}   {key: number | null}, cm (body fat in %); null clears a value
 *   measurement.delete {d}
 */
export function applyOps(S, ops, now = Date.now()) {
  if (!Array.isArray(ops) || !ops.length) return { error: 'ops-required', text: 'Нечего записывать' };
  if (ops.length > OPS_MAX) return { error: 'ops-too-many', text: `За раз можно записать не больше ${OPS_MAX} изменений` };
  const doc = isRec(S) ? clone(S) : {};
  for (const k of ['workouts', 'bodyweight', 'measurements']) doc[k] = list(doc[k]).filter(isRec);
  const changes = [];
  for (const op of ops) {
    if (!isRec(op) || typeof op.op !== 'string') return { error: 'op-invalid', text: 'Изменение записано неверно' };
    switch (op.op) {
      case 'workout.save': {
        const r = cleanWorkout(op.workout, now);
        if (r.error) return r;
        const at = doc.workouts.findIndex(x => key(x) === key(r.workout));
        if (at >= 0) doc.workouts[at] = r.workout;
        else {
          doc.workouts.push(r.workout);
          // Oldest first, as the app files them; the sort is stable so a day's order is kept.
          doc.workouts = doc.workouts.map((w, i) => ({ w, i })).sort((a, b) => (a.w.d < b.w.d ? -1 : a.w.d > b.w.d ? 1 : (Number(a.w.start) || 0) - (Number(b.w.start) || 0) || a.i - b.i)).map(x => x.w);
        }
        changes.push('workout');
        break;
      }
      case 'workout.delete': {
        if (typeof op.id !== 'string' && !Number.isSafeInteger(op.id)) return { error: 'op-invalid', text: 'Не указана тренировка' };
        const n = doc.workouts.length;
        doc.workouts = doc.workouts.filter(w => String(w.id) !== String(op.id));
        if (doc.workouts.length === n) return { error: 'workout-gone', text: 'Такой тренировки нет' };
        changes.push('workout.delete');
        break;
      }
      case 'bodyweight.set': {
        if (!validDate(op.d) || !num(op.w, 1, 1000)) return { error: 'op-invalid', text: 'Вес или дата неверны' };
        const w = round1(op.w);
        const ex = doc.bodyweight.find(b => b.d === op.d);
        if (ex) { ex.w = w; ex.t = now; delete ex.src; } else doc.bodyweight.push({ d: op.d, w, t: now });
        doc.bodyweight.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
        changes.push('bodyweight');
        break;
      }
      case 'bodyweight.delete': {
        if (!validDate(op.d)) return { error: 'op-invalid', text: 'Дата неверна' };
        const n = doc.bodyweight.length;
        doc.bodyweight = doc.bodyweight.filter(b => b.d !== op.d);
        if (doc.bodyweight.length === n) return { error: 'weight-gone', text: 'Такого взвешивания нет' };
        changes.push('bodyweight.delete');
        break;
      }
      case 'measurement.set': {
        if (!validDate(op.d) || !isRec(op.values)) return { error: 'op-invalid', text: 'Замер записан неверно' };
        const keys = Object.keys(op.values);
        if (!keys.length) return { error: 'op-invalid', text: 'В замере нет значений' };
        let ex = doc.measurements.find(m => m.d === op.d);
        const entry = ex || { d: op.d, t: now };
        for (const k of keys) {
          if (!MEASUREMENT_KEYS.includes(k)) return { error: 'op-invalid', text: 'Неизвестный замер' };
          const v = op.values[k];
          if (v === null) { entry[k] = null; continue; }
          if (!num(v, k === 'bodyFat' ? 0 : 0.1, k === 'bodyFat' ? 100 : 500)) return { error: 'op-invalid', text: 'Значение замера неверно' };
          entry[k] = round1(v);
        }
        entry.t = now;
        if (!ex) { doc.measurements.push(entry); doc.measurements.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0)); }
        changes.push('measurement');
        break;
      }
      case 'measurement.delete': {
        if (!validDate(op.d)) return { error: 'op-invalid', text: 'Дата неверна' };
        const n = doc.measurements.length;
        doc.measurements = doc.measurements.filter(m => m.d !== op.d);
        if (doc.measurements.length === n) return { error: 'measurement-gone', text: 'Такого замера нет' };
        changes.push('measurement.delete');
        break;
      }
      default:
        return { error: 'op-invalid', text: 'Неизвестное изменение' };
    }
  }
  if (JSON.stringify(doc).length > DOC_BYTES_MAX) return { error: 'doc-too-big', text: 'Дневник подопечного слишком большой' };
  return { doc, changes };
}

/** What a trainer gets back for a managed client: its diary without bookkeeping or media. */
export function managedView(S) {
  const doc = isRec(S) ? S : {};
  const strip = x => stripDeep(x);
  return {
    unit: doc.unit === 'lb' ? 'lb' : 'kg',
    weekStart: doc.weekStart === 0 ? 0 : 1,
    workouts: list(doc.workouts).filter(isRec).map(strip),
    customEx: list(doc.customEx).filter(isRec).map(strip),
    bodyweight: list(doc.bodyweight).filter(isRec).map(strip),
    measurements: list(doc.measurements).filter(isRec).map(strip),
    customMeasurements: list(doc.customMeasurements).filter(isRec).map(strip),
    measurementEnabled: doc.measurementEnabled ?? null,
  };
}

/** The export a trainer downloads: the view plus a header saying what it is. */
export function managedExport(name, S, now = Date.now()) {
  return { app: 'zhimolost', kind: 'managed-client-export', exportedAt: new Date(now).toISOString(), name, data: managedView(S) };
}

export const newManagedId = () => crypto.randomBytes(12).toString('base64url');
