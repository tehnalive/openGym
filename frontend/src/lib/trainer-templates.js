// Trainer mode: templates and copying routines to clients (TG14, docs/telegram/TRAINER_MODE.md section 17).
// Pure helpers for the screens (views/TrainerTemplates.jsx, components/TrainerOffer.jsx, the routines block of
// views/ManagedSettings.jsx). Text is Russian only, like the other trainer screens.
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { EXIDX } from './exercises.js'
import { exerciseNameFor } from './i18n-core.js'
import { plural } from './plan-link.js'

export const routinesCount = n => `${n} ${plural(n, 'рутина', 'рутины', 'рутин')}`
export const exercisesCount = n => `${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')}`

/** "3 рутины: Тяни, Толкай, Ноги", cut short when the names are many. */
export function compositionLine(names, max = 4) {
  const list = (names || []).filter(Boolean)
  const shown = list.slice(0, max).join(', ')
  return list.length ? `${routinesCount(list.length)}: ${shown}${list.length > max ? ' и ещё ' + (list.length - max) : ''}` : 'Пустой шаблон'
}

/** The routines a person has, for a list of choices: [{ id, name, count }]. */
export const routineChoices = S => (S?.routines || []).filter(r => r && r.id != null)
  .map(r => ({ id: r.id, name: r.name || 'Без названия', count: (r.ex || []).length }))

/**
 * The body of "save as a template" out of the chosen routines of one diary (the trainer's own, or a managed client's
 * opened in the app): the same cleaning as a shared plan file (lib/plan-share.js), which drops bookkeeping and keeps the
 * custom exercises the routines use. The server cleans again; this is what the app sends.
 */
export function templateBody(S, ids, { name, note } = {}) {
  const chosen = new Set(ids)
  const picked = (S?.routines || []).filter(r => r && chosen.has(r.id))
  const bundle = buildPlanBundle({ ...S, routines: picked, week: {} }, name)
  return { name: (name || '').trim(), note: (note || '').trim(), unit: bundle.unit, routines: bundle.routines, customEx: bundle.customEx }
}

/** The name of an exercise of a template, for the list of its contents. */
export function templateExerciseName(template, id) {
  const own = (template?.customEx || []).find(c => c.id === id)
  if (own) return own.n || id
  const ex = EXIDX[id]
  return ex ? (exerciseNameFor(ex) || ex.n || id) : id
}

/** One line for an exercise of a template: "Присед: 3 × 5, 100 кг" (the sets and the reps as stored; nothing derived). */
export function exerciseLine(template, e, unit) {
  const bits = []
  if (e.sets && e.reps) bits.push(`${e.sets} × ${e.reps}`)
  else if (e.sets && e.sec) bits.push(`${e.sets} × ${e.sec} с`)
  else if (e.sets) bits.push(`${e.sets} подх.`)
  if (e.weight) bits.push(`${e.weight} ${unit === 'lb' ? 'фунт.' : 'кг'}`)
  return templateExerciseName(template, e.id) + (bits.length ? ': ' + bits.join(', ') : '')
}

// ---- the result of handing something to clients ----
export const ASSIGN_ERRORS = {
  'client-gone': 'подопечный недоступен',
  unreadable: 'дневник сейчас не читается',
  'doc-too-big': 'дневник слишком большой',
  'offer-too-big': 'программа слишком большая для предложения',
  'write-failed': 'не удалось записать',
  'same-client': 'это тот же подопечный',
}

/** "Добавлено: Иван. Отправлено предложение: Мария. Не получилось: Пётр (подопечный недоступен)." */
export function assignSummary(results, clients) {
  const name = id => (clients || []).find(c => c.linkId === id)?.name || 'подопечный'
  const by = r => (results || []).filter(x => x.result === r)
  const parts = []
  if (by('added').length) parts.push('Добавлено: ' + by('added').map(x => name(x.linkId)).join(', ') + '.')
  if (by('offered').length) parts.push('Отправлено предложение: ' + by('offered').map(x => name(x.linkId)).join(', ') + '.')
  if (by('error').length) parts.push('Не получилось: ' + by('error').map(x => `${name(x.linkId)} (${ASSIGN_ERRORS[x.code] || 'ошибка'})`).join(', ') + '.')
  return parts.join(' ') || 'Ничего не отправлено.'
}

/** Whether every result was an error (the sheet stays open then, for another try). */
export const allFailed = results => !!results && results.length > 0 && results.every(x => x.result === 'error')

// ---- an offer on the client's side ----
const OFFERS_KEY = 'gym_trainer_offers_added'

const readList = () => { try { const v = JSON.parse(window.localStorage.getItem(OFFERS_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }

/** Whether this offer is already in the diary: a routine carries `fromOffer`, and the device keeps the ids it added
 *  (so a routine deleted afterwards does not bring the offer back when the server still lists it). */
export function offerAlreadyAdded(S, id) {
  if ((S?.routines || []).some(r => r && r.fromOffer === id)) return true
  return readList().includes(id)
}

export function rememberOfferAdded(id) {
  try { window.localStorage.setItem(OFFERS_KEY, JSON.stringify([...readList().filter(x => x !== id), id].slice(-50))) } catch { /* private mode */ }
}

/** The offer as a plan bundle the shared-plan code reads (it resolves exercises, converts the unit, gives new ids). */
export const offerBundle = offer => ({
  opengym_plan: 1, name: offer.templateName || '', unit: offer.unit === 'lb' ? 'lb' : 'kg', week: {},
  routines: offer.routines || [], customEx: offer.customEx || [],
})

/**
 * Adds the offer's routines to the draft state `s` (inside store.update) as new routines with fresh ids, and marks them
 * `fromOffer`. Nothing the person has is changed; a custom exercise they already have under the same name is reused.
 * Idempotent: an offer already in the diary adds nothing. Returns { added, dropped } (`dropped`: exercises the app does not know).
 */
export function addOfferToState(s, offer) {
  if (offerAlreadyAdded(s, offer.id)) return { added: 0, dropped: 0 }
  const parsed = parsePlan(offerBundle(offer), s.unit == null ? 'kg' : s.unit)
  const res = mergePlan(s, parsed)
  const made = new Set(res.ids)
  s.routines.forEach(r => { if (made.has(r.id)) r.fromOffer = offer.id })
  return { added: res.routines, dropped: parsed.dropped }
}
