/* Keyboard diagnostics for the Telegram Mini App on iPhone (UI01).

   The exercise search sheet shifted when the keyboard came up in Telegram's iOS WebView, and the
   cause could not be told from the code alone. Turned on (tap the version in Settings → About
   seven times), this draws the numbers that decide it on top of the app and lets a layout mode
   be tried on the spot:

     auto  the layout the app ships with
     tg    the modal layer is as tall as Telegram's own visible height
     vv    the modal layer follows the visual viewport (position and height)
     top   the search sheet is anchored to the top of what is visible, above the keyboard

   Off by default and idle: nothing here runs until it is switched on. */

const FLAG = 'gym_kbdebug'
const MODE = 'gym_kbmode'
export const KB_MODES = ['auto', 'tg', 'vv', 'top']

const read = key => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key, value) => { try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value) } catch { /* private mode */ } }

export const kbDebugOn = () => read(FLAG) === '1'
export const kbMode = () => (KB_MODES.includes(read(MODE)) ? read(MODE) : 'auto')

export function toggleKbDebug() {
  const next = !kbDebugOn()
  write(FLAG, next ? '1' : null)
  if (!next) write(MODE, null)
  return next
}

/* What each viewport reports, one object so the overlay and a test read the same thing. */
export function kbSnapshot(win = window) {
  const vv = win.visualViewport
  const doc = win.document
  const tg = win.Telegram?.WebApp
  const root = doc.documentElement
  const css = name => root.style.getPropertyValue(name) || getComputedStyle(root).getPropertyValue(name) || ''
  const sheet = doc.querySelector('#modal-root .sheet:last-of-type, #modal-root .sheet')
  const rect = el => {
    const r = el?.getBoundingClientRect?.()
    return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null
  }
  const a = doc.activeElement
  return {
    inner: [win.innerWidth, win.innerHeight],
    vv: vv ? { w: Math.round(vv.width), h: Math.round(vv.height), top: Math.round(vv.offsetTop), left: Math.round(vv.offsetLeft), pageTop: Math.round(vv.pageTop) } : null,
    scrollY: Math.round(win.scrollY || 0),
    clientH: root.clientHeight,
    body: { pos: doc.body.style.position || '-', top: doc.body.style.top || '-' },
    tg: tg ? { vh: Math.round(tg.viewportHeight), stable: Math.round(tg.viewportStableHeight), expanded: !!tg.isExpanded, platform: tg.platform } : null,
    cssTgVh: css('--tg-viewport-height').trim(),
    cssSafe: css('--tg-safe-top').trim(),
    pickerBottom: sheet?.style.getPropertyValue('--picker-keyboard-bottom') || '-',
    pickerH: sheet?.style.getPropertyValue('--picker-visual-height') || '-',
    modalRoot: rect(doc.getElementById('modal-root')),
    sheet: rect(sheet),
    active: a && a !== doc.body ? a.tagName.toLowerCase() : '-',
  }
}

/* The visual viewport as CSS variables, for the vv and top modes. */
function syncVars(win) {
  const vv = win.visualViewport
  const root = win.document.documentElement.style
  root.setProperty('--kb-vv-top', Math.max(0, vv?.offsetTop || 0) + 'px')
  root.setProperty('--kb-vv-h', Math.max(0, vv?.height || win.innerHeight) + 'px')
}

function setMode(win, mode) {
  write(MODE, mode === 'auto' ? null : mode)
  const root = win.document.documentElement
  if (mode === 'auto') root.removeAttribute('data-kbmode')
  else root.setAttribute('data-kbmode', mode)
}

function run(win) {
  if (!win || !kbDebugOn()) return () => {}
  const doc = win.document
  setMode(win, kbMode())
  const box = doc.createElement('div')
  box.setAttribute('data-kbdebug', '')
  box.style.cssText = 'position:fixed;z-index:2147483647;left:4px;top:4px;max-width:92vw;padding:6px 8px;border-radius:8px;'
    + 'background:rgba(0,0,0,.78);color:#9f9;font:10px/1.35 ui-monospace,Menlo,monospace;white-space:pre-wrap;pointer-events:none'
  const bar = doc.createElement('div')
  bar.style.cssText = 'position:fixed;z-index:2147483647;right:4px;top:4px;display:flex;gap:4px'
  const buttons = KB_MODES.map(mode => {
    const b = doc.createElement('button')
    b.type = 'button'; b.textContent = mode
    b.style.cssText = 'font:11px system-ui;padding:4px 7px;border-radius:6px;border:1px solid #888;background:rgba(0,0,0,.8);color:#fff'
    // pointerdown so the tap does not first blur the search field and drop the keyboard
    b.addEventListener('pointerdown', e => { e.preventDefault(); setMode(win, mode); draw() })
    bar.appendChild(b)
    return [mode, b]
  })
  const draw = () => {
    syncVars(win)
    const s = kbSnapshot(win)
    box.textContent = `mode ${kbMode()}\n` + JSON.stringify(s, null, 1).replace(/[{}",]/g, '').replace(/\n\s*\n/g, '\n')
    for (const [mode, b] of buttons) b.style.background = mode === kbMode() ? '#2a7' : 'rgba(0,0,0,.8)'
  }
  doc.body.append(box, bar)
  const events = [['resize', win], ['scroll', win], ['focusin', doc], ['focusout', doc], ['orientationchange', win]]
  for (const [name, target] of events) target.addEventListener(name, draw, true)
  win.visualViewport?.addEventListener('resize', draw)
  win.visualViewport?.addEventListener('scroll', draw)
  const tg = win.Telegram?.WebApp
  tg?.onEvent?.('viewportChanged', draw)
  const timer = win.setInterval(draw, 400)
  draw()
  return () => {
    win.clearInterval(timer)
    for (const [name, target] of events) target.removeEventListener(name, draw, true)
    win.visualViewport?.removeEventListener('resize', draw)
    win.visualViewport?.removeEventListener('scroll', draw)
    tg?.offEvent?.('viewportChanged', draw)
    box.remove(); bar.remove()
    doc.documentElement.removeAttribute('data-kbmode')
  }
}

let stop = () => {}
/* Start (or restart, after the switch was flipped) the overlay. Returns the stopper. */
export function startKbDebug(win = typeof window !== 'undefined' ? window : null) {
  stop()
  stop = run(win)
  return stop
}
