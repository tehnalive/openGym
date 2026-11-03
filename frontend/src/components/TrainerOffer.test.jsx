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
  // The list names the offers; each one's routines come from its own route.
  const summary = o => ({ id: o.id, templateName: o.templateName, coachName: 'Анна', routineNames: o.routines.map(r => r.name), at: o.at })
  const me = offers => ({ consentVersion: 1, trainer: { enabled: false, limit: 5 }, asClient: { linkId: 'l1', coachName: 'Анна', grants: {}, consentAt: 'x', offers: offers.map(summary) } })
  const serve = (offers, extra) => mocks.api.mockImplementation(path => {
    if (path === '/api/trainer/me') return Promise.resolve(me(offers))
    const hit = offers.find(o => path === '/api/trainer/offers/' + o.id)
    if (hit) return Promise.resolve({ offer: hit })
    return extra ? extra(path) : Promise.resolve({ ok: true })
  })

  it('shows the waiting offer as a sheet, with the routines read from the offer itself', async () => {
    serve([OFFER()])
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(calls('/api/trainer/offers/offer-0001')).toHaveLength(1)
    const host = document.createElement('div'); document.body.appendChild(host)
    const r2 = createRoot(host)
    act(() => r2.render(useUI.getState().sheets[0].render(vi.fn())))
    expect(host.textContent).toContain('2 рутины: Тяни, Толкай')
    expect(host.textContent).toContain('Тяни-Толкай')
    act(() => r2.unmount()); host.remove()
  })

  it('skips an offer taken back between the list and the read', async () => {
    const two = [OFFER(), OFFER({ id: 'offer-0002', templateName: 'Ноги' })]
    mocks.api.mockImplementation(path => path === '/api/trainer/me' ? Promise.resolve(me(two))
      : path === '/api/trainer/offers/offer-0001' ? Promise.reject(Object.assign(new Error('gone'), { status: 404 })) : Promise.resolve({ offer: two[1] }))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('does nothing while blocked, and asks once per profile', async () => {
    serve([OFFER()])
    act(() => root.render(<TrainerOfferGate blocked />)); await flush()
    expect(mocks.api).not.toHaveBeenCalled()
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(calls('/api/trainer/me')).toHaveLength(1)
  })

  it('asks again when another profile signs in under the same page', async () => {
    serve([])
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(calls('/api/trainer/me')).toHaveLength(1)
    act(() => { useStore.setState({ user: { id: 'u2', name: 'Олег' } }) }); await flush()
    expect(calls('/api/trainer/me')).toHaveLength(2)
    act(() => { useStore.setState({ user: { id: 'u2', name: 'Олег Ч.' } }) }); await flush()
    expect(calls('/api/trainer/me')).toHaveLength(2)
  })

  it('does not open a sheet for a profile that is no longer signed in when the answers come', async () => {
    let release
    mocks.api.mockImplementation(path => path === '/api/trainer/me' ? Promise.resolve(me([OFFER()]))
      : new Promise(res => { release = () => res({ offer: OFFER() }) }))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    act(() => { useStore.setState({ user: { id: 'u2', name: 'Олег' } }) })
    await act(async () => { release(); await new Promise(r => setTimeout(r, 0)) })
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('closes an offer already in the diary quietly, without a sheet or a second copy', async () => {
    mocks.api.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 })); await acceptOffer(OFFER())
    expect(S().routines).toHaveLength(3)
    mocks.api.mockReset()
    serve([OFFER()])
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(calls('/api/trainer/offers/offer-0001/accept')).toHaveLength(1)
    expect(calls('/api/trainer/offers/offer-0001')).toHaveLength(0)
    expect(S().routines).toHaveLength(3)
  })

  it('stays quiet without offers, and for someone who is not signed in through Telegram', async () => {
    serve([])
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
    act(() => root.unmount()); root = createRoot(box)
    useStore.setState({ user: { id: 'u9', name: 'Другой' } })
    mocks.api.mockReset(); mocks.api.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }))
    act(() => root.render(<TrainerOfferGate blocked={false} />)); await flush()
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

describe('the profile an offer was opened for', () => {
  it('writes nothing when another profile is signed in by the time the button is pressed', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    useStore.setState({ user: { id: 'u2', name: 'Олег' } })
    const r = await acceptOffer(OFFER(), 'u1')
    expect(r).toMatchObject({ stale: true, added: 0 })
    expect(S().routines).toHaveLength(1)
    expect(mocks.api).not.toHaveBeenCalled()
    expect(localStorage.getItem('gym_trainer_offers_added')).toBeNull()
  })

  it('the sheet closes without a write and says why', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const close = vi.fn()
    act(() => root.render(<TrainerOffer coachName="Анна" offers={[OFFER()]} userId="u1" close={close} />))
    useStore.setState({ user: { id: 'u2', name: 'Олег' } })
    click(button(box, 'Добавить в мой план')); await flush()
    expect(close).toHaveBeenCalled()
    expect(S().routines).toHaveLength(1)
    expect(useUI.getState().toastMsg).toContain('другой аккаунт')
    expect(mocks.api).not.toHaveBeenCalled()
  })
})

describe('an offer whose exercises this app does not know', () => {
  const ALIEN = (over = {}) => OFFER({ id: 'offer-alien', customEx: [], routines: [{ id: 'x', name: 'Чужая', ex: [{ id: 'no-such-exercise-xyz', sets: 1 }] }], ...over })

  it('adds nothing, is not remembered as added, and is still closed on the server', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const r = await acceptOffer(ALIEN())
    expect(r).toMatchObject({ added: 0, dropped: 1, closed: true })
    expect(S().routines).toHaveLength(1)
    expect(localStorage.getItem('gym_trainer_offers_added')).toBeNull()
    expect(calls('/api/trainer/offers/offer-alien/accept')).toHaveLength(1)
  })

  it('the sheet says nothing was added and why, and when only some were left out it says how many', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    const close = vi.fn()
    act(() => root.render(<TrainerOffer coachName="Анна" offers={[ALIEN()]} userId="u1" close={close} />))
    click(button(box, 'Добавить в мой план')); await flush()
    expect(useUI.getState().toastMsg).toBe('Ничего не добавлено: этих упражнений нет в вашей библиотеке.')
    act(() => root.unmount()); root = createRoot(box)
    const partial = OFFER({ id: 'offer-part', customEx: [], routines: [{ id: 'x', name: 'Часть', ex: [{ id: A, sets: 1 }, { id: 'no-such-exercise-xyz', sets: 1 }] }] })
    act(() => root.render(<TrainerOffer coachName="Анна" offers={[partial]} userId="u1" close={close} />))
    click(button(box, 'Добавить в мой план')); await flush()
    expect(useUI.getState().toastMsg).toContain('Пропущено 1 упражнение')
    expect(S().routines.map(r => r.name)).toContain('Часть')
  })
})

describe('names in the diary', () => {
  it('a routine named like one the person has gets a suffix, as when the server copies into a diary', async () => {
    mocks.api.mockResolvedValue({ ok: true })
    useStore.setState(st => ({ S: { ...st.S, routines: [{ id: 'own1', name: 'Тяни', ex: [] }, { id: 'own2', name: 'толкай (2)', ex: [] }] } }))
    await acceptOffer(OFFER())
    expect(S().routines.map(r => r.name)).toEqual(['Тяни', 'толкай (2)', 'Тяни (2)', 'Толкай'])
    await acceptOffer(OFFER({ id: 'offer-0002' }))
    expect(S().routines.map(r => r.name).slice(4)).toEqual(['Тяни (3)', 'Толкай (3)'])
  })
})
