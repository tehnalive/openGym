// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ grants: { history: true, measures: false, stats: false }, leave: vi.fn() }))
vi.mock('../lib/managed-mode.js', async importOriginal => ({
  ...(await importOriginal()),
  isManagedMode: () => true,
  isReadonlyMode: () => true,
  diaryGrants: () => mocks.grants,
  managedInfo: () => ({ id: 'gDzEuZgmpoBd', name: 'Мария', kind: 'readonly', grants: mocks.grants }),
  leaveManagedMode: mocks.leave,
}))

import { useStore } from '../store/useStore.js'
import TabBar from '../components/TabBar.jsx'
import { ReadonlyHome, ReadonlyHistory, ReadonlyMeasures, ReadonlyStats } from './ReadonlyDiary.jsx'
import { EXDB } from '../lib/exercises.js'

const exId = EXDB.find(e => e.bp !== 'cardio' && e.tg && !e.hd).id
let host, root
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const Where = () => <i data-testid="where">{useLocation().pathname}</i>
const mount = (path = '/home') => act(() => root.render(<MemoryRouter initialEntries={[path]}><Where />
  <Routes><Route path="/home" element={<ReadonlyHome />} /><Route path="/history" element={<ReadonlyHistory />} />
    <Route path="/measurements" element={<ReadonlyMeasures />} /><Route path="/stats" element={<ReadonlyStats />} /></Routes>
  <TabBar onStart={() => {}} /></MemoryRouter>))
const where = () => host.querySelector('[data-testid=where]').textContent
const tabs = () => [...host.querySelectorAll('#tabbar button')].map(b => b.textContent.trim())

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.grants = { history: true, measures: false, stats: false }
  mocks.leave.mockReset()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState({ user: { id: 'managed-gDzEuZgmpoBd', name: 'Мария' } })
  useStore.setState(s => ({ S: { ...s.S, active: null, unit: 'kg',
    workouts: [{ id: 'w1', d: '2026-10-20', name: 'Верх', start: 1, end: 3600001, entries: [{ id: exId, sets: [{ done: true, w: 40, r: 10 }] }] }],
    bodyweight: [], measurements: [] } }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('a Telegram client\'s diary read only', () => {
  it('says whose profile it is and that nothing can be changed, and shows what was opened', async () => {
    mount()
    await flush()
    expect(host.querySelector('.hdr h1').textContent).toBe('Профиль: Мария')
    expect(host.querySelector('.hdr .sub').textContent).toBe('Вы в режиме тренера · только чтение')
    expect(host.textContent).toContain('Верх')
    expect(host.textContent).not.toMatch(/Привет|Hi /)
  })

  it('has nothing that writes or starts a workout: no fields, no Start, no plan, no library', async () => {
    mount()
    await flush()
    expect(host.querySelectorAll('input, textarea, select, [contenteditable]').length).toBe(0)
    expect(host.querySelector('#tabbar .start')).toBeNull()
    const l = tabs()
    expect(l.some(x => /Start|Старт|Plan|План|Exercises|Упражнения/i.test(x))).toBe(false)
    const buttons = [...host.querySelectorAll('button')].map(b => b.textContent)
    expect(buttons.some(b => /Записать|Добавить|Удалить|Сохранить|Начать|Изменить|Log|Edit|Delete/i.test(b))).toBe(false)
  })

  it('shows only the sections the client opened in the tab bar, ending with the way back', async () => {
    mocks.grants = { history: true, measures: true, stats: true }
    mount()
    await flush()
    expect(tabs()).toEqual(['Home', 'История', 'Stats', 'Замеры', 'К подопечным'])
    mocks.grants = { history: false, measures: true, stats: false }
    act(() => root.unmount()); root = createRoot(host)
    mount()
    await flush()
    expect(tabs()).toEqual(['Home', 'Замеры', 'К подопечным'])
    click([...host.querySelectorAll('#tabbar button')].pop())
    await flush()
    expect(mocks.leave).toHaveBeenCalledTimes(1)
  })

  it('shows a closed section as an empty state, not as an error', async () => {
    mocks.grants = { history: false, measures: false, stats: false }
    mount('/history')
    await flush()
    expect(host.textContent).toContain('Подопечный не открыл этот раздел.')
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(host.textContent).not.toContain('Верх')
    for (const path of ['/measurements', '/stats', '/home']) {
      act(() => root.unmount()); root = createRoot(host)
      mount(path)
      await flush()
      expect(host.textContent, path).toContain('Подопечный не открыл этот раздел.')
      expect(host.querySelector('[role=alert]'), path).toBeNull()
    }
  })

  it('reads the history of the document in the store, with the details of a workout, and never changes it', async () => {
    const before = JSON.stringify(useStore.getState().S)
    mount('/history')
    await flush()
    expect(host.textContent).toContain('Верх')
    click(host.querySelector('.item [role=button]'))
    expect(host.textContent).toMatch(/40/)
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
    expect(where()).toBe('/history')
  })
})
