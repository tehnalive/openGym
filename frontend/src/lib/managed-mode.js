/* Managed mode (TG14): the trainer opens a client's diary in the ordinary app.

   A client without Telegram has no sign-in of their own, so the trainer keeps their diary. Rather than a
   second, smaller app, the trainer gets the same app, started again in the client's name:

     1. The cabinet calls enterManagedMode(): it writes a flag to sessionStorage and loads the page again
        with ?as=<link id>. A fresh page is a fresh JavaScript world, so the store that runs is a second
        copy of the app's, not the trainer's own with a swapped document.
     2. This module is the first import of main.jsx. Before any other code runs it reads the flag and puts
        three guards in place:
          - storage: every localStorage, sessionStorage and IndexedDB name gets the prefix `m:<id>:`, so
            nothing the app keeps (its copy of the document, the sync marks, the owner, the stashes) can
            land in, or be read from, the trainer's own keys;
          - network: the app's /api/data calls are sent to the managed routes, /api/me answers locally with
            the client as the signed-in profile, and every other /api call (sign-in, push, coach, shares,
            media, the trainer's own routes) is refused here, without a request;
          - isManagedMode(), for the screens that differ.
     3. leaveManagedMode() clears the flag and loads the page again, in the trainer's own world.

   Nothing here runs unless the flag is set; for everyone else this module only reads two storage keys. */

const FLAG = 'gym_as'
const NOTICE = 'gym_as_notice'
export const MANAGED_PREFIX = id => `m:${id}:`
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/
// Telegram's own script keeps its launch parameters in sessionStorage under these names; they are not the
// app's data, and without them the script cannot tell it runs inside Telegram (viewport, safe area).
const FOREIGN = /^__telegram__/

let info = null
export const isManagedMode = () => info !== null
/** A Telegram client's diary opened read only: nothing in it can be written, and the screens have no writing controls. */
export const isReadonlyMode = () => info !== null && info.kind === 'readonly'
/** What the client opened (history, measures, stats) in a read only diary; everything for a managed one. */
export const diaryGrants = () => (info && info.kind === 'readonly' ? info.grants : { history: true, measures: true, stats: true })
export const managedInfo = () => info
export const managedUserId = id => 'managed-' + id

/* ------------------------------------------------------------------------------------ the flag */

const KINDS = ['managed', 'readonly']
const GRANT_KEYS = ['history', 'measures', 'stats']
const cleanGrants = g => Object.fromEntries(GRANT_KEYS.map(k => [k, !!(g && g[k] === true)]))

function parseFlag(raw) {
  try {
    const v = JSON.parse(raw)
    if (v && typeof v.id === 'string' && ID_RE.test(v.id)) {
      const kind = KINDS.includes(v.kind) ? v.kind : 'managed'
      return {
        id: v.id, name: typeof v.name === 'string' ? v.name.slice(0, 40) : '', kind,
        lang: typeof v.lang === 'string' && /^[A-Za-z-]{2,10}$/.test(v.lang) ? v.lang : '',
        // What the client opened for the trainer; only a read only diary has it.
        ...(kind === 'readonly' ? { grants: cleanGrants(v.grants) } : {}),
      }
    }
  } catch { /* no flag */ }
  return null
}

const baseOf = loc => {
  const path = ((loc && loc.pathname) || '/').replace(/[\\/]+/g, '/')
  return path.slice(0, path.lastIndexOf('/') + 1) || '/'
}

/** The managed client this page was opened for: `?as=` on a fresh load, or the flag a reload keeps. */
export function detect(win) {
  let ss
  try { ss = win.sessionStorage } catch { return null }
  let stored = null
  try { stored = parseFlag(ss.getItem(FLAG)) } catch { /* unreadable: not managed */ }
  const asId = new URLSearchParams(win.location.search).get('as')
  // The parameter only names the diary; what kind it is, whose language and which grants come from the flag the cabinet wrote.
  const found = asId && ID_RE.test(asId) ? (stored && stored.id === asId ? stored : { id: asId, name: '', kind: 'managed', lang: '' }) : stored
  if (asId) {
    // The parameter is only a way in: it comes off the address so a reload or a shared link does not carry it.
    try {
      if (found) ss.setItem(FLAG, JSON.stringify(found))
      const url = new URL(win.location.href)
      url.searchParams.delete('as')
      win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash)
    } catch { /* a page that cannot rewrite its address still works */ }
  }
  return found
}

/** The language a diary opened by the trainer is shown in: the trainer's, carried in the flag; else what the app would pick. */
export const shownLang = (i, fallback) => (i && i.lang) || fallback

/** From the cabinet: open this client's diary in the app. `lang` is the trainer's own interface language, worked out
 *  in the trainer's world before leaving it: the diary is shown in it, and neither the client's document nor the
 *  trainer's settings are written with it. */
export function enterManagedMode(id, name, lang, win = window) {
  if (!ID_RE.test(String(id))) return false
  try { win.sessionStorage.setItem(FLAG, JSON.stringify({ id, name: String(name || '').slice(0, 40), lang: typeof lang === 'string' ? lang : '' })) } catch { return false }
  win.location.assign(baseOf(win.location) + '?as=' + encodeURIComponent(id) + '#/home')
  return true
}

/** From the cabinet: open a client who signed in with Telegram, read only, as the app. `grants` is what the client opened. */
export function enterReadonlyMode(id, name, lang, grants, win = window) {
  if (!ID_RE.test(String(id))) return false
  const flag = { id, name: String(name || '').slice(0, 40), kind: 'readonly', lang: typeof lang === 'string' ? lang : '', grants: cleanGrants(grants) }
  try { win.sessionStorage.setItem(FLAG, JSON.stringify(flag)) } catch { return false }
  win.location.assign(baseOf(win.location) + '?as=' + encodeURIComponent(id) + '#/home')
  return true
}

/** Back to the trainer's own app. `notice` is shown once in the cabinet. */
export function leaveManagedMode(notice, win = window) {
  // Through the page's own sessionStorage object, whose methods the guards below do not touch for these keys.
  try { win.sessionStorage.removeItem(FLAG) } catch { /* the load below starts clean anyway for a new tab */ }
  if (notice) { try { win.sessionStorage.setItem(NOTICE, String(notice)) } catch { /* the cabinet just opens */ } }
  // A new query string makes it a real page load: a change of the hash alone would keep this JavaScript world,
  // with the diary's storage names, running.
  win.location.assign(baseOf(win.location) + '?m=out#/trainer')
}

/** The line left by leaveManagedMode, once. */
export function takeManagedNotice(win = window) {
  try {
    const v = win.sessionStorage.getItem(NOTICE)
    if (v) win.sessionStorage.removeItem(NOTICE)
    return v || ''
  } catch { return '' }
}

/* ---------------------------------------------------------------------------------- the network */

const dataBase = id => `/api/trainer/managed/${id}/data`

/** What to do with one request. `path` has no query; `search` is the query with its "?" or empty. `mode` is the kind of
 *  diary: a managed client's, or a Telegram client's read only (its document is read from another route, and a push of it
 *  is answered here, as stored, without a request: there is nothing to write). */
export function routeFor(method, path, search, id, mode = 'managed') {
  const m = String(method || 'GET').toUpperCase()
  if (m === 'GET' && path === '/api/config') return { kind: 'config' }
  if (m === 'GET' && path === '/api/me') return { kind: 'me' }
  if (mode === 'readonly') {
    if (m === 'GET' && path === '/api/data') return { kind: 'rewrite', path: `/api/trainer/clients/${id}/doc`, search, track: true }
    if (m === 'GET' && path === '/api/data/rev') return { kind: 'rewrite', path: `/api/trainer/clients/${id}/doc/rev`, search, track: true }
    if (m === 'PUT' && path === '/api/data') return { kind: 'swallow' }
    return { kind: 'block' }
  }
  if (path === '/api/data' && (m === 'GET' || m === 'PUT')) return { kind: 'rewrite', path: dataBase(id), search }
  if (m === 'GET' && path === '/api/data/rev') return { kind: 'rewrite', path: dataBase(id) + '/rev', search }
  // The two things the trainer does with this client's data from its settings: a copy, and deleting the diary. Only
  // for this diary's own id; the same calls for any other id fall through to the refusal below.
  if (m === 'GET' && path === `/api/trainer/managed/${id}/export`) return { kind: 'pass' }
  if (m === 'DELETE' && path === `/api/trainer/managed/${id}`) return { kind: 'pass' }
  return { kind: 'block' }
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
export const blockedAnswer = () => json(403, { error: 'managed-mode', code: 'managed-mode' })
const meAnswer = i => json(200, { user: { id: managedUserId(i.id), name: i.name || 'Подопечный' } })

/** The instance config, minus everything that is the trainer's own: no sign-in, Coach, media or invites. */
export function managedConfig(cfg) {
  const out = { allow_guest: false, invite_only: false }
  if (cfg && typeof cfg === 'object' && typeof cfg.default_lang === 'string') out.default_lang = cfg.default_lang
  return out
}

/** The path under the app's base when `url` is an API call of this app, else null (a foreign URL). */
export function apiPathOf(rawUrl, win) {
  let u
  try { u = new URL(rawUrl, win.location.href) } catch { return null }
  if (u.origin !== win.location.origin) return null
  const base = baseOf(win.location).replace(/\/$/, '')
  const p = u.pathname.replace(/[\\/]+/g, '/')
  if (p === base + '/api' || p.startsWith(base + '/api/')) return { path: p.slice(base.length), search: u.search, base }
  return null
}

function guardFetch(win, i) {
  const real = win.fetch.bind(win)
  const seen = { rev: 0, wid: '' }
  win.fetch = function managedFetch(input, init) {
    const isReq = typeof Request !== 'undefined' && input instanceof Request
    const target = apiPathOf(isReq ? input.url : String(input), win)
    if (!target) return real(input, init)
    const method = (init && init.method) || (isReq ? input.method : 'GET')
    const r = routeFor(method, target.path, target.search, i.id, i.kind || 'managed')
    if (r.kind === 'block') return Promise.resolve(blockedAnswer())
    if (r.kind === 'me') return Promise.resolve(meAnswer(i))
    if (r.kind === 'pass') return real(input, init)
    if (r.kind === 'swallow') return Promise.resolve(json(200, { ok: true, rev: seen.rev, ...(seen.wid ? { wid: seen.wid } : {}), ts: null }))
    if (r.kind === 'config') {
      return real(input, init).then(async res => {
        let cfg = null
        try { cfg = await res.json() } catch { /* an answer that is not JSON: the minimal config */ }
        return json(200, managedConfig(cfg))
      }).catch(() => json(200, managedConfig(null)))
    }
    // Rewritten to the owner's managed routes. The profile header names the client, whom the trainer's own
    // session is not: it would be refused as another account, so it does not go.
    const headers = new Headers((init && init.headers) || (isReq ? input.headers : undefined))
    headers.delete('x-opengym-user')
    const next = { ...(init || {}), method, headers, credentials: 'same-origin' }
    if (isReq && !(init && init.body) && method !== 'GET' && method !== 'HEAD') next.body = input.clone().body
    const answer = real(target.base + r.path + r.search, next)
    // A read only diary remembers the revision the server has, to answer its own pushes with it (see 'swallow').
    return r.track ? answer.then(res => { res.clone().json().then(b => { if (b && Number.isFinite(b.rev)) { seen.rev = b.rev; seen.wid = typeof b.wid === 'string' ? b.wid : seen.wid } }).catch(() => {}); return res }) : answer
  }
}

function guardOtherChannels(win) {
  const open = win.XMLHttpRequest && win.XMLHttpRequest.prototype.open
  if (open) {
    win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (apiPathOf(String(url), win)) throw new DOMException('Not available in this diary', 'NotAllowedError')
      return open.call(this, method, url, ...rest)
    }
  }
  const beacon = win.navigator && win.navigator.sendBeacon
  if (typeof beacon === 'function') {
    win.navigator.sendBeacon = function (url, data) {
      if (apiPathOf(String(url), win)) return false
      return beacon.call(win.navigator, url, data)
    }
  }
}

/* ----------------------------------------------------------------------------------- the storage */

/** A Storage-like view of `real` whose names all carry `prefix`. Exported for the tests. */
export function scoped(real, prefix) {
  const own = () => { const keys = []; for (let i = 0; i < real.length; i++) { const k = real.key(i); if (k && k.startsWith(prefix)) keys.push(k) } return keys }
  return {
    getItem: k => real.getItem(prefix + k),
    setItem: (k, v) => real.setItem(prefix + k, v),
    removeItem: k => real.removeItem(prefix + k),
    key: n => { const k = own()[n]; return k === undefined ? null : k.slice(prefix.length) },
    clear: () => { for (const k of own()) real.removeItem(k) },
    get length() { return own().length },
  }
}

// Storage's methods are replaced on the prototype, not window.localStorage itself: every engine allows it,
// where redefining the window's own property is not dependable (WebKit). The page's two Storage objects are
// told apart by identity; a Storage the page makes itself would not exist (there is no constructor).
function guardStorage(win, i) {
  const proto = win.Storage && win.Storage.prototype
  if (!proto) return
  let ls = null, ss = null
  try { ls = win.localStorage } catch { /* blocked */ }
  try { ss = win.sessionStorage } catch { /* blocked */ }
  const prefix = MANAGED_PREFIX(i.id)
  const orig = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem, key: proto.key, clear: proto.clear }
  const lengthDesc = Object.getOwnPropertyDescriptor(proto, 'length')
  const view = new Map()
  const viewOf = self => {
    if (self !== ls && self !== ss) return null
    if (!view.has(self)) {
      // The unscoped operations of the real object, in the shape scoped() takes.
      const real = {
        getItem: k => orig.getItem.call(self, k), setItem: (k, v) => orig.setItem.call(self, k, v), removeItem: k => orig.removeItem.call(self, k),
        key: n => orig.key.call(self, n), get length() { return lengthDesc.get.call(self) },
      }
      view.set(self, scoped(real, prefix))
    }
    return view.get(self)
  }
  const keep = (self, k) => self === ss && (String(k) === FLAG || String(k) === NOTICE || FOREIGN.test(String(k)))
  proto.getItem = function (k) { const v = viewOf(this); return !v || keep(this, k) ? orig.getItem.call(this, k) : v.getItem(String(k)) }
  proto.setItem = function (k, val) { const v = viewOf(this); return !v || keep(this, k) ? orig.setItem.call(this, k, val) : v.setItem(String(k), String(val)) }
  proto.removeItem = function (k) { const v = viewOf(this); return !v || keep(this, k) ? orig.removeItem.call(this, k) : v.removeItem(String(k)) }
  proto.key = function (n) { const v = viewOf(this); return v ? v.key(n) : orig.key.call(this, n) }
  proto.clear = function () { const v = viewOf(this); return v ? v.clear() : orig.clear.call(this) }
  if (lengthDesc && lengthDesc.get) {
    Object.defineProperty(proto, 'length', { ...lengthDesc, get() { const v = viewOf(this); return v ? v.length : lengthDesc.get.call(this) } })
  }
  // IndexedDB: the app's databases (the media store) get their own names too.
  const idb = win.IDBFactory && win.IDBFactory.prototype
  if (idb) {
    const open = idb.open, del = idb.deleteDatabase
    idb.open = function (name, ...rest) { return open.call(this, prefix + name, ...rest) }
    idb.deleteDatabase = function (name, ...rest) { return del.call(this, prefix + name, ...rest) }
  }
}

/* ------------------------------------------------------------------------------------- start */

export function installManagedGuards(win, i) {
  guardStorage(win, i)
  guardFetch(win, i)
  guardOtherChannels(win)
}

if (typeof window !== 'undefined') {
  info = detect(window)
  if (info) installManagedGuards(window, info)
}
