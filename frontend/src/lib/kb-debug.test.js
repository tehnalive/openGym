// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { kbDebugOn, kbMode, kbSnapshot, startKbDebug, toggleKbDebug } from './kb-debug.js'

afterEach(() => {
  startKbDebug()   // stops a running overlay (the flag is cleared below)
  localStorage.clear()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-kbmode')
})

describe('keyboard diagnostics (UI01)', () => {
  it('does nothing until switched on', () => {
    expect(kbDebugOn()).toBe(false)
    startKbDebug()
    expect(document.querySelector('[data-kbdebug]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-kbmode')).toBe(false)
  })

  it('shows the numbers and lets a layout mode be picked', () => {
    expect(toggleKbDebug()).toBe(true)
    startKbDebug()
    const box = document.querySelector('[data-kbdebug]')
    expect(box.textContent).toContain('mode auto')
    const tap = name => [...document.querySelectorAll('button')].find(b => b.textContent === name)
      .dispatchEvent(new Event('pointerdown', { cancelable: true }))
    tap('vv')
    expect(kbMode()).toBe('vv')
    expect(document.documentElement.getAttribute('data-kbmode')).toBe('vv')
    tap('auto')
    expect(document.documentElement.hasAttribute('data-kbmode')).toBe(false)
  })

  it('switching off removes the overlay and forgets the mode', () => {
    toggleKbDebug(); startKbDebug()
    expect(toggleKbDebug()).toBe(false)
    startKbDebug()
    expect(document.querySelector('[data-kbdebug]')).toBeNull()
    expect(kbMode()).toBe('auto')
  })

  it('reads the sheet and Telegram numbers when they exist', () => {
    document.body.innerHTML = '<div id="modal-root"><div class="sheet"></div></div>'
    const snap = kbSnapshot({ ...window, Telegram: { WebApp: { viewportHeight: 612.4, viewportStableHeight: 700, isExpanded: true, platform: 'ios' } }, visualViewport: { width: 390, height: 500, offsetTop: 12, offsetLeft: 0, pageTop: 12 }, document, innerWidth: 390, innerHeight: 844, scrollY: 0 })
    expect(snap.tg).toEqual({ vh: 612, stable: 700, expanded: true, platform: 'ios' })
    expect(snap.vv.h).toBe(500)
    expect(snap.inner).toEqual([390, 844])
    expect(snap.sheet).not.toBeNull()
  })
})
