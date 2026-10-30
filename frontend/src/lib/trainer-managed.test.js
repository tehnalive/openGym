import { describe, expect, it } from 'vitest'
import { workoutOp, weightOp, measureOp, newDraft, exportFile, todayIso, MEASURE_FIELDS } from './trainer-managed.js'
import { EXDB } from './exercises.js'

const bench = EXDB.find(e => e.bp !== 'cardio' && e.tg && !e.hd).id
const hold = EXDB.find(e => e.hd && e.bp !== 'cardio')?.id
const view = (over = {}) => ({ unit: 'kg', weekStart: 1, workouts: [], customEx: [], bodyweight: [], measurements: [], ...over })
const draft = (over = {}) => ({ ...newDraft(), exercises: [{ id: bench, sets: [{ w: '60', r: '8' }, { w: '62,5', r: '6' }] }], ...over })

describe('workoutOp', () => {
  it('turns a form into a workout the app would have saved', () => {
    const r = workoutOp(view(), draft({ name: ' Грудь ', note: 'легко' }))
    expect(r.problems).toBeUndefined()
    expect(r.op.op).toBe('workout.save')
    const w = r.op.workout
    expect(w.d).toBe(todayIso()); expect(w.name).toBe('Грудь'); expect(w.note).toBe('легко')
    expect(w.entries).toHaveLength(1)
    expect(w.entries[0].sets.map(s => [s.w, s.r, s.done])).toEqual([[60, 8, true], [62.5, 6, true]])
    expect(w.id).toBeTruthy(); expect(w.end).toBeGreaterThan(w.start)
  })

  it('leaves out blank sets, reads a comma as a decimal point and a blank weight as bodyweight', () => {
    const r = workoutOp(view(), draft({ exercises: [{ id: bench, sets: [{ w: '', r: '10' }, { w: '70', r: '' }] }] }))
    expect(r.op.workout.entries[0].sets.map(s => [s.w, s.r])).toEqual([[0, 10]])
  })

  it('files a past day as a backfill and does not touch the history it was built from', () => {
    const v = view()
    const r = workoutOp(v, draft({ date: '2026-01-05' }))
    expect(r.op.workout.d).toBe('2026-01-05')
    expect(v.workouts).toEqual([])
  })

  it('says in Russian what is wrong, and writes nothing', () => {
    const cases = [
      [draft({ exercises: [] }), 'упражнение'],
      [draft({ exercises: [{ id: bench, sets: [{ w: '5', r: '' }] }] }), 'подход'],
      [draft({ date: '2999-01-01' }), 'будущем'],
      [draft({ date: 'вчера' }), 'дату'],
      [draft({ exercises: [{ id: bench, sets: [{ w: 'тяжело', r: '8' }] }] }), 'числами'],
      [draft({ exercises: [{ id: 'no-such-exercise', sets: [{ w: '5', r: '5' }] }] }), 'упражнение'],
    ]
    for (const [d, word] of cases) {
      const r = workoutOp(view(), d)
      expect(r.op, JSON.stringify(d)).toBeUndefined()
      expect(r.problems.join(' ')).toContain(word)
    }
  })

  it('reads a timed hold in seconds', () => {
    if (!hold) return
    const r = workoutOp(view(), draft({ exercises: [{ id: hold, sets: [{ w: '', r: '45' }] }] }))
    expect(r.op.workout.entries[0].sets[0].sec).toBe(45)
  })

  it('marks a personal record against the diary it is added to', () => {
    const first = workoutOp(view(), draft({ date: '2026-01-05' })).op.workout
    const second = workoutOp(view({ workouts: [first] }), draft({ exercises: [{ id: bench, sets: [{ w: '100', r: '5' }] }] }))
    expect(second.op.workout.prs).toContain(bench)
  })
})

describe('weightOp and measureOp', () => {
  it('check the date and the number', () => {
    expect(weightOp('2026-10-30', '81,5').op).toEqual({ op: 'bodyweight.set', d: '2026-10-30', w: 81.5 })
    for (const [d, w] of [['2026-10-30', ''], ['2026-10-30', 'abc'], ['2026-10-30', '0'], ['nope', '80']]) expect(weightOp(d, w).problems).toHaveLength(1)
  })

  it('send only the fields that were filled in', () => {
    const r = measureOp('2026-10-30', { waist: '82,5', chest: '', bodyFat: '18' })
    expect(r.op).toEqual({ op: 'measurement.set', d: '2026-10-30', values: { waist: 82.5, bodyFat: 18 } })
    expect(measureOp('2026-10-30', {}).problems[0]).toContain('хотя бы один')
    expect(measureOp('2026-10-30', { waist: '-3' }).problems[0]).toContain('Проверьте значение')
    expect(measureOp('2026-10-30', { bodyFat: '101' }).problems).toHaveLength(1)
    expect(measureOp('x', { waist: '80' }).problems).toHaveLength(1)
  })

  it('offer the fields the server accepts', () => {
    expect(MEASURE_FIELDS.map(f => f.key)).toContain('waist')
    expect(MEASURE_FIELDS.find(f => f.key === 'bodyFat').percent).toBe(true)
  })
})

describe('exportFile', () => {
  it('names the file by the client and the day, without odd characters', () => {
    const f = exportFile({ name: 'Мама / Лена', data: {} }, new Date(2026, 9, 30))
    expect(f.name).toBe('zhimolost-Мама-Лена-2026-10-30.json')
    expect(JSON.parse(f.text).name).toBe('Мама / Лена')
    expect(exportFile({}, new Date(2026, 9, 30)).name).toBe('zhimolost-podopechny-2026-10-30.json')
  })
})
