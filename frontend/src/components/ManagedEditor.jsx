// Forms for keeping the diary of a client without Telegram (TG14): a workout, a weigh-in, body measurements.
// They only build an operation and hand it to `onSave(op)`; the screen sends it to the server. Nothing here
// reads or writes the store or localStorage. Russian only, like the other trainer screens.
import { useMemo, useState } from 'react'
import { TextField, TextArea, Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { allExercises, searchExercises, EXIDX } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'
import { newDraft, newSet, workoutOp, weightOp, measureOp, MEASURE_FIELDS, todayIso } from '../lib/trainer-managed.js'
import { t } from '../lib/i18n.js'

const nameOf = id => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id)
const Problems = ({ list }) => (list.length
  ? <div role="alert" className="small" style={{ color: 'var(--red)', margin: '8px 0', lineHeight: 1.4 }}>{list.join('. ')}</div> : null)
const Label = ({ children }) => <div className="dim small" style={{ margin: '10px 0 4px' }}>{children}</div>

function ExercisePicker({ view, onPick }) {
  const [q, setQ] = useState('')
  const found = useMemo(() => (q.trim().length >= 2 ? searchExercises(allExercises(view), q).slice(0, 6) : []), [view, q])
  return <div>
    <TextField value={q} onChange={e => setQ(e.target.value)} placeholder="Найти упражнение (например, жим лёжа)" aria-label="Поиск упражнения" />
    {found.map(e => <button key={e.id} type="button" className="item" style={{ width: '100%', textAlign: 'start' }}
      onClick={() => { onPick(e.id); setQ('') }}><div className="grow"><div className="tt">{exerciseNameFor(e)}</div>
      <div className="ss">{[e.eq, e.bp].filter(Boolean).map(x => t(x)).join(' · ')}</div></div></button>)}
  </div>
}

export function WorkoutForm({ view, onSave, onCancel, busy }) {
  const [draft, setDraft] = useState(newDraft)
  const [problems, setProblems] = useState([])
  const set = (patch) => setDraft(d => ({ ...d, ...patch }))
  const editEx = (i, fn) => setDraft(d => ({ ...d, exercises: d.exercises.map((e, j) => (j === i ? fn(e) : e)) }))
  const addEx = id => setDraft(d => (d.exercises.some(e => e.id === id) ? d : { ...d, exercises: [...d.exercises, { id, sets: [newSet()] }] }))
  const save = () => {
    const r = workoutOp(view, draft)
    if (r.problems) return setProblems(r.problems)
    setProblems([])
    onSave(r.op)
  }
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="tt" style={{ marginBottom: 6 }}>Новая тренировка</div>
    <Label>Дата</Label>
    <input type="date" className="field" value={draft.date} max={todayIso()} onChange={e => set({ date: e.target.value })} aria-label="Дата тренировки" />
    <Label>Название (необязательно)</Label>
    <TextField value={draft.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder="Например, Ноги" aria-label="Название тренировки" />
    {draft.exercises.map((e, i) => <div key={e.id} style={{ marginTop: 12 }}>
      <div className="row between"><span className="tt">{nameOf(e.id)}</span>
        <button type="button" className="iconbtn" aria-label="Убрать упражнение" onClick={() => setDraft(d => ({ ...d, exercises: d.exercises.filter((_, j) => j !== i) }))}><Icon name="trash" /></button></div>
      {e.sets.map((s, k) => <div key={k} className="row" style={{ gap: 8, marginTop: 6 }}>
        <span className="dim small" style={{ width: 22 }}>{k + 1}</span>
        <input className="field" inputMode="decimal" value={s.w} placeholder={'Вес, ' + view.unit} aria-label={`Вес, подход ${k + 1}`}
          onChange={ev => editEx(i, x => ({ ...x, sets: x.sets.map((y, m) => (m === k ? { ...y, w: ev.target.value } : y)) }))} />
        <input className="field" inputMode="numeric" value={s.r} placeholder="Повторы" aria-label={`Повторы, подход ${k + 1}`}
          onChange={ev => editEx(i, x => ({ ...x, sets: x.sets.map((y, m) => (m === k ? { ...y, r: ev.target.value } : y)) }))} />
        <button type="button" className="iconbtn" aria-label="Убрать подход" disabled={e.sets.length < 2}
          onClick={() => editEx(i, x => ({ ...x, sets: x.sets.filter((_, m) => m !== k) }))}><Icon name="xmark" /></button>
      </div>)}
      <button type="button" className="btn" style={{ marginTop: 6 }}
        onClick={() => editEx(i, x => ({ ...x, sets: [...x.sets, { ...(x.sets[x.sets.length - 1] || newSet()) }] }))}>Ещё подход</button>
    </div>)}
    <Label>Добавить упражнение</Label>
    <ExercisePicker view={view} onPick={addEx} />
    <Label>Заметка (необязательно)</Label>
    <TextArea value={draft.note} maxLength={500} onChange={e => set({ note: e.target.value })} aria-label="Заметка к тренировке" />
    <Problems list={problems} />
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Записываем…' : 'Записать'}</Button>
      <Button onClick={onCancel}>Отмена</Button>
    </div>
  </div>
}

export function WeightForm({ view, onSave, busy }) {
  const [date, setDate] = useState(todayIso)
  const [w, setW] = useState('')
  const [problems, setProblems] = useState([])
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="tt" style={{ marginBottom: 6 }}>Вес</div>
    <div className="row" style={{ gap: 8 }}>
      <input type="date" className="field" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} aria-label="Дата взвешивания" />
      <input className="field" inputMode="decimal" value={w} placeholder={view.unit} aria-label="Вес" onChange={e => setW(e.target.value)} />
    </div>
    <Problems list={problems} />
    <Button style={{ marginTop: 8 }} disabled={busy} onClick={() => {
      const r = weightOp(date, w)
      if (r.problems) return setProblems(r.problems)
      setProblems([]); onSave(r.op); setW('')
    }}>Записать вес</Button>
  </div>
}

export function MeasureForm({ onSave, busy }) {
  const [date, setDate] = useState(todayIso)
  const [values, setValues] = useState({})
  const [problems, setProblems] = useState([])
  const [open, setOpen] = useState(false)
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row between" role="button" tabIndex={0} aria-expanded={open} style={{ cursor: 'pointer' }}
      onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o) }}>
      <span className="tt">Замеры тела</span><Icon name={open ? 'chevronLeft' : 'chevronRight'} className="chev" /></div>
    {open && <>
      <Label>Дата</Label>
      <input type="date" className="field" value={date} max={todayIso()} onChange={e => setDate(e.target.value)} aria-label="Дата замера" />
      {MEASURE_FIELDS.map(f => <div key={f.key} className="row between" style={{ marginTop: 6, gap: 8 }}>
        <span className="small">{t(f.label)}</span>
        <input className="field" style={{ maxWidth: 110 }} inputMode="decimal" value={values[f.key] ?? ''} placeholder={f.percent ? '%' : 'см'} aria-label={t(f.label)}
          onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
      </div>)}
      <Problems list={problems} />
      <Button style={{ marginTop: 8 }} disabled={busy} onClick={() => {
        const r = measureOp(date, values)
        if (r.problems) return setProblems(r.problems)
        setProblems([]); onSave(r.op); setValues({})
      }}>Записать замеры</Button>
    </>}
  </div>
}
