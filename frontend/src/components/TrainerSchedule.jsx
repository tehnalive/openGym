// The days a client comes to the trainer, the time, and whether the bot reminds the trainer that morning (TG14).
// A sheet from the cabinet and from a client's own screens. Russian only, like the other trainer screens.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, WEEKDAYS } from '../lib/trainer.js'
import { Button, Switch } from './ui.jsx'

function ScheduleForm({ linkId, name, schedule, close, onSaved }) {
  const [days, setDays] = useState(schedule?.days || [])
  const [time, setTime] = useState(schedule?.time || '')
  const [remind, setRemind] = useState(!!schedule?.remind)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = iso => setDays(d => (d.includes(iso) ? d.filter(x => x !== iso) : [...d, iso].sort((a, b) => a - b)))
  const save = async () => {
    setBusy(true); setError('')
    try {
      const r = await trainerApi.setSchedule(linkId, { days, time, remind: remind && days.length > 0 })
      onSaved?.(r.schedule)
      close()
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <div>
    <h3 style={{ marginBottom: 4 }}>Расписание</h3>
    <div className="dim small" style={{ marginBottom: 12 }}>{name}: в какие дни приходит.</div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {WEEKDAYS.map(w => <button key={w.iso} type="button" aria-pressed={days.includes(w.iso)} aria-label={w.long}
        className={'btn' + (days.includes(w.iso) ? ' primary' : '')} style={{ minWidth: 44, padding: '8px 10px' }} onClick={() => toggle(w.iso)}>{w.short}</button>)}
    </div>
    <label className="row between" style={{ marginBottom: 12, gap: 12 }}>
      <span className="tt" style={{ fontSize: 15 }}>Время</span>
      <input type="time" value={time} aria-label="Время занятия" onChange={e => setTime(e.target.value)} />
    </label>
    <div className="row between" style={{ marginBottom: 6, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>Напоминать в день занятия</div>
        <div className="dim small">Бот напишет вам: «Сегодня к вам придёт {name}»{time ? ' за час до времени' : ' утром'}. Нужно, чтобы вы открывали бота.</div></div>
      <Switch checked={remind && days.length > 0} disabled={!days.length} aria-label="Напоминать" onChange={setRemind} />
    </div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '8px 0', lineHeight: 1.4 }}>{error}</div>}
    <div className="row" style={{ gap: 8, marginTop: 12 }}>
      <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      <Button onClick={close}>Отмена</Button>
    </div>
  </div>
}

/** Open the schedule of one client. `onSaved(schedule)` hears the stored plan. */
export function scheduleSheet(props) {
  useUI.getState().openSheet(close => <ScheduleForm {...props} close={close} />)
}
