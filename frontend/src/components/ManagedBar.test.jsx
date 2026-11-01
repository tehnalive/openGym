// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ leave: vi.fn(), enter: vi.fn(() => true) }))
vi.mock('../lib/managed-mode.js', async importOriginal => ({
  ...(await importOriginal()),
  isManagedMode: () => true,
  managedInfo: () => ({ id: 'gDzEuZgmpoBd', name: 'Мама' }),
  leaveManagedMode: mocks.leave,
  enterManagedMode: mocks.enter,
}))

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import ManagedBar, { leaveManagedDiary, openManagedDiary } from './ManagedBar.jsx'
import TabBar from './TabBar.jsx'

const mounted = []
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
function mount(node) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(<MemoryRouter>{node}</MemoryRouter>))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
let push, owed

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.leave.mockReset(); mocks.enter.mockClear()
  useUI.setState({ sheets: [], toastMsg: '' })
  push = vi.fn(async () => {})
  owed = false
  useStore.setState({ pushState: push, unsyncedChanges: () => ({ owed, count: 0 }), user: { id: 'managed-gDzEuZgmpoBd', name: 'Мама' } })
  useStore.setState(s => ({ S: { ...s.S, active: null } }))
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the bar over a client\'s diary', () => {
  it('says whose diary it is and takes the room it needs', () => {
    const host = mount(<ManagedBar />)
    expect(host.querySelector('.managed-bar').textContent).toContain('Режим тренера · дневник: Мама')
    // The way back is the last tab, not a button of the bar.
    expect(host.querySelector('.managed-bar button')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--conn')).not.toBe('')
  })

  it('goes back to the cabinet once what is owed has been sent', async () => {
    mount(<ManagedBar />)
    await act(async () => { await leaveManagedDiary() })
    expect(push).toHaveBeenCalledTimes(1)
    expect(mocks.leave).toHaveBeenCalledTimes(1)
  })

  it('does not leave quietly with changes that did not reach the server', async () => {
    owed = true
    await act(async () => { await leaveManagedDiary() })
    expect(push).toHaveBeenCalledTimes(1)
    expect(mocks.leave).not.toHaveBeenCalled()
    expect(useUI.getState().sheets.length).toBe(1)
  })

  it('names a workout that is still running before leaving it, and leaves only on the answer', async () => {
    useStore.setState(s => ({ S: { ...s.S, active: { start: Date.now(), ex: [] } } }))
    await act(async () => { await leaveManagedDiary() })
    expect(useUI.getState().sheets.length).toBe(1)
    expect(push).not.toHaveBeenCalled()
    expect(mocks.leave).not.toHaveBeenCalled()
  })
})

describe('opening a diary', () => {
  it('carries the language the app of the trainer speaks now, not a stored default', () => {
    useStore.setState(s => ({ S: { ...s.S, lang: 'ru', langAuto: false }, config: null }))
    expect(openManagedDiary('gDzEuZgmpoBd', 'Мама')).toBe(true)
    expect(mocks.enter).toHaveBeenCalledWith('gDzEuZgmpoBd', 'Мама', 'ru')
  })
})

describe('the tab bar in a client\'s diary', () => {
  it('has no exercise library, and ends with the way back', async () => {
    const host = mount(<TabBar onStart={() => {}} />)
    await flush()
    const labels = [...host.querySelectorAll('#tabbar button')].map(b => b.textContent.trim())
    expect(labels.some(l => /Exercises/i.test(l))).toBe(false)
    expect(labels[labels.length - 1]).toContain('К подопечным')
    expect(host.querySelector('#tabbar button:last-child svg')).toBeTruthy()
    click(button(host, 'К подопечным'))
    await flush()
    expect(mocks.leave).toHaveBeenCalledTimes(1)
  })
})
