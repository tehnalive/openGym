// @vitest-environment happy-dom
// The mark «written by the trainer» (TG14, section 16): shown on a workout the server marked `via: 'coach'`, nowhere else.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import CoachMark, { isCoachWorkout } from './CoachMark.jsx'
import { WorkoutCard } from '../views/TrainerClient.jsx'
import { WorkoutRow } from '../sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
function draw(el) {
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(el) })
  return host
}
afterEach(() => { if (root) act(() => root.unmount()); host?.remove(); root = host = null })

describe('CoachMark', () => {
  it('shows for a workout the trainer wrote and for no other', () => {
    expect(isCoachWorkout({ via: 'coach' })).toBe(true)
    for (const w of [null, undefined, {}, { via: 'client' }, { by: 'x' }, 'coach']) expect(isCoachWorkout(w)).toBe(false)
    expect(draw(<CoachMark w={{ via: 'coach' }} />).textContent).toBe('Written by the trainer')
    act(() => root.unmount()); host.remove()
    expect(draw(<CoachMark w={{ via: 'client' }} />).textContent).toBe('')
  })

  it('the cabinet says it in Russian, without a translation call', () => {
    const row = { id: 'w', d: '2026-01-01', name: 'Ноги', sets: 2, minutes: 0, w: { id: 'w', via: 'coach', entries: [] } }
    expect(draw(<WorkoutCard row={row} unit="kg" />).querySelector('[data-testid="coach-mark"]')?.textContent).toBe('Записал тренер')
    act(() => root.unmount()); host.remove()
    const own = { ...row, w: { id: 'w', entries: [] } }
    expect(draw(<WorkoutCard row={own} unit="kg" />).querySelector('[data-testid="coach-mark"]')).toBeNull()
  })

  it('in the history row the badge sits in the name column, under the date, not beside the PR badge', () => {
    const w = { id: 'w', d: '2026-01-01', name: 'Ноги', start: 0, end: 0, via: 'coach', entries: [], prs: [{}] }
    const row = draw(<WorkoutRow w={w} onClick={() => {}} />)
    const mark = row.querySelector('[data-testid="coach-mark"]')
    expect(mark.parentElement.classList.contains('grow')).toBe(true)
    expect(mark.previousElementSibling.classList.contains('ss')).toBe(true)
    expect(row.querySelector('.pr')).toBeTruthy()
  })
})
