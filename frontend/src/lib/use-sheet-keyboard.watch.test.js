// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { sheetKeyboardInsets, watchKeyboardViewport } from './use-sheet-keyboard.js'

// Telegram's iOS WebView (UI01, seen on an iPhone 02:25): the visual viewport shrinks to what the
// keyboard leaves while the window is still full height, and only a beat later the window shrinks
// to match. The inset measured in between must not stay.
function fakeWindow({ innerHeight, vvHeight }) {
  const listeners = {}
  const vvListeners = {}
  const win = {
    innerHeight, document: { documentElement: { style: { getPropertyValue: () => '' } } },
    setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: id => clearTimeout(id),
    addEventListener: (n, f) => { (listeners[n] ||= []).push(f) },
    removeEventListener: (n, f) => { listeners[n] = (listeners[n] || []).filter(x => x !== f) },
    visualViewport: {
      height: vvHeight, offsetTop: 0,
      addEventListener: (n, f) => { (vvListeners[n] ||= []).push(f) },
      removeEventListener: (n, f) => { vvListeners[n] = (vvListeners[n] || []).filter(x => x !== f) },
    },
    emit: (n) => (listeners[n] || []).forEach(f => f()),
    emitViewport: (n) => (vvListeners[n] || []).forEach(f => f()),
    listeners, vvListeners,
  }
  return win
}

describe('keyboard inset while the window itself resizes', () => {
  it('measures a 345px lift in between, and none once the window has caught up', () => {
    const win = fakeWindow({ innerHeight: 824, vvHeight: 479 })
    expect(sheetKeyboardInsets(win).bottomInset).toBe(345)
    win.innerHeight = 479
    expect(sheetKeyboardInsets(win).bottomInset).toBe(0)
  })

  it('measures again when the window resizes, which the visual viewport never reports', () => {
    const win = fakeWindow({ innerHeight: 824, vvHeight: 479 })
    const seen = []
    const stop = watchKeyboardViewport(() => seen.push(sheetKeyboardInsets(win).bottomInset), win)
    win.emitViewport('resize')                       // keyboard starts: window still 824
    expect(seen.at(-1)).toBe(345)
    win.innerHeight = 479
    win.emit('resize')                               // Telegram shrinks the window
    expect(seen.at(-1)).toBe(0)
    stop()
  })

  it('measures once more after the events stop, for a window that settles quietly', async () => {
    vi.useFakeTimers()
    const win = fakeWindow({ innerHeight: 824, vvHeight: 479 })
    const seen = []
    const stop = watchKeyboardViewport(() => seen.push(sheetKeyboardInsets(win).bottomInset), win)
    win.emitViewport('resize')
    win.innerHeight = 479                            // no event for this
    vi.advanceTimersByTime(200)
    expect(seen.at(-1)).toBe(0)
    stop()
    vi.useRealTimers()
  })

  it('stops listening, and follows Telegram\'s own viewport event', () => {
    const win = fakeWindow({ innerHeight: 479, vvHeight: 479 })
    const handlers = {}
    win.Telegram = { WebApp: { onEvent: (n, f) => { handlers[n] = f }, offEvent: n => { delete handlers[n] } } }
    const sync = vi.fn()
    const stop = watchKeyboardViewport(sync, win)
    handlers.viewportChanged()
    expect(sync).toHaveBeenCalled()
    stop()
    expect(handlers.viewportChanged).toBeUndefined()
    expect(win.listeners.resize).toEqual([])
    expect(win.vvListeners.resize).toEqual([])
  })
})
