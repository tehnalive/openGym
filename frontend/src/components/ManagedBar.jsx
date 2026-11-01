// The bar over a client's diary opened by their trainer (lib/managed-mode.js): whose diary this is and whether
// it has reached the server. The way back to the cabinet is the last tab (components/TabBar.jsx). Russian only, like the other trainer screens.
import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { managedInfo, leaveManagedMode, enterManagedMode, enterReadonlyMode, isReadonlyMode } from '../lib/managed-mode.js'
import { effectiveLang } from '../lib/default-lang.js'
import { confirmSheet } from '../sheets.jsx'

/** Open a client's diary from the cabinet, in the language the trainer's own app speaks now. */
export function openManagedDiary(id, name) {
  const { S, config } = useStore.getState()
  return enterManagedMode(id, name, effectiveLang(S, config))
}

/** Open a Telegram client's diary read only, in the language the app of the trainer speaks now. */
export function openReadonlyDiary(id, name, grants) {
  const { S, config } = useStore.getState()
  return enterReadonlyMode(id, name, effectiveLang(S, config), grants)
}

/** Back to the cabinet, without losing anything quietly: what is owed is sent first, a workout that is
 *  still running is named before leaving it (it stays on this device, in this diary, and is there on return). */
export async function leaveManagedDiary() {
  // Nothing is written in a read only diary, so there is nothing to send or to lose.
  if (isReadonlyMode()) { leaveManagedMode(); return }
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
    <strong>Режим тренера · дневник: {info?.name || 'подопечного'}{isReadonlyMode() ? ' · только чтение' : ''}</strong>
    {(trouble || saving) && <span className="managed-bar-sub">{trouble ? 'Нет связи, изменения пока на устройстве' : 'Сохраняется…'}</span>}
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
