// A client's profile in the trainer's cabinet (TG14, stage 1): history, measurements and muscle
// statistics, read only. The data lives in this component's state and nowhere else: not the store, not
// localStorage, not a backup. There is no input and no save here by design (TrainerClient.test.jsx).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, SECTIONS, clientView, workoutRows, muscleRows, RANGES } from '../lib/trainer.js'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { weighInAt } from '../lib/bodyweight.js'
import { enabledMeasurementFields, latestMeasurement, measurementSeries, measurementUnit, toMeasurementDisplay } from '../lib/measurements.js'
import { t } from '../lib/i18n.js'
import { Segmented } from '../components/ui.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { confirmSheet } from '../sheets.jsx'
import ProfileAvatar from '../components/ProfileAvatar.jsx'

const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id || 'Упражнение'))

export function WorkoutCard({ row, unit, onDelete }) {
  const [open, setOpen] = useState(false)
  const entries = Array.isArray(row.w.entries) ? row.w.entries : []
  return <div className="item" style={{ display: 'block' }}>
    <div className="row" role="button" tabIndex={0} aria-expanded={open} style={{ gap: 10, cursor: 'pointer' }}
      onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o) }}>
      <div className="grow"><div className="tt">{row.name}</div>
        <div className="ss">{[fmtDate(row.d, true), row.minutes ? row.minutes + ' мин' : null, `подходов: ${row.sets}`].filter(Boolean).join(' · ')}</div></div>
      <Icon name={open ? 'chevronLeft' : 'chevronRight'} className="chev" />
    </div>
    {open && <div style={{ marginTop: 8 }}>
      {entries.map((e, i) => {
        const sets = (Array.isArray(e.sets) ? e.sets : []).filter(s => s && s.done)
        return <div key={i} className="small" style={{ padding: '4px 0', lineHeight: 1.4 }}>
          <span className="tt" style={{ fontSize: 14 }}>{nameOf(e)}</span>
          <span className="dim">{sets.length ? ' · ' + sets.map(s => (s.w ? `${fmtNum(s.w)} ${unit} × ${s.r ?? '?'}` : `${s.r ?? '?'}`)).join(', ') : ' · нет выполненных подходов'}</span>
        </div>
      })}
      {row.w.note && <div className="dim small" style={{ marginTop: 6 }}>{row.w.note}</div>}
      {onDelete && <button className="btn danger" style={{ marginTop: 8 }} onClick={() => onDelete(row.w)}>Удалить тренировку</button>}
    </div>}
  </div>
}

export function History({ view, onDelete }) {
  const rows = useMemo(() => workoutRows(view), [view])
  const [shown, setShown] = useState(40)
  if (!rows.length) return <div className="empty"><div className="ico"><Icon name="history" /></div>Тренировок пока нет.</div>
  return <>
    <div className="list">{rows.slice(0, shown).map(r => <WorkoutCard key={r.id + r.d} row={r} unit={view.unit} onDelete={onDelete} />)}</div>
    {rows.length > shown && <button className="btn" style={{ marginTop: 10 }} onClick={() => setShown(n => n + 40)}>Показать ещё</button>}
  </>
}

export function Measures({ view }) {
  const pts = view.bodyweight.filter(b => b && b.d && Number(b.w) > 0).map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))
  const fields = enabledMeasurementFields(view)
  const rows = fields.map(f => ({ f, hit: latestMeasurement(view, f.key) })).filter(r => r.hit)
  if (!pts.length && !rows.length) return <div className="empty"><div className="ico"><Icon name="ruler" /></div>Замеров и веса пока нет.</div>
  return <>
    {pts.length > 0 && <div className="card" style={{ marginBottom: 12 }}>
      <div className="row between" style={{ marginBottom: 6 }}><span className="tt">Вес</span>
        <span className="dim small">{fmtNum(pts[pts.length - 1].y)} {view.unit} · {fmtDate(pts[pts.length - 1].d, true)}</span></div>
      <LineChart points={pts.slice(-60)} unit={view.unit} />
    </div>}
    {rows.length > 0 && <div className="list">{rows.map(({ f, hit }) => {
      const series = measurementSeries(view, f.key)
      const shown = toMeasurementDisplay(hit.value, view.unit, f)
      return <div key={f.key} className="item"><div className="grow"><div className="tt">{t(f.label)}</div>
        <div className="ss">{fmtDate(hit.entry.d, true)}{series.length > 1 ? ` · замеров: ${series.length}` : ''}</div></div>
        <span className="tt">{fmtNum(shown)} {measurementUnit(view.unit, f) === 'none' ? '' : measurementUnit(view.unit, f)}</span></div>
    })}</div>}
  </>
}

export function Muscles({ view }) {
  const [days, setDays] = useState(30)
  const rows = useMemo(() => muscleRows(view, days), [view, days])
  return <>
    <Segmented className="seg-range" value={days} onChange={setDays} options={RANGES.map(r => ({ value: r.days, label: r.label }))} />
    {rows.length
      ? <div className="list" style={{ marginTop: 10 }}>{rows.map(r => <div key={r.slug} className="item" style={{ display: 'block' }}>
        <div className="row between"><span className="tt">{r.name}</span><span className="dim small">{fmtNum(r.load)} усл. подходов</span></div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', marginTop: 6 }}>
          <div style={{ width: Math.max(4, Math.round(r.share * 100)) + '%', height: '100%', borderRadius: 3, background: 'var(--acc)' }} /></div>
      </div>)}</div>
      : <div className="empty" style={{ marginTop: 10 }}><div className="ico"><Icon name="chart" /></div>За этот период тренировок нет.</div>}
  </>
}

// What the client opened for the trainer, since when, and the way to end the link: the client's own screen of it.
function ClientSettings({ res, linkId, onDone }) {
  const since = (() => { const d = new Date(res.since); return Number.isNaN(+d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) })()
  return <>
    <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
      <ProfileAvatar user={{ id: linkId, name: res.name, avatarUrl: res.avatarUrl }} size={48} neutral />
      <div><div className="tt">{res.name}</div><div className="dim small">{since ? 'Связь с ' + since : 'Подопечный через Telegram'}</div></div>
    </div>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="tt" style={{ marginBottom: 6 }}>Что открыто вам</div>
      {SECTIONS.map(x => <div key={x.key} className="row between" style={{ padding: '6px 0' }}>
        <span>{x.label}</span><span className={res.grants[x.key] ? '' : 'dim'}>{res.grants[x.key] ? 'открыто' : 'закрыто'}</span></div>)}
      <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>{res.name} видит этот доступ у себя и может закрыть его сам. Данные остаются у подопечного.</div>
    </div>
    <button className="btn danger" onClick={() => confirmSheet({
      title: 'Завершить связь?', message: `Вы перестанете видеть данные: ${res.name}. Подопечный сможет пригласить вас снова.`,
      confirmText: 'Завершить', danger: true,
      onConfirm: async () => {
        try { await trainerApi.endLink(linkId); useUI.getState().toast('Связь завершена'); onDone() }
        catch (e) { useUI.getState().toast(errorText(e)) }
      },
    })}>Завершить связь</button>
  </>
}

export default function TrainerClient() {
  const { linkId } = useParams()
  const nav = useNavigate()
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(null)
  const [settings, setSettings] = useState(false)
  useEffect(() => {
    let gone = false
    setRes(null); setError('')
    trainerApi.clientData(linkId).then(r => { if (!gone) { setRes(r); setTab(SECTIONS.find(s => r.grants[s.key])?.key || null) } })
      .catch(e => { if (!gone) setError(errorText(e)) })
    return () => { gone = true }
  }, [linkId])
  const view = useMemo(() => res && clientView(res.data), [res])
  const tabs = res ? SECTIONS.filter(s => res.grants[s.key]) : []
  const back = () => nav('/trainer')

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/trainer" onClick={settings ? () => setSettings(false) : back} aria-label={settings ? 'Назад' : 'Подопечные'}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{res?.name || 'Подопечный'}</h1>
        <div className="sub">{settings ? 'Настройки' : 'Только просмотр'}</div></div>
      {res && !settings && <button className="iconbtn" onClick={() => setSettings(true)} aria-label="Настройки"><Icon name="gear" /></button>}</div>
    {error && <>
      <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>
      <button className="btn" onClick={() => { useUI.getState().toast('Доступ закрыт'); back() }}>К списку</button>
    </>}
    {res && settings && <ClientSettings res={res} linkId={linkId} onDone={back} />}
    {res && !settings && <>
      {tabs.length > 1 && <Segmented className="seg-range" value={tab} onChange={setTab} options={tabs.map(s => ({ value: s.key, label: s.short }))} />}
      <div style={{ height: 10 }} />
      {tab === 'history' && <History view={view} />}
      {tab === 'measures' && <Measures view={view} />}
      {tab === 'stats' && <Muscles view={view} />}
    </>}
  </>
}
