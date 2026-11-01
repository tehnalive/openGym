// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ api: vi.fn(), leave: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
vi.mock('../lib/managed-mode.js', async importOriginal => ({
  ...(await importOriginal()),
  isManagedMode: () => true,
  managedInfo: () => ({ id: 'gDzEuZgmpoBd', name: 'Мама', lang: 'ru' }),
  leaveManagedMode: mocks.leave,
}))

import { useUI } from '../store/useUI.js'
import ManagedSettings from './ManagedSettings.jsx'

let host, root
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset(); mocks.leave.mockReset()
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter><ManagedSettings /></MemoryRouter>))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the settings of a client\'s diary', () => {
  it('has the unit and the data of the client, and nothing of the account', () => {
    expect(host.textContent).toContain('Режим тренера · дневник: Мама')
    expect(host.textContent).toContain('Единицы веса')
    expect(button('Скачать данные подопечного')).toBeTruthy()
    expect(button('Удалить подопечного')).toBeTruthy()
    expect(host.textContent).not.toMatch(/Passkey|Telegram-аккаунт|Выйти|Coach|Уведомления/)
  })

  it('downloads the copy of this client only', async () => {
    mocks.api.mockResolvedValue({ app: 'zhimolost', kind: 'managed-client-export', name: 'Мама', data: { workouts: [] } })
    click(button('Скачать данные подопечного'))
    await flush()
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.api.mock.calls[0][0]).toBe('/api/trainer/managed/gDzEuZgmpoBd/export')
  })

  it('asks before deleting, then deletes this diary, and leaves with a notice', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    click(button('Удалить подопечного'))
    expect(useUI.getState().sheets.length).toBe(1)
    expect(mocks.api).not.toHaveBeenCalled()
    // Answer the confirmation.
    const sheet = useUI.getState().sheets.at(-1)
    const dialog = document.createElement('div'); document.body.appendChild(dialog)
    const r2 = createRoot(dialog)
    act(() => r2.render(sheet.render ? sheet.render(() => {}) : sheet.node || null))
    const confirm = [...dialog.querySelectorAll('button')].find(b => b.textContent.includes('Удалить навсегда'))
    click(confirm)
    await flush()
    expect(mocks.api.mock.calls[0][0]).toBe('/api/trainer/managed/gDzEuZgmpoBd')
    expect(mocks.api.mock.calls[0][1].method).toBe('DELETE')
    expect(mocks.leave).toHaveBeenCalledWith('Подопечный удалён')
    act(() => r2.unmount()); dialog.remove()
  })
})
