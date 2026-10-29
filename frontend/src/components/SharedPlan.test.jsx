// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const mocks = vi.hoisted(() => ({ api: vi.fn(), nav: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
vi.mock('../lib/nav.js', async importOriginal => ({ ...(await importOriginal()), nav: mocks.nav }))

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import SharedPlanGate, { sharePlanSheet } from './SharedPlan.jsx'
import { capturePendingShare, clearPendingShare } from '../lib/plan-link.js'
import { EXDB } from '../lib/exercises.js'

const exId = EXDB.find(e => e.bp !== 'cardio').id
const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
const BUNDLE = { opengym_plan: 1, unit: 'kg', name: 'Сплит', week: { 1: ['r1'] }, customEx: [],
  routines: [{ id: 'r1', name: 'Верх', ex: [{ id: exId, sets: 3, reps: 8 }, { id: exId, sets: 2, reps: 10 }] }] }
const SHARE = { id: 'abcdefgh12', author: 'Аня', mine: false, bundle: BUNDLE }

function mount(el) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(el))
  return { host, rerender: e => act(() => root.render(e)) }
}
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent === label)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset(); mocks.nav.mockReset()
  clearPendingShare(); sessionStorage.clear(); localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  const S = clone(useStore.getState().S); S.routines = []; S.week = {}; S.unit = 'kg'
  useStore.setState({ S, user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('SharedPlanGate', () => {
  it('keeps the link until sign-in and first-run setup are over, then shows the preview', async () => {
    mocks.api.mockResolvedValue(SHARE)
    capturePendingShare({ initData: 'start_param=p_abcdefgh12' })
    const { rerender } = mount(<SharedPlanGate blocked />)
    await flush()
    expect(mocks.api).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(0)
    rerender(<SharedPlanGate blocked={false} />)
    await flush()
    expect(mocks.api).toHaveBeenCalledWith('/api/shares/abcdefgh12')
    expect(useUI.getState().sheets).toHaveLength(1)
    const host = renderTop()
    expect(host.textContent).toContain('Тренировка от Аня')
    expect(host.textContent).toContain('2 упражнения')
    expect(host.textContent).toContain('дни: Пн')
    expect(button(host, 'Добавить в мои программы')).toBeTruthy()
    expect(button(host, 'Закрыть')).toBeTruthy()
  })

  it('does nothing without a link, and asks only once for one', async () => {
    mount(<SharedPlanGate blocked={false} />)
    await flush()
    expect(mocks.api).not.toHaveBeenCalled()
    mocks.api.mockResolvedValue(SHARE)
    capturePendingShare({ initData: 'start_param=p_abcdefgh12' })
    const { rerender } = mount(<SharedPlanGate blocked={false} />)
    await flush()
    rerender(<SharedPlanGate blocked={true} />); rerender(<SharedPlanGate blocked={false} />)
    await flush()
    expect(mocks.api).toHaveBeenCalledTimes(1)
  })

  it('adds the plan once; opening the same link again offers no second copy', async () => {
    mocks.api.mockResolvedValue(SHARE)
    capturePendingShare({ initData: 'start_param=p_abcdefgh12' })
    mount(<SharedPlanGate blocked={false} />)
    await flush()
    const host = renderTop()
    act(() => button(host, 'Добавить в мои программы').click())
    const routines = useStore.getState().S.routines
    expect(routines).toHaveLength(1)
    expect(routines[0]).toMatchObject({ name: 'Верх', sharedFrom: 'abcdefgh12' })
    expect(routines[0].ex).toHaveLength(2)
    expect(mocks.nav).toHaveBeenCalledWith('/plan')

    // The same link on a later launch.
    sessionStorage.clear()
    capturePendingShare({ initData: 'start_param=p_abcdefgh12' })
    useUI.setState({ sheets: [] })
    mount(<SharedPlanGate blocked={false} />)
    await flush()
    const again = renderTop()
    expect(again.textContent).toContain('уже добавлена')
    expect(button(again, 'Добавить в мои программы')).toBeUndefined()
    expect(useStore.getState().S.routines).toHaveLength(1)
  })

  it('says so for a revoked link and for a broken one, and opens no sheet', async () => {
    capturePendingShare({ initData: 'start_param=p_abcdefgh12' })
    mocks.api.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }))
    mount(<SharedPlanGate blocked={false} />)
    await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toContain('отозвана')

    sessionStorage.clear(); clearPendingShare()
    capturePendingShare({ initData: 'start_param=p_zzzzzzzz12' })
    mocks.api.mockResolvedValue({ ...SHARE, bundle: { hello: 1 } })
    mount(<SharedPlanGate blocked={false} />)
    await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toContain('нет программы')
  })
})

describe('sharePlanSheet', () => {
  beforeEach(() => {
    const S = useStore.getState().S
    useStore.setState({ S: { ...S, routines: [{ id: 'r1', name: 'Верх', ex: [{ id: exId, sets: 3, reps: 8 }] }] } })
  })

  it('warns that the link is public, then creates it, opens the chat picker and can revoke', async () => {
    const openTelegramLink = vi.fn()
    window.Telegram = { WebApp: { openTelegramLink } }
    mocks.api.mockImplementation(async (path, opts) => {
      if (path === '/api/shares' && opts?.method === 'POST') {
        expect(JSON.parse(opts.body).bundle.routines[0].name).toBe('Верх')
        return { id: 'abcdefgh12', link: 'https://t.me/Gym_statsbot/app?startapp=p_abcdefgh12', expires: new Date(Date.now() + 30 * 86400000).toISOString() }
      }
      return { ok: true }
    })
    sharePlanSheet()
    const host = renderTop()
    expect(host.textContent).toContain('любой, у кого она окажется')
    await act(async () => { button(host, 'Создать ссылку и отправить').click() })
    await flush()
    expect(openTelegramLink).toHaveBeenCalledTimes(1)
    expect(openTelegramLink.mock.calls[0][0]).toContain('https://t.me/share/url?url=' + encodeURIComponent('https://t.me/Gym_statsbot/app?startapp=p_abcdefgh12'))
    expect(host.textContent).toContain('ещё 30 дн')
    await act(async () => { button(host, 'Отозвать ссылку').click() })
    await flush()
    expect(mocks.api).toHaveBeenLastCalledWith('/api/shares/abcdefgh12', { method: 'DELETE' })
    delete window.Telegram
  })

  it('shows a readable error when the server refuses', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('x'), { status: 429 }))
    sharePlanSheet()
    const host = renderTop()
    await act(async () => { button(host, 'Создать ссылку и отправить').click() })
    await flush()
    expect(host.querySelector('[role=alert]').textContent).toContain('Слишком много')
  })
})
