// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { useStore } from './store/useStore.js'

vi.mock('./lib/api.js', async original => ({ ...await original(), api: vi.fn(), beacon: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host, original
beforeEach(() => {
  original = useStore.getState()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState({ boot: vi.fn(), user: { id: 'old', name: 'PRIVATE OLD ACCOUNT' }, ready: false,
    telegram: { status: 'pending', message: '' } })
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState(original, true) })

it('mounts only the neutral Telegram gate even when an old signed-in user is present', async () => {
  await act(async () => root.render(<App />))
  expect(host.textContent).toContain('Подключаем ваш дневник')
  expect(host.textContent).not.toContain('PRIVATE OLD ACCOUNT')
  expect(host.querySelector('#app')).toBeNull()
  expect(host.querySelector('[role="status"]')).not.toBeNull()
})

it('keeps Shell unmounted on authentication error and lets the user retry', async () => {
  const retry = vi.fn()
  useStore.setState({ telegram: { status: 'error', message: 'Вход отклонён' }, bootTelegram: retry })
  await act(async () => root.render(<App />))
  expect(host.querySelector('[role="alert"]').textContent).toBe('Вход отклонён')
  expect(host.querySelector('#app')).toBeNull()
  await act(async () => host.querySelector('button').click())
  expect(retry).toHaveBeenCalledOnce()
})
