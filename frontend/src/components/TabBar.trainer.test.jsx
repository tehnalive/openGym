// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import TabBar from './TabBar.jsx'

let host, root
const Where = () => <i data-testid="where">{useLocation().pathname}</i>
const labels = () => [...host.querySelectorAll('#tabbar button')].map(b => b.textContent.trim())
const mount = () => act(() => root.render(<MemoryRouter initialEntries={['/home']}><Where /><TabBar onStart={() => {}} /></MemoryRouter>))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the last tab', () => {
  it('is the exercise library for everyone else', () => {
    useStore.setState({ user: { id: 'u1', name: 'Аня' } })
    mount()
    expect(labels().some(l => /Exercises/i.test(l))).toBe(true)
    expect(labels().some(l => /Кабинет/.test(l))).toBe(false)
  })

  it('is the cabinet of the trainer once the role is on, and opens it', () => {
    useStore.setState({ user: { id: 'u1', name: 'Ирина', trainer: true } })
    mount()
    expect(labels().some(l => /Exercises/i.test(l))).toBe(false)
    const tab = [...host.querySelectorAll('#tabbar button')].find(b => b.textContent.includes('Кабинет'))
    expect(tab).toBeTruthy()
    act(() => { tab.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(host.querySelector('[data-testid=where]').textContent).toBe('/trainer')
  })
})
