// Pause and archive of one client, on the client's settings screen in the cabinet (TG14). Russian only, like the
// other trainer screens. Pause: the place and the access stay, no reminders. Archive: the place is freed and the
// access closes until the client is brought back (the archive list is in TrainerHome).
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, PAUSE_PRESETS, PAUSE_REASONS, pauseUntil, pauseText } from '../lib/trainer.js'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)

export const ARCHIVE_CONFIRM = 'Место освободится. Данные подопечного сохранятся, ваш доступ закроется до возврата из архива.'

// "pause" is what the server last said (or null); onPause(pause) hears every change, onArchived() the archive.
export default function ClientLifecycle({ linkId, name, pause: initial = null, onPause, onArchived }) {
  const [pause, setPause] = useState(initial)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = async days => {
    setBusy(true); setError('')
    try {
      const r = await trainerApi.pause(linkId, { until: pauseUntil(days), reason })
      setPause(r.pause); onPause?.(r.pause)
      toast('Пауза поставлена')
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const resume = async () => {
    setBusy(true); setError('')
    try { await trainerApi.resume(linkId); setPause(null); onPause?.(null); toast('Пауза снята') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const archive = () => confirmSheet({
    title: 'Перенести в архив?', message: ARCHIVE_CONFIRM, confirmText: 'В архив',
    onConfirm: async () => {
      try { await trainerApi.archive(linkId); toast('Подопечный в архиве. Место освободилось.'); onArchived?.() }
      catch (e) { toast(errorText(e)) }
    },
  })

  return <>
    <div className="card" style={{ marginBottom: 12 }} aria-label="Пауза">
      <div className="tt" style={{ marginBottom: 4 }}>Пауза</div>
      <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 8 }}>
        {pause
          ? pauseText(pause) + '. Место за подопечным, доступ к данным тоже. Напоминаний о занятиях нет.'
          : 'Отпуск, травма, болезнь. Место за подопечным, доступ к данным остаётся, напоминания о занятиях не приходят.'}
      </div>
      <div className="dim small" style={{ marginBottom: 4 }}>Причина</div>
      <div className="chips" role="group" aria-label="Причина паузы">
        {[...PAUSE_REASONS, ''].map(r => <button key={r || 'none'} type="button" aria-pressed={reason === r} className={'chip' + (reason === r ? ' on' : '')}
          onClick={() => setReason(r)}>{r || 'Без причины'}</button>)}
      </div>
      <div className="dim small" style={{ margin: '10px 0 4px' }}>{pause ? 'Изменить срок' : 'На какой срок'}</div>
      <div className="chips" role="group" aria-label="Срок паузы">
        {PAUSE_PRESETS.map(p => <button key={p.label} type="button" className="chip" disabled={busy} onClick={() => set(p.days)}>{p.label}</button>)}
      </div>
      {pause && <button className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={resume}>Снять паузу</button>}
      {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '8px 0 0', lineHeight: 1.4 }}>{error}</div>}
    </div>
    <div className="card" style={{ marginBottom: 12 }} aria-label="Архив">
      <div className="tt" style={{ marginBottom: 4 }}>Архив</div>
      <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 10 }}>
        {name} не занимает место из пяти. Данные сохраняются, вернуть из архива можно в любой момент, если есть свободное место.
      </div>
      <button className="btn" onClick={archive}>В архив</button>
    </div>
  </>
}
