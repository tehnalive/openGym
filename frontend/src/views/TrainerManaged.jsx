// A client without Telegram, whose diary the trainer keeps (TG14, managed clients). The diary lives on the
// server in a profile of its own; here it is held in this component's state only, never in the store, in
// localStorage or in a backup, so it cannot mix with the trainer's own training. Russian only.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, clientView } from '../lib/trainer.js'
import { exportFile } from '../lib/trainer-managed.js'
import { copyLink } from '../lib/plan-link.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { Segmented } from '../components/ui.jsx'
import { WorkoutForm, WeightForm, MeasureForm } from '../components/ManagedEditor.jsx'
import { History, Measures, Muscles } from './TrainerClient.jsx'
import Icon from '../components/Icon.jsx'
import { confirmSheet } from '../sheets.jsx'

const TABS = [{ value: 'history', label: 'История' }, { value: 'measures', label: 'Вес и замеры' }, { value: 'stats', label: 'Мышцы' }]
const toast = m => useUI.getState().toast(m)

function save(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch { return false }
}

export default function TrainerManaged() {
  const { linkId } = useParams()
  const nav = useNavigate()
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('history')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let gone = false
    setRes(null); setError('')
    trainerApi.managed(linkId).then(r => { if (!gone) setRes(r) }).catch(e => { if (!gone) setError(errorText(e)) })
    return () => { gone = true }
  }, [linkId])
  const view = useMemo(() => res && clientView(res.data), [res])
  const back = () => nav('/trainer')

  // One request, the revision it was made against; on a conflict the server's newer diary replaces ours.
  const send = useCallback(async (ops, done = 'Записано') => {
    setBusy(true)
    try {
      const r = await trainerApi.managedOps(linkId, ops, res?.rev)
      setRes(x => ({ ...x, rev: r.rev, data: r.data }))
      toast(done)
      return true
    } catch (e) {
      if (e?.status === 409 && e.data?.data) setRes(x => ({ ...x, rev: e.data.rev, data: e.data.data }))
      toast(errorText(e))
      return false
    } finally { setBusy(false) }
  }, [linkId, res?.rev])

  const askDelete = (title, message, op) => confirmSheet({ title, message, confirmText: 'Удалить', danger: true, onConfirm: () => send([op], 'Удалено') })
  const weights = view ? [...view.bodyweight].filter(b => b?.d).sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 8) : []
  const checkins = view ? [...view.measurements].filter(m => m?.d).sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 5) : []

  const exportData = async () => {
    try {
      const file = exportFile(await trainerApi.managedExport(linkId))
      if (!save(file.name, file.text)) throw new Error('save')
      toast('Файл сохранён')
    } catch {
      // Some in-app browsers cannot save a file: the same text goes to the clipboard instead.
      try {
        const file = exportFile(await trainerApi.managedExport(linkId))
        toast(await copyLink(file.text) ? 'Файл не сохранился, данные скопированы текстом' : 'Не удалось выгрузить данные')
      } catch (e) { toast(errorText(e)) }
    }
  }
  const removeClient = () => confirmSheet({
    title: 'Удалить подопечного?', message: `Дневник «${res.name}» будет стёрт без возврата. Если нужна копия, сначала скачайте данные.`,
    confirmText: 'Удалить навсегда', danger: true,
    onConfirm: async () => {
      try { await trainerApi.deleteManaged(linkId); toast('Подопечный удалён'); back() } catch (e) { toast(errorText(e)) }
    },
  })

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/trainer" onClick={back} aria-label="Подопечные"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{res?.name || 'Подопечный'}</h1>
        <div className="sub">{res?.note || 'Без Telegram'}</div></div></div>
    {error && <>
      <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>
      <button className="btn" onClick={back}>К списку</button>
    </>}
    {res && view && <>
      <div className="card" role="status" style={{ marginBottom: 12, borderInlineStart: '4px solid var(--acc)' }}>
        <div className="tt">Вы ведёте дневник: {res.name}</div>
        <div className="dim small" style={{ lineHeight: 1.4, marginTop: 4 }}>Всё, что вы запишете здесь, попадёт в дневник этого подопечного, а не в ваш. Свои тренировки ведите в обычных разделах приложения.</div>
      </div>
      <Segmented className="seg-range" value={tab} onChange={setTab} options={TABS} />
      <div style={{ height: 10 }} />
      {tab === 'history' && <>
        {adding
          ? <WorkoutForm view={view} busy={busy} onCancel={() => setAdding(false)} onSave={async op => { if (await send([op], 'Тренировка записана')) setAdding(false) }} />
          : <button className="btn primary" style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>Записать тренировку</button>}
        <History view={view} onDelete={w => askDelete('Удалить тренировку?', `Тренировка «${w.name || w.d}» пропадёт из дневника.`, { op: 'workout.delete', id: w.id })} />
      </>}
      {tab === 'measures' && <>
        <WeightForm view={view} busy={busy} onSave={op => send([op], 'Вес записан')} />
        <MeasureForm busy={busy} onSave={op => send([op], 'Замеры записаны')} />
        <Measures view={view} />
        {(weights.length > 0 || checkins.length > 0) && <div className="list" style={{ marginTop: 12 }}>
          {weights.map(b => <div key={'w' + b.d} className="item"><div className="grow"><div className="tt">Вес {fmtNum(b.w)} {view.unit}</div><div className="ss">{fmtDate(b.d, true)}</div></div>
            <button className="iconbtn" aria-label={`Удалить вес за ${b.d}`} onClick={() => askDelete('Удалить вес?', `Взвешивание за ${fmtDate(b.d, true)} пропадёт.`, { op: 'bodyweight.delete', d: b.d })}><Icon name="trash" /></button></div>)}
          {checkins.map(m => <div key={'m' + m.d} className="item"><div className="grow"><div className="tt">Замеры</div><div className="ss">{fmtDate(m.d, true)}</div></div>
            <button className="iconbtn" aria-label={`Удалить замеры за ${m.d}`} onClick={() => askDelete('Удалить замеры?', `Замеры за ${fmtDate(m.d, true)} пропадут.`, { op: 'measurement.delete', d: m.d })}><Icon name="trash" /></button></div>)}
        </div>}
      </>}
      {tab === 'stats' && <Muscles view={view} />}
      <div className="dim small" style={{ margin: '18px 0 8px', lineHeight: 1.4 }}>
        У подопечного нет Telegram, поэтому дневник хранится на сервере под вашей ответственностью. Вы можете скачать его в любой момент и удалить целиком.
      </div>
      <button className="btn" style={{ marginBottom: 8 }} onClick={exportData}>Скачать данные подопечного</button>
      <button className="btn danger" onClick={removeClient}>Удалить подопечного</button>
    </>}
  </>
}
