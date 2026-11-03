// @vitest-environment happy-dom
// The trainer's templates (TRAINER_MODE.md section 17): the list, a new template from the trainer's own routines, the card
// with assigning, renaming, taking a routine out and deleting; and the routines block on a managed client's data screen.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
vi.mock('../lib/managed-mode.js', async importOriginal => ({ ...(await importOriginal()), enterManagedMode: vi.fn(() => true), enterReadonlyMode: vi.fn(() => true) }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXDB } from '../lib/exercises.js'
import TrainerTemplates from './TrainerTemplates.jsx'
import TrainerManaged from './TrainerManaged.jsx'
import TrainerHome from './TrainerHome.jsx'

const strength = EXDB.filter(e => e.bp !== 'cardio' && e.tg && !e.hd)
const A = strength[0].id, B = strength[1].id
const mounted = []
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const field = (host, label) => host.querySelector(`[aria-label="${label}"]`)
const check = (host, label) => host.querySelector(`[role=checkbox][aria-label="${label}"]`)
const calls = (method, path) => mocks.api.mock.calls.filter(([p, i]) => p === path && (i?.method || 'GET') === method)
const body = (method, path) => JSON.parse(calls(method, path).at(-1)[1].body)

function mount(path = '/trainer/templates') {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  const Where = () => <i data-testid="where">{useLocation().pathname}</i>
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Where />
    <Routes><Route path="/trainer" element={<TrainerHome />} /><Route path="/trainer/templates" element={<TrainerTemplates />} />
      <Route path="/trainer/m/:linkId" element={<TrainerManaged />} /><Route path="/settings" element={<b>settings</b>} /></Routes></MemoryRouter>))
  return host
}
const where = host => host.querySelector('[data-testid=where]').textContent
// The sheet the screen opened, drawn into a box of its own.
function sheet() {
  const s = useUI.getState().sheets.at(-1)
  expect(s, 'a sheet is open').toBeTruthy()
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  const closed = vi.fn()
  act(() => root.render(s.render(closed)))
  return { host, closed }
}

const TPL = (over = {}) => ({
  id: 'tpl-aaaa-1', name: 'Тяни-Толкай', note: 'база', unit: 'kg', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z',
  routines: [{ id: 'r1', name: 'Тяни', ex: [{ id: A, sets: 3, reps: 5, weight: 100 }, { id: 'c_mine', sets: 2, reps: 10 }] }, { id: 'r2', name: 'Толкай', ex: [{ id: B, sets: 3, reps: 8 }] }],
  customEx: [{ id: 'c_mine', n: 'Моё упражнение', bp: 'back' }], ...over,
})
const ROW = t => ({ id: t.id, name: t.name, note: t.note, unit: t.unit, routineCount: t.routines.length, routineNames: t.routines.map(r => r.name), exerciseCount: 3, updatedAt: t.updatedAt })
const CLIENTS = { limit: 5, clients: [
  { linkId: 'link-mmmm-1', name: 'Иван', managed: true, grants: { history: true, measures: true, stats: true } },
  { linkId: 'link-tttt-2', name: 'Мария', grants: { history: true, measures: false, stats: false }, workouts: 2, lastWorkout: '2026-10-20' },
] }

let templates
const route = extra => (path, init) => {
  const method = init?.method || 'GET'
  const key = method + ' ' + path
  const hit = extra?.[key]
  if (hit) { try { return Promise.resolve(typeof hit === 'function' ? hit(init) : hit) } catch (e) { return Promise.reject(e) } }
  if (key === 'GET /api/trainer/templates') return Promise.resolve({ templates: templates.map(ROW), limit: 50 })
  if (key === 'GET /api/trainer/templates/tpl-aaaa-1') return Promise.resolve({ template: templates[0] })
  if (key === 'GET /api/trainer/clients') return Promise.resolve(CLIENTS)
  if (key === 'GET /api/trainer/me') return Promise.resolve({ consentVersion: 1, trainer: { enabled: true, limit: 5, clients: 2, invites: [] }, asClient: null })
  return Promise.reject(Object.assign(new Error('nope ' + key), { status: 404 }))
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset(); localStorage.clear()
  templates = [TPL()]
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), routines: [
    { id: 'mine1', name: 'Мои ноги', emoji: 'x', _ts: 4, ex: [{ id: A, sets: 4, reps: 6, weight: 80, _ts: 3 }] },
    { id: 'mine2', name: 'Моя спина', ex: [{ id: B, sets: 3, reps: 10 }] },
  ] }, user: { id: 'coach1', name: 'Анна', trainer: true } })
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the cabinet', () => {
  it('has a «Шаблоны» button that opens the list', async () => {
    mocks.api.mockImplementation(route({ 'GET /api/trainer/clients': { limit: 5, clients: [] } }))
    const host = mount('/trainer'); await flush()
    click(button(host, 'Шаблоны'))
    expect(where(host)).toBe('/trainer/templates')
  })
})

describe('the list', () => {
  it('shows each template with its routines, and says when there are none', async () => {
    mocks.api.mockImplementation(route())
    const host = mount(); await flush()
    expect(host.querySelector('h1').textContent).toBe('Шаблоны')
    expect(host.textContent).toContain('Тяни-Толкай'); expect(host.textContent).toContain('2 рутины: Тяни, Толкай'); expect(host.textContent).toContain('база')
    expect(host.textContent).toContain('1 из 50')
    expect(host.innerHTML).not.toMatch(/[–—]/)
    act(() => { mounted.splice(0).forEach(r => r.unmount()) })
    templates = []
    const empty = mount(); await flush()
    expect(empty.textContent).toContain('Шаблонов пока нет')
  })

  it('says so when the server refuses (not a trainer)', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('x'), { status: 403, data: { error: 'Сначала включите роль тренера в настройках' } }))
    const host = mount(); await flush()
    expect(host.querySelector('[role=alert]').textContent).toBe('Сначала включите роль тренера в настройках')
  })
})

describe('a new template', () => {
  it('is made from the trainer\'s own routines, in their order, without bookkeeping', async () => {
    mocks.api.mockImplementation(route({ 'POST /api/trainer/templates': { ok: true, template: TPL({ id: 'tpl-new-0001' }) } }))
    const host = mount(); await flush()
    click(button(host, 'Новый шаблон'))
    const { host: s, closed } = sheet()
    expect(button(s, 'Сохранить').disabled).toBe(true)
    type(field(s, 'Название шаблона'), '  Ноги и спина  ')
    click(check(s, 'Моя спина')); click(check(s, 'Мои ноги'))
    expect(button(s, 'Сохранить').disabled).toBe(false)
    click(button(s, 'Сохранить')); await flush()
    const sent = body('POST', '/api/trainer/templates')
    expect(sent.name).toBe('Ноги и спина')
    expect(sent.routines.map(r => r.name)).toEqual(['Мои ноги', 'Моя спина'])
    expect(JSON.stringify(sent)).not.toContain('_ts')
    expect(sent.unit).toBe('kg')
    expect(closed).toHaveBeenCalled()
  })

  it('says so when there are no routines yet', async () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [] } }))
    mocks.api.mockImplementation(route())
    const host = mount(); await flush()
    click(button(host, 'Новый шаблон'))
    const { host: s } = sheet()
    expect(s.textContent).toContain('У вас пока нет своих рутин')
    expect(button(s, 'Сохранить').disabled).toBe(true)
  })

  it('shows the server\'s refusal and keeps the sheet', async () => {
    mocks.api.mockImplementation(route({ 'POST /api/trainer/templates': () => { throw Object.assign(new Error('x'), { status: 409, data: { error: 'Можно хранить до 50 шаблонов' } }) } }))
    const host = mount(); await flush()
    click(button(host, 'Новый шаблон'))
    const { host: s, closed } = sheet()
    type(field(s, 'Название шаблона'), 'х'); click(check(s, 'Мои ноги'))
    click(button(s, 'Сохранить')); await flush()
    expect(s.querySelector('[role=alert]').textContent).toBe('Можно хранить до 50 шаблонов')
    expect(closed).not.toHaveBeenCalled()
  })
})

describe('a template card', () => {
  const open = async () => {
    mocks.api.mockImplementation(route({
      'POST /api/trainer/templates/tpl-aaaa-1/assign': { ok: true, results: [{ linkId: 'link-mmmm-1', result: 'added', routineCount: 2 }, { linkId: 'link-tttt-2', result: 'offered' }] },
      'PUT /api/trainer/templates/tpl-aaaa-1': init => { const b = JSON.parse(init.body); const next = TPL(); if (b.name) next.name = b.name; if (b.routineIds) next.routines = next.routines.filter(r => b.routineIds.includes(r.id)); return { ok: true, template: next } },
      'DELETE /api/trainer/templates/tpl-aaaa-1': { ok: true },
    }))
    const host = mount(); await flush()
    click(host.querySelector('.item'))
    const opened = sheet(); await flush()
    return opened
  }

  it('shows what is inside: the routines and their exercises', async () => {
    const { host: s } = await open()
    expect(s.querySelector('h3').textContent).toBe('Тяни-Толкай')
    expect(s.textContent).toContain('Тяни'); expect(s.textContent).toContain('Толкай')
    expect(s.textContent).toContain('Моё упражнение: 2 × 10'); expect(s.textContent).toContain('3 × 5, 100 кг')
    for (const label of ['Назначить', 'Переименовать', 'Удалить шаблон']) expect(button(s, label), label).toBeTruthy()
  })

  it('assigns to the chosen clients and says who got it, who was offered', async () => {
    const { host: s } = await open()
    click(button(s, 'Назначить')); await flush()
    expect(s.textContent).toContain('Без Telegram: рутины добавятся в его дневник')
    expect(s.textContent).toContain('Придёт предложение, подопечный примет сам')
    click(check(s, 'Иван')); click(check(s, 'Мария'))
    click([...s.querySelectorAll('button')].filter(b => b.textContent === 'Назначить').at(-1)); await flush()
    const sent = body('POST', '/api/trainer/templates/tpl-aaaa-1/assign')
    expect(sent.linkIds).toEqual(['link-mmmm-1', 'link-tttt-2'])
    expect(sent.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(s.textContent).toContain('Добавлено: Иван. Отправлено предложение: Мария.')
  })

  it('the assign button waits for a choice', async () => {
    const { host: s } = await open()
    click(button(s, 'Назначить')); await flush()
    const go = [...s.querySelectorAll('button')].filter(b => b.textContent === 'Назначить').at(-1)
    expect(go.disabled).toBe(true)
    click(check(s, 'Иван'))
    expect([...s.querySelectorAll('button')].filter(b => b.textContent === 'Назначить').at(-1).disabled).toBe(false)
    click(check(s, 'Иван'))
    expect([...s.querySelectorAll('button')].filter(b => b.textContent === 'Назначить').at(-1).disabled).toBe(true)
  })

  it('names a client on pause and never offers an archived one (pause and archive, section 14)', async () => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/clients': { limit: 5, clients: [CLIENTS.clients[0], { ...CLIENTS.clients[1], pause: { since: '2026-11-01', until: null } }],
        archived: [{ linkId: 'link-aaaa-3', name: 'Архивный', managed: true, archivedAt: '2026-10-01T00:00:00Z' }] },
    }))
    const host = mount(); await flush()
    click(host.querySelector('.item'))
    const { host: s } = sheet(); await flush()
    click(button(s, 'Назначить')); await flush()
    expect(s.textContent).toContain('Мария · на паузе')
    expect(s.textContent).not.toContain('Иван · на паузе')
    expect(s.textContent).not.toContain('Архивный')
  })

  it('renames, and takes a routine out (the last one cannot go)', async () => {
    const { host: s } = await open()
    click(button(s, 'Переименовать'))
    type(field(s, 'Название шаблона'), 'Новое имя')
    click(button(s, 'Сохранить')); await flush()
    expect(body('PUT', '/api/trainer/templates/tpl-aaaa-1').name).toBe('Новое имя')
    click(s.querySelector('[aria-label="Убрать из шаблона: Толкай"]')); await flush()
    expect(body('PUT', '/api/trainer/templates/tpl-aaaa-1')).toEqual({ routineIds: ['r1'] })
    expect(s.querySelector('[aria-label="Убрать из шаблона: Толкай"]')).toBeNull()
    expect(s.querySelector('[aria-label="Убрать из шаблона: Тяни"]').disabled).toBe(true)
  })

  it('moves a routine up and down', async () => {
    const { host: s } = await open()
    click(s.querySelector('[aria-label="Ниже: Тяни"]')); await flush()
    expect(body('PUT', '/api/trainer/templates/tpl-aaaa-1')).toEqual({ routineIds: ['r2', 'r1'] })
    expect(s.querySelector('[aria-label="Выше: Тяни"]')).toBeTruthy()
  })

  it('asks before deleting, and deletes only after the confirmation', async () => {
    const { host: s, closed } = await open()
    click(button(s, 'Удалить шаблон'))
    expect(s.textContent).toContain('Удалить шаблон «Тяни-Толкай»?')
    expect(s.textContent).toContain('Копии, которые уже получили подопечные, останутся у них')
    expect(calls('DELETE', '/api/trainer/templates/tpl-aaaa-1')).toHaveLength(0)
    click(button(s, 'Отмена'))
    expect(s.querySelector('h3').textContent).toBe('Тяни-Толкай')
    click(button(s, 'Удалить шаблон')); click(button(s, 'Удалить навсегда')); await flush()
    expect(calls('DELETE', '/api/trainer/templates/tpl-aaaa-1')).toHaveLength(1)
    expect(closed).toHaveBeenCalled()
  })
})

describe('the routines of a client without Telegram (the cabinet data screen)', () => {
  const DIARY = { linkId: 'link-mmmm-1', name: 'Мама', note: '', managed: true, rev: 4, data: { unit: 'kg', workouts: [], bodyweight: [], measurements: [], customEx: [] } }
  const ROUTINES = { routines: [{ id: 'm1', name: 'Мамина', exerciseCount: 4 }, { id: 'm2', name: 'Вторая', exerciseCount: 2 }] }
  const setup = async extra => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/managed/link-mmmm-1': DIARY, 'GET /api/trainer/managed/link-mmmm-1/routines': ROUTINES,
      'POST /api/trainer/templates/from-client/link-mmmm-1': { ok: true, template: TPL() },
      'POST /api/trainer/managed/link-mmmm-1/routines/copy': { ok: true, results: [{ linkId: 'link-tttt-2', result: 'offered' }] }, ...extra,
    }))
    const host = mount('/trainer/m/link-mmmm-1'); await flush()
    return host
  }

  it('lists the routines with the number of exercises, and the buttons wait for a choice', async () => {
    const host = await setup()
    expect(host.textContent).toContain('Рутины подопечного'); expect(host.textContent).toContain('Мамина'); expect(host.textContent).toContain('4 упражнения')
    expect(button(host, 'В шаблоны').disabled).toBe(true)
    expect(button(host, 'Скопировать другому подопечному').disabled).toBe(true)
    click(check(host, 'Мамина'))
    expect(button(host, 'В шаблоны').disabled).toBe(false)
  })

  it('saves the chosen routines as a template, by name', async () => {
    const host = await setup()
    click(check(host, 'Вторая')); click(check(host, 'Мамина'))
    click(button(host, 'В шаблоны'))
    const { host: s, closed } = sheet()
    expect(button(s, 'Сохранить').disabled).toBe(true)
    type(field(s, 'Название шаблона'), 'От мамы')
    click(button(s, 'Сохранить')); await flush()
    expect(body('POST', '/api/trainer/templates/from-client/link-mmmm-1')).toEqual({ name: 'От мамы', note: '', routineIds: ['m1', 'm2'] })
    expect(closed).toHaveBeenCalled()
  })

  it('copies to another client, and the client itself is not offered', async () => {
    const host = await setup()
    click(check(host, 'Мамина'))
    click(button(host, 'Скопировать другому подопечному'))
    const { host: s } = sheet(); await flush()
    expect(check(s, 'Иван')).toBeNull()
    click(check(s, 'Мария'))
    click(button(s, 'Скопировать')); await flush()
    const sent = body('POST', '/api/trainer/managed/link-mmmm-1/routines/copy')
    expect(sent).toMatchObject({ routineIds: ['m1'], toLinkIds: ['link-tttt-2'] })
    expect(sent.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(s.textContent).toContain('Отправлено предложение: Мария.')
  })

  it('an empty diary and a refusal are said in words', async () => {
    const host = await setup({ 'GET /api/trainer/managed/link-mmmm-1/routines': { routines: [] } })
    expect(host.textContent).toContain('У подопечного пока нет рутин')
    act(() => { mounted.splice(0).forEach(r => r.unmount()) })
    const other = await setup({ 'GET /api/trainer/managed/link-mmmm-1/routines': () => { throw Object.assign(new Error('x'), { status: 404, data: { error: 'Подопечный недоступен' } }) } })
    expect(other.textContent).toContain('Подопечный недоступен')
  })
})

describe('a repeat and a partial failure (review fixes)', () => {
  const assignGoes = results => route({
    'POST /api/trainer/templates/tpl-aaaa-1/assign': results,
    'POST /api/trainer/managed/link-mmmm-1/routines/copy': results,
    'GET /api/trainer/managed/link-mmmm-1': { linkId: 'link-mmmm-1', name: 'Мама', note: '', managed: true, rev: 1, data: { unit: 'kg', workouts: [], bodyweight: [], measurements: [], customEx: [] } },
    'GET /api/trainer/managed/link-mmmm-1/routines': { routines: [{ id: 'm1', name: 'Мамина', exerciseCount: 4 }] },
  })
  const openCard = async () => {
    const host = mount(); await flush()
    click(host.querySelector('.item'))
    const opened = sheet(); await flush()
    click(button(opened.host, 'Назначить')); await flush()
    return opened
  }
  const sendButton = s => [...s.querySelectorAll('button')].filter(b => /^(Назначить|Повторить для выбранных)$/.test(b.textContent)).at(-1)

  it('keeps one request id for the sheet, and after a partial failure sends only the failed client again with the same id', async () => {
    let n = 0
    mocks.api.mockImplementation((path, init) => {
      if (path === '/api/trainer/templates/tpl-aaaa-1/assign') {
        n++
        return Promise.resolve(n === 1
          ? { ok: true, results: [{ linkId: 'link-mmmm-1', result: 'added', routineCount: 2 }, { linkId: 'link-tttt-2', result: 'error', code: 'write-failed' }] }
          : { ok: true, results: [{ linkId: 'link-tttt-2', result: 'offered' }] })
      }
      return route()(path, init)
    })
    const { host: s } = await openCard()
    click(check(s, 'Иван')); click(check(s, 'Мария'))
    click(sendButton(s)); await flush()
    expect(s.textContent).toContain('Добавлено: Иван.')
    expect(s.querySelector('[role=alert]').textContent).toBe('Не получилось: Мария (не удалось записать).')
    expect(check(s, 'Иван').getAttribute('aria-checked')).toBe('false')
    expect(check(s, 'Мария').getAttribute('aria-checked')).toBe('true')
    expect(sendButton(s).textContent).toBe('Повторить для выбранных')
    click(sendButton(s)); await flush()
    const sent = mocks.api.mock.calls.filter(([p]) => p === '/api/trainer/templates/tpl-aaaa-1/assign').map(([, i]) => JSON.parse(i.body))
    expect(sent.map(b => b.linkIds)).toEqual([['link-mmmm-1', 'link-tttt-2'], ['link-tttt-2']])
    expect(sent[0].requestId).toBe(sent[1].requestId)
    expect(s.textContent).toContain('Отправлено предложение: Мария.')
  })

  it('a pressed-again button after a lost answer sends the same request id', async () => {
    let n = 0
    mocks.api.mockImplementation((path, init) => {
      if (path === '/api/trainer/templates/tpl-aaaa-1/assign') { n++; return n === 1 ? Promise.reject(Object.assign(new Error('offline'), { status: 0 })) : Promise.resolve({ ok: true, results: [{ linkId: 'link-mmmm-1', result: 'added' }] }) }
      return route()(path, init)
    })
    const { host: s } = await openCard()
    click(check(s, 'Иван'))
    click(sendButton(s)); await flush()
    expect(s.querySelector('[role=alert]')).toBeTruthy()
    click(sendButton(s)); await flush()
    const sent = mocks.api.mock.calls.filter(([p]) => p === '/api/trainer/templates/tpl-aaaa-1/assign').map(([, i]) => JSON.parse(i.body))
    expect(sent).toHaveLength(2); expect(sent[0].requestId).toBe(sent[1].requestId)
    expect(s.textContent).toContain('Добавлено: Иван.')
  })

  it('says how many exercises were left out when copying', async () => {
    mocks.api.mockImplementation(assignGoes({ ok: true, results: [{ linkId: 'link-tttt-2', result: 'offered' }], dropped: 2 }))
    const host = mount('/trainer/m/link-mmmm-1'); await flush()
    click(check(host, 'Мамина'))
    click(button(host, 'Скопировать другому подопечному'))
    const { host: s } = sheet(); await flush()
    click(check(s, 'Мария'))
    click(button(s, 'Скопировать')); await flush()
    expect(s.textContent).toContain('Отправлено предложение: Мария.')
    expect(s.textContent).toContain('Пропущено 2 упражнения')
  })

  it('says it too when a template is made from a client', async () => {
    mocks.api.mockImplementation(route({
      'GET /api/trainer/managed/link-mmmm-1': { linkId: 'link-mmmm-1', name: 'Мама', note: '', managed: true, rev: 1, data: { unit: 'kg', workouts: [], bodyweight: [], measurements: [], customEx: [] } },
      'GET /api/trainer/managed/link-mmmm-1/routines': { routines: [{ id: 'm1', name: 'Мамина', exerciseCount: 4 }] },
      'POST /api/trainer/templates/from-client/link-mmmm-1': { ok: true, template: TPL(), dropped: 1 },
    }))
    const host = mount('/trainer/m/link-mmmm-1'); await flush()
    click(check(host, 'Мамина')); click(button(host, 'В шаблоны'))
    const { host: s } = sheet()
    type(field(s, 'Название шаблона'), 'От мамы')
    click(button(s, 'Сохранить')); await flush()
    expect(useUI.getState().toastMsg).toContain('Пропущено 1 упражнение')
  })
})

describe('review: the card on a small screen', () => {
  it('keeps the routines in a scrolling box above the buttons, and cuts a long exercise line to one line', async () => {
    mocks.api.mockImplementation(route())
    const host = mount(); await flush()
    click([...host.querySelectorAll('.item')].find(x => x.textContent.includes('Тяни-Толкай')))
    await flush()
    const { host: s } = sheet()
    await flush()
    const body = s.querySelector('.tpl-body')
    expect(body).toBeTruthy()
    expect(body.textContent).toContain('Тяни')
    expect(s.querySelectorAll('.tpl-body button').length).toBeGreaterThan(0)
    // the buttons are outside the scrolling box
    expect(body.contains(button(s, 'Закрыть'))).toBe(false)
    expect(body.contains(button(s, 'Назначить'))).toBe(false)
    const lines = [...body.querySelectorAll('.small.dim')]
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) { expect(l.style.whiteSpace).toBe('nowrap'); expect(l.style.textOverflow).toBe('ellipsis'); expect(l.title).toBe(l.textContent) }
  })
})
