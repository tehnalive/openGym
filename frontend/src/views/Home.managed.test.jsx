// @vitest-environment happy-dom
// In a client's diary opened by the trainer (lib/managed-mode.js) Home must not greet the client's name as if it
// were the reader's: it says whose profile this is and that the trainer is in it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import Home from './Home.jsx'

const mode = vi.hoisted(() => ({ on: true }))
vi.mock('../lib/managed-mode.js', async importOriginal => ({ ...(await importOriginal()), isManagedMode: () => mode.on }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState({ user: { id: 'managed-x', name: 'Дима' } })
})
afterEach(() => { act(() => root.unmount()); host.remove(); mode.on = true })

describe('Home in a client\'s diary', () => {
  it('names the profile and says the trainer is in it, with no greeting', () => {
    act(() => root.render(<Home />))
    const h = host.querySelector('.hdr h1').textContent
    expect(h).toBe('Профиль: Дима')
    expect(h).not.toMatch(/Hi|Привет/)
    expect(host.querySelector('.hdr .sub').textContent).toBe('Вы в режиме тренера')
  })

  it('keeps the ordinary greeting everywhere else', () => {
    mode.on = false
    act(() => root.render(<Home />))
    expect(host.querySelector('.hdr h1').textContent).toBe('Hi Дима')
  })
})
