// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  shareIdOf, startParamOf, capturePendingShare, peekPendingShare, takePendingShare, clearPendingShare,
  alreadyAdded, addSharedPlan, rememberAdded, scheduleDays, exercisesWord, routinesWord, telegramShareUrl, sendLink,
} from './plan-link.js'
import { parsePlan, mergePlan } from './plan-share.js'
import { EXDB } from './exercises.js'

const exId = EXDB.find(e => e.bp !== 'cardio').id
const bundleOf = (week = { 1: ['r1'], 3: ['r1'] }) => parsePlan({
  opengym_plan: 1, unit: 'kg', name: 'Тест', week, customEx: [],
  routines: [{ id: 'r1', name: 'Верх', ex: [{ id: exId, sets: 3, reps: 8, weight: 40 }] }],
}, 'kg')
const freshS = () => ({ unit: 'kg', routines: [], week: {}, customEx: [] })

beforeEach(() => { clearPendingShare(); sessionStorage.clear(); localStorage.clear() })
afterEach(() => vi.restoreAllMocks())

describe('start_param', () => {
  it('accepts only p_ plus a short url-safe id', () => {
    expect(shareIdOf('p_abcDEF12-_x9')).toBe('abcDEF12-_x9')
    for (const bad of ['', null, undefined, 5, 'p_', 'p_short', 'p_' + 'a'.repeat(33), 'q_abcdefgh12', 'p_abc def12345', 'p_abc/../def1', 't_abcdefgh12', 'P_abcdefgh12', 'p_abcdefgh12\n'])
      expect(shareIdOf(bad)).toBe(null)
  })

  it('reads the signed initData first and the SDK parse as a fallback', () => {
    expect(startParamOf({ initData: 'query_id=x&start_param=p_signed12345&hash=h', initDataUnsafe: { start_param: 'p_other1234567' } })).toBe('p_signed12345')
    expect(startParamOf({ initData: 'query_id=x', initDataUnsafe: { start_param: 'p_unsafe12345' } })).toBe('p_unsafe12345')
    expect(startParamOf({ initData: 'query_id=x' })).toBe('')
    expect(startParamOf(undefined)).toBe('')
  })

  it('captures a share id once and ignores other launch parameters', () => {
    expect(capturePendingShare({ initData: 'start_param=t_abcdefgh12' })).toBe(null)
    expect(peekPendingShare()).toBe(null)
    expect(capturePendingShare({ initData: 'start_param=p_abcdefgh12' })).toBe('abcdefgh12')
    expect(takePendingShare()).toBe('abcdefgh12')
    expect(takePendingShare()).toBe(null)
  })

  it('does not ask again for an id already shown in this session (reload of the same launch)', () => {
    capturePendingShare({ initData: 'start_param=p_abcdefgh12' })
    takePendingShare()
    expect(capturePendingShare({ initData: 'start_param=p_abcdefgh12' })).toBe(null)
    expect(capturePendingShare({ initData: 'start_param=p_zzzzzzzz12' })).toBe('zzzzzzzz12')
  })
})

describe('adding without duplicates', () => {
  it('adds new routines with fresh ids, labels them and is recognised afterwards', () => {
    const s = freshS()
    s.routines.push({ id: 'mine', name: 'Моя', ex: [] })
    const res = addSharedPlan(s, bundleOf(), 'abcdefgh12', mergePlan, { schedule: false })
    expect(s.routines).toHaveLength(2)
    expect(s.routines[0]).toEqual({ id: 'mine', name: 'Моя', ex: [] })
    expect(s.routines[1].id).not.toBe('r1')
    expect(s.routines[1].sharedFrom).toBe('abcdefgh12')
    expect(res.ids).toEqual([s.routines[1].id])
    expect(s.routines[0].sharedFrom).toBeUndefined()
    expect(alreadyAdded(s, 'abcdefgh12')).toBe(true)
    expect(alreadyAdded(s, 'other123456')).toBe(false)
  })

  it('still knows the plan after its routine was deleted, on this device', () => {
    const s = freshS()
    addSharedPlan(s, bundleOf(), 'abcdefgh12', mergePlan, {})
    rememberAdded('abcdefgh12')
    s.routines = []
    expect(alreadyAdded(s, 'abcdefgh12')).toBe(true)
  })

  it('leaves the week alone unless the schedule is asked for', () => {
    const s = freshS(); s.week = { 5: ['mine'] }
    addSharedPlan(s, bundleOf(), 'abcdefgh12', mergePlan, { schedule: false })
    expect(s.week).toEqual({ 5: ['mine'] })
    addSharedPlan(s, bundleOf(), 'abcdefgh13', mergePlan, { schedule: true })
    expect(Object.keys(s.week).sort()).toEqual(['1', '3'])
  })
})

describe('texts and sending', () => {
  it('words counts and days in Russian', () => {
    expect(exercisesWord(1)).toBe('1 упражнение')
    expect(exercisesWord(3)).toBe('3 упражнения')
    expect(exercisesWord(11)).toBe('11 упражнений')
    expect(exercisesWord(21)).toBe('21 упражнение')
    expect(routinesWord(2)).toBe('2 тренировки')
    expect(scheduleDays({ 0: ['a'], 3: ['a'], 1: ['a'], 2: [] })).toBe('Пн, Ср, Вс')
    expect(scheduleDays({})).toBe('')
  })

  it('opens the Telegram chat picker with the link and a text', async () => {
    const openTelegramLink = vi.fn()
    expect(await sendLink('https://t.me/b/app?startapp=p_x1234567', 'Привет & пока', { sdk: { openTelegramLink } })).toBe('telegram')
    const url = new URL(openTelegramLink.mock.calls[0][0])
    expect(url.origin + url.pathname).toBe('https://t.me/share/url')
    expect(url.searchParams.get('url')).toBe('https://t.me/b/app?startapp=p_x1234567')
    expect(url.searchParams.get('text')).toBe('Привет & пока')
    expect(telegramShareUrl('a b', 'c')).toBe('https://t.me/share/url?url=a%20b&text=c')
  })

  it('copies the link outside Telegram, and says so when nothing works', async () => {
    const copy = vi.fn().mockResolvedValue(true)
    expect(await sendLink('L', 'T', { sdk: undefined, copy })).toBe('copied')
    expect(copy).toHaveBeenCalledWith('L')
    expect(await sendLink('L', 'T', { sdk: { openTelegramLink() { throw new Error('old client') } }, copy })).toBe('copied')
    expect(await sendLink('L', 'T', { sdk: {}, copy: vi.fn().mockResolvedValue(false) })).toBe('failed')
    expect(await sendLink('L', 'T', { sdk: {}, copy: vi.fn().mockRejectedValue(new Error('no')) })).toBe('failed')
  })
})
