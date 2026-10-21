import { useState } from 'react'
import Icon from './Icon.jsx'

export default function ProfileAvatar({ user }) {
  const [failed, setFailed] = useState(null)
  const initial = user ? String(user.name || '?').trim().charAt(0).toUpperCase() : null
  let src = ''
  try {
    const url = new URL(user?.avatarUrl)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
      && /(^|\.)(t\.me|telegram\.org)$/.test(url.hostname)
      && !/(^|\.)api\.telegram\.org$/.test(url.hostname)) src = url.href
  } catch { /* No photo, or a stale invalid cached URL: show the initial. */ }
  const key = `${user?.id || ''}:${src}`
  return <span className={'sp-avatar' + (initial ? ' on' : '')} aria-hidden="true">
    {src && failed !== key
      ? <img key={key} src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(key)} />
      : initial || <Icon name="personCircle" />}
  </span>
}
