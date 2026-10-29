// Guards for the Telegram fork's patches on top of upstream openGym (docs/telegram/FORK_PATCHES.md).
// Each test fails when an upstream merge quietly puts the upstream version back. They read the
// files themselves, like csp.test.js. If one fails after a merge: restore the fork's behaviour, do
// not edit the test (unless the patch is deliberately retired: then update FORK_PATCHES.md too).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = p => readFileSync(join(root, p), 'utf8')

describe('boot page (frontend/index.html)', () => {
  const html = read('frontend/index.html')
  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1]).find(s => s.includes("addEventListener('error'"))

  function boot() {
    const listeners = {}
    const b = { className: '', getAttribute: () => null, removeAttribute() {}, setAttribute() {}, appendChild() {}, set innerHTML(v) {} }
    const win = { addEventListener: (type, fn) => { listeners[type] = fn } }
    const doc = { getElementById: () => b, readyState: 'complete', createElement: () => ({ appendChild() {}, setAttribute() {} }) }
    new Function('window', 'document', 'location', 'navigator', 'setTimeout', script)(
      win, doc, { origin: 'https://gym.example.test' }, { userAgent: 'test' }, () => 0)
    return { listeners, b }
  }

  it('has the inline error handler', () => {
    expect(script).toBeTruthy()
  })
  it('ignores a blocked third-party script (Cloudflare analytics beacon)', () => {
    const { listeners, b } = boot()
    listeners.error({ target: { tagName: 'SCRIPT', src: 'https://static.cloudflareinsights.com/beacon.min.js' } })
    expect(b.className).not.toBe('fail')
  })
  it('still reports a failed script of the app itself', () => {
    const { listeners, b } = boot()
    listeners.error({ target: { tagName: 'SCRIPT', src: 'https://gym.example.test/assets/index-abc.js' } })
    expect(b.className).toBe('fail')
  })
  it('is branded', () => {
    expect(html).toContain('<title>Жимолость</title>')
  })
})

describe('Settings: seven taps on the version switch the keyboard diagnostics', () => {
  const src = read('frontend/src/views/Settings.jsx')
  it('wires the tap counter to toggleKbDebug', () => {
    expect(src).toMatch(/import \{[^}]*toggleKbDebug[^}]*\} from '..\/lib\/kb-debug\.js'/)
    expect(src).toContain('if (k.n < 7) return')
    expect(src).toMatch(/toggleKbDebug\(\)/)
    expect(src).toMatch(/startKbDebug\(\)/)
  })
  it('hides account methods that Telegram accounts do not have', () => {
    expect(src).toContain("telegramAuth = useStore(s => s.telegram?.status === 'ready')")
    expect(src).toContain('{!telegramAuth && <>')
  })
  it('keeps the brand and no upstream support or install links', () => {
    expect(src).toContain('APP_NAME')
    expect(src).not.toMatch(/buymeacoffee|ko-fi\.com|github\.com\/sponsors|opengym\.ch\/#download|Add to Home Screen/)
  })
})

describe('keyboard handling', () => {
  it('both keyboard users go through watchKeyboardViewport, not their own listeners', () => {
    expect(read('frontend/src/components/ui.jsx')).toMatch(/watchKeyboardViewport\(sync\)/)
    expect(read('frontend/src/lib/use-sheet-keyboard.js')).toMatch(/const stop = watchKeyboardViewport\(sync\)/)
  })
  it('the watcher listens to the window resize, Telegram viewportChanged and the late re-measures', () => {
    const src = read('frontend/src/lib/use-sheet-keyboard.js')
    expect(src).toContain("win.addEventListener('resize', run)")
    expect(src).toContain("'viewportChanged'")
    expect(src).toContain('[120, 450]')
  })
  it('the diagnostics start at boot and their layout modes are in the stylesheet', () => {
    expect(read('frontend/src/main.jsx')).toContain('startKbDebug()')
    const css = read('frontend/src/index.css')
    for (const mode of ['tg', 'vv', 'top']) expect(css).toContain(`html[data-kbmode="${mode}"]`)
    expect(css).toContain('--tg-safe-bottom')
  })
})

describe('App.jsx', () => {
  const src = read('frontend/src/App.jsx')
  it('returns the Telegram gate before it mounts the Shell', () => {
    const gate = src.indexOf("telegram && !['off', 'ready'].includes(telegram.status)")
    const shell = src.indexOf('<HashRouter><Shell />')
    expect(gate).toBeGreaterThan(0)
    expect(shell).toBeGreaterThan(gate)
  })
  it('has the first-run onboarding', () => {
    expect(src).toContain('FirstRunOnboarding')
    expect(src).toContain('needsFirstRunOnboarding')
  })
})

describe('screens the fork removed stay removed', () => {
  it('no check-in, progress photos or install tips', () => {
    const app = read('frontend/src/App.jsx')
    expect(app).not.toMatch(/views\/CheckIn\.jsx|views\/ProgressPhotos\.jsx/)
    expect(app).not.toContain('path="/checkin"')
    expect(read('frontend/src/views/Home.jsx')).not.toContain("nav('/checkin')")
    expect(read('frontend/src/views/Stats.jsx')).not.toContain("nav('/progress-photos')")
    const pages = read('frontend/src/views/settings-pages.js')
    expect(pages).not.toMatch(/title: 'Gym check-in'|title: 'Get the Android app'|Add to Home screen|Add to Home Screen|install icon in the address bar/)
  })
})

describe('brand', () => {
  it('manifest, service worker and server use the product name', () => {
    expect(JSON.parse(read('frontend/public/manifest.json')).name).toBe('Жимолость')
    expect(read('frontend/public/sw.js')).toContain("data.title || 'Жимолость'")
    expect(read('frontend/src/lib/i18n-core.js')).toContain('brandText')
    expect(read('api/server.js')).toContain("process.env.RP_NAME || 'Жимолость'")
  })
})

describe('deployment files', () => {
  it('compose.telegram.yml switches TELEGRAM_ONLY on', () => {
    expect(read('compose.telegram.yml')).toMatch(/TELEGRAM_ONLY:\s*"?(1|true)"?\s*$/m)
  })
  it('the API image ships the Telegram modules', () => {
    const copy = read('api/Dockerfile').split('\n').find(l => /^COPY server\.js/.test(l)) || ''
    expect(copy).toContain('telegram-auth.mjs')
    expect(copy).toContain('telegram-notifications.mjs')
  })
  it('the web image strips CR from the entrypoint script (Windows checkouts)', () => {
    expect(read('web/Dockerfile')).toContain("sed -i 's/\\r$//' /docker-entrypoint.d/05-check-base-path.sh")
  })
  it('the dev server accepts the tunnel host from APP_HOST', () => {
    expect(read('frontend/vite.config.js')).toContain('allowedHosts')
  })
})
