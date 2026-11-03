// "Рутины подопечного": on the data screen of a client without Telegram, in the trainer's cabinet (TG14, section 17).
// The routines of this diary can be saved as a template, or copied to other clients. The server reads the routines from
// the stored diary of this client (a Telegram client's are never read); the screen only lists their names.
// Russian only, like the other trainer screens.
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText } from '../lib/trainer.js'
import { exercisesCount, droppedLine } from '../lib/trainer-templates.js'
import AssignPanel from './TrainerAssign.jsx'
import { Button, Check, TextField } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

function ToTemplate({ linkId, ids, close }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      const made = await trainerApi.templateFromClient(linkId, { name: name.trim(), note: note.trim(), routineIds: ids })
      close()
      toast('Шаблон сохранён. Он в кабинете тренера, раздел «Шаблоны».' + (made.dropped ? ' ' + droppedLine(made.dropped) : ''))
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <>
    <h3>Сохранить как шаблон</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>Выбранные рутины подопечного ({ids.length}) станут вашим шаблоном. Дневник подопечного не меняется.</div>
    <TextField value={name} maxLength={60} placeholder="Название шаблона" aria-label="Название шаблона" onChange={e => setName(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField value={note} maxLength={300} placeholder="Заметка (необязательно)" aria-label="Заметка к шаблону" onChange={e => setNote(e.target.value)} />
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '12px 0 0', lineHeight: 1.4 }}>{error}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>Отмена</Button>
  </>
}

function CopyToClients({ linkId, ids, close }) {
  return <>
    <h3>Скопировать другому подопечному</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>Выбранные рутины ({ids.length}) получат копию. Дальше копия живёт отдельно от оригинала.</div>
    <AssignPanel exclude={linkId} sendLabel="Скопировать" empty="Других подопечных пока нет."
      send={(to, requestId) => trainerApi.copyRoutines(linkId, ids, to, requestId)} />
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>Закрыть</Button>
  </>
}

export default function ManagedRoutines({ linkId }) {
  const [choices, setChoices] = useState(null)
  const [picked, setPicked] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    trainerApi.managedRoutines(linkId)
      .then(r => { if (live) setChoices((r.routines || []).map(x => ({ id: x.id, name: x.name || 'Без названия', count: x.exerciseCount || 0 }))) })
      .catch(e => { if (live) setError(errorText(e)) })
    return () => { live = false }
  }, [linkId])
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  // In the order of the diary's own list, not of the taps.
  const ids = (choices || []).filter(c => picked.includes(c.id)).map(c => c.id)
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="tt" style={{ marginBottom: 4 }}>Рутины подопечного</div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', lineHeight: 1.4 }}>{error}</div>}
    {!error && !choices && <div className="dim small">Загружаем…</div>}
    {choices && (choices.length
      ? <>
        <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 6 }}>Отметьте рутины, чтобы сохранить их в шаблоны или скопировать другому подопечному.</div>
        <div style={{ marginBottom: 10 }}>{choices.map(c => <div key={c.id} className="row" role="presentation" style={{ padding: '8px 2px', gap: 12, alignItems: 'center' }} onClick={() => toggle(c.id)}>
          <Check checked={picked.includes(c.id)} onChange={() => {}} label={c.name} />
          <div style={{ flex: 1 }}><div className="tt" style={{ fontSize: 15 }}>{c.name}</div><div className="small dim">{exercisesCount(c.count)}</div></div>
        </div>)}</div>
        <Button disabled={!ids.length} onClick={() => ui().openSheet(close => <ToTemplate linkId={linkId} ids={ids} close={close} />, { locked: false })}>В шаблоны</Button>
        <div style={{ height: 8 }} />
        <Button disabled={!ids.length} onClick={() => ui().openSheet(close => <CopyToClients linkId={linkId} ids={ids} close={close} />, { locked: false })}>Скопировать другому подопечному</Button>
      </>
      : <div className="dim small" style={{ lineHeight: 1.4 }}>У подопечного пока нет рутин.</div>)}
  </div>
}
