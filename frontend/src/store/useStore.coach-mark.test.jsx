// @vitest-environment happy-dom

/* The mark «written by the trainer» (TG14, section 16) reaches the trainer's app. The server sets `via` after the
   push and moves the revision one further than the push's answer (api/test/trainer-managed.test.js: "the document PUT
   moves the revision when it set a mark"), so the next revision check differs from the marker, the app pulls, and
   the workout it pushed comes back marked. */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'
import CoachMark from '../components/CoachMark.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = v => JSON.parse(JSON.stringify(v))
const w1 = { id: 'w1', d: '2026-09-01', start: 1, entries: [], _ts: 150 }

beforeEach(() => { localStorage.clear(); api.mockReset(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('push, then pull: the badge', () => {
  it('a workout pushed unmarked comes back marked on the next revision check and shows the badge', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 150, workouts: [w1] }, user: { id: 'user-1' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    let served = { ...clone(DEF), _ts: 100, _rev: 1, workouts: [] }
    let rev = 1
    api.mockImplementation(async (url, o) => {
      if (o?.method === 'PUT') {
        // the server's side: the mark is set, and the revision goes one further than the answer says
        served = { ...JSON.parse(o.body).state, _rev: rev + 2, workouts: [{ ...w1, via: 'coach' }] }
        rev += 2
        return { ok: true, rev: rev - 1, wid: 'a' }
      }
      if (url === '/api/data/rev') return { rev }
      return { state: served, rev }
    })

    await useStore.getState().pullState()
    expect(useStore.getState().S.workouts[0].via).toBeUndefined()   // pushed, nothing read back yet
    await act(async () => { window.dispatchEvent(new Event('online')); await new Promise(r => setTimeout(r, 20)) })

    expect(useStore.getState().S.workouts[0].via).toBe('coach')
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(<CoachMark w={useStore.getState().S.workouts[0]} />) })
    expect(host.textContent).toBe('Written by the trainer')
    act(() => root.unmount()); host.remove()
  })
})
