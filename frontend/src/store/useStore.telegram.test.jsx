// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn(), abandonWork: vi.fn(), stopRest: vi.fn() }) } }))

let api, useStore, DEF, listeners, addListener
const clone = x => JSON.parse(JSON.stringify(x))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const workout = id => ({ id, d: '2026-10-20', start: 1, end: 2, entries: [] })
const user = id => ({ id, name: id, admin: false })
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT')
const sdk = () => ({ initData: 'signed-opaque-data', ready: vi.fn(), expand: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn() })

async function init({ owner, guest = false, launch = true } = {}) {
  if (launch) window.Telegram = { WebApp: sdk() }
  else delete window.Telegram
  if (owner) { localStorage.setItem('gym_owner', owner); localStorage.setItem('gym_user', JSON.stringify(user(owner))) }
  if (guest) localStorage.setItem('gym_guest', '1')
  ;({ api } = await import('../lib/api.js'))
  api.mockReset()
  ;({ useStore, DEF } = await import('./useStore.js'))
  api.mockImplementation(async (p, o) => {
    if (p === '/api/config') return { telegram_login: true, allow_guest: true, coach: null }
    if (p === '/api/telegram/login') return { user: user('B') }
    if (p === '/api/me') return { user: user('A') }
    if (p === '/api/data' && o?.method === 'PUT') return { ok: true, rev: 2, wid: 'new' }
    if (p === '/api/data') return { state: { ...clone(DEF), workouts: [workout('B-workout')], _ts: 2 }, rev: 1 }
    return {}
  })
}

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  listeners = []
  addListener = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => { listeners.push([type, fn]); addListener(type, fn, opts) })
})
afterEach(() => {
  for (const [type, fn] of listeners) window.removeEventListener(type, fn)
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks()
  localStorage.clear(); sessionStorage.clear(); delete window.Telegram
  document.querySelectorAll('script[src*="telegram.org"]').forEach(s => s.remove())
})

describe('Telegram bootstrap isolates browser identities', () => {
  it('does not call /me or sync the saved owner before the signed exchange; duplicate boot shares one login', async () => {
    await init({ owner: 'A' })
    expect(useStore.getState().user).toBeNull() // main.jsx media sync cannot use cached A either
    useStore.setState({ S: { ...clone(DEF), workouts: [workout('A-private')] } })
    const exchange = deferred()
    const original = api.getMockImplementation()
    api.mockImplementation((p, o) => p === '/api/telegram/login' ? exchange.promise : original(p, o))
    const a = useStore.getState().boot(), b = useStore.getState().boot()
    await vi.waitFor(() => expect(api.mock.calls.some(([p]) => p === '/api/telegram/login')).toBe(true))
    await useStore.getState().pushState(); await useStore.getState().pullState()
    expect(api.mock.calls.filter(([p]) => p === '/api/me' || p === '/api/data')).toHaveLength(0)
    expect(useStore.getState().telegram.status).toBe('pending')
    expect(useStore.getState().ready).toBe(false)
    exchange.resolve({ user: user('B') }); await Promise.all([a, b])
    expect(api.mock.calls.filter(([p]) => p === '/api/telegram/login')).toHaveLength(1)
    expect(useStore.getState().user.id).toBe('B')
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['B-workout'])
    expect(api.mock.calls.find(([p]) => p === '/api/data')[1].headers).toEqual({ 'X-OpenGym-User': 'B' })
    expect(puts()).toHaveLength(0)
    expect(window.Telegram.WebApp.ready).toHaveBeenCalledOnce()
  })

  it('keeps guest data and active workout aside, never imports either into a new empty Telegram profile', async () => {
    await init({ guest: true })
    const active = { id: 'guest-active', name: 'Guest workout', ex: [] }
    useStore.setState({ S: { ...clone(DEF), workouts: [workout('guest')], active } })
    const original = api.getMockImplementation()
    api.mockImplementation((p, o) => p === '/api/data' ? Promise.resolve({ state: null, rev: 0 }) : original(p, o))
    await useStore.getState().boot()
    expect(useStore.getState().telegram.status).toBe('ready')
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useStore.getState().S.active).toBeNull()
    expect(puts()).toHaveLength(0)
    const kept = await useStore.getState().keptChanges()
    expect(kept).toHaveLength(1)
    const saved = await useStore.getState().keptState(kept[0].server, kept[0].uid)
    expect(saved.workouts[0].id).toBe('guest')
    expect(saved.active.id).toBe('guest-active')
  })

  it('does not fall back to cookie A when Telegram exchange fails; explicit retry can recover', async () => {
    await init({ owner: 'A' })
    const original = api.getMockImplementation()
    api.mockImplementation((p, o) => p === '/api/telegram/login' ? Promise.reject({ status: 401 }) : original(p, o))
    await useStore.getState().boot()
    expect(useStore.getState().telegram.status).toBe('error')
    expect(useStore.getState().ready).toBe(false)
    expect(api.mock.calls.some(([p]) => p === '/api/me' || p === '/api/data')).toBe(false)
    api.mockImplementation(original)
    await useStore.getState().bootTelegram()
    expect(useStore.getState().telegram.status).toBe('ready')
    expect(useStore.getState().user.id).toBe('B')
  })

  it('ignores a late pull after shared storage switches owners, blocks the Telegram tab instead of following C', async () => {
    await init(); await useStore.getState().boot()
    const read = deferred()
    api.mockImplementation((p) => p === '/api/data' ? read.promise : Promise.resolve({}))
    const pull = useStore.getState().pullState()
    localStorage.setItem('gym_owner', 'C')
    window.dispatchEvent(new StorageEvent('storage', { key: 'gym_owner', newValue: 'C', oldValue: 'B' }))
    read.resolve({ state: { ...clone(DEF), workouts: [workout('C-private')], _ts: 99 }, rev: 9 })
    await pull
    expect(useStore.getState().telegram.status).toBe('error')
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
    expect(puts()).toHaveLength(0)
  })

  it('fails closed if cookie changes before adoption GET and server reports account-changed', async () => {
    await init({ owner: 'A' })
    const original = api.getMockImplementation()
    api.mockImplementation((p, o) => {
      if (p === '/api/data') {
        expect(o.headers['X-OpenGym-User']).toBe('B')
        return Promise.reject({ status: 409, data: { code: 'account-changed', error: 'account changed' } })
      }
      return original(p, o)
    })
    await useStore.getState().boot()
    expect(useStore.getState().telegram.status).toBe('error')
    expect(useStore.getState().ready).toBe(false)
    expect(puts()).toHaveLength(0)
  })

  it('ordinary web without launch data keeps its existing /me boot and never loads the SDK', async () => {
    await init({ launch: false })
    await useStore.getState().boot()
    expect(useStore.getState().telegram.status).toBe('off')
    expect(api.mock.calls.some(([p]) => p === '/api/me')).toBe(true)
    expect(api.mock.calls.some(([p]) => p === '/api/telegram/login')).toBe(false)
    expect(document.querySelector('script[src*="telegram.org"]')).toBeNull()
  })

  it('launch fragment plus unavailable SDK blocks the old cookie instead of becoming ordinary web', async () => {
    window.history.replaceState(null, '', '/#tgWebAppData=opaque&tgWebAppVersion=8.0')
    vi.spyOn(document.head, 'appendChild').mockImplementation(el => el)
    await init({ owner: 'A', launch: false })
    const boot = useStore.getState().boot()
    await vi.advanceTimersByTimeAsync(8001)
    await boot
    expect(useStore.getState().telegram.status).toBe('error')
    expect(useStore.getState().user).toBeNull()
    expect(api).not.toHaveBeenCalled()
  })

  it('marker-only reload at #/home remains a Telegram barrier when no SDK credential is restored', async () => {
    sessionStorage.setItem('opengym_telegram_tab', '1')
    window.history.replaceState(null, '', '/#/home')
    vi.spyOn(document.head, 'appendChild').mockImplementation(el => el)
    await init({ owner: 'A', launch: false })
    const boot = useStore.getState().boot()
    await vi.advanceTimersByTimeAsync(8001); await boot
    expect(useStore.getState().telegram.status).toBe('error')
    expect(useStore.getState().user).toBeNull()
    expect(api).not.toHaveBeenCalled()
  })

  it('logout requires a fresh signed exchange and cannot expose the ordinary Login screen', async () => {
    await init(); await useStore.getState().boot()
    expect(() => useStore.getState().setUser(user('C'))).toThrow('Telegram identity')
    useStore.getState().setUser(null)
    expect(useStore.getState().telegram.status).toBe('error')
    expect(useStore.getState().ready).toBe(false)
    api.mockClear()
    await useStore.getState().bootTelegram()
    expect(api.mock.calls.filter(([p]) => p === '/api/telegram/login')).toHaveLength(1)
    expect(useStore.getState().user.id).toBe('B')
    expect(useStore.getState().telegram.status).toBe('ready')
  })
})
