// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))

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
  mocks.api.mockReset(); localStorage.clear()
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

  it('offers Telegram or no Telegram, and a managed client opens its own screen', async () => {
    mocks.api.mockImplementation(route(base))
    const host = mount('/trainer')
    await flush()
    expect(host.textContent).toContain('Без Telegram · 1 трен.')
    click(button(host, 'Добавить подопечного'))
    expect(button(host, 'Через Telegram')).toBeTruthy(); expect(button(host, 'У него нет Telegram')).toBeTruthy()
    click([...host.querySelectorAll('.item')].find(x => x.textContent.includes('Мама')))
    expect(where(host)).toBe('/trainer/m/link-mmmm-1')
  })

  it('needs a name and the 18+ box, then creates the client and opens the diary', async () => {
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
    expect(where(host)).toBe('/trainer/m/link-new-22')
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

describe('keeping the diary', () => {
  const table = extra => ({ 'GET /api/trainer/managed/link-mmmm-1': DIARY(), ...extra })

  it('says whose diary is open and keeps it out of the trainer\'s own store and storage', async () => {
    const before = JSON.stringify(useStore.getState().S)
    mocks.api.mockImplementation(route(table()))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    expect(host.querySelector('[role=status]').textContent).toContain('Вы ведёте дневник: Мама')
    expect(host.textContent).toContain('Ноги')
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
    expect(localStorage.length).toBe(0)
  })

  it('records a weigh-in with the revision it was made against and shows the answer', async () => {
    const ops = vi.fn(() => ({ ok: true, rev: 5, data: DIARY({ bodyweight: [{ d: TODAY, w: 71.5 }, { d: '2026-10-19', w: 70 }] }).data }))
    mocks.api.mockImplementation(route(table({ 'POST /api/trainer/managed/link-mmmm-1/ops': ops })))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    click([...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Вес и замеры'))
    type(field(host, 'Вес'), '71,5')
    click(button(host, 'Записать вес')); await flush()
    const body = JSON.parse(ops.mock.calls[0][0].body)
    expect(body).toEqual({ baseRev: 4, ops: [{ op: 'bodyweight.set', d: TODAY, w: 71.5 }] })
    expect(host.textContent).toContain('71.5')
  })

  it('writes a workout through the form', async () => {
    const ops = vi.fn(() => ({ ok: true, rev: 5, data: DIARY().data }))
    mocks.api.mockImplementation(route(table({ 'POST /api/trainer/managed/link-mmmm-1/ops': ops })))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    click(button(host, 'Записать тренировку'))
    // No exercise yet: the form says so and sends nothing.
    click([...host.querySelectorAll('button')].find(b => b.textContent === 'Записать'))
    expect(host.querySelector('[role=alert]').textContent).toContain('упражнение')
    expect(ops).not.toHaveBeenCalled()
    const name = EXDB.find(e => e.id === exId).n
    type(field(host, 'Поиск упражнения'), name)
    const pick = [...host.querySelectorAll('button.item')][0]
    expect(pick).toBeTruthy()
    click(pick)
    type(field(host, 'Вес, подход 1'), '50'); type(field(host, 'Повторы, подход 1'), '8')
    click([...host.querySelectorAll('button')].find(b => b.textContent === 'Записать')); await flush()
    expect(ops).toHaveBeenCalledTimes(1)
    const sent = JSON.parse(ops.mock.calls[0][0].body)
    expect(sent.baseRev).toBe(4)
    expect(sent.ops[0].op).toBe('workout.save')
    expect(sent.ops[0].workout.entries[0].sets[0]).toMatchObject({ w: 50, r: 8, done: true })
  })

  it('takes the server\'s newer diary on a conflict', async () => {
    const newer = DIARY({ workouts: [], bodyweight: [{ d: '2026-10-25', w: 69 }] })
    mocks.api.mockImplementation(route(table({ 'POST /api/trainer/managed/link-mmmm-1/ops': Object.assign(new Error('x'), { status: 409, data: { code: 'conflict', error: 'Дневник изменился в другом окне. Данные обновлены, повторите действие', rev: 9, data: newer.data } }) })))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    click([...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Вес и замеры'))
    type(field(host, 'Вес'), '70'); click(button(host, 'Записать вес')); await flush()
    expect(useUI.getState().toastMsg).toContain('Дневник изменился')
    expect(host.textContent).toContain('69')
  })

  it('asks before deleting a workout and before deleting the client', async () => {
    mocks.api.mockImplementation(route(table()))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    click(host.querySelector('.item [role=button]'))
    click(button(host, 'Удалить тренировку'))
    expect(useUI.getState().sheets.length).toBe(1)
    expect(mocks.api.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false)
    useUI.setState({ sheets: [] })
    click(button(host, 'Удалить подопечного'))
    expect(useUI.getState().sheets.length).toBe(1)
    expect(mocks.api.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false)
  })

  it('says so when the client is not the trainer\'s', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/managed/link-mmmm-1': Object.assign(new Error('x'), { status: 404, data: { code: 'client-gone', error: 'Подопечный недоступен' } }) }))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    expect(host.querySelector('[role=alert]').textContent).toContain('недоступен')
    expect(host.textContent).not.toContain('Ноги')
  })
})
