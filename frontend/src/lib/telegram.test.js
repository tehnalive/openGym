// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { isTelegramLaunch, loadTelegram, prepareTelegram, startTelegramAwareMediaSync } from './telegram.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); delete window.Telegram; window.history.replaceState(null, '', '/'); document.querySelectorAll('script[src*="telegram.org"]').forEach(s => s.remove()) })

it('recognizes a launch even without the SDK, but never treats initDataUnsafe as a credential', () => {
  window.Telegram = { WebApp: { initDataUnsafe: { user: { id: 123 } } } }
  expect(isTelegramLaunch()).toBe(false)
  window.history.replaceState(null, '', '/#tgWebAppData=user%3Dopaque&tgWebAppVersion=8.0')
  expect(isTelegramLaunch()).toBe(true)
})

it('bounds SDK loading, fails closed, and permits an explicit retry', async () => {
  vi.useFakeTimers()
  const append = vi.spyOn(document.head, 'appendChild').mockImplementation(el => el)
  const pending = loadTelegram({ timeoutMs: 50 })
  const rejected = expect(pending).rejects.toThrow('Telegram')
  expect(append.mock.calls[0][0].src).toBe('https://telegram.org/js/telegram-web-app.js')
  await vi.advanceTimersByTimeAsync(51); await rejected
  window.Telegram = { WebApp: { initData: 'signed-only' } }
  expect(await loadTelegram()).toBe(window.Telegram.WebApp)
})

it('signals ready, expands, and updates safe areas without changing account preferences', () => {
  const sdk = { ready: vi.fn(), expand: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(), contentSafeAreaInset: { top: 32, bottom: 12 }, viewportStableHeight: 700 }
  const cleanup = prepareTelegram(sdk)
  expect(sdk.ready).toHaveBeenCalledOnce(); expect(sdk.expand).toHaveBeenCalledOnce()
  expect(document.documentElement.style.getPropertyValue('--tg-safe-top')).toBe('32px')
  expect(document.documentElement.style.getPropertyValue('--tg-viewport-height')).toBe('700px')
  cleanup(); expect(sdk.offEvent).toHaveBeenCalledTimes(3)
})

it('marks the Telegram tab without persisting credentials and retains the barrier after router replaces the hash', () => {
  window.Telegram = { WebApp: { initData: 'secret-signed-data' } }
  expect(isTelegramLaunch()).toBe(true)
  delete window.Telegram
  window.history.replaceState(null, '', '/#/home')
  expect(isTelegramLaunch()).toBe(true)
  expect(sessionStorage.getItem('opengym_telegram_tab')).toBe('1')
  expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-signed-data')
})

it('main media integration starts only for verified Telegram and stops on an error, without rescheduling on store updates', () => {
  let listener
  const stop = vi.fn(), start = vi.fn(() => stop), unsubscribe = vi.fn()
  const store = { getState: () => ({ telegram: { status: 'pending' }, user: { id: 'old' } }), subscribe: fn => { listener = fn; return unsubscribe } }
  const cleanup = startTelegramAwareMediaSync(store, start)
  expect(start).not.toHaveBeenCalled()
  listener({ telegram: { status: 'adopting' } }); expect(start).not.toHaveBeenCalled()
  listener({ telegram: { status: 'ready' } }); expect(start).toHaveBeenCalledOnce()
  listener({ telegram: { status: 'ready' } }); expect(start).toHaveBeenCalledOnce()
  listener({ telegram: { status: 'error' } }); expect(stop).toHaveBeenCalledOnce()
  listener({ telegram: { status: 'error' }, user: null }); expect(start).toHaveBeenCalledOnce()
  cleanup(); expect(unsubscribe).toHaveBeenCalledOnce()
})
