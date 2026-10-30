// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))

import { useUI } from '../store/useUI.js'
import TrainerConsentGate from './TrainerConsent.jsx'
import { capturePendingShare, clearPendingTrainer } from '../lib/plan-link.js'

const TOKEN = 't_' + 'A1b2C3d4E5f6G7h8I9j0K_'
const mounted = []
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
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset()
  clearPendingTrainer(); sessionStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

const PREVIEW = { coachName: 'Ирина', grants: ['history', 'measures', 'stats'], consentVersion: 1, expires: '2026-11-06T00:00:00Z' }

async function open() {
  mocks.api.mockResolvedValueOnce(PREVIEW)
  capturePendingShare({ initData: 'start_param=' + TOKEN })
  mount(<TrainerConsentGate blocked={false} />)
  await flush()
  return renderTop()
}

describe('TrainerConsentGate', () => {
  it('waits for sign-in and first-run setup, then shows the invitation', async () => {
    mocks.api.mockResolvedValue(PREVIEW)
    capturePendingShare({ initData: 'start_param=' + TOKEN })
    const { rerender } = mount(<TrainerConsentGate blocked />)
    await flush()
    expect(mocks.api).not.toHaveBeenCalled()
    rerender(<TrainerConsentGate blocked={false} />)
    await flush()
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.api.mock.calls[0][0]).toBe('/api/trainer/invites/preview?t=' + TOKEN)
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('shows the display name, what can be opened and what cannot, without any id', async () => {
    const host = await open()
    const text = host.textContent
    expect(text).toContain('Ирина просит доступ к вашему дневнику')
    for (const s of ['История тренировок', 'Замеры и вес', 'Статистика по мышцам']) expect(text).toContain(s)
    expect(text).toContain('фото прогресса, чат с AI-коучем')
    expect(text).toContain('Мне есть 18 лет')
    expect(text).not.toMatch(/@|\d{6,}/)
  })

  it('does not enable "Доверить" without the 18+ box or without anything to open', async () => {
    const host = await open()
    const go = button(host, 'Доверить')
    expect(go.disabled).toBe(true)
    click(host.querySelector('input[type=checkbox]'))
    expect(button(host, 'Доверить').disabled).toBe(false)
    for (const sw of host.querySelectorAll('[role=switch]')) if (sw.getAttribute('aria-checked') === 'true' && !sw.disabled) click(sw)
    expect(button(host, 'Доверить').disabled).toBe(true)
  })

  it('statistics follow the history switch', async () => {
    const host = await open()
    const [history, , stats] = host.querySelectorAll('[role=switch]')
    expect(stats.getAttribute('aria-checked')).toBe('true')
    click(history)
    const after = host.querySelectorAll('[role=switch]')
    expect(after[2].getAttribute('aria-checked')).toBe('false')
    expect(after[2].disabled).toBe(true)
  })

  it('accepts with the 18+ box and the chosen sections', async () => {
    const host = await open()
    mocks.api.mockResolvedValueOnce({ ok: true, linkId: 'x', coachName: 'Ирина', grants: {} })
    click(host.querySelector('input[type=checkbox]'))
    click(host.querySelectorAll('[role=switch]')[1])   // measurements off
    click(button(host, 'Доверить'))
    await flush()
    const [path, init] = mocks.api.mock.calls.at(-1)
    expect(path).toBe('/api/trainer/invites/accept')
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN, ageConfirmed: true, grants: { history: true, measures: false, stats: true } })
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('declining sends nothing', async () => {
    const host = await open()
    const calls = mocks.api.mock.calls.length
    click(button(host, 'Отклонить'))
    expect(mocks.api.mock.calls.length).toBe(calls)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('shows the server\'s refusal and stays open', async () => {
    const host = await open()
    mocks.api.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 410, data: { error: 'Эта ссылка уже использована', code: 'invite-used' } }))
    click(host.querySelector('input[type=checkbox]'))
    click(button(host, 'Доверить'))
    await flush()
    expect(host.textContent).toContain('Эта ссылка уже использована')
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('tells a dead link in a toast instead of a sheet', async () => {
    mocks.api.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404, data: { error: 'Эта ссылка не работает: она отозвана или неверна' } }))
    capturePendingShare({ initData: 'start_param=' + TOKEN })
    mount(<TrainerConsentGate blocked={false} />)
    await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toContain('не работает')
  })

  it('a launch without an invitation does nothing', async () => {
    mount(<TrainerConsentGate blocked={false} />)
    await flush()
    expect(mocks.api).not.toHaveBeenCalled()
  })
})
