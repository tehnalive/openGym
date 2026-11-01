// The bar over a client's diary opened by their trainer (lib/managed-mode.js): whose diary this is, whether
// it has reached the server, and the way back to the cabinet. Russian only, like the other trainer screens.
import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { managedInfo, leaveManagedMode } from '../lib/managed-mode.js'
import { confirmSheet } from '../sheets.jsx'

/** Back to the cabinet, without losing anything quietly: what is owed is sent first, a workout that is
 *  still running is named before leaving it (it stays on this device, in this diary, and is there on return). */
export async function leaveManagedDiary() {
  const go = async () => {
    useUI.getState().toast('Сохраняем дневник…')
    try { await useStore.getState().pushState() } catch { /* the check below tells whether it landed */ }
    if (useStore.getState().unsyncedChanges().owed) {
      confirmSheet({
        title: 'Не всё сохранилось',
        message: 'Часть изменений пока только на этом устройстве. Они уйдут в дневник, когда вы откроете его снова при связи. Выйти?',
        confirmText: 'Выйти', cancelText: 'Остаться', onConfirm: () => leaveManagedMode(),
      })
      return
    }
    leaveManagedMode()
  }
  if (useStore.getState().S.active) {
    confirmSheet({
      title: 'Тренировка не завершена',
      message: 'Она останется на этом устройстве в дневнике «' + (managedInfo()?.name || 'подопечного') + '» и ждёт вас там, но самого дневника пока не коснётся. Выйти?',
      confirmText: 'Выйти', cancelText: 'Остаться', onConfirm: go,
    })
    return
  }
  await go()
}

export default function ManagedBar() {
  const info = managedInfo()
  const sync = useStore(s => s.sync)
  const ref = useRef(null)
  // Its height goes into --conn, as the connection banner's does, so the page starts below it.
  useEffect(() => {
    const el = ref.current
    const root = document.documentElement.style
    if (!el) return
    const fit = () => root.setProperty('--conn', el.offsetHeight + 'px')
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.removeProperty('--conn') }
  }, [])
  const trouble = !!sync && (sync.offline || sync.status === 'error' || sync.status === 'auth' || !!sync.lastError)
  const saving = !!sync && !trouble && (sync.status === 'pending' || sync.pending)
  return <div ref={ref} className="managed-bar" role="status">
    <div className="managed-bar-text">
      <strong>Дневник: {info?.name || 'подопечного'}</strong>
      <span className="managed-bar-sub">{trouble ? 'Нет связи: изменения пока на этом устройстве' : saving ? 'Сохраняется…' : 'Всё, что вы запишете, попадёт в этот дневник'}</span>
    </div>
    <button type="button" className="managed-bar-btn" onClick={leaveManagedDiary}>К подопечным</button>
  </div>
}

/** The trainer's own session ended while the diary was open: the way out is the cabinet, which signs in again. */
export function ManagedEnded() {
  return <main className="telegram-entry" lang="ru">
    <h1>Сессия закончилась</h1>
    <p role="alert">Вход тренера больше не действует. Вернитесь в кабинет: изменения, которые не успели уйти, останутся в этом дневнике на устройстве.</p>
    <button className="btn primary" onClick={() => leaveManagedMode()}>К подопечным</button>
  </main>
}
