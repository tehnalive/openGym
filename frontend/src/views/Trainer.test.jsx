// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ api: vi.fn(), enterRo: vi.fn(() => true) }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
// Opening a client reloads the page in read only mode; here it is only recorded.
vi.mock('../lib/managed-mode.js', async importOriginal => ({ ...(await importOriginal()), enterReadonlyMode: mocks.enterRo }))

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import TrainerHome from './TrainerHome.jsx'
import TrainerClient from './TrainerClient.jsx'
import { EXDB } from '../lib/exercises.js'

const exId = EXDB.find(e => e.bp !== 'cardio' && e.tg).id
const mounted = []
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
function mount(el, path) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  const Where = () => <i data-testid="where">{useLocation().pathname}</i>
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Where />{el}</MemoryRouter>))
  return host
}
const where = host => host.querySelector('[data-testid=where]').textContent
const routes = <Routes><Route path="/trainer" element={<TrainerHome />} /><Route path="/trainer/:linkId" element={<TrainerClient />} />
  <Route path="/settings" element={<b>settings</b>} /></Routes>

const ME = { consentVersion: 1, trainer: { enabled: true, limit: 5, clients: 2, invites: [{ id: 'inv-1-aaaa', label: 'Вася', created: '2026-10-30T00:00:00Z', expires: '2026-11-06T00:00:00Z' }] }, asClient: null }
const CLIENTS = { limit: 5, clients: [
  { linkId: 'link-aaaa-1', name: 'Вася', since: '2026-10-01T00:00:00Z', grants: { history: true, measures: true, stats: true }, workouts: 3, lastWorkout: '2026-10-20' },
  { linkId: 'link-bbbb-2', name: 'Петя', since: '2026-10-02T00:00:00Z', grants: { history: false, measures: true, stats: false } },
] }
const DATA = (grants, extra = {}) => ({ linkId: 'link-aaaa-1', name: 'Вася', since: '2026-10-01T00:00:00Z', grants, data: {
  unit: 'kg',
  ...(grants.history ? { workouts: [{ id: 'w1', d: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), name: 'Верх', start: Date.now() - 2 * 86400000, end: Date.now() - 2 * 86400000 + 3600000, entries: [{ id: exId, sets: [{ done: true, w: 60, r: 8 }] }] }], customEx: [] } : {}),
  ...(grants.measures ? { bodyweight: [{ d: '2026-10-19', w: 80.5 }], measurements: [{ d: '2026-10-19', waist: 82 }], customMeasurements: [] } : {}),
  ...extra } })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

const apiFor = table => path => {
  const hit = Object.entries(table).find(([p]) => path.startsWith(p))
  return hit ? (hit[1] instanceof Error ? Promise.reject(hit[1]) : Promise.resolve(hit[1])) : Promise.reject(Object.assign(new Error('nope'), { status: 404 }))
}

describe('TrainerHome', () => {
  it('lists the clients with what they opened and opens one', async () => {
    mocks.api.mockImplementation(apiFor({ '/api/trainer/me': ME, '/api/trainer/clients': CLIENTS }))
    const host = mount(routes, '/trainer')
    await flush()
    expect(host.textContent).toContain('Подопечных: 2 из 5')
    expect(host.textContent).toContain('Вася')
    expect(host.textContent).toContain('3 трен.')
    expect(host.textContent).toContain('Открыто: замеры и вес')   // no history grant: no history facts
    click([...host.querySelectorAll('.item')].find(x => x.textContent.includes('Вася')))
    // The client opens as the app, read only, with what they opened; the classic screen is the gear on the row.
    expect(mocks.enterRo).toHaveBeenCalledWith('link-aaaa-1', 'Вася', expect.any(String), expect.objectContaining({ history: expect.any(Boolean) }))
    expect(where(host)).toBe('/trainer')
    click(host.querySelector('[aria-label="Классический вид: Вася"]'))
    expect(where(host)).toBe('/trainer/link-aaaa-1')
  })

  it('makes an invitation link and shows it', async () => {
    mocks.api.mockImplementation((path, init) => path === '/api/trainer/invites' && init?.method === 'POST'
      ? Promise.resolve({ id: 'inv-2-bbbb', link: 'https://t.me/Gym_statsbot/zhim?startapp=t_A1b2C3d4E5f6G7h8I9j0K_', expires: '2026-11-06T00:00:00Z' })
      : apiFor({ '/api/trainer/me': ME, '/api/trainer/clients': CLIENTS })(path))
    const host = mount(routes, '/trainer')
    await flush()
    click([...host.querySelectorAll('button')].find(b => b.textContent.includes('Добавить подопечного')))
    click([...host.querySelectorAll('button')].find(b => b.textContent.includes('Через Telegram')))
    await flush()
    expect(host.querySelector('input[aria-label="Ссылка-приглашение"]').value).toMatch(/^https:\/\/t\.me\/Gym_statsbot\/zhim\?startapp=t_/)
  })

  it('with five clients offers no invitation and says why', async () => {
    const five = { limit: 5, clients: Array.from({ length: 5 }, (_, i) => ({ ...CLIENTS.clients[0], linkId: 'link-full-' + i })) }
    mocks.api.mockImplementation(apiFor({ '/api/trainer/me': { ...ME, trainer: { ...ME.trainer, clients: 5 } }, '/api/trainer/clients': five }))
    const host = mount(routes, '/trainer')
    await flush()
    expect(host.textContent).toContain('Сейчас доступно 5 подопечных, позже появится возможность добавить больше')
    expect([...host.querySelectorAll('button')].some(b => b.textContent.includes('Добавить подопечного'))).toBe(false)
  })

  it('shows the server\'s refusal of an invitation', async () => {
    mocks.api.mockImplementation((path, init) => path === '/api/trainer/invites' && init?.method === 'POST'
      ? Promise.reject(Object.assign(new Error('x'), { status: 409, data: { code: 'client-limit', error: 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше' } }))
      : apiFor({ '/api/trainer/me': ME, '/api/trainer/clients': CLIENTS })(path))
    const host = mount(routes, '/trainer')
    await flush()
    click([...host.querySelectorAll('button')].find(b => b.textContent.includes('Добавить подопечного')))
    click([...host.querySelectorAll('button')].find(b => b.textContent.includes('Через Telegram')))
    await flush()
    expect(host.querySelector('[role=alert]').textContent).toContain('Сейчас доступно 5 подопечных')
  })

  it('sends someone who is not a trainer back to settings', async () => {
    mocks.api.mockImplementation(apiFor({ '/api/trainer/me': { consentVersion: 1, trainer: { enabled: false, limit: 5 }, asClient: null } }))
    const host = mount(routes, '/trainer')
    await flush()
    expect(where(host)).toBe('/settings')
  })
})

describe('TrainerClient', () => {
  it('shows only the sections the client opened', async () => {
    mocks.api.mockImplementation(apiFor({ '/api/trainer/clients/link-aaaa-1/data': DATA({ history: true, measures: false, stats: false }) }))
    const host = mount(routes, '/trainer/link-aaaa-1')
    await flush()
    expect(host.textContent).toContain('Вася')
    expect(host.textContent).toContain('Только просмотр')
    expect(host.textContent).toContain('Верх')
    expect(host.querySelector('.seg')).toBe(null)   // one section: no switcher, nothing else to pick
    expect(host.textContent).not.toContain('Вес')
  })

  it('switches between history, measurements and muscles', async () => {
    mocks.api.mockImplementation(apiFor({ '/api/trainer/clients/link-aaaa-1/data': DATA({ history: true, measures: true, stats: true }) }))
    const host = mount(routes, '/trainer/link-aaaa-1')
    await flush()
    const tab = label => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label)
    click(tab('Замеры'))
    expect(host.textContent).toContain('80.5')
    click(tab('Мышцы'))
    expect(host.textContent).toMatch(/усл\. подходов/)
    click(tab('История'))
    expect(host.textContent).toContain('Верх')
  })

  it('has nothing to type into and no way to save: reading only', async () => {
    mocks.api.mockImplementation(apiFor({ '/api/trainer/clients/link-aaaa-1/data': DATA({ history: true, measures: true, stats: true }) }))
    const host = mount(routes, '/trainer/link-aaaa-1')
    await flush()
    for (const label of ['Замеры', 'Мышцы', 'История']) click([...host.querySelectorAll('.seg button')].find(b => b.textContent === label))
    click(host.querySelector('.item [role=button]'))   // open a workout
    expect(host.querySelectorAll('input, textarea, select, [contenteditable]').length).toBe(0)
    // the main screen has nothing that changes anything: ending the link moved to the settings screen
    const labels = [...host.querySelectorAll('button')].map(b => b.textContent).filter(Boolean)
    expect(labels.some(l => /Завершить связь/.test(l))).toBe(false)
    expect(labels.some(l => /Сохранить|Добавить|Записать|Изменить|Удалить/.test(l))).toBe(false)
    expect(mocks.api.mock.calls.every(([p, init]) => p.startsWith('/api/trainer/clients/') && (!init || !init.method || init.method === 'GET'))).toBe(true)
  })

  it('keeps the client\'s data out of the trainer\'s own store and storage', async () => {
    const before = JSON.stringify(useStore.getState().S.workouts)
    mocks.api.mockImplementation(apiFor({ '/api/trainer/clients/link-aaaa-1/data': DATA({ history: true, measures: true, stats: true }) }))
    mount(routes, '/trainer/link-aaaa-1')
    await flush()
    expect(JSON.stringify(useStore.getState().S.workouts)).toBe(before)
    expect(JSON.stringify(useStore.getState().S)).not.toContain('"w1"')
    expect(localStorage.length).toBe(0)
  })

  it('says so when the access was closed', async () => {
    mocks.api.mockImplementation(apiFor({ '/api/trainer/clients/link-aaaa-1/data': Object.assign(new Error('x'), { status: 404, data: { code: 'client-gone', error: 'Подопечный недоступен: доступ закрыт или не открыт' } }) }))
    const host = mount(routes, '/trainer/link-aaaa-1')
    await flush()
    expect(host.querySelector('[role=alert]').textContent).toContain('доступ закрыт')
    expect(host.textContent).not.toContain('Верх')
  })

  it('ends the link after a confirmation', async () => {
    mocks.api.mockImplementation((path, init) => init?.method === 'DELETE' ? Promise.resolve({ ok: true })
      : apiFor({ '/api/trainer/clients/link-aaaa-1/data': DATA({ history: true, measures: false, stats: false }) })(path))
    const host = mount(routes, '/trainer/link-aaaa-1')
    await flush()
    click(host.querySelector('[aria-label="Настройки"]'))
    click([...host.querySelectorAll('button')].find(b => b.textContent === 'Завершить связь'))
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet).toBeTruthy()
    expect(mocks.api.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false)
  })

  it('has the settings: what is open, since when, and the one place to end the link', async () => {
    const data = DATA({ history: true, measures: false, stats: false })
    mocks.api.mockImplementation(apiFor({ '/api/trainer/clients/link-aaaa-1/data': { ...data, avatarUrl: 'https://t.me/i/userpic/320/a.jpg', since: '2026-10-31T10:00:00Z' } }))
    const host = mount(routes, '/trainer/link-aaaa-1')
    await flush()
    expect(host.textContent).not.toContain('Что открыто вам')
    click(host.querySelector('[aria-label="Настройки"]'))
    expect(host.textContent).toContain('Что открыто вам')
    expect(host.textContent).toMatch(/Связь с 31 октября 2026/)
    expect(host.textContent).toMatch(/История тренировок.{0,2}открыто/)
    expect(host.textContent).toMatch(/Замеры и вес.{0,2}закрыто/)
    expect(host.querySelector('.sp-avatar img').getAttribute('src')).toBe('https://t.me/i/userpic/320/a.jpg')
    expect([...host.querySelectorAll('button')].filter(b => b.textContent === 'Завершить связь')).toHaveLength(1)
  })
})
