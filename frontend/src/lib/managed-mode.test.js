// Managed mode (TG14): the trainer's app opened in a client's name must not touch the trainer's own storage and
// must not reach any API route but the client's diary. Run against a fake window, so the guards are the real ones.
import { describe, it, expect, vi } from 'vitest'
import { shownLang, routeFor, scoped, detect, installManagedGuards, apiPathOf, managedConfig, enterManagedMode, leaveManagedMode, takeManagedNotice, MANAGED_PREFIX } from './managed-mode.js'

const ID = 'gDzEuZgmpoBd'

class FakeStorage {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null }
  setItem(k, v) { this.m.set(String(k), String(v)) }
  removeItem(k) { this.m.delete(String(k)) }
  key(n) { return [...this.m.keys()][n] ?? null }
  clear() { this.m.clear() }
  get length() { return this.m.size }
}

function fakeWindow({ href = 'https://gym.example/', fetchImpl } = {}) {
  const url = new URL(href)
  const win = {
    Storage: FakeStorage, localStorage: new FakeStorage(), sessionStorage: new FakeStorage(),
    location: { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, assign: vi.fn() },
    history: { state: null, replaceState: vi.fn() },
    fetch: fetchImpl || vi.fn(async () => new Response('{"ok":true}', { status: 200 })),
    XMLHttpRequest: class { open() { this.opened = true } },
    navigator: { sendBeacon: vi.fn(() => true) },
    IDBFactory: class { open(name) { return { opened: name } } deleteDatabase(name) { return { deleted: name } } },
  }
  win.indexedDB = new win.IDBFactory()
  return win
}
const jsonOf = async r => ({ status: r.status, body: await r.json() })

describe('routeFor', () => {
  it('sends the app\'s data calls to the client\'s managed routes', () => {
    expect(routeFor('GET', '/api/data', '', ID)).toEqual({ kind: 'rewrite', path: `/api/trainer/managed/${ID}/data`, search: '' })
    expect(routeFor('put', '/api/data', '', ID).path).toBe(`/api/trainer/managed/${ID}/data`)
    expect(routeFor('GET', '/api/data/rev', '?x=1', ID)).toEqual({ kind: 'rewrite', path: `/api/trainer/managed/${ID}/data/rev`, search: '?x=1' })
  })
  it('answers /api/me and the config locally, and refuses everything else', () => {
    expect(routeFor('GET', '/api/me', '', ID).kind).toBe('me')
    expect(routeFor('GET', '/api/config', '', ID).kind).toBe('config')
    const refused = [['POST', '/api/telegram/login'], ['POST', '/api/logout'], ['POST', '/api/push/subscribe'], ['GET', '/api/coach/status'],
      ['POST', '/api/shares'], ['GET', '/api/trainer/clients'], ['GET', '/api/trainer/managed/other/data'], ['PUT', '/api/media/abc'], ['POST', '/api/activity'],
      ['DELETE', '/api/data'], ['POST', '/api/data'], ['GET', '/api/admin/users'], ['POST', '/api/account/delete'], ['GET', '/api/telegram/notifications']]
    for (const [m, p] of refused) expect(routeFor(m, p, '', ID).kind, m + ' ' + p).toBe('block')
  })
  it('lets through the export and the deleting of this diary only, never the diary of another client', () => {
    expect(routeFor('GET', `/api/trainer/managed/${ID}/export`, '', ID).kind).toBe('pass')
    expect(routeFor('DELETE', `/api/trainer/managed/${ID}`, '', ID).kind).toBe('pass')
    expect(routeFor('GET', '/api/trainer/managed/otherlink12/export', '', ID).kind).toBe('block')
    expect(routeFor('DELETE', '/api/trainer/managed/otherlink12', '', ID).kind).toBe('block')
    expect(routeFor('POST', `/api/trainer/managed/${ID}/ops`, '', ID).kind).toBe('block')
    expect(routeFor('GET', `/api/trainer/managed/${ID}`, '', ID).kind).toBe('block')
  })
})

describe('the storage guard', () => {
  it('scoped() is a prefixed view that cannot see or clear other keys', () => {
    const real = new FakeStorage()
    real.setItem('gym_state_v1', 'trainer')
    const s = scoped(real, 'm:x:')
    s.setItem('gym_state_v1', 'client')
    expect(real.getItem('gym_state_v1')).toBe('trainer')
    expect(real.getItem('m:x:gym_state_v1')).toBe('client')
    expect(s.getItem('gym_state_v1')).toBe('client')
    expect(s.length).toBe(1)
    expect(s.key(0)).toBe('gym_state_v1')
    s.clear()
    expect(real.getItem('gym_state_v1')).toBe('trainer')
    expect(real.length).toBe(1)
  })

  it('every localStorage and sessionStorage write lands under the prefix, and the trainer\'s keys are never read', () => {
    const win = fakeWindow()
    const ls = win.localStorage, ss = win.sessionStorage
    ls.setItem('gym_state_v1', 'TRAINER'); ls.setItem('gym_owner', 'TRAINER_ID')
    ss.setItem('opengym_telegram_tab', '1')
    installManagedGuards(win, { id: ID, name: 'Мама' })
    const p = MANAGED_PREFIX(ID)
    expect(ls.getItem('gym_state_v1')).toBeNull()
    expect(ls.getItem('gym_owner')).toBeNull()
    expect(ss.getItem('opengym_telegram_tab')).toBeNull()
    ls.setItem('gym_state_v1', 'CLIENT'); ls.setItem('gym_owner', 'CLIENT_ID'); ls.setItem('newkey', 'x')
    ss.setItem('anything', 'y')
    // What is really stored, read around the guard (the Map behind the fake).
    const raw = Object.fromEntries(ls.m)
    expect(raw.gym_state_v1).toBe('TRAINER')
    expect(raw.gym_owner).toBe('TRAINER_ID')
    expect(raw[p + 'gym_state_v1']).toBe('CLIENT')
    expect(raw[p + 'newkey']).toBe('x')
    expect(Object.keys(raw).filter(k => !k.startsWith(p) && !['gym_state_v1', 'gym_owner'].includes(k))).toEqual([])
    expect([...ss.m.keys()].filter(k => !k.startsWith(p) && k !== 'opengym_telegram_tab')).toEqual([])
    expect(ls.length).toBe(3)
    ls.removeItem('gym_state_v1')
    expect(ls.m.get('gym_state_v1')).toBe('TRAINER')
    expect(ls.getItem('gym_state_v1')).toBeNull()
    ls.clear()
    expect(ls.m.get('gym_state_v1')).toBe('TRAINER')   // the trainer's own copy survives a clear()
    expect(ls.length).toBe(0)
  })

  it('the flag, the notice and Telegram\'s own keys stay in plain sessionStorage', () => {
    const win = fakeWindow()
    installManagedGuards(win, { id: ID, name: '' })
    win.sessionStorage.setItem('gym_as', '{"id":"x"}')
    win.sessionStorage.setItem('__telegram__initParams', '{}')
    win.sessionStorage.setItem('gym_as_notice', 'n')
    expect([...win.sessionStorage.m.keys()].sort()).toEqual(['__telegram__initParams', 'gym_as', 'gym_as_notice'])
    // The same name in localStorage is the client's, prefixed.
    win.localStorage.setItem('gym_as', 'z')
    expect(win.localStorage.m.has(MANAGED_PREFIX(ID) + 'gym_as')).toBe(true)
  })

  it('IndexedDB names get the prefix too', () => {
    const win = fakeWindow()
    installManagedGuards(win, { id: ID, name: '' })
    expect(win.indexedDB.open('opengym-media', 1).opened).toBe(MANAGED_PREFIX(ID) + 'opengym-media')
    expect(win.indexedDB.deleteDatabase('opengym-media').deleted).toBe(MANAGED_PREFIX(ID) + 'opengym-media')
  })
})

describe('the network guard', () => {
  it('refuses every other /api call without a request', async () => {
    const win = fakeWindow(); const real = win.fetch
    installManagedGuards(win, { id: ID, name: 'Мама' })
    const calls = [['/api/telegram/login', { method: 'POST', body: '{}' }], ['/api/push/subscribe', { method: 'POST' }], ['/api/coach/status'],
      ['/api/shares', { method: 'POST' }], ['/api/trainer/clients'], ['/api/logout', { method: 'POST' }], ['/api/media/abc'], ['/api/account/delete', { method: 'POST' }]]
    for (const [path, init] of calls) {
      const r = await jsonOf(await win.fetch(path, init))
      expect(r.status, path).toBe(403)
      expect(r.body.code).toBe('managed-mode')
    }
    expect(real).not.toHaveBeenCalled()
  })

  it('answers /api/me with the client, locally', async () => {
    const win = fakeWindow(); const real = win.fetch
    installManagedGuards(win, { id: ID, name: 'Мама' })
    const r = await jsonOf(await win.fetch('https://gym.example/api/me'))
    expect(r.status).toBe(200)
    expect(r.body.user).toEqual({ id: 'managed-' + ID, name: 'Мама' })
    expect(real).not.toHaveBeenCalled()
  })

  it('rewrites the document calls to the managed routes and drops the profile header', async () => {
    const win = fakeWindow(); const real = win.fetch
    installManagedGuards(win, { id: ID, name: 'Мама' })
    await win.fetch('/api/data', { headers: { 'X-OpenGym-User': 'managed-' + ID, 'Content-Type': 'application/json' } })
    await win.fetch('/api/data', { method: 'PUT', headers: { 'x-opengym-user': 'u', 'Content-Type': 'application/json' }, body: '{"state":{}}' })
    await win.fetch('/api/data/rev')
    const calls = real.mock.calls
    expect(calls[0][0]).toBe(`/api/trainer/managed/${ID}/data`)
    expect(calls[1][0]).toBe(`/api/trainer/managed/${ID}/data`)
    expect(calls[1][1].method).toBe('PUT')
    expect(calls[1][1].body).toBe('{"state":{}}')
    expect(calls[2][0]).toBe(`/api/trainer/managed/${ID}/data/rev`)
    for (const c of calls) {
      expect(c[1].headers.get('x-opengym-user')).toBeNull()
      expect(c[1].credentials).toBe('same-origin')
    }
  })

  it('keeps the app\'s subpath, passes foreign and non-API URLs through, and trims the config', async () => {
    const answer = url => (String(url).endsWith('/api/config')
      ? new Response(JSON.stringify({ invite_only: true, telegram_login: true, coach: { on: 1 }, media: {}, default_lang: 'ru' })) : new Response('{}'))
    const win = fakeWindow({ href: 'https://gym.example/myGym/index.html', fetchImpl: vi.fn(async url => answer(url)) })
    const real = win.fetch
    installManagedGuards(win, { id: ID, name: '' })
    await win.fetch('/myGym/api/data')
    expect(real.mock.calls[0][0]).toBe(`/myGym/api/trainer/managed/${ID}/data`)
    await win.fetch('https://telegram.org/js/telegram-web-app.js')
    await win.fetch('/myGym/assets/index.js')
    await win.fetch('https://other.example/api/data')
    expect(real.mock.calls.slice(1).map(c => c[0])).toEqual(['https://telegram.org/js/telegram-web-app.js', '/myGym/assets/index.js', 'https://other.example/api/data'])
    const cfg = await jsonOf(await win.fetch('/myGym/api/config'))
    expect(cfg.body).toEqual({ allow_guest: false, invite_only: false, default_lang: 'ru' })
  })

  it('an XHR to the API throws, a beacon to it is refused, other URLs go on', () => {
    const win = fakeWindow()
    installManagedGuards(win, { id: ID, name: '' })
    const x = new win.XMLHttpRequest()
    expect(() => x.open('PUT', '/api/media/abc')).toThrow()
    expect(() => x.open('GET', '/assets/a.png')).not.toThrow()
    expect(win.navigator.sendBeacon('/api/activity', '{}')).toBe(false)
    expect(win.navigator.sendBeacon('/other', '{}')).toBe(true)
  })

  it('apiPathOf reads the path under the base', () => {
    const win = fakeWindow({ href: 'https://gym.example/app/' })
    expect(apiPathOf('/app/api/data?x=1', win)).toEqual({ path: '/api/data', search: '?x=1', base: '/app' })
    expect(apiPathOf('/api/data', win)).toBeNull()
    expect(apiPathOf('https://x.example/app/api/data', win)).toBeNull()
  })

  it('managedConfig never lets the sign-in, Coach or media of the instance through', () => {
    expect(managedConfig({ telegram_login: true, coach: {}, media: {}, password_login: true, allow_guest: true })).toEqual({ allow_guest: false, invite_only: false })
  })
})

describe('the language of the diary', () => {
  it('is the language of the trainer, and the pick of the app only when none was carried', () => {
    expect(shownLang({ id: ID, name: '', lang: 'ru' }, 'en')).toBe('ru')
    expect(shownLang({ id: ID, name: '', lang: '' }, 'de')).toBe('de')
    expect(shownLang(null, 'en')).toBe('en')
  })
})

describe('entering and leaving', () => {
  it('detect() takes ?as= once, keeps the flag, and ignores a bad id', () => {
    const win = fakeWindow({ href: `https://gym.example/?as=${ID}#/home` })
    expect(detect(win)).toEqual({ id: ID, name: '', lang: '' })
    expect(JSON.parse(win.sessionStorage.getItem('gym_as')).id).toBe(ID)
    expect(win.history.replaceState).toHaveBeenCalled()
    expect(win.history.replaceState.mock.calls[0][2]).toBe('/#/home')
    const again = fakeWindow(); again.sessionStorage.setItem('gym_as', JSON.stringify({ id: ID, name: 'Мама', lang: 'ru' }))
    expect(detect(again)).toEqual({ id: ID, name: 'Мама', lang: 'ru' })
    // A language that is not a tag is dropped, not trusted.
    const odd = fakeWindow(); odd.sessionStorage.setItem('gym_as', JSON.stringify({ id: ID, name: 'x', lang: '<script>' }))
    expect(detect(odd).lang).toBe('')
    expect(detect(fakeWindow({ href: 'https://gym.example/?as=../../x' }))).toBeNull()
    expect(detect(fakeWindow())).toBeNull()
    const bad = fakeWindow(); bad.sessionStorage.setItem('gym_as', '{"id":"short"}')
    expect(detect(bad)).toBeNull()
  })

  it('enterManagedMode sets the flag and loads the page again with ?as=; leaving clears it and loads again', () => {
    const win = fakeWindow({ href: 'https://gym.example/app/#/trainer' })
    expect(enterManagedMode('bad id', 'x', 'ru', win)).toBe(false)
    expect(enterManagedMode(ID, 'Мама', 'ru', win)).toBe(true)
    expect(JSON.parse(win.sessionStorage.getItem('gym_as'))).toEqual({ id: ID, name: 'Мама', lang: 'ru' })
    expect(win.location.assign).toHaveBeenLastCalledWith(`/app/?as=${ID}#/home`)
    leaveManagedMode('Не открылось', win)
    expect(win.sessionStorage.getItem('gym_as')).toBeNull()
    expect(win.location.assign).toHaveBeenLastCalledWith('/app/?m=out#/trainer')
    expect(takeManagedNotice(win)).toBe('Не открылось')
    expect(takeManagedNotice(win)).toBe('')
  })
})
