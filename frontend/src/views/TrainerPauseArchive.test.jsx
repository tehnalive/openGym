// @vitest-environment happy-dom
// Pause and archive of a client (TG14): the cabinet, the client's settings screens, and "my trainer" on the client's side.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ api: vi.fn(), enter: vi.fn(() => true), enterRo: vi.fn(() => true) }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
vi.mock('../lib/managed-mode.js', async importOriginal => ({ ...(await importOriginal()), enterManagedMode: mocks.enter, enterReadonlyMode: mocks.enterRo }))

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import TrainerHome from './TrainerHome.jsx'
import TrainerManaged from './TrainerManaged.jsx'
import TrainerClient from './TrainerClient.jsx'
import TrainerSettings from '../components/TrainerSettings.jsx'
import { ARCHIVE_CONFIRM } from '../components/TrainerLifecycle.jsx'
import { isoWeekday, pauseUntil, pauseText } from '../lib/trainer.js'

const mounted = []
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
function mount(path, el) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  const Where = () => <i data-testid="where">{useLocation().pathname}</i>
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Where />
    {el || <Routes><Route path="/trainer" element={<TrainerHome />} /><Route path="/trainer/m/:linkId" element={<TrainerManaged />} />
      <Route path="/trainer/:linkId" element={<TrainerClient />} /><Route path="/settings" element={<b>settings</b>} /></Routes>}</MemoryRouter>))
  return host
}
const where = host => host.querySelector('[data-testid=where]').textContent
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
/** Render the open confirmation and press its button. */
async function answer(confirmText) {
  const sheet = useUI.getState().sheets.at(-1)
  const dialog = document.createElement('div'); document.body.appendChild(dialog)
  const root = createRoot(dialog); mounted.push(root)
  act(() => root.render(sheet.render(() => {})))
  const text = dialog.textContent
  const b = [...dialog.querySelectorAll('button')].find(x => x.textContent.includes(confirmText))
  expect(b).toBeTruthy()
  click(b)
  await flush()
  return text
}

const route = table => (path, init) => {
  const key = (init?.method || 'GET') + ' ' + path
  const hit = Object.entries(table).find(([k]) => key === k || key.startsWith(k))
  if (!hit) return Promise.reject(Object.assign(new Error('nope'), { status: 404 }))
  const v = typeof hit[1] === 'function' ? hit[1](init) : hit[1]
  return v instanceof Error ? Promise.reject(v) : Promise.resolve(v)
}
const calls = (method, prefix) => mocks.api.mock.calls.filter(([p, i]) => (i?.method || 'GET') === method && p.startsWith(prefix))
const G = { history: true, measures: true, stats: true }
const ME = (over = {}) => ({ consentVersion: 1, trainer: { enabled: true, limit: 5, clients: 3, archived: 1, invites: [], ...over }, asClient: null })
const dayIso = isoWeekday()
const CLIENTS = (over = {}) => ({ limit: 5, clients: [
  { linkId: 'link-aaaa-1', name: 'Вася', since: '2026-10-01T00:00:00Z', grants: G, workouts: 3, lastWorkout: '2026-10-20', schedule: { days: [dayIso], time: '10:00', remind: true }, pause: null },
  { linkId: 'link-bbbb-2', name: 'Петя', since: '2026-10-02T00:00:00Z', grants: G, workouts: 1, lastWorkout: '2026-10-21', schedule: { days: [dayIso], time: '11:00', remind: true },
    pause: { since: '2026-11-01T00:00:00Z', until: '2026-11-15', reason: 'Отпуск' } },
], archived: [
  { linkId: 'link-cccc-3', name: 'Коля', managed: false, archivedAt: '2026-11-03T08:00:00Z' },
  { linkId: 'link-mmmm-4', name: 'Мама', managed: true, archivedAt: '2026-11-02T08:00:00Z' },
], ...over })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset(); localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the cabinet', () => {
  const base = (over = {}) => ({ 'GET /api/trainer/me': ME(), 'GET /api/trainer/clients': CLIENTS(), ...over })

  it('shows a client on pause muted, with the end and the reason, and does not expect them today', async () => {
    mocks.api.mockImplementation(route(base()))
    const host = mount('/trainer')
    await flush()
    expect(host.textContent).toContain('Подопечных: 2 из 5')
    const row = [...host.querySelectorAll('.list .item')].find(x => x.textContent.includes('Петя'))
    expect(row.textContent).toMatch(/Пауза до 15 нояб\.? · Отпуск/)
    expect(row.style.opacity).toBe('0.6')
    const vasya = [...host.querySelectorAll('.list .item')].find(x => x.textContent.includes('Вася'))
    expect(vasya.style.opacity).toBe('')
    // "Сегодня": the one who is expected, and a muted line for the one on pause
    const todayCard = host.querySelector('[aria-label="Сегодня"]')
    expect(todayCard.textContent).toContain('10:00')
    expect(todayCard.textContent).not.toContain('11:00')
    expect(todayCard.textContent).toContain('На паузе: Петя')
  })

  it('keeps the archive closed until opened, then lists names with Вернуть, and the right buttons per kind', async () => {
    mocks.api.mockImplementation(route(base()))
    const host = mount('/trainer')
    await flush()
    expect(button(host, 'Архив (2)')).toBeTruthy()
    expect(host.textContent).not.toContain('Коля')
    click(button(host, 'Архив (2)'))
    expect(host.textContent).toContain('Коля'); expect(host.textContent).toContain('Мама')
    expect(host.textContent).toContain('Без Telegram · В архиве с 2 нояб.')
    const kolya = [...host.querySelectorAll('.list .item')].find(x => x.textContent.includes('Коля') && x.textContent.includes('Вернуть'))
    const mama = [...host.querySelectorAll('.list .item')].find(x => x.textContent.includes('Мама') && x.textContent.includes('Вернуть'))
    const labels = el => [...el.querySelectorAll('button')].map(b => b.textContent)
    expect(labels(kolya)).toEqual(['Вернуть', 'Завершить связь'])
    expect(labels(mama)).toEqual(['Вернуть', 'Скачать данные', 'Удалить'])
    // nothing about the archived ones is read: the archive is names only
    expect(mocks.api.mock.calls.every(([p]) => !/link-(cccc-3|mmmm-4)/.test(p))).toBe(true)
  })

  it('brings a client back, and says the refusal in words when there is no free place', async () => {
    let full = true
    mocks.api.mockImplementation(route(base({
      'POST /api/trainer/links/link-cccc-3/restore': () => (full
        ? Object.assign(new Error('x'), { status: 409, data: { code: 'client-limit', error: 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше' } })
        : { ok: true }),
    })))
    const host = mount('/trainer')
    await flush()
    click(button(host, 'Архив (2)'))
    const kolya = () => [...host.querySelectorAll('.list .item')].find(x => x.textContent.includes('Коля') && x.textContent.includes('Вернуть'))
    click(button(kolya(), 'Вернуть'))
    await flush()
    expect(kolya().querySelector('[role=alert]').textContent).toBe('Сейчас доступно 5 подопечных, позже появится возможность добавить больше')
    full = false
    click(button(kolya(), 'Вернуть'))
    await flush()
    expect(useUI.getState().toastMsg).toContain('вернулся из архива')
    expect(calls('POST', '/api/trainer/links/link-cccc-3/restore')).toHaveLength(2)
    expect(JSON.parse(calls('POST', '/api/trainer/links/link-cccc-3/restore')[0][1].body).tz).toBeTruthy()
  })

  it('downloads and deletes an archived client without Telegram, after a confirmation', async () => {
    mocks.api.mockImplementation(route(base({
      'GET /api/trainer/managed/link-mmmm-4/export': { app: 'zhimolost', kind: 'managed-client-export', name: 'Мама', data: { workouts: [] } },
      'DELETE /api/trainer/managed/link-mmmm-4': { ok: true },
    })))
    const host = mount('/trainer')
    await flush()
    click(button(host, 'Архив (2)'))
    const mama = () => [...host.querySelectorAll('.list .item')].find(x => x.textContent.includes('Мама') && x.textContent.includes('Вернуть'))
    click(button(mama(), 'Скачать данные'))
    await flush()
    expect(calls('GET', '/api/trainer/managed/link-mmmm-4/export')).toHaveLength(1)
    click(button(mama(), 'Удалить'))
    expect(calls('DELETE', '/api/trainer/managed/link-mmmm-4')).toHaveLength(0)
    await answer('Удалить навсегда')
    expect(calls('DELETE', '/api/trainer/managed/link-mmmm-4')).toHaveLength(1)
  })

  it('has no archive section when the archive is empty', async () => {
    mocks.api.mockImplementation(route(base({ 'GET /api/trainer/clients': CLIENTS({ archived: [] }) })))
    const host = mount('/trainer')
    await flush()
    expect(host.textContent).not.toContain('Архив')
  })
})

describe('the settings of a client with Telegram', () => {
  const data = (over = {}) => ({ linkId: 'link-aaaa-1', name: 'Вася', since: '2026-10-01T00:00:00Z', grants: G, pause: null, data: { unit: 'kg', workouts: [], customEx: [] }, ...over })

  it('pauses with a reason and a preset, shows it, and lifts it', async () => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/clients/link-aaaa-1/data': data(),
      'PUT /api/trainer/links/link-aaaa-1/pause': init => ({ pause: { since: 'x', until: JSON.parse(init.body).until, reason: JSON.parse(init.body).reason } }),
      'DELETE /api/trainer/links/link-aaaa-1/pause': { pause: null },
    }))
    const host = mount('/trainer/link-aaaa-1')
    await flush()
    click(host.querySelector('[aria-label="Настройки"]'))
    const card = host.querySelector('[aria-label="Пауза"]')
    expect(card.textContent).not.toContain('Снять паузу')
    click(button(card, 'Травма'))
    click(button(card, '2 недели'))
    await flush()
    const put = calls('PUT', '/api/trainer/links/link-aaaa-1/pause')
    expect(put).toHaveLength(1)
    const body = JSON.parse(put[0][1].body)
    expect(body.until).toBe(pauseUntil(14)); expect(body.reason).toBe('Травма')
    expect(card.textContent).toContain(pauseText({ until: body.until, reason: 'Травма' }))
    click(button(card, 'Снять паузу'))
    await flush()
    expect(calls('DELETE', '/api/trainer/links/link-aaaa-1/pause')).toHaveLength(1)
    expect(card.textContent).not.toContain('Снять паузу')
  })

  it('sends no end for "Без срока" and no reason for "Без причины"', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/clients/link-aaaa-1/data': data(), 'PUT /api/trainer/links/link-aaaa-1/pause': { pause: { since: 'x', until: null } } }))
    const host = mount('/trainer/link-aaaa-1')
    await flush()
    click(host.querySelector('[aria-label="Настройки"]'))
    click(button(host.querySelector('[aria-label="Пауза"]'), 'Без срока'))
    await flush()
    const body = JSON.parse(calls('PUT', '/api/trainer/links/link-aaaa-1/pause')[0][1].body)
    expect(body.until).toBeNull(); expect('reason' in body).toBe(false)
  })

  it('shows the pause the server already has, and the refusal of a change', async () => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/clients/link-aaaa-1/data': data({ pause: { since: 'x', until: '2026-12-01', reason: 'Отпуск' } }),
      'PUT /api/trainer/links/link-aaaa-1/pause': Object.assign(new Error('x'), { status: 400, data: { error: 'Пауза не может быть дольше года' } }),
    }))
    const host = mount('/trainer/link-aaaa-1')
    await flush()
    click(host.querySelector('[aria-label="Настройки"]'))
    const card = host.querySelector('[aria-label="Пауза"]')
    expect(card.textContent).toMatch(/Пауза до 1 дек\.? · Отпуск/)
    expect(button(card, 'Снять паузу')).toBeTruthy()
    click(button(card, 'Месяц'))
    await flush()
    expect(card.querySelector('[role=alert]').textContent).toBe('Пауза не может быть дольше года')
  })

  it('archives only after a confirmation that says what happens, then goes back to the cabinet', async () => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/clients/link-aaaa-1/data': data(),
      'POST /api/trainer/links/link-aaaa-1/archive': { ok: true, archivedAt: '2026-11-03T08:00:00Z' },
      'GET /api/trainer/me': ME(), 'GET /api/trainer/clients': CLIENTS({ archived: [] }),
    }))
    const host = mount('/trainer/link-aaaa-1')
    await flush()
    click(host.querySelector('[aria-label="Настройки"]'))
    click(button(host, 'В архив'))
    expect(calls('POST', '/api/trainer/links/link-aaaa-1/archive')).toHaveLength(0)
    const text = await answer('В архив')
    expect(text).toContain(ARCHIVE_CONFIRM)
    expect(ARCHIVE_CONFIRM).toBe('Место освободится. Данные подопечного сохранятся, ваш доступ закроется до возврата из архива.')
    expect(calls('POST', '/api/trainer/links/link-aaaa-1/archive')).toHaveLength(1)
    await flush()
    expect(where(host)).toBe('/trainer')
  })
})

describe('the data screen of a client without Telegram', () => {
  it('has the pause and the archive too', async () => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/managed/link-mmmm-1': { linkId: 'link-mmmm-1', name: 'Мама', note: '', managed: true, rev: 1, pause: { since: 'x', until: null }, data: { unit: 'kg', workouts: [], bodyweight: [], measurements: [] } },
      'POST /api/trainer/links/link-mmmm-1/archive': { ok: true },
      'GET /api/trainer/me': ME(), 'GET /api/trainer/clients': CLIENTS({ archived: [] }),
    }))
    const host = mount('/trainer/m/link-mmmm-1')
    await flush()
    expect(host.querySelector('[aria-label="Пауза"]').textContent).toContain('Пауза.')
    expect(button(host, 'Снять паузу')).toBeTruthy()
    click(button(host, 'В архив'))
    await answer('В архив')
    expect(calls('POST', '/api/trainer/links/link-mmmm-1/archive')).toHaveLength(1)
    await flush()
    expect(where(host)).toBe('/trainer')
  })
})

describe('"my trainer" on the client\'s side', () => {
  const asClient = over => ({ consentVersion: 1, trainer: { enabled: false, limit: 5 }, asClient: { linkId: 'link-zzzz-9', coachName: 'Ирина', grants: G, consentAt: '2026-10-01T00:00:00Z', status: 'active', ...over } })
  beforeEach(() => { useStore.setState({ user: { id: 'u1', name: 'Клиент' } }) })
  afterEach(() => { useStore.setState({ user: null }) })

  it('says the link is in the archive, and lets the client end it', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': asClient({ status: 'archived' }), 'DELETE /api/trainer/links/link-zzzz-9': { ok: true } }))
    const host = mount('/settings', <TrainerSettings />)
    await flush()
    expect(host.textContent).toContain('Ирина')
    expect(host.textContent).toContain('Связь в архиве у тренера')
    expect(host.textContent).not.toContain('Открыто:')
    const end = [...host.querySelectorAll('[role=button], button, .lrow')].find(x => x.textContent.includes('Завершить связь'))
    expect(end).toBeTruthy()
    click(end)
    const text = await answer('Завершить')
    expect(text).toContain('в архив')
    expect(calls('DELETE', '/api/trainer/links/link-zzzz-9')).toHaveLength(1)
  })

  it('says there is a pause, without the reason', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': asClient({ pause: { until: '2026-11-15' } }) }))
    const host = mount('/settings', <TrainerSettings />)
    await flush()
    expect(host.textContent).toMatch(/Пауза до 15 нояб\.? · Открыто:/)
    expect(host.textContent).toContain('Прекратить доступ')
  })

  it('shows nothing extra for an ordinary active link', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/me': asClient({}) }))
    const host = mount('/settings', <TrainerSettings />)
    await flush()
    expect(host.textContent).not.toContain('Пауза'); expect(host.textContent).not.toContain('архиве')
  })
})
