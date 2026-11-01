// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: mocks.api }))

import { useUI } from '../store/useUI.js'
import { scheduleSheet, remindAt, PRESETS, QUICK_TIMES } from './TrainerSchedule.jsx'

let box, root, closed, saved
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const day = label => box.querySelector(`[aria-label="${label}"]`)
const chip = text => [...box.querySelectorAll('.chip')].find(b => b.textContent === text)
const pressed = () => [...box.querySelectorAll('.sched-day')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
const val = label => box.querySelector(`[aria-label="${label}"][role=status]`).textContent
const more = label => click(box.querySelector(`[aria-label="Больше: ${label}"]`))
const less = label => click(box.querySelector(`[aria-label="Меньше: ${label}"]`))
const open = schedule => {
  scheduleSheet({ linkId: 'link-mmmm-1', name: 'Мария', schedule, onSaved: s => { saved = s } })
  const sheet = useUI.getState().sheets.at(-1)
  closed = vi.fn()
  act(() => root.render(sheet.render(closed)))
}
const body = () => JSON.parse(mocks.api.mock.calls.find(([p, i]) => p === '/api/trainer/links/link-mmmm-1/schedule' && i?.method === 'PUT')[1].body)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset(); saved = null
  useUI.setState({ sheets: [], toastMsg: '' })
  box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box)
})
afterEach(() => { act(() => root.unmount()); box.remove() })

describe('the schedule sheet', () => {
  it('names the client, and has no native date or time field', () => {
    open(null)
    expect(box.querySelector('h3').textContent).toBe('Расписание: Мария')
    expect(box.textContent).toContain('В какие дни приходит.')
    expect(box.querySelector('input')).toBeNull()
  })

  it('has seven day buttons in one row that toggle, and the presets fill the week', () => {
    open(null)
    expect([...box.querySelectorAll('.sched-day')].map(b => b.textContent)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'])
    click(day('Вторник')); click(day('Суббота'))
    expect(pressed()).toEqual(['Вт', 'Сб'])
    click(day('Вторник'))
    expect(pressed()).toEqual(['Сб'])
    expect(PRESETS.map(p => p.label)).toEqual(['Будни', 'Через день', 'Каждый день', 'Очистить'])
    click(chip('Будни')); expect(pressed()).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт'])
    click(chip('Через день')); expect(pressed()).toEqual(['Пн', 'Ср', 'Пт'])
    expect(chip('Через день').className).toContain('on')
    click(chip('Каждый день')); expect(pressed()).toHaveLength(7)
    click(chip('Очистить')); expect(pressed()).toEqual([])
  })

  it('picks the time from chips, or none, or by steppers that wrap round and need no keyboard', () => {
    open({ days: [1], time: '', remind: false })
    expect(QUICK_TIMES[0]).toBe('07:00'); expect(QUICK_TIMES.at(-1)).toBe('20:00')
    expect(chip('Без времени').className).toContain('on')
    click(chip('18:00'))
    expect(chip('18:00').className).toContain('on'); expect(chip('Без времени').className).not.toContain('on')
    expect([val('часы'), val('минуты')]).toEqual(['18', '00'])
    more('минуты'); more('минуты')
    expect(val('минуты')).toBe('10'); expect(chip('18:00').className).not.toContain('on')
    less('часы')
    expect(val('часы')).toBe('17')
    for (let i = 0; i < 3; i++) more('минуты')
    expect(`${val('часы')}:${val('минуты')}`).toBe('17:25')
    click(chip('07:00')); less('минуты')
    expect(`${val('часы')}:${val('минуты')}`).toBe('06:55')
    click(chip('Без времени')); expect([val('часы'), val('минуты')]).toEqual(['--', '--'])
    more('часы')
    expect(`${val('часы')}:${val('минуты')}`).toBe('19:00')
  })

  it('the reminder switch says when it will remind, and is off without days', () => {
    open(null)
    const sw = () => box.querySelector('[role=switch]')
    expect(sw().disabled).toBe(true)
    expect(box.textContent).toContain('Напоминать утром в день занятия')
    expect(box.textContent).not.toContain('Напомню в')
    click(day('Среда'))
    expect(sw().disabled).toBe(false)
    expect(box.textContent).toContain('Напомню в 08:00')
    click(chip('18:00'))
    expect(box.textContent).toContain('Напомню в 17:00')
    click(sw()); expect(sw().getAttribute('aria-checked')).toBe('true')
    click(chip('Очистить')); expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(remindAt('')).toBe('08:00'); expect(remindAt('09:30')).toBe('08:30'); expect(remindAt('00:20')).toBe('00:00')
  })

  it('saves the days, the time and the reminder as the API takes them, then closes and tells the list', async () => {
    mocks.api.mockResolvedValue({ schedule: { days: [1, 3, 5], time: '18:00', remind: true } })
    open({ days: [], time: '', remind: false })
    click(chip('Через день')); click(chip('18:00')); click(box.querySelector('[role=switch]'))
    click([...box.querySelectorAll('button')].find(b => b.textContent === 'Сохранить'))
    await flush()
    const b = body()
    expect(b.days).toEqual([1, 3, 5]); expect(b.time).toBe('18:00'); expect(b.remind).toBe(true)
    expect(saved).toEqual({ days: [1, 3, 5], time: '18:00', remind: true })
    expect(closed).toHaveBeenCalled()
  })

  it('cancels without a request, and shows a refusal without closing', async () => {
    open({ days: [2], time: '09:00', remind: false })
    expect(pressed()).toEqual(['Вт']); expect(chip('09:00').className).toContain('on')
    click([...box.querySelectorAll('button')].find(b => b.textContent === 'Отмена'))
    expect(closed).toHaveBeenCalledTimes(1); expect(mocks.api).not.toHaveBeenCalled()
    mocks.api.mockRejectedValue(Object.assign(new Error('x'), { status: 404, data: { error: 'Связь не найдена', code: 'link-gone' } }))
    click([...box.querySelectorAll('button')].find(b => b.textContent === 'Сохранить'))
    await flush()
    expect(box.querySelector('[role=alert]').textContent).toContain('Связь не найдена')
    expect(closed).toHaveBeenCalledTimes(1)
  })
})
