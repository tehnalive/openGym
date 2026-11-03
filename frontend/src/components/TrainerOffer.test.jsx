// @vitest-environment happy-dom
// A program the trainer handed to a client with Telegram (TRAINER_MODE.md section 17): added to the client's own diary by the
// app, once, whatever fails on the way; the server only hears about it afterwards.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const mocks = vi.hoisted(() => ({ api: vi.fn(), nav: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))
vi.mock('../lib/nav.js', () => ({ nav: mocks.nav, setNav: vi.fn() }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXDB } from '../lib/exercises.js'
import TrainerOfferGate, { acceptOffer, declineOffer, TrainerOffer } from './TrainerOffer.jsx'

const strength = EXDB.filter(e => e.bp !== 'cardio' && e.tg && !e.hd)
const A = strength[0].id, B = strength[1].id
const OFFER = (over = {}) => ({
  id: 'offer-0001', templateName: 'Тяни-Толкай', unit: 'kg', at: '2026-11-03T10:00:00Z', routineCount: 2, routineNames: ['Тяни', 'Толкай'],
  routines: [{ id: 't1', name: 'Тяни', ex: [{ id: A, sets: 3, reps: 5, weight: 100 }, { id: 'c_mine', sets: 2, reps: 10 }] }, { id: 't2', name: 'Толкай', ex: [{ id: B, sets: 3, reps: 8 }] }],
  customEx: [{ id: 'c_mine', n: 'Моё упражнение', bp: 'back' }], ...over,
})
const S = () => useStore.getState().S
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = (box, text) => [...box.querySelectorAll('button')].find(b => b.textContent.includes(text))
const calls = path => mocks.api.mock.calls.filter(([p]) => p === path)
let box, root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); mocks.api.mockReset(); mocks.nav.mockReset()
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), routines: [{ id: 'mine', name: 'Моя', ex: [] }] }, user: { id: 'u1', name: 'Мария' } })
  useUI.setState({ sheets: [], toastMsg: '' })
  box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box)
})
afterEach(() => { act(() => root.unmount()); box.remove() })

describe('accepting an offer', () => {
  it('adds the routines to the diary, marked with the offer, then tells the server', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const r = await acceptOffer(OFFER())
    expect(r).toEqual({ added: 2, dropped: 0, closed: true })
    expect(S().routines.map(x => x.name)).toEqual(['Моя', 'Тяни', 'Толкай'])
    expect(S().routines.slice(1).every(x => x.fromOffer === 'offer-0001')).toBe(true)
    expect(S().customEx.map(c => c.n)).toEqual(['Моё упражнение'])
    expect(calls('/api/trainer/offers/offer-0001/accept')).toHaveLength(1)
    expect(calls('/api/trainer/offers/offer-0001/accept')[0][1].method).toBe('POST')
    // The mark is a plain field of the routine: it travels with the diary (a copy through JSON, as a push does).
    expect(JSON.parse(JSON.stringify(S())).routines[1].fromOffer).toBe('offer-0001')
  })

  it('a failed answer to the server loses nothing and doubles nothing: the routines are in once, the offer is closed later', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    const first = await acceptOffer(OFFER())
    expect(first).toMatchObject({ added: 2, closed: false })
    expect(S().routines).toHaveLength(3)
    // Pressed again (or the app opened again): nothing is added a second time; the server is told again.
    const second = await acceptOffer(OFFER())
    expect(second).toMatchObject({ added: 0, closed: false })
    expect(S().routines).toHaveLength(3)
    expect(calls('/api/trainer/offers/offer-0001/accept')).toHaveLength(2)
    mocks.api.mockResolvedValue({ ok: true })
    expect(await acceptOffer(OFFER())).toMatchObject({ added: 0, closed: true })
    expect(S().routines).toHaveLength(3)
  })

  it('an offer the server no longer has (404) counts as closed', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }))
    expect(await acceptOffer(OFFER())).toMatchObject({ added: 2, closed: true })
  })

  it('the diary stays as it was when adding fails: the server is not told, so the offer is still there', async () => {
    const broken = OFFER({ routines: 'not a list' })      // an offer the plan code refuses
    await expect(acceptOffer(broken)).rejects.toThrow()
    expect(S().routines).toHaveLength(1)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('declining only tells the server and leaves the diary alone', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    expect(await declineOffer(OFFER())).toBe(true)
    expect(calls('/api/trainer/offers/offer-0001/decline')).toHaveLength(1)
    expect(S().routines).toHaveLength(1)
    mocks.api.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }))
    await expect(declineOffer(OFFER())).rejects.toBeTruthy()
  })
})

describe('the offer sheet', () => {
  const show = (offers, close = vi.fn()) => { act(() => root.render(<TrainerOffer coachName="Анна" offers={offers} close={close} />)); return close }

  it('says who sent what and what is inside', () => {
    show([OFFER()])
    expect(box.querySelector('h3').textContent).toBe('Анна прислал программу «Тяни-Толкай»')
    expect(box.textContent).toContain('2 рутины: Тяни, Толкай')
    expect(box.textContent).toContain('Добавить в мой план'); expect(box.textContent).toContain('Отклонить')
    expect(box.innerHTML).not.toMatch(/[–—]/)
  })

  it('"Добавить в мой план" adds, closes the offer, and goes to the plan', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const close = show([OFFER()])
    click(button(box, 'Добавить в мой план')); await flush()
    expect(S().routines).toHaveLength(3)
    expect(calls('/api/trainer/offers/offer-0001/accept')).toHaveLength(1)
    expect(close).toHaveBeenCalled(); expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })

  it('pressing twice quickly adds once', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    show([OFFER()])
    const add = button(box, 'Добавить в мой план')
    click(add); click(add); await flush()
    expect(S().routines).toHaveLength(3)
  })

  it('"Отклонить" declines and adds nothing; the next offer shows', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const close = show([OFFER(), OFFER({ id: 'offer-0002', templateName: 'Ноги', routines: [{ id: 'x', name: 'Ноги', ex: [{ id: A, sets: 1 }] }], customEx: [] })])
    click(button(box, 'Отклонить')); await flush()
    expect(S().routines).toHaveLength(1)
    expect(calls('/api/trainer/offers/offer-0001/decline')).toHaveLength(1)
    expect(close).not.toHaveBeenCalled()
    expect(box.querySelector('h3').textContent).toBe('Анна прислал программу «Ноги»')
    click(button(box, 'Отклонить')); await flush()
    expect(close).toHaveBeenCalled()
  })

  it('shows the error and keeps the sheet open when declining fails', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('x'), { status: 500, data: { error: 'Сбой сервера' } }))
    const close = show([OFFER()])
    click(button(box, 'Отклонить')); await flush()
    expect(box.querySelector('[role=alert]').textContent).toBe('Сбой сервера')
    expect(close).not.toHaveBeenCalled()
  })
})

describe('on opening the app', () => {
  const me = offers => ({ consentVersion: 1, trainer: { enabled: false, limit: 5 }, asClient: { linkId: 'l1', coachName: 'Анна', grants: {}, consentAt: 'x', offers } })

  it('shows the waiting offer as a sheet', async () => {
    mocks.api.mockResolvedValue(me([OFFER()]))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('does nothing while blocked, and asks only once', async () => {
    mocks.api.mockResolvedValue(me([OFFER()]))
    act(() => root.render(<TrainerOfferGate blocked />)); await flush()
    expect(mocks.api).not.toHaveBeenCalled()
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(calls('/api/trainer/me')).toHaveLength(1)
  })

  it('closes an offer already in the diary quietly, without a sheet or a second copy', async () => {
    await (async () => { mocks.api.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 })); await acceptOffer(OFFER()) })()
    expect(S().routines).toHaveLength(3)
    mocks.api.mockReset()
    mocks.api.mockImplementation(path => Promise.resolve(path === '/api/trainer/me' ? me([OFFER()]) : { ok: true }))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(calls('/api/trainer/offers/offer-0001/accept')).toHaveLength(1)
    expect(S().routines).toHaveLength(3)
  })

  it('stays quiet without offers, and for someone who is not signed in through Telegram', async () => {
    mocks.api.mockResolvedValue(me([]))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    act(() => root.unmount()); root = createRoot(box)
    mocks.api.mockReset(); mocks.api.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
