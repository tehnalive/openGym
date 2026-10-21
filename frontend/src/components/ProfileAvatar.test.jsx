// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import ProfileAvatar from './ProfileAvatar.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host
function render(user) {
  if (!host) { host = document.createElement('div'); document.body.append(host); root = createRoot(host) }
  act(() => root.render(<ProfileAvatar user={user} />))
  return host
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); host = root = null })

it('uses the server avatar, falls back on image failure and retries for the next owner', () => {
  const a = { id: 'A', name: 'Аня', avatarUrl: 'https://t.me/i/userpic/320/test.svg' }
  const el = render(a)
  expect(el.querySelector('img').referrerPolicy).toBe('no-referrer')
  act(() => el.querySelector('img').dispatchEvent(new Event('error')))
  expect(el.textContent).toBe('А')
  render({ ...a, id: 'B', name: 'Борис' })
  expect(el.querySelector('img')).not.toBeNull()
  render({ id: 'C', name: 'Саша' })
  expect(el.querySelector('img')).toBeNull()
  expect(el.textContent).toBe('С')
})

it('never loads unsafe or non-Telegram URLs from a cached profile', () => {
  for (const avatarUrl of ['javascript:alert(1)', 'http://t.me/a.jpg', 'https://evil.example/a.jpg', 'https://t.me.evil.example/a.jpg']) {
    const el = render({ id: 'A', name: 'Аня', avatarUrl })
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toBe('А')
  }
})
