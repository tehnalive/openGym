// A training plan sent to a friend as a Telegram Mini App link (TG19).
//
// The plan itself lives on the server (POST /api/shares); the link carries only its short id in
// Telegram's `startapp` parameter: https://t.me/<bot>/<app>?startapp=p_<id>. The id read back from
// a launch is a lookup key and nothing more: the server decides who may read what it points to.

import { copyText } from './clipboard.js'

const ID_RE = /^p_([A-Za-z0-9_-]{8,32})$/
// A trainer's invitation (TG14): the whole `t_<22>` string is the token the server wants.
const TRAINER_RE = /^(t_[A-Za-z0-9_-]{22})$/
const TRAINER_SEEN_KEY = 'opengym_seen_trainer_invites'
const SEEN_KEY = 'opengym_seen_shares'    // sessionStorage: ids already shown in this Mini App session
const ADDED_KEY = 'opengym_added_shares'  // localStorage: ids already added on this device

const SHORT_DAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

export const shareIdOf = param => {
  const m = ID_RE.exec(typeof param === 'string' ? param : '')
  return m ? m[1] : null
}

export const trainerTokenOf = param => {
  const m = TRAINER_RE.exec(typeof param === 'string' ? param : '')
  return m ? m[1] : null
}

/** What a launch link carries, by its prefix: `p_` a shared plan, `t_` a trainer's invitation. */
export function launchOf(param) {
  const id = shareIdOf(param)
  if (id) return { kind: 'plan', id }
  const token = trainerTokenOf(param)
  return token ? { kind: 'trainer', token } : null
}

/** The launch's start_param. The signed initData is read first; initDataUnsafe is the SDK's own
 *  parse of the same string and only a fallback. Either way it is an id to look up, not a right. */
export function startParamOf(sdk) {
  try {
    const signed = new URLSearchParams(sdk?.initData || '').get('start_param')
    if (signed) return signed
  } catch { /* fall through */ }
  const unsafe = sdk?.initDataUnsafe?.start_param
  return typeof unsafe === 'string' ? unsafe : ''
}

const readList = (storage, key) => {
  try { const v = JSON.parse(storage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
const writeList = (storage, key, list) => { try { storage.setItem(key, JSON.stringify(list.slice(-50))) } catch { /* private mode */ } }

let pending = null
let pendingTrainer = null

/** Remember the shared plan (or a trainer's invitation) a launch asked for, until the app can show it
 *  (after sign-in and, for a new profile, after the first-run setup). A link already shown in this
 *  session is not asked for again by a reload of the same launch. Returns the plan id; an invitation is
 *  kept for takePendingTrainer and gives null here, so a caller that only knows plans is unchanged. */
export function capturePendingShare(sdk) {
  const launch = launchOf(startParamOf(sdk))
  if (launch?.kind === 'trainer') {
    let seen = []
    try { seen = readList(window.sessionStorage, TRAINER_SEEN_KEY) } catch { /* no storage */ }
    if (!seen.includes(launch.token)) pendingTrainer = launch.token
    return null
  }
  const id = launch?.id
  if (!id) return null
  let seen = []
  try { seen = readList(window.sessionStorage, SEEN_KEY) } catch { /* no storage */ }
  if (seen.includes(id)) return null
  pending = id
  return id
}

export const peekPendingShare = () => pending

/** The waiting id, once: it is marked as shown so a re-render or a reload does not ask again. */
export function takePendingShare() {
  const id = pending
  if (!id) return null
  pending = null
  try { const w = window.sessionStorage; writeList(w, SEEN_KEY, [...readList(w, SEEN_KEY), id]) } catch { /* no storage */ }
  return id
}

export const clearPendingShare = () => { pending = null }

export const peekPendingTrainer = () => pendingTrainer

/** The waiting invitation token, once (marked as shown for this session, like takePendingShare). */
export function takePendingTrainer() {
  const token = pendingTrainer
  if (!token) return null
  pendingTrainer = null
  try { const w = window.sessionStorage; writeList(w, TRAINER_SEEN_KEY, [...readList(w, TRAINER_SEEN_KEY), token]) } catch { /* no storage */ }
  return token
}

export const clearPendingTrainer = () => { pendingTrainer = null }

/** Whether this plan is already among the routines. The routine carries the label (it travels
 *  with the profile to the other devices); the device list covers a routine since deleted. */
export function alreadyAdded(S, id) {
  if ((S?.routines || []).some(r => r && r.sharedFrom === id)) return true
  try { return readList(window.localStorage, ADDED_KEY).includes(id) } catch { return false }
}

/** Merge a parsed plan into the draft state and label the routines it created. */
export function addSharedPlan(s, bundle, id, mergePlan, opts) {
  const res = mergePlan(s, bundle, opts)
  const made = new Set(res.ids)
  s.routines.forEach(r => { if (made.has(r.id)) r.sharedFrom = id })
  return res
}

export function rememberAdded(id) {
  try { const w = window.localStorage; writeList(w, ADDED_KEY, [...readList(w, ADDED_KEY).filter(x => x !== id), id]) } catch { /* private mode */ }
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return many
  if (b > 1 && b < 5) return few
  return b === 1 ? one : many
}

export const exercisesWord = n => `${n} ${plural(n, 'упражнение', 'упражнения', 'упражнений')}`
export const routinesWord = n => `${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')}`

/** "Пн, Ср, Пт" for the days a plan's week uses, Monday first. */
export function scheduleDays(week) {
  const days = [1, 2, 3, 4, 5, 6, 0].filter(d => [].concat(week?.[d] || []).length)
  return days.map(d => SHORT_DAY[d]).join(', ')
}

/** The Telegram share dialog for a link: the chat picker, with the link and a line of text. */
export const telegramShareUrl = (link, text) =>
  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`

/** Open the chat picker inside Telegram; anywhere else (or if it throws) copy the link instead.
 *  Resolves to 'telegram' or 'copied', 'failed' when neither worked. */
export async function sendLink(link, text, { sdk = window.Telegram?.WebApp, copy } = {}) {
  if (typeof sdk?.openTelegramLink === 'function') {
    try { sdk.openTelegramLink(telegramShareUrl(link, text)); return 'telegram' } catch { /* copy below */ }
  }
  return (await copyLink(link, copy)) ? 'copied' : 'failed'
}

export async function copyLink(link, copy) {
  try {
    return !!(await (copy || copyText)(link))
  } catch { return false }
}
