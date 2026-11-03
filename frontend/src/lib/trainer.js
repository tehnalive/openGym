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
  setSchedule: (linkId, schedule) => call('/api/trainer/links/' + encodeURIComponent(linkId) + '/schedule', 'PUT', { ...schedule, tz: localTz() }),
  endLink: linkId => call('/api/trainer/links/' + encodeURIComponent(linkId), 'DELETE'),
  // Pause and archive of a client: the trainer's time zone goes with them, the days are counted in it.
  pause: (linkId, { until = null, reason = '' } = {}) => call('/api/trainer/links/' + encodeURIComponent(linkId) + '/pause', 'PUT', { until, ...(reason ? { reason } : {}), tz: localTz() }),
  resume: linkId => call('/api/trainer/links/' + encodeURIComponent(linkId) + '/pause', 'DELETE', { tz: localTz() }),
  archive: linkId => call('/api/trainer/links/' + encodeURIComponent(linkId) + '/archive', 'POST', { tz: localTz() }),
  restore: linkId => call('/api/trainer/links/' + encodeURIComponent(linkId) + '/restore', 'POST', { tz: localTz() }),
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

// ---- the trainer's week: which days a client comes ----
export const WEEKDAYS = [
  { iso: 1, short: 'Пн', long: 'Понедельник' }, { iso: 2, short: 'Вт', long: 'Вторник' }, { iso: 3, short: 'Ср', long: 'Среда' },
  { iso: 4, short: 'Чт', long: 'Четверг' }, { iso: 5, short: 'Пт', long: 'Пятница' }, { iso: 6, short: 'Сб', long: 'Суббота' },
  { iso: 7, short: 'Вс', long: 'Воскресенье' },
]
function localTz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined } }
/** The ISO weekday (1 = Monday .. 7 = Sunday) of a Date. */
export const isoWeekday = (d = new Date()) => (d.getDay() === 0 ? 7 : d.getDay())

/** "Пн Ср Пт · 18:00 · напоминание", or '' for a client with no days. */
export function scheduleText(s) {
  if (!s || !Array.isArray(s.days) || !s.days.length) return ''
  const days = s.days.map(d => WEEKDAYS.find(w => w.iso === d)?.short).filter(Boolean).join(' ')
  return [days, s.time, s.remind ? 'напоминание' : ''].filter(Boolean).join(' · ')
}

const byTime = (a, b) => (a.time || '99:99') < (b.time || '99:99' ) ? -1 : (a.time || '99:99') > (b.time || '99:99') ? 1 : a.name.localeCompare(b.name, 'ru')

/** The date ('YYYY-MM-DD') of the next ISO weekday `iso` counted from `now`: today for today's weekday, else within the
 *  coming six days. The week of the cabinet is that window. */
export function dateOfWeekday(iso, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((iso - isoWeekday(now) + 7) % 7), 12)
  return isoOf(d)
}
/** Whether the client's pause covers that date: it started today or before, and `until` is the last paused day (null: no end). */
export const pausedOnDate = (c, date) => !!c.pause && (c.pause.until == null || c.pause.until >= date)

/** Who is expected on this ISO weekday: [{ linkId, name, time, remind }], the booked times first, by time. A client on
 *  pause is not expected on the days the pause covers (that weekday's date counted from today), and is on the days after. */
export function clientsOn(clients, iso, now = new Date()) {
  const date = dateOfWeekday(iso, now)
  return (clients || []).filter(c => c.schedule?.days?.includes(iso) && !pausedOnDate(c, date))
    .map(c => ({ linkId: c.linkId, name: c.name, time: c.schedule.time || '', remind: !!c.schedule.remind, client: c })).sort(byTime)
}

/** The whole week for the cabinet: one entry per weekday. */
export const weekPlan = (clients, now = new Date()) => WEEKDAYS.map(w => ({ ...w, clients: clientsOn(clients, w.iso, now) }))

// ---- pause and archive of a client ----
// A pause keeps the place and the access; the trainer is not reminded. An archive frees the place and closes the access.
export const PAUSE_PRESETS = [
  { label: '1 неделя', days: 7 }, { label: '2 недели', days: 14 }, { label: 'Месяц', days: 30 }, { label: 'Без срока', days: null },
]
export const PAUSE_REASONS = ['Отпуск', 'Травма', 'Болезнь']

const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
/** The last paused day for a pause of `days` days from today (the first of them), or null for no end. */
export function pauseUntil(days, now = new Date()) {
  if (days == null) return null
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days - 1, 12)
  return isoOf(d)
}
const shortDate = iso => {
  const d = new Date(iso + 'T12:00:00')
  return Number.isNaN(+d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
/** "Пауза до 15 нояб. · Отпуск", "Пауза · Травма" (no end), or '' when there is none. */
export function pauseText(pause) {
  if (!pause) return ''
  return [pause.until ? 'Пауза до ' + shortDate(pause.until) : 'Пауза', pause.reason].filter(Boolean).join(' · ')
}
/** The clients on pause who would otherwise be expected on this ISO weekday: for the muted line under "Сегодня". */
export const pausedOnWeekday = (clients, iso, now = new Date()) => (clients || []).filter(c => c.schedule?.days?.includes(iso) && pausedOnDate(c, dateOfWeekday(iso, now)))
/** "в архиве с 3 нояб.": from the trainer's day the server sends (`archivedOn`), else the date part of the time. */
export const archivedText = iso => (iso && shortDate(iso.slice(0, 10)) ? 'В архиве с ' + shortDate(iso.slice(0, 10)) : 'В архиве')

// ---- plan compliance over 7, 30 and 90 days (TG14, section 15 of docs/telegram/TRAINER_MODE.md) ----
// The server counts it (api/trainer-compliance.js) and sends it to the trainer only; these helpers only word it. The
// client never has a percentage of their own on any screen.
export const PCT_GOOD = 80   // from here on green, from PCT_OK yellow (amber), below red
export const PCT_OK = 50
/** The theme colour of a percentage, or '' when there is none. */
export const pctColor = pct => (pct == null ? '' : pct >= PCT_GOOD ? 'var(--green)' : pct >= PCT_OK ? 'var(--orange)' : 'var(--red)')
export const pctText = pct => (pct == null ? '' : pct + '%')

/** "тренировался сегодня", "тренировался вчера", "был 3 дн. назад", "ещё не тренировался". */
export function seenText(compliance) {
  const n = compliance ? compliance.daysSinceLast : null
  return n == null ? 'ещё не тренировался' : n === 0 ? 'тренировался сегодня' : n === 1 ? 'тренировался вчера' : `был ${n} дн. назад`
}

/** What a row of the cabinet shows for a client: { pct, color, note } where `pct` is the 30 day percentage to put on the
 *  right ('' when there is none) and `note` the line about the plan when there is no percentage. null for a client whose
 *  history is closed. A client on pause has no percentage: the pause line stays instead. */
export function rowCompliance(client) {
  const c = client && client.compliance
  if (!c) return null
  const w = c.d30 || {}
  const trained = `${w.workouts || 0} трен. за 30 дн.`
  if (client.pause) return { pct: '', color: '', note: '', seen: seenText(c) }
  if (w.pct != null) return { pct: pctText(w.pct), color: pctColor(w.pct), note: '', seen: seenText(c), aria: `Соблюдение плана за 30 дней: ${w.pct}%` }
  return { pct: '', color: '', note: (c.hasSchedule ? 'пока нечего считать' : 'нет плана') + ' · ' + trained, seen: seenText(c) }
}

/** The clients who need a look, with the line for each: those who went quiet (longest first), then the ones whose week
 *  fell (the lowest first). A client on pause has no signal (the server sends none, and the row says so again here). */
export function attentionItems(clients) {
  const quiet = [], drop = []
  for (const c of clients || []) {
    const a = c.compliance && !c.pause ? c.compliance.attention : null
    if (a === 'quiet') {
      const n = c.compliance.daysSinceLast
      quiet.push({ linkId: c.linkId, name: c.name, kind: 'quiet', days: n, text: n == null ? `${c.name}: ещё не тренировался` : `${c.name}: не тренировался ${n} дн.`, client: c })
    } else if (a === 'drop') {
      drop.push({ linkId: c.linkId, name: c.name, kind: 'drop', pct: c.compliance.d7.pct, text: `${c.name}: соблюдение за неделю упало до ${c.compliance.d7.pct}%`, client: c })
    }
  }
  quiet.sort((x, y) => (y.days ?? Infinity) - (x.days ?? Infinity))
  drop.sort((x, y) => x.pct - y.pct)
  return [...quiet, ...drop]
}

/** The list with the clients who need attention first, the rest in their order. */
export function sortByAttention(clients) {
  const first = attentionItems(clients).map(x => x.client)
  return [...first, ...(clients || []).filter(c => !first.includes(c))]
}

export const COMPLIANCE_WINDOWS = [{ key: 'd7', label: '7 дней' }, { key: 'd30', label: '30 дней' }, { key: 'd90', label: '90 дней' }]
/** The three tiles of the client screen: { key, label, pct (text), color, sub }. */
export function complianceTiles(compliance) {
  if (!compliance) return []
  return COMPLIANCE_WINDOWS.map(({ key, label }) => {
    const w = compliance[key] || {}
    if (w.pct != null) return { key, label, pct: pctText(w.pct), color: pctColor(w.pct), sub: `выполнено ${w.done} из ${w.planned}` }
    return { key, label, pct: '–', color: '', sub: compliance.hasSchedule ? 'нечего считать' : `${w.workouts || 0} трен.` }
  })
}
