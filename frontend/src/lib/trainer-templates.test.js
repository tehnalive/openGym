// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { EXDB } from './exercises.js'
import {
  compositionLine, routinesCount, templateBody, assignSummary, allFailed, routineChoices,
  offerBundle, offerAlreadyAdded, rememberOfferAdded, addOfferToState, exerciseLine, templateExerciseName,
} from './trainer-templates.js'

const strength = EXDB.filter(e => e.bp !== 'cardio' && e.tg && !e.hd)
const A = strength[0].id, B = strength[1].id

const routine = (over = {}) => ({ id: 'r1', name: 'Тяни', emoji: 'x', _ts: 7, _f: { name: 1 }, ex: [{ id: A, sets: 3, reps: 5, weight: 100, _ts: 1 }], ...over })
const offer = (over = {}) => ({
  id: 'offer-0001', templateName: 'Тяни-Толкай', unit: 'kg', at: '2026-11-03T10:00:00Z',
  routines: [{ id: 't1', name: 'Тяни', ex: [{ id: A, sets: 3, reps: 5, weight: 100 }, { id: 'c_mine', sets: 2, reps: 10 }] }, { id: 't2', name: 'Толкай', ex: [{ id: B, sets: 3, reps: 8 }] }],
  customEx: [{ id: 'c_mine', n: 'Моё упражнение', bp: 'back' }], ...over,
})
const draft = (over = {}) => ({ unit: 'kg', routines: [], customEx: [], week: {}, ...over })

beforeEach(() => { localStorage.clear() })

describe('words', () => {
  it('counts routines in Russian and lists them', () => {
    expect([1, 2, 5, 21].map(routinesCount)).toEqual(['1 рутина', '2 рутины', '5 рутин', '21 рутина'])
    expect(compositionLine(['Тяни', 'Толкай', 'Ноги'])).toBe('3 рутины: Тяни, Толкай, Ноги')
    expect(compositionLine(['а', 'б', 'в', 'г', 'д', 'е'], 4)).toBe('6 рутин: а, б, в, г и ещё 2')
    expect(compositionLine([])).toBe('Пустой шаблон')
  })
  it('summarises who got what, by name, with the reason for a failure', () => {
    const clients = [{ linkId: 'a', name: 'Иван' }, { linkId: 'b', name: 'Мария' }, { linkId: 'c', name: 'Пётр' }]
    expect(assignSummary([{ linkId: 'a', result: 'added' }, { linkId: 'b', result: 'offered' }], clients)).toBe('Добавлено: Иван. Отправлено предложение: Мария.')
    expect(assignSummary([{ linkId: 'c', result: 'error', code: 'client-gone' }], clients)).toBe('Не получилось: Пётр (подопечный недоступен).')
    expect(assignSummary([], clients)).toBe('Ничего не отправлено.')
    expect(allFailed([{ result: 'error' }, { result: 'error' }])).toBe(true)
    expect(allFailed([{ result: 'error' }, { result: 'added' }])).toBe(false)
    expect(allFailed([])).toBe(false)
  })
  it('no long dashes anywhere in the words it says', () => {
    const said = [compositionLine(['а']), assignSummary([{ linkId: 'a', result: 'error', code: 'x' }], []), assignSummary([], [])].join(' ')
    expect(said).not.toMatch(/[–—]/)
  })
})

describe('what the trainer sends as a template', () => {
  it('takes the chosen routines only, without bookkeeping, with the custom exercises they use', () => {
    const S = { unit: 'lb', routines: [routine(), routine({ id: 'r2', name: 'Ноги' }), routine({ id: 'r3', name: 'Спина', ex: [{ id: 'c_mine', sets: 2, reps: 8 }] })],
      customEx: [{ id: 'c_mine', n: 'Моё', bp: 'back', custom: true, _ts: 5 }, { id: 'c_unused', n: 'Лишнее', bp: 'legs' }], week: { 1: ['r1'] } }
    const body = templateBody(S, ['r3', 'r1'], { name: ' Шаблон ', note: ' заметка ' })
    expect(body.name).toBe('Шаблон'); expect(body.note).toBe('заметка'); expect(body.unit).toBe('lb')
    expect(body.routines.map(r => r.name)).toEqual(['Тяни', 'Спина'])
    expect(body.customEx.map(c => c.id)).toEqual(['c_mine'])
    const text = JSON.stringify(body)
    expect(text).not.toContain('_ts'); expect(text).not.toContain('"week"')
  })
  it('lists the routines a person has, in order, with the number of exercises', () => {
    expect(routineChoices({ routines: [routine(), { id: 'r2', ex: [] }, null] })).toEqual([{ id: 'r1', name: 'Тяни', count: 1 }, { id: 'r2', name: 'Без названия', count: 0 }])
    expect(routineChoices(null)).toEqual([])
  })
  it('names exercises: a custom one by its own name, a catalogue one by the catalogue, an unknown one by its id', () => {
    const tpl = { customEx: [{ id: 'c1', n: 'Моё' }] }
    expect(templateExerciseName(tpl, 'c1')).toBe('Моё')
    expect(templateExerciseName(tpl, A)).toBeTruthy()
    expect(templateExerciseName(tpl, 'unknown-id')).toBe('unknown-id')
    expect(exerciseLine(tpl, { id: 'c1', sets: 3, reps: 5, weight: 60 }, 'kg')).toBe('Моё: 3 × 5, 60 кг')
    expect(exerciseLine(tpl, { id: 'c1', sets: 2 }, 'lb')).toBe('Моё: 2 подх.')
  })
})

describe('adding an offer to the diary', () => {
  it('adds new routines with new ids, marks them with the offer, and brings the custom exercise along', () => {
    const s = draft({ routines: [{ id: 'mine', name: 'Тяни', ex: [] }] })
    const r = addOfferToState(s, offer())
    expect(r).toEqual({ added: 2, dropped: 0 })
    expect(s.routines.map(x => x.name)).toEqual(['Тяни', 'Тяни', 'Толкай'])
    expect(s.routines[0]).toEqual({ id: 'mine', name: 'Тяни', ex: [] })
    const added = s.routines.slice(1)
    expect(added.every(x => x.fromOffer === 'offer-0001')).toBe(true)
    expect(added.map(x => x.id)).not.toContain('t1')
    expect(new Set(s.routines.map(x => x.id)).size).toBe(3)
    expect(s.customEx).toHaveLength(1)
    expect(s.customEx[0].n).toBe('Моё упражнение'); expect(s.customEx[0].custom).toBe(true)
    expect(added[0].ex[1].id).toBe(s.customEx[0].id)
  })
  it('is idempotent: the same offer adds nothing the second time, by the mark or by the device\'s own list', () => {
    const s = draft()
    addOfferToState(s, offer())
    expect(addOfferToState(s, offer())).toEqual({ added: 0, dropped: 0 })
    expect(s.routines).toHaveLength(2)
    // The routines were deleted afterwards: the device still remembers, so the offer does not come back.
    expect(offerAlreadyAdded(draft(), 'offer-0001')).toBe(false)
    rememberOfferAdded('offer-0001')
    expect(offerAlreadyAdded(draft(), 'offer-0001')).toBe(true)
    const again = draft()
    expect(addOfferToState(again, offer())).toEqual({ added: 0, dropped: 0 })
    expect(again.routines).toEqual([])
    // Another offer is another offer.
    expect(addOfferToState(again, offer({ id: 'offer-0002' })).added).toBe(2)
  })
  it('reuses a custom exercise the person already has under the same name', () => {
    const s = draft({ customEx: [{ id: 'own', n: 'Моё упражнение', bp: 'back', custom: true }] })
    addOfferToState(s, offer())
    expect(s.customEx).toHaveLength(1)
    expect(s.routines[0].ex[1].id).toBe('own')
  })
  it('converts weights to the unit of the diary, and drops exercises the app does not know', () => {
    const s = draft({ unit: 'lb' })
    addOfferToState(s, offer())
    expect(s.routines[0].ex[0].weight).toBe(220.5)
    const t = draft()
    const r = addOfferToState(t, offer({ id: 'offer-0003', customEx: [], routines: [{ id: 'x', name: 'Х', ex: [{ id: 'no-such-exercise-xyz', sets: 1 }, { id: A, sets: 1 }] }] }))
    expect(r.dropped).toBe(1); expect(t.routines[0].ex).toHaveLength(1)
  })
  it('wraps the offer as a plan file the shared-plan code reads', () => {
    const b = offerBundle(offer({ unit: 'lb' }))
    expect(b.opengym_plan).toBe(1); expect(b.unit).toBe('lb'); expect(b.week).toEqual({}); expect(b.name).toBe('Тяни-Толкай')
    expect(offerBundle(offer({ unit: 'stone' })).unit).toBe('kg')
  })
})
