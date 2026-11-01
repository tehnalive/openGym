import { useState } from 'react'
import Icon from './Icon.jsx'

// `size` in px and `neutral` (a grey disc for the initial) are for the trainer's lists; Settings keeps the defaults.
export default function ProfileAvatar({ user, size, neutral }) {
  const [failed, setFailed] = useState(null)
  const initial = user ? String(user.name || '?').trim().charAt(0).toUpperCase() : null
  let src = ''
  try {
    const url = new URL(user?.avatarUrl)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
      && /(^|\.)(t\.me|telegram\.org|telegram-cdn\.org)$/.test(url.hostname)
      && !/(^|\.)api\.telegram\.org$/.test(url.hostname)) src = url.href
  } catch { /* No photo, or a stale invalid cached URL: show the initial. */ }
  const key = `${user?.id || ''}:${src}`
  const sized = size ? { width: size, height: size, fontSize: Math.round(size * 0.45) } : undefined
  return <span className={'sp-avatar' + (initial ? ' on' : '') + (neutral ? ' neutral' : '')} style={sized} aria-hidden="true">
    {src && failed !== key
      ? <img key={key} src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(key)} />
      : initial || <Icon name="personCircle" />}
  </span>
}
