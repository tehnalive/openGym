import { useCallback, useEffect } from 'react'
import { nativeKeyboardHeight, NATIVE_KEYBOARD_EVENT } from './native-keyboard.js'

/* The modal root follows the keyboard-visible viewport (components/Modals.jsx), including the
   native Android 15 IME measurement. Sheets therefore need no second bottom inset. */
export function sheetKeyboardInsets(win) {
  const viewport = win.visualViewport
  const native = nativeKeyboardHeight(win.document)
  const top = Math.max(0, viewport?.offsetTop || 0)
  const height = Math.max(0, viewport?.height || win.innerHeight)
  const visibleBottom = Math.min(top + height, win.innerHeight - native)
  const visualHeight = Math.max(0, visibleBottom - top)
  return { visualHeight }
}

/* Keyboard-aware sheets. Modals.jsx syncs the modal root to visualViewport, including the
   position correction needed by iOS WKWebView. This hook keeps the search sheet's height current
   while the viewport changes. SelectSheet in components/ui.jsx
   does the same sync inline; the exercise picker, custom-exercise form and note sheets use this
   hook so their keyboard-aware layout follows the same measurements below.

   On Android 15 the visual viewport does not shrink either (the app is edge to edge, so
   adjustResize has no effect); the modal root accounts for --native-kb once and the sheet
   follows that smaller containing block.

   `inputRef` points at the text input (or textarea) whose closest `.sheet` gets the vars.
   `enabled` lets a caller switch the sync off (e.g. a picker without a search box). */
export function useSheetKeyboard(inputRef, enabled = true) {
  const sync = useCallback(() => {
    const input = inputRef.current
    const sheet = input?.closest?.('.sheet')
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (!sheet || !viewport) return
    const { visualHeight } = sheetKeyboardInsets(window)
    sheet.style.setProperty('--picker-visual-height', `${visualHeight}px`)
  }, [inputRef])

  useEffect(() => {
    if (!enabled) return
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (!viewport) return
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    window.addEventListener(NATIVE_KEYBOARD_EVENT, sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      window.removeEventListener(NATIVE_KEYBOARD_EVENT, sync)
      // The sheet element outlives this input when the sheet swaps content, so leave it
      // the way we found it rather than pinning a stale keyboard inset on it.
      const sheet = inputRef.current?.closest?.('.sheet')
      sheet?.style.removeProperty('--picker-visual-height')
    }
  }, [enabled, sync, inputRef])

  // Hand back as onFocus so the first measurement happens as the keyboard opens, before
  // the visualViewport events land (on iOS they can arrive a frame late).
  return sync
}

/* Chip strips scroll sideways, and a filter set from code ("★ Chosen", a reset) can land the
   active chip off-screen. Pull it into view along the strip only. This used to be
   scrollIntoView({block:'nearest'}), which also walks every scrollable ancestor: with the
   strip scrolled above the fold (Library, halfway down the list) a tap on a chip made the
   whole page jump up to show the row — the "swiping the chips scrolls the page" bug. Setting
   the strip's own scrollLeft cannot move anything but the strip.

   `pad` mirrors scroll-padding-inline in index.css so a revealed chip is not glued to the edge. */
export function revealChip(strip, chip, pad = 16) {
  if (!strip || !chip || typeof strip.getBoundingClientRect !== 'function' || typeof chip.getBoundingClientRect !== 'function') return false
  const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect()
  const width = strip.clientWidth || s.width || 0
  if (!width) return false
  const left = c.left - s.left + (strip.scrollLeft || 0)   // chip's offset inside the strip's content
  const right = left + c.width
  let next = strip.scrollLeft || 0
  if (left - pad < next) next = Math.max(0, left - pad)
  else if (right + pad > next + width) next = right + pad - width
  if (next === (strip.scrollLeft || 0)) return false
  strip.scrollLeft = next
  return true
}

export function useRevealActiveChip(stripRef, active) {
  useEffect(() => {
    const strip = stripRef.current
    const chip = strip?.querySelector?.('.chip.on')
    if (chip) revealChip(strip, chip)
  }, [stripRef, active])
}

/* Props that make a clickable <div> behave like a button for keyboard and screen-reader
   users. Kept as a div because some rows nest a real <Button> (Library), and a button inside
   a button is invalid HTML. Space is swallowed so the page does not scroll under the row. */
export function tappable(onClick) {
  if (!onClick) return {}
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return   // a nested control handles its own keys
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick(e)
      }
    }
  }
}
