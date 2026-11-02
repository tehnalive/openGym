// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  trainerTokenOf, launchOf, shareIdOf, capturePendingShare, peekPendingTrainer, takePendingTrainer, clearPendingTrainer,
  peekPendingShare, clearPendingShare, takePendingShare,
} from './plan-link.js'
import { normalizeGrants, canConsent, grantsText, clientView, workoutRows, muscleRows, daysSince, ago, errorText, pctColor, seenText, rowCompliance, attentionItems, sortByAttention, complianceTiles } from './trainer.js'
import { EXDB } from './exercises.js'

const TOKEN = 't_' + 'A1b2C3d4E5f6G7h8I9j0K_'   // 22 characters after the prefix
const exId = EXDB.find(e => e.bp !== 'cardio' && e.tg).id

beforeEach(() => { clearPendingShare(); clearPendingTrainer(); sessionStorage.clear() })
afterEach(() => vi.restoreAllMocks())

describe('start_param prefixes p_ and t_', () => {
  it('reads a trainer token only as t_ plus 22 url-safe characters', () => {
    expect(TOKEN).toHaveLength(24)
    expect(trainerTokenOf(TOKEN)).toBe(TOKEN)
    for (const bad of ['', null, undefined, 7, 't_', 't_short', TOKEN + 'x', 'T_' + TOKEN.slice(2), 'p_' + TOKEN.slice(2), TOKEN + '\n', 't_' + 'a'.repeat(21) + '/'])
      expect(trainerTokenOf(bad)).toBe(null)
  })

  it('keeps the prefixes apart, so a plan id is never a token and the other way round', () => {
    expect(launchOf('p_abcdefgh12')).toEqual({ kind: 'plan', id: 'abcdefgh12' })
    expect(launchOf(TOKEN)).toEqual({ kind: 'trainer', token: TOKEN })
    expect(shareIdOf(TOKEN)).toBe(null)
    expect(launchOf('p_' + 'a'.repeat(22))).toEqual({ kind: 'plan', id: 'a'.repeat(22) })
    expect(launchOf('x_abcdefgh12')).toBe(null)
    expect(launchOf(undefined)).toBe(null)
  })

  it('captures an invitation once and leaves the plan link alone', () => {
    expect(capturePendingShare({ initData: 'start_param=' + TOKEN })).toBe(null)
    expect(peekPendingShare()).toBe(null)
    expect(peekPendingTrainer()).toBe(TOKEN)
    expect(takePendingTrainer()).toBe(TOKEN)
    expect(takePendingTrainer()).toBe(null)
    // shown once in this session: a reload of the same launch does not ask again
    expect(capturePendingShare({ initData: 'start_param=' + TOKEN })).toBe(null)
    expect(peekPendingTrainer()).toBe(null)
    // a plan link still works as before
    expect(capturePendingShare({ initData: 'start_param=p_abcdefgh12' })).toBe('abcdefgh12')
    expect(takePendingShare()).toBe('abcdefgh12')
    expect(peekPendingTrainer()).toBe(null)
  })
})

describe('what the client may open', () => {
  it('holds statistics back until the history is on', () => {
    expect(normalizeGrants({ stats: true })).toEqual({ history: false, measures: false, stats: false })
    expect(normalizeGrants({ history: true, stats: true })).toEqual({ history: true, measures: false, stats: true })
  })
  it('allows consent only with the 18+ box and something to open', () => {
    const g = { history: true }
    expect(canConsent({ age: false, grants: g })).toBe(false)
    expect(canConsent({ age: true, grants: {} })).toBe(false)
    expect(canConsent({ age: true, grants: g })).toBe(true)
  })
  it('names the open sections', () => {
    expect(grantsText({ history: true, measures: true })).toBe('история тренировок, замеры и вес')
    expect(grantsText({})).toBe('ничего')
  })
})

describe('the client view', () => {
  const view = clientView({
    unit: 'lb', workouts: [
      { id: 'a', d: '2026-10-01', name: 'Верх', start: 0, end: 3600000, entries: [{ id: exId, sets: [{ done: true, w: 50, r: 8 }, { done: false, w: 50, r: 8 }] }] },
      { id: 'b', d: '2026-10-20', name: 'Ноги', entries: [{ id: exId, sets: [{ done: true, w: 60, r: 5 }] }] },
      null, 5,
    ],
  })
  it('is safe on anything the server could send', () => {
    expect(clientView(undefined).workouts).toEqual([])
    expect(clientView({ workouts: 'x', unit: 'stone' }).unit).toBe('kg')
    expect(view.unit).toBe('lb')
    expect(view.workouts).toHaveLength(2)
  })
  it('lists workouts newest first with their sets', () => {
    const rows = workoutRows(view)
    expect(rows.map(r => r.name)).toEqual(['Ноги', 'Верх'])
    expect(rows[1]).toMatchObject({ sets: 1, minutes: 60 })
  })
  it('adds the muscle load of a window and tells nothing about an empty one', () => {
    const all = muscleRows(view, 0)
    expect(all.length).toBeGreaterThan(0)
    expect(all[0].share).toBe(1)
    expect(all.every(r => r.load > 0 && r.share <= 1)).toBe(true)
    expect(muscleRows(view, 7, Date.parse('2027-06-01'))).toEqual([])
  })
})

describe('small helpers', () => {
  it('counts days since the last workout', () => {
    const now = new Date(2026, 9, 30)
    expect(daysSince('2026-10-30', now)).toBe(0)
    expect(daysSince('2026-10-23', now)).toBe(7)
    expect(daysSince(null, now)).toBe(null)
    expect(daysSince('garbage', now)).toBe(null)
    expect([ago(null), ago(0), ago(1), ago(9)]).toEqual(['нет тренировок', 'сегодня', 'вчера', '9 дн. назад'])
  })
  it('shows the server wording, or ours', () => {
    expect(errorText({ status: 409, data: { error: 'Сейчас доступно 5 подопечных, позже появится возможность добавить больше' } })).toMatch(/^Сейчас доступно 5/)
    expect(errorText({ status: 429 })).toMatch(/Слишком много/)
    expect(errorText(new Error('network'))).toMatch(/Проверьте соединение/)
  })
})

describe('the trainer week', () => {
  const clients = [
    { linkId: 'a', name: 'Вася', schedule: { days: [1, 3, 5], time: '18:00', remind: true } },
    { linkId: 'b', name: 'Аня', schedule: { days: [1], time: '09:30', remind: false } },
    { linkId: 'c', name: 'Боря', schedule: { days: [1], time: '', remind: false } },
    { linkId: 'd', name: 'Без дней', schedule: null },
  ]
  it('names the days, the time and the reminder', async () => {
    const { scheduleText } = await import('./trainer.js')
    expect(scheduleText(clients[0].schedule)).toBe('Пн Ср Пт · 18:00 · напоминание')
    expect(scheduleText({ days: [7], time: '', remind: false })).toBe('Вс')
    expect(scheduleText(null)).toBe('')
    expect(scheduleText({ days: [], time: '10:00', remind: true })).toBe('')
  })
  it('lists who comes on a day by time, the ones with no time last', async () => {
    const { clientsOn, weekPlan } = await import('./trainer.js')
    expect(clientsOn(clients, 1).map(x => x.name)).toEqual(['Аня', 'Вася', 'Боря'])
    expect(clientsOn(clients, 2)).toEqual([])
    expect(clientsOn(clients, 3).map(x => x.name)).toEqual(['Вася'])
    const week = weekPlan(clients)
    expect(week.map(d => d.short)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
    expect(week[0].clients).toHaveLength(3)
    expect(week[4].clients.map(x => x.name)).toEqual(['Вася'])
  })
  it('reads the ISO weekday of a date: Sunday is 7', async () => {
    const { isoWeekday } = await import('./trainer.js')
    expect(isoWeekday(new Date(2026, 10, 1))).toBe(7)
    expect(isoWeekday(new Date(2026, 10, 2))).toBe(1)
  })
})

describe('pause and archive helpers', () => {
  it('counts the last paused day: a week from today is today plus six', async () => {
    const { pauseUntil, PAUSE_PRESETS } = await import('./trainer.js')
    const now = new Date(2026, 10, 3, 18, 0)
    expect(pauseUntil(7, now)).toBe('2026-11-09')
    expect(pauseUntil(14, now)).toBe('2026-11-16')
    expect(pauseUntil(30, now)).toBe('2026-12-02')
    expect(pauseUntil(null, now)).toBeNull()
    expect(PAUSE_PRESETS.map(p => p.label)).toEqual(['1 неделя', '2 недели', 'Месяц', 'Без срока'])
    expect(pauseUntil(1, new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })
  it('words the pause for the row', async () => {
    const { pauseText, archivedText } = await import('./trainer.js')
    expect(pauseText(null)).toBe('')
    expect(pauseText({ until: '2026-11-15' })).toMatch(/^Пауза до 15 нояб\.?$/)
    expect(pauseText({ until: '2026-11-15', reason: 'Отпуск' })).toMatch(/^Пауза до 15 нояб\.? · Отпуск$/)
    expect(pauseText({ until: null, reason: 'Травма' })).toBe('Пауза · Травма')
    expect(pauseText({ until: null })).toBe('Пауза')
    expect(archivedText('2026-11-03T08:00:00Z')).toMatch(/^В архиве с 3 нояб\.?$/)
    expect(archivedText(null)).toBe('В архиве')
  })
  it('does not expect a client on pause on their days', async () => {
    const { clientsOn, weekPlan, pausedOnWeekday } = await import('./trainer.js')
    const clients = [
      { linkId: 'a', name: 'Вася', schedule: { days: [1], time: '10:00', remind: true }, pause: null },
      { linkId: 'b', name: 'Петя', schedule: { days: [1], time: '11:00', remind: true }, pause: { until: null } },
    ]
    expect(clientsOn(clients, 1).map(x => x.name)).toEqual(['Вася'])
    expect(weekPlan(clients)[0].clients.map(x => x.name)).toEqual(['Вася'])
    expect(pausedOnWeekday(clients, 1).map(x => x.name)).toEqual(['Петя'])
    expect(pausedOnWeekday(clients, 2)).toEqual([])
  })
})

describe('plan compliance wording', () => {
  const win = (planned, done, workouts = done) => ({ planned, done, workouts, pct: planned ? Math.round(done * 100 / planned) : null })
  const comp = (extra = {}) => ({ d7: win(6, 5), d30: win(24, 20), d90: win(70, 50), hasSchedule: true, lastWorkout: '2026-11-01', daysSinceLast: 3, attention: null, ...extra })

  it('colours by the thresholds: 80 and up green, 50 to 79 amber, under 50 red, none for no plan', () => {
    expect([100, 80, 79, 50, 49, 0].map(pctColor)).toEqual(['var(--green)', 'var(--green)', 'var(--orange)', 'var(--orange)', 'var(--red)', 'var(--red)'])
    expect([pctColor(null), pctColor(undefined)]).toEqual(['', ''])
  })

  it('says when the client was last seen', () => {
    expect([null, 0, 1, 3].map(n => seenText({ daysSinceLast: n }))).toEqual(['ещё не тренировался', 'тренировался сегодня', 'тренировался вчера', 'был 3 дн. назад'])
    expect(seenText(null)).toBe('ещё не тренировался')
  })

  it('a row: the 30 day percentage with its colour; none while on pause; the plan line without a plan; nothing without the history', () => {
    expect(rowCompliance({ compliance: comp() })).toMatchObject({ pct: '83%', color: 'var(--green)', note: '', seen: 'был 3 дн. назад' })
    expect(rowCompliance({ compliance: comp({ d30: win(24, 10) }) })).toMatchObject({ pct: '42%', color: 'var(--red)' })
    expect(rowCompliance({ pause: { until: null }, compliance: comp() })).toMatchObject({ pct: '', note: '' })
    expect(rowCompliance({ compliance: comp({ hasSchedule: false, d30: win(0, 0, 6) }) })).toMatchObject({ pct: '', note: 'нет плана · 6 трен. за 30 дн.' })
    expect(rowCompliance({ compliance: comp({ d30: win(0, 0, 2) }) }).note).toBe('пока нечего считать · 2 трен. за 30 дн.')
    expect(rowCompliance({ compliance: null })).toBe(null)
    expect(rowCompliance({})).toBe(null)
  })

  it('the attention list: quiet first (the longest), then the falls (the lowest); not on pause; no long dashes', () => {
    const clients = [
      { linkId: 'a', name: 'Анна', compliance: comp() },
      { linkId: 'b', name: 'Иван', compliance: comp({ attention: 'quiet', daysSinceLast: 9 }) },
      { linkId: 'c', name: 'Мария', compliance: comp({ attention: 'drop', d7: win(5, 2) }) },
      { linkId: 'd', name: 'Олег', compliance: comp({ attention: 'quiet', daysSinceLast: 20 }) },
      { linkId: 'e', name: 'Ира', pause: { until: null }, compliance: comp({ attention: 'quiet', daysSinceLast: 30 }) },
      { linkId: 'f', name: 'Юра', compliance: comp({ attention: 'quiet', daysSinceLast: null }) },
      { linkId: 'g', name: 'Лена', compliance: null },
    ]
    const items = attentionItems(clients)
    expect(items.map(x => x.text)).toEqual([
      'Юра: ещё не тренировался', 'Олег: не тренировался 20 дн.', 'Иван: не тренировался 9 дн.', 'Мария: соблюдение за неделю упало до 40%'])
    expect(items.every(x => !x.text.includes('—'))).toBe(true)
    expect(sortByAttention(clients).map(c => c.name)).toEqual(['Юра', 'Олег', 'Иван', 'Мария', 'Анна', 'Ира', 'Лена'])
    expect(attentionItems(null)).toEqual([])
  })

  it('three tiles: percent and "выполнено 5 из 6"; a dash and the count of workouts without a plan', () => {
    expect(complianceTiles(comp())).toEqual([
      { key: 'd7', label: '7 дней', pct: '83%', color: 'var(--green)', sub: 'выполнено 5 из 6' },
      { key: 'd30', label: '30 дней', pct: '83%', color: 'var(--green)', sub: 'выполнено 20 из 24' },
      { key: 'd90', label: '90 дней', pct: '71%', color: 'var(--orange)', sub: 'выполнено 50 из 70' }])
    const none = complianceTiles(comp({ hasSchedule: false, d7: win(0, 0, 2), d30: win(0, 0, 6), d90: win(0, 0, 9) }))
    expect(none.map(t => [t.pct, t.sub])).toEqual([['–', '2 трен.'], ['–', '6 трен.'], ['–', '9 трен.']])
    expect(complianceTiles(null)).toEqual([])
  })
})
