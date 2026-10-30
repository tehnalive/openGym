// Trainer mode, stage 1 (TG14): the client side of /api/trainer/* and the pure helpers its screens use.
// Text is Russian only, like the other Telegram-only screens (SharedPlan.jsx, the entry gate).
//
// A trainer's view of a client is held in memory by the screen and never put in the store, in
// localStorage or in a backup: the client's data must not end up in the trainer's own profile.
import { api } from './api.js'
import { useStore } from '../store/useStore.js'
import { loadOfWorkouts, muscleBalanceWindow, MUSCLE_NAME, inMuscleOrder } from './muscles.js'
import { setsDone } from './history.js'
import { t } from './i18n.js'

export const SECTIONS = [
  { key: 'history', label: 'История тренировок', short: 'История' },
  { key: 'measures', label: 'Замеры и вес', short: 'Замеры' },
  { key: 'stats', label: 'Статистика по мышцам', short: 'Мышцы' },
]

/** What the consent screen offers. `stats` is held back until `history` is on: the muscle numbers are
 *  counted from the workouts, so the server does not open one without the other. */
export const normalizeGrants = g => {
  const out = { history: !!g?.history, measures: !!g?.measures, stats: !!g?.stats }
  if (out.stats && !out.history) out.stats = false
  return out
}
export const anyGrant = g => !!(g && (g.history || g.measures || g.stats))
export const grantsText = g => {
  const list = SECTIONS.filter(s => g?.[s.key]).map(s => s.label.toLowerCase())
  return list.length ? list.join(', ') : 'ничего'
}

/** Whether the consent button may be pressed: the 18+ box and at least one section. */
export const canConsent = ({ age, grants }) => !!age && anyGrant(grants)

// One header for every call: a tab that captured another profile is refused by the server.
const headers = () => {
  const id = useStore.getState().user?.id
  return id ? { 'X-OpenGym-User': id } : {}
}
const call = (path, method = 'GET', body) =>
  api(path, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export const trainerApi = {
  me: () => call('/api/trainer/me'),
  setRole: (enabled, ageConfirmed) => call('/api/trainer/me', 'PUT', { enabled, ...(enabled ? { ageConfirmed: !!ageConfirmed } : {}) }),
  invite: (body = {}) => call('/api/trainer/invites', 'POST', body),
  invites: () => call('/api/trainer/invites'),
  revokeInvite: id => call('/api/trainer/invites/' + encodeURIComponent(id), 'DELETE'),
  preview: token => call('/api/trainer/invites/preview?t=' + encodeURIComponent(token)),
  accept: (token, ageConfirmed, grants) => call('/api/trainer/invites/accept', 'POST', { token, ageConfirmed, grants }),
  clients: () => call('/api/trainer/clients'),
  clientData: linkId => call('/api/trainer/clients/' + encodeURIComponent(linkId) + '/data'),
  endLink: linkId => call('/api/trainer/links/' + encodeURIComponent(linkId), 'DELETE'),
  // Managed clients: a diary the trainer keeps for someone without Telegram.
  addManaged: body => call('/api/trainer/managed', 'POST', body),
  managed: linkId => call('/api/trainer/managed/' + encodeURIComponent(linkId)),
  managedOps: (linkId, ops, baseRev) => call('/api/trainer/managed/' + encodeURIComponent(linkId) + '/ops', 'POST', { ops, ...(baseRev == null ? {} : { baseRev }) }),
  managedExport: linkId => call('/api/trainer/managed/' + encodeURIComponent(linkId) + '/export'),
  deleteManaged: linkId => call('/api/trainer/managed/' + encodeURIComponent(linkId), 'DELETE', { confirm: true }),
}

/** The server's Russian text for a refusal, or ours when the network failed first. */
export function errorText(e, fallback = 'Не получилось. Проверьте соединение и повторите.') {
  if (e?.status === 429) return 'Слишком много запросов. Попробуйте чуть позже.'
  return e?.data?.error || (e?.status ? e.message : '') || fallback
}

const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [])

/** The client's document as the screens read it: lists are lists, the unit is one of two. */
export function clientView(data) {
  const d = data && typeof data === 'object' ? data : {}
  return {
    unit: d.unit === 'lb' ? 'lb' : 'kg', weekStart: d.weekStart === 0 ? 0 : 1,
    workouts: list(d.workouts), customEx: list(d.customEx),
    bodyweight: list(d.bodyweight), measurements: list(d.measurements), customMeasurements: list(d.customMeasurements),
    measurementEnabled: Array.isArray(d.measurementEnabled) ? d.measurementEnabled : null,
  }
}

/** Newest first. */
export function workoutRows(view) {
  return view.workouts.map((w, i) => ({ w, i })).sort((a, b) => (a.w.d < b.w.d ? 1 : a.w.d > b.w.d ? -1 : b.i - a.i)).map(x => x.w)
    .map(w => ({ id: String(w.id ?? w.d), d: w.d, name: w.name || 'Тренировка', sets: Array.isArray(w.entries) ? setsDone(w) : 0, minutes: w.end > w.start ? Math.round((w.end - w.start) / 60000) : 0, w }))
}

export const RANGES = [{ days: 7, label: 'Неделя' }, { days: 30, label: '30 дней' }, { days: 90, label: '90 дней' }, { days: 0, label: 'Всё время' }]

/** Training load per muscle over a window, biggest first, with each muscle's share of the top one. */
export function muscleRows(view, days, now = Date.now()) {
  const inRange = muscleBalanceWindow(view.workouts, days, now)
  const load = loadOfWorkouts(inRange)
  const slugs = inMuscleOrder(Object.keys(load).filter(k => load[k] > 0 && MUSCLE_NAME[k]))
  const top = Math.max(0, ...slugs.map(s => load[s]))
  return slugs.map(slug => ({ slug, name: t(MUSCLE_NAME[slug]), load: Math.round(load[slug] * 10) / 10, share: top ? load[slug] / top : 0 }))
    .sort((a, b) => b.load - a.load)
}

/** Days since the last workout, for the client list. null when there is none. */
export function daysSince(iso, now = new Date()) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const [y, m, d] = iso.split('-').map(Number)
  return Math.max(0, Math.round((a - Date.UTC(y, m - 1, d)) / 86400000))
}
export const ago = n => (n === null ? 'нет тренировок' : n === 0 ? 'сегодня' : n === 1 ? 'вчера' : `${n} дн. назад`)
