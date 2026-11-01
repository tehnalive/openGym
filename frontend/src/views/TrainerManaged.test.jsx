// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ api: vi.fn(), enter: vi.fn(() => true) }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
// Entering the diary reloads the page; here it is only recorded.
vi.mock('../lib/managed-mode.js', async importOriginal => ({ ...(await importOriginal()), enterManagedMode: mocks.enter }))

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import TrainerHome from './TrainerHome.jsx'
import TrainerManaged from './TrainerManaged.jsx'
import TrainerClient from './TrainerClient.jsx'
import { EXDB } from '../lib/exercises.js'

const exId = EXDB.find(e => e.bp !== 'cardio' && e.tg && !e.hd).id
const today = new Date(); const TODAY = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
const mounted = []
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const type = (el, value) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
function mount(path) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  const Where = () => <i data-testid="where">{useLocation().pathname}</i>
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Where />
    <Routes><Route path="/trainer" element={<TrainerHome />} /><Route path="/trainer/m/:linkId" element={<TrainerManaged />} />
      <Route path="/trainer/:linkId" element={<TrainerClient />} /><Route path="/settings" element={<b>settings</b>} /></Routes></MemoryRouter>))
  return host
}
const where = host => host.querySelector('[data-testid=where]').textContent
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const field = (host, label) => host.querySelector(`[aria-label="${label}"]`)

const ME = { consentVersion: 1, trainer: { enabled: true, limit: 5, clients: 1, invites: [] }, asClient: null }
const LIST = { limit: 5, clients: [{ linkId: 'link-mmmm-1', name: 'Мама', managed: true, note: 'колено', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: true, stats: true }, workouts: 1, lastWorkout: '2026-10-20' }] }
const DIARY = (over = {}) => ({ linkId: 'link-mmmm-1', name: 'Мама', note: 'колено', managed: true, rev: 4, data: {
  unit: 'kg', weekStart: 1, customEx: [], customMeasurements: [], measurementEnabled: null,
  workouts: [{ id: 'w1', d: '2026-10-20', name: 'Ноги', start: 1, end: 3600001, entries: [{ id: exId, sets: [{ done: true, w: 40, r: 10 }] }] }],
  bodyweight: [{ d: '2026-10-19', w: 70 }], measurements: [{ d: '2026-10-19', waist: 80 }], ...over } })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset(); mocks.enter.mockClear(); mocks.enter.mockImplementation(() => true); localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

const route = table => (path, init) => {
  const key = (init?.method || 'GET') + ' ' + path
  const hit = Object.entries(table).find(([k]) => key === k || key.startsWith(k))
  if (!hit) return Promise.reject(Object.assign(new Error('nope'), { status: 404 }))
  const v = typeof hit[1] === 'function' ? hit[1](init) : hit[1]
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}

describe('adding a client', () => {
  const base = { 'GET /api/trainer/me': ME, 'GET /api/trainer/clients': LIST }

  it('offers Telegram or no Telegram; a managed client opens as the ordinary app, its data screen is one tap away', async () => {
    mocks.api.mockImplementation(route(base))
    const host = mount('/trainer')
    await flush()
    expect(host.textContent).toContain('Без Telegram · 1 трен.')
    click(button(host, 'Добавить подопечного'))
    expect(button(host, 'Через Telegram')).toBeTruthy(); expect(button(host, 'У него нет Telegram')).toBeTruthy()
    click([...host.querySelectorAll('.item')].find(x => x.textContent.includes('Мама')))
    expect(mocks.enter).toHaveBeenCalledWith('link-mmmm-1', 'Мама', expect.any(String))
    expect(where(host)).toBe('/trainer')
    click(host.querySelector('[aria-label="Данные подопечного: Мама"]'))
    expect(where(host)).toBe('/trainer/m/link-mmmm-1')
    expect(mocks.enter).toHaveBeenCalledTimes(1)
  })

  it('needs a name and the 18+ box, then creates the client and opens the diary in the app', async () => {
    mocks.api.mockImplementation(route({ ...base, 'POST /api/trainer/managed': { linkId: 'link-new-22', name: 'Дед', note: '' } }))
    const host = mount('/trainer')
    await flush()
    click(button(host, 'Добавить подопечного')); click(button(host, 'У него нет Telegram'))
    const create = () => button(host, 'Добавить') && [...host.querySelectorAll('button')].find(b => b.textContent === 'Добавить')
    expect(create().disabled).toBe(true)
    type(field(host, 'Имя подопечного'), 'Дед'); expect(create().disabled).toBe(true)
    click(host.querySelector('[role=checkbox]')); expect(create().disabled).toBe(false)
    click(create()); await flush()
    const call = mocks.api.mock.calls.find(([p, i]) => p === '/api/trainer/managed' && i?.method === 'POST')
    expect(JSON.parse(call[1].body)).toEqual({ name: 'Дед', note: '', unit: 'kg', ageConfirmed: true })
    expect(mocks.enter).toHaveBeenCalledWith('link-new-22', 'Дед', expect.any(String))
  })

  it('shows a refusal such as the client limit', async () => {
    mocks.api.mockImplementation(route({ ...base, 'POST /api/trainer/managed': Object.assign(new Error('x'), { status: 409, data: { code: 'client-limit', error: 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше' } }) }))
    const host = mount('/trainer')
    await flush()
    click(button(host, 'Добавить подопечного')); click(button(host, 'У него нет Telegram'))
    type(field(host, 'Имя подопечного'), 'Дед'); click(host.querySelector('[role=checkbox]'))
    click([...host.querySelectorAll('button')].find(b => b.textContent === 'Добавить')); await flush()
    expect(host.querySelector('[role=alert]').textContent).toContain('Сейчас доступно 5 подопечных')
    expect(where(host)).toBe('/trainer')
  })
})

describe('the data of a managed client', () => {
  const table = extra => ({ 'GET /api/trainer/managed/link-mmmm-1': DIARY(), ...extra })

  it('shows the note and what the diary holds, opens it in the app, and keeps it out of the own store and storage of the trainer', async () => {
    const before = JSON.stringify(useStore.getState().S)
    mocks.api.mockImplementation(route(table()))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    expect(host.textContent).toContain('Мама')
    expect(host.textContent).toContain('колено')
    expect(host.textContent).toContain('1 трен., 1 взвеш., 1 замеров')
    // Nothing is recorded on this screen: the forms of the compact version are gone.
    expect(button(host, 'Записать тренировку')).toBeFalsy()
    expect(host.querySelector('input')).toBeNull()
    click(button(host, 'Открыть дневник'))
    expect(mocks.enter).toHaveBeenCalledWith('link-mmmm-1', 'Мама', expect.any(String))
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
    expect(localStorage.length).toBe(0)
  })

  it('asks before deleting the client, and deletes only after the answer', async () => {
    const del = vi.fn(() => ({ ok: true }))
    mocks.api.mockImplementation(route(table({ 'DELETE /api/trainer/managed/link-mmmm-1': del })))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    click(button(host, 'Удалить подопечного'))
    expect(useUI.getState().sheets.length).toBe(1)
    expect(del).not.toHaveBeenCalled()
  })

  it('says so when the client is not the one of this trainer', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/managed/link-mmmm-1': Object.assign(new Error('x'), { status: 404, data: { code: 'client-gone', error: 'Подопечный недоступен' } }) }))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    expect(host.querySelector('[role=alert]').textContent).toContain('недоступен')
    expect(host.textContent).not.toContain('Ноги')
  })
})

describe('avatars in the cabinet', () => {
  it('shows the Telegram picture, else the initial on a grey disc; a managed client has the initial only', async () => {
    const list = { limit: 5, clients: [
      { linkId: 'link-tg-0001', name: 'Мария', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: false, stats: false }, avatarUrl: 'https://t.me/i/userpic/320/m.jpg' },
      { linkId: 'link-tg-0002', name: 'Олег', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: false, stats: false } },
      { linkId: 'link-mmmm-1', name: 'Мама', managed: true, since: '2026-10-30T00:00:00Z', grants: { history: true, measures: true, stats: true } },
    ] }
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': ME, 'GET /api/trainer/clients': list }))
    const host = mount('/trainer')
    await flush()
    const rows = [...host.querySelectorAll('.item')]
    const avatar = name => rows.find(r => r.textContent.includes(name)).querySelector('.sp-avatar')
    expect(avatar('Мария').querySelector('img').getAttribute('src')).toBe('https://t.me/i/userpic/320/m.jpg')
    expect(avatar('Олег').querySelector('img')).toBeNull()
    expect(avatar('Олег').textContent).toBe('О')
    expect(avatar('Олег').className).toContain('neutral')
    expect(avatar('Мама').querySelector('img')).toBeNull()
    expect(avatar('Мама').textContent).toBe('М')
  })

  it('falls back to the initial when the picture does not load, and refuses a picture from another host', async () => {
    const list = { limit: 5, clients: [
      { linkId: 'link-tg-0001', name: 'Мария', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: false, stats: false }, avatarUrl: 'https://t.me/i/userpic/320/m.jpg' },
      { linkId: 'link-tg-0002', name: 'Олег', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: false, stats: false }, avatarUrl: 'https://evil.example/x.jpg' },
    ] }
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': ME, 'GET /api/trainer/clients': list }))
    const host = mount('/trainer')
    await flush()
    const rows = [...host.querySelectorAll('.item')]
    const img = rows[0].querySelector('.sp-avatar img')
    await act(async () => { img.dispatchEvent(new Event('error')) })
    expect(rows[0].querySelector('.sp-avatar img')).toBeNull()
    expect(rows[0].querySelector('.sp-avatar').textContent).toBe('М')
    expect(rows[1].querySelector('.sp-avatar img')).toBeNull()
  })
})

describe('the week of the trainer in the cabinet', () => {
  const sched = (days, time = '', remind = false) => ({ days, time, remind })
  const clientsToday = () => {
    const wd = new Date().getDay() === 0 ? 7 : new Date().getDay()
    const other = wd === 1 ? 2 : 1
    return { limit: 5, clients: [
      { linkId: 'link-tg-0001', name: 'Мария', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: false, stats: false }, schedule: sched([wd], '18:00', true) },
      { linkId: 'link-tg-0002', name: 'Олег', since: '2026-10-30T00:00:00Z', grants: { history: true, measures: false, stats: false }, schedule: sched([other], '10:00') },
      { linkId: 'link-mmmm-1', name: 'Мама', managed: true, since: '2026-10-30T00:00:00Z', grants: { history: true, measures: true, stats: true }, schedule: null },
    ] }
  }

  it('shows who comes today, the week, and the days on each client', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': ME, 'GET /api/trainer/clients': clientsToday() }))
    const host = mount('/trainer')
    await flush()
    const today = host.querySelector('[aria-label=Сегодня]')
    expect(today.textContent).toContain('18:00')
    expect(today.textContent).toContain('Мария')
    expect(today.textContent).not.toContain('Олег')
    expect(host.querySelector('[aria-label=Неделя]').textContent).toContain('Олег')
    expect(host.textContent).toMatch(/напоминание/)
    click(today.querySelector('[role=button]'))
    expect(where(host)).toBe('/trainer/link-tg-0001')
  })

  it('says what to do while nobody has days yet', async () => {
    const list = clientsToday(); list.clients.forEach(c => { c.schedule = null })
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': ME, 'GET /api/trainer/clients': list }))
    const host = mount('/trainer')
    await flush()
    expect(host.querySelector('[aria-label=Сегодня]').textContent).toContain('Отметьте у подопечных')
    expect(host.querySelector('[aria-label=Неделя]')).toBeNull()
  })

  it('sets the days, the time and the reminder of a client, and the list takes the answer', async () => {
    const list = clientsToday(); list.clients[2].schedule = null
    const put = vi.fn(() => ({ schedule: { days: [2, 4], time: '19:15', remind: true } }))
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': ME, 'GET /api/trainer/clients': list, 'PUT /api/trainer/links/link-mmmm-1/schedule': put }))
    const host = mount('/trainer')
    await flush()
    click(host.querySelector('[aria-label="Расписание: Мама"]'))
    const sheet = useUI.getState().sheets.at(-1)
    const box = document.createElement('div'); document.body.appendChild(box)
    const r2 = createRoot(box)
    act(() => r2.render(sheet.render(() => useUI.setState({ sheets: [] }))))
    click(box.querySelector('[aria-label=Вторник]')); click(box.querySelector('[aria-label=Четверг]'))
    type(box.querySelector('[aria-label="Время занятия"]'), '19:15')
    click(box.querySelector('[aria-label=Напоминать]'))
    click([...box.querySelectorAll('button')].find(b => b.textContent === 'Сохранить'))
    await flush()
    const call = mocks.api.mock.calls.find(([p, i]) => p === '/api/trainer/links/link-mmmm-1/schedule' && i?.method === 'PUT')
    const body = JSON.parse(call[1].body)
    expect(body.days).toEqual([2, 4]); expect(body.time).toBe('19:15'); expect(body.remind).toBe(true)
    expect(host.textContent).toContain('Вт Чт · 19:15 · напоминание')
    act(() => r2.unmount()); box.remove()
  })
})
