// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FirstRunOnboarding, { needsFirstRunOnboarding } from './FirstRunOnboarding.jsx'
import { todayISO } from '../lib/format.js'

const mocks = vi.hoisted(() => ({ S: null }))

vi.mock('../store/useStore.js', () => {
  const useStore = () => ({ S: mocks.S, update: mut => mut(mocks.S) })
  return { useStore }
})
vi.mock('../lib/i18n.js', () => ({ useLang: () => 0, getLang: () => 'ru', baseLang: lang => lang, t: key => key }))
vi.mock('../components/ui.jsx', () => ({
  Button: ({ children, onClick }) => <button className="btn" onClick={onClick}>{children}</button>,
  Switch: ({ checked, onChange, ...props }) => <button role="switch" aria-checked={String(checked)} {...props}
    onClick={() => onChange(!checked)} />,
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const fresh = () => ({
  unit: 'kg', weighIn: true, body: 'male', bodyweight: [], routines: [], workouts: [],
  customEx: [], measurements: [], equipProfiles: [], active: null, queue: null, rotation: null,
})
const click = async element => act(async () => { element.click(); await Promise.resolve() })

beforeEach(() => {
  mocks.S = fresh()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('first-run onboarding', () => {
  it('shows only for an empty, unfinished profile', () => {
    expect(needsFirstRunOnboarding(fresh())).toBe(true)
    expect(needsFirstRunOnboarding({ ...fresh(), firstRunVersion: 1 })).toBe(false)
    expect(needsFirstRunOnboarding({ ...fresh(), workouts: [{ id: 'w1' }] })).toBe(false)
    expect(needsFirstRunOnboarding(fresh(), true)).toBe(false)
  })

  it('saves chosen settings and today’s optional weigh-in to the profile', async () => {
    await act(async () => { root.render(<FirstRunOnboarding />) })
    expect(host.textContent).toContain('Добро пожаловать в «Жимолость»')
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Настроить дневник'))
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'lb'))
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Female'))
    const weight = host.querySelector('#first-run-weight')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(weight, '88.4')
    await act(async () => { weight.dispatchEvent(new Event('input', { bubbles: true })) })
    await click(host.querySelector('[role="switch"]'))
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Выбрать программу'))
    expect([...host.querySelectorAll('button')].map(button => button.textContent).join(' ')).toContain('Full Body')
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Настроить программу позже'))

    expect(mocks.S).toMatchObject({
      unit: 'lb', weighIn: false, body: 'female', exFigure: 'female', firstRunVersion: 1,
      bodyweight: [{ d: todayISO(), w: 88.4 }],
    })
  })

  it('lets a user skip without writing a weight or changing defaults', async () => {
    await act(async () => { root.render(<FirstRunOnboarding />) })
    await click([...host.querySelectorAll('button')].find(button => button.textContent === 'Пропустить настройку'))
    expect(mocks.S.unit).toBe('kg')
    expect(mocks.S.bodyweight).toEqual([])
    expect(mocks.S.firstRunVersion).toBe(1)
  })
})
