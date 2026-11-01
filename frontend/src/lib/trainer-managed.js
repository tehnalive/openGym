// Trainer mode, managed clients (TG14): the pure part of keeping the diary of someone without Telegram.
// A form draft becomes an operation the server applies (api/trainer-managed.js applyOps); nothing here
// touches the store or storage. Text is Russian only, like the other trainer screens.
import { buildLoggedWorkout, appendLoggedWorkout } from './log-workout.js'
import { isHold } from './exercises.js'
import { MEASUREMENT_FIELDS } from './measurements.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const clone = v => JSON.parse(JSON.stringify(v))
const toNum = v => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim().replace(',', '.')
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null
  return Number(s)
}

export const todayIso = (now = new Date()) =>
  now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')

/** The builder's English reasons, as a trainer would read them. */
function ruProblem(p) {
  const text = String(p?.problem || '')
  const field = String(p?.field || '')
  if (field === 'date') return /future/.test(text) ? 'Дата тренировки в будущем' : 'Проверьте дату тренировки'
  if (field === 'exercises') return 'Добавьте хотя бы одно упражнение'
  if (/cardio/.test(text)) return 'Кардио пока нельзя записать здесь'
  if (/no exercise|match|pass one id/.test(text)) return 'Не нашли такое упражнение: выберите его из списка'
  if (/sets|reps|seconds|weight/.test(text)) return 'Проверьте подходы: вес и повторы должны быть числами'
  if (/session would end|began yesterday|later than now/.test(text)) return 'Время тренировки не подходит, укажите другую дату'
  return 'Проверьте данные тренировки'
}

/** An empty form for a workout. */
export const newDraft = (now = new Date()) => ({ date: todayIso(now), name: '', note: '', exercises: [] })
export const newSet = () => ({ w: '', r: '' })

/**
 * The `workout.save` operation for a form draft, against the client's diary `view` (see clientView).
 * draft: { date, name, note, exercises: [{ id, sets: [{ w, r }] }] }, weights in the client's unit.
 * A set with no repeats is a blank row and is left out. Returns { op } or { problems: [text] }.
 */
export function workoutOp(view, draft, { now = Date.now() } = {}) {
  // A weight that is not a number must not be read as "no weight" (the builder takes a missing one as 0).
  const badWeight = (Array.isArray(draft?.exercises) ? draft.exercises : []).some(e => (Array.isArray(e.sets) ? e.sets : [])
    .some(s => String(s?.r ?? '').trim() !== '' && String(s?.w ?? '').trim() !== '' && toNum(s.w) === null))
  if (badWeight) return { problems: ['Проверьте подходы: вес и повторы должны быть числами'] }
  const exercises = (Array.isArray(draft?.exercises) ? draft.exercises : []).map(e => {
    const timed = isHold(e.id)
    const sets = (Array.isArray(e.sets) ? e.sets : []).filter(s => String(s?.r ?? '').trim() !== '').map(s => {
      const reps = toNum(s.r), w = String(s.w ?? '').trim() === '' ? 0 : toNum(s.w)
      return { ...(timed ? { seconds: reps } : { reps }), weight: w }
    })
    return { exercise: e.id, sets }
  })
  const input = {
    date: draft?.date, unit: view.unit,
    ...(String(draft?.name || '').trim() ? { name: String(draft.name).trim() } : {}),
    ...(String(draft?.note || '').trim() ? { note: String(draft.note).trim() } : {}),
    exercises,
  }
  if (!exercises.length) return { problems: ['Добавьте хотя бы одно упражнение'] }
  if (exercises.some(e => !e.sets.length)) return { problems: ['В каждом упражнении нужен хотя бы один подход с повторами'] }
  const built = buildLoggedWorkout(view, input, { now })
  if (built.problems) return { problems: [...new Set(built.problems.map(ruProblem))] }
  // On a copy, so the badges (PRs) are worked out against the history the way the app does at Finish.
  const copy = clone({ unit: view.unit, workouts: view.workouts, customEx: view.customEx })
  const filed = appendLoggedWorkout(copy, built, { now, allowDuplicate: true })
  if (!filed.added) return { problems: ['Такая тренировка уже записана'] }
  return { op: { op: 'workout.save', workout: filed.workout } }
}

/** `bodyweight.set`, or a reason. `w` is in the client's unit. */
export function weightOp(date, w) {
  const n = toNum(w)
  if (!ISO.test(date || '')) return { problems: ['Проверьте дату'] }
  if (n === null || n < 1 || n > 1000) return { problems: ['Вес должен быть числом'] }
  return { op: { op: 'bodyweight.set', d: date, w: n } }
}

/** The body measurements a trainer can fill in (the app's built-in ones; cm, body fat in %). */
export const MEASURE_FIELDS = MEASUREMENT_FIELDS.map(f => ({ key: f.key, label: f.label, percent: f.kind === 'percent' }))

/** `measurement.set` from a form of strings; blank fields are left alone. */
export function measureOp(date, values) {
  if (!ISO.test(date || '')) return { problems: ['Проверьте дату'] }
  const out = {}
  for (const f of MEASURE_FIELDS) {
    const raw = values?.[f.key]
    if (raw === undefined || String(raw).trim() === '') continue
    const n = toNum(raw)
    if (n === null || n <= (f.percent ? -1 : 0) || n > (f.percent ? 100 : 500)) return { problems: [`Проверьте значение: ${f.label}`] }
    out[f.key] = n
  }
  if (!Object.keys(out).length) return { problems: ['Заполните хотя бы один замер'] }
  return { op: { op: 'measurement.set', d: date, values: out } }
}

/** Save text as a file through the browser; false where it cannot (some in-app browsers). */
export function saveFile(name, text, type = 'application/json') {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch { return false }
}

/** The export as a file the trainer can save: its name and text. The text is the diary itself in the form of the
 *  app's own backup (workouts, routines, body weight, measurements), so the person can load it in Settings → import
 *  once they have the app on a Telegram account of their own. */
export function exportFile(res, now = new Date()) {
  const safe = String(res?.name || 'podopechny').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 30) || 'podopechny'
  return { name: `zhimolost-${safe}-${todayIso(now)}.json`, text: JSON.stringify({ routines: [], ...(res?.data || {}) }, null, 2) }
}
