// The days a client comes to the trainer, the time, and whether the bot reminds the trainer that morning (TG14).
// A sheet from the cabinet. Russian only, like the other trainer screens. No native date or time field: the days are
// seven buttons, the time is a strip of chips and a pair of steppers, so it looks the same on every phone and in
// both themes, and needs no keyboard.
import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, WEEKDAYS } from '../lib/trainer.js'
import { Button, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

// Quick ways to fill the week.
export const PRESETS = [
  { label: 'Будни', days: [1, 2, 3, 4, 5] },
  { label: 'Через день', days: [1, 3, 5] },
  { label: 'Каждый день', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'Очистить', days: [] },
]
// The usual hours of a training, as chips.
export const QUICK_TIMES = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']
const REMIND_LEAD_MIN = 60     // as the server (api/trainer.js): a booked time is reminded this long before
const REMIND_DEFAULT_AT = '08:00'

const pad = n => String(n).padStart(2, '0')
const parts = time => (/^\d\d:\d\d$/.test(time) ? [Number(time.slice(0, 2)), Number(time.slice(3))] : [null, null])
const sameDays = (a, b) => a.length === b.length && a.every((d, i) => d === b[i])

/** When the reminder will come, for the line under the switch. */
export function remindAt(time) {
  const [h, m] = parts(time)
  if (h == null) return REMIND_DEFAULT_AT
  const at = Math.max(0, h * 60 + m - REMIND_LEAD_MIN)
  return pad(Math.floor(at / 60)) + ':' + pad(at % 60)
}

function Step({ label, value, onMinus, onPlus }) {
  return <div className="sched-step">
    <button type="button" aria-label={'Меньше: ' + label} onClick={onMinus}><Icon name="minus" /></button>
    <span aria-label={label} role="status">{value}</span>
    <button type="button" aria-label={'Больше: ' + label} onClick={onPlus}><Icon name="plus" /></button>
  </div>
}

function ScheduleForm({ linkId, name, schedule, close, onSaved }) {
  const [days, setDays] = useState(schedule?.days || [])
  const [time, setTime] = useState(schedule?.time || '')
  const [remind, setRemind] = useState(!!schedule?.remind)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = iso => setDays(d => (d.includes(iso) ? d.filter(x => x !== iso) : [...d, iso].sort((a, b) => a - b)))
  const [h, m] = parts(time)
  const setHM = (hh, mm) => setTime(pad(((hh % 24) + 24) % 24) + ':' + pad(((mm % 60) + 60) % 60))
  const stepHour = dir => setHM((h ?? 18) + dir, m ?? 0)
  const stepMin = dir => { const next = (m ?? 0) + dir * 5; setHM((h ?? 18) + (next >= 60 ? 1 : next < 0 ? -1 : 0), next) }
  const save = async () => {
    setBusy(true); setError('')
    try {
      const r = await trainerApi.setSchedule(linkId, { days, time, remind: remind && days.length > 0 })
      onSaved?.(r.schedule)
      close()
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  const on = remind && days.length > 0
  return <div className="sched">
    <h3 style={{ marginBottom: 4 }}>Расписание: {name}</h3>
    <div className="dim small" style={{ marginBottom: 12 }}>В какие дни приходит.</div>

    <div className="sched-days" role="group" aria-label="Дни недели">
      {WEEKDAYS.map(w => <button key={w.iso} type="button" aria-pressed={days.includes(w.iso)} aria-label={w.long}
        className={'sched-day' + (days.includes(w.iso) ? ' on' : '')} onClick={() => toggle(w.iso)}>{w.short}</button>)}
    </div>
    <div className="chips sched-chips" role="group" aria-label="Быстрый выбор дней">
      {PRESETS.map(p => <button key={p.label} type="button" className={'chip' + (p.days.length && sameDays(days, p.days) ? ' on' : '')}
        onClick={() => setDays(p.days)}>{p.label}</button>)}
    </div>

    <div className="tt" style={{ margin: '14px 0 4px', fontSize: 15 }}>Время</div>
    <div className="chips sched-chips" role="group" aria-label="Время занятия">
      <button type="button" className={'chip' + (time === '' ? ' on' : '')} onClick={() => setTime('')}>Без времени</button>
      {QUICK_TIMES.map(q => <button key={q} type="button" className={'chip' + (time === q ? ' on' : '')} onClick={() => setTime(q)}>{q}</button>)}
    </div>
    <div className="sched-own">
      <span className="dim small">Своё время</span>
      <Step label="часы" value={h == null ? '--' : pad(h)} onMinus={() => stepHour(-1)} onPlus={() => stepHour(1)} />
      <b aria-hidden="true">:</b>
      <Step label="минуты" value={m == null ? '--' : pad(m)} onMinus={() => stepMin(-1)} onPlus={() => stepMin(1)} />
    </div>

    <div className="sched-remind">
      <div style={{ minWidth: 0 }}>
        <div className="tt" style={{ fontSize: 15 }}>Напоминать утром в день занятия</div>
        <div className="dim small" style={{ lineHeight: 1.35 }}>
          {days.length ? 'Напомню в ' + remindAt(time) + '. ' : ''}Бот напишет вам в Telegram: «Сегодня к вам придёт {name}». Нужно, чтобы вы открывали бота.
        </div>
      </div>
      <Switch checked={on} disabled={!days.length} aria-label="Напоминать" onChange={setRemind} />
    </div>

    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '8px 0', lineHeight: 1.4 }}>{error}</div>}
    <div className="sched-actions">
      <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      <Button onClick={close}>Отмена</Button>
    </div>
  </div>
}

/** Open the schedule of one client. `onSaved(schedule)` hears the stored plan. */
export function scheduleSheet(props) {
  useUI.getState().openSheet(close => <ScheduleForm {...props} close={close} />)
}
