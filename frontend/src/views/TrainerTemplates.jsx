// The trainer's templates (TG14, section 17): a snapshot of routines that can be handed to clients. A list, a sheet to make
// one from the trainer's own routines, and a card to look inside, hand it out, rename it and delete it.
// Russian only, like the other trainer screens; no long dashes.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText } from '../lib/trainer.js'
import { compositionLine, routineChoices, templateBody, exerciseLine, exercisesCount, routinesCount, droppedLine } from '../lib/trainer-templates.js'
import AssignPanel from '../components/TrainerAssign.jsx'
import { Button, Check, TextField } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/** Make a template out of the trainer's own routines. */
export function NewTemplate({ close, onSaved }) {
  const S = useStore(s => s.S)
  const choices = routineChoices(S)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const save = async () => {
    setBusy(true); setError('')
    try {
      // In the order of the trainer's own list, not of the taps.
      const ids = choices.filter(c => picked.includes(c.id)).map(c => c.id)
      const made = await trainerApi.createTemplate(templateBody(S, ids, { name, note }))
      close()
      toast('Шаблон сохранён' + (made.dropped ? '. ' + droppedLine(made.dropped) : ''))
      onSaved?.(made.template)
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <>
    <h3>Новый шаблон</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>Шаблон это снимок ваших рутин. Когда вы назначите его подопечному, у него появится своя копия, которую можно менять независимо от шаблона.</div>
    <TextField value={name} maxLength={60} placeholder="Название" aria-label="Название шаблона" onChange={e => setName(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField value={note} maxLength={300} placeholder="Заметка (необязательно)" aria-label="Заметка к шаблону" onChange={e => setNote(e.target.value)} />
    <div className="tt" style={{ margin: '14px 0 4px', fontSize: 15 }}>Какие рутины взять</div>
    {choices.length
      ? <div style={{ marginBottom: 12 }}>{choices.map(c => <div key={c.id} className="row" role="presentation" style={{ padding: '8px 2px', gap: 12, alignItems: 'center' }} onClick={() => toggle(c.id)}>
        <Check checked={picked.includes(c.id)} onChange={() => {}} label={c.name} />
        <div style={{ flex: 1 }}><div className="tt" style={{ fontSize: 15 }}>{c.name}</div><div className="small dim">{exercisesCount(c.count)}</div></div>
      </div>)}</div>
      : <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 12 }}>У вас пока нет своих рутин. Создайте их на вкладке «План», а потом сохраните здесь.</div>}
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>}
    <Button variant="primary" disabled={busy || !name.trim() || !picked.length} onClick={save}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>Отмена</Button>
  </>
}

/** A template: what is inside, hand it out, rename it, take a routine out, delete it. */
export function TemplateCard({ id, close, onChanged }) {
  const [tpl, setTpl] = useState(null)
  const [mode, setMode] = useState('card')       // 'card' | 'assign' | 'rename' | 'delete'
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { const r = await trainerApi.template(id); setTpl(r.template); setName(r.template.name); setNote(r.template.note || '') }
    catch (e) { setError(errorText(e)) }
  }, [id])
  useEffect(() => { load() }, [load])
  const run = async (job, after) => {
    setBusy(true); setError('')
    try { await job(); onChanged?.(); after?.() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  if (!tpl) return <>
    <h3>Шаблон</h3>
    {error ? <div role="alert" className="small" style={{ color: 'var(--red)', lineHeight: 1.4 }}>{error}</div> : <div className="dim small">Загружаем…</div>}
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>Закрыть</Button>
  </>

  const takeOut = rid => run(async () => {
    const r = await trainerApi.changeTemplate(tpl.id, { routineIds: tpl.routines.filter(x => x.id !== rid).map(x => x.id) })
    setTpl(r.template)
  })
  const move = (i, dir) => run(async () => {
    const ids = tpl.routines.map(x => x.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setTpl((await trainerApi.changeTemplate(tpl.id, { routineIds: ids })).template)
  })
  const rename = () => run(async () => { setTpl((await trainerApi.changeTemplate(tpl.id, { name, note })).template); setMode('card') })
  const remove = () => run(async () => { await trainerApi.deleteTemplate(tpl.id) }, () => { close(); toast('Шаблон удалён') })

  if (mode === 'assign') return <>
    <h3>Назначить: {tpl.name}</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>Каждый получит свою копию: {compositionLine(tpl.routines.map(r => r.name))}. Дальше копия живёт отдельно от шаблона.</div>
    <AssignPanel send={(ids, requestId) => trainerApi.assignTemplate(tpl.id, ids, requestId)} />
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => setMode('card')}>Назад</Button>
  </>
  if (mode === 'rename') return <>
    <h3>Переименовать</h3>
    <TextField value={name} maxLength={60} placeholder="Название" aria-label="Название шаблона" onChange={e => setName(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField value={note} maxLength={300} placeholder="Заметка" aria-label="Заметка к шаблону" onChange={e => setNote(e.target.value)} />
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '12px 0 0', lineHeight: 1.4 }}>{error}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !name.trim()} onClick={rename}>Сохранить</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" disabled={busy} onClick={() => { setMode('card'); setError('') }}>Назад</Button>
  </>
  if (mode === 'delete') return <>
    <h3>Удалить шаблон «{tpl.name}»?</h3>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>Копии, которые уже получили подопечные, останутся у них.</div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>}
    <Button className="danger" disabled={busy} onClick={remove}>Удалить навсегда</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" disabled={busy} onClick={() => { setMode('card'); setError('') }}>Отмена</Button>
  </>

  return <>
    <h3>{tpl.name}</h3>
    {tpl.note && <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.4 }}>{tpl.note}</div>}
    <div className="dim small" style={{ marginBottom: 10 }}>{compositionLine(tpl.routines.map(r => r.name), 6)}</div>
    <div style={{ marginBottom: 12 }}>
      {tpl.routines.map((r, i) => <div key={r.id} style={{ padding: '8px 0', borderTop: i ? '1px solid var(--sep)' : 'none' }}>
        <div className="row between" style={{ gap: 8 }}>
          <div className="tt" style={{ fontSize: 15, flex: 1 }}>{r.name}</div>
          <button className="iconbtn" aria-label={'Выше: ' + r.name} disabled={busy || i === 0} onClick={() => move(i, -1)}><Icon name="chevronUp" /></button>
          <button className="iconbtn" aria-label={'Ниже: ' + r.name} disabled={busy || i === tpl.routines.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" /></button>
          <button className="iconbtn" aria-label={'Убрать из шаблона: ' + r.name} disabled={busy || tpl.routines.length < 2} title={tpl.routines.length < 2 ? 'В шаблоне должна остаться хотя бы одна рутина' : 'Убрать из шаблона'}
            onClick={() => takeOut(r.id)}><Icon name="trash" /></button>
        </div>
        {(r.ex || []).map((e, k) => <div key={k} className="small dim" style={{ lineHeight: 1.4 }}>{exerciseLine(tpl, e, tpl.unit)}</div>)}
      </div>)}
    </div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>}
    <Button variant="primary" icon="share" onClick={() => setMode('assign')}>Назначить</Button>
    <div style={{ height: 8 }} /><Button onClick={() => setMode('rename')}>Переименовать</Button>
    <div style={{ height: 8 }} /><Button className="danger" onClick={() => setMode('delete')}>Удалить шаблон</Button>
    <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={close}>Закрыть</Button>
  </>
}

export default function TrainerTemplates() {
  const nav = useNavigate()
  const [list, setList] = useState(null)
  const [limit, setLimit] = useState(50)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { const r = await trainerApi.templates(); setList(r.templates || []); setLimit(r.limit || 50); setError('') }
    catch (e) { setError(errorText(e)) }
  }, [])
  useEffect(() => { load() }, [load])
  const open = id => ui().openSheet(close => <TemplateCard id={id} close={close} onChanged={load} />, { locked: false })
  const make = () => ui().openSheet(close => <NewTemplate close={close} onSaved={t => { load(); open(t.id) }} />, { locked: false })
  return <>
    <div className="hdr"><button className="iconbtn" data-back="/trainer" onClick={() => nav('/trainer')} aria-label="Кабинет тренера"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Шаблоны</h1>
        <div className="sub">{list ? `${list.length} из ${limit}` : ' '}</div></div></div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '0 0 12px', lineHeight: 1.4 }}>{error}</div>}
    {list && (list.length
      ? <div className="list">{list.map(t => <div key={t.id} className="item" role="button" tabIndex={0} onClick={() => open(t.id)} onKeyDown={e => { if (e.key === 'Enter') open(t.id) }}>
        <div className="grow"><div className="tt">{t.name}</div>
          <div className="ss">{compositionLine(t.routineNames)}</div>
          {t.note && <div className="ss">{t.note}</div>}</div>
        <Icon name="chevronRight" className="chev" />
      </div>)}</div>
      : <div className="empty"><div className="ico"><Icon name="clipboard" /></div>Шаблонов пока нет. Сохраните свои рутины как шаблон и назначайте его подопечным.</div>)}
    <div style={{ height: 12 }} />
    {list && list.length >= limit
      ? <div className="dim small" style={{ lineHeight: 1.4 }}>Можно хранить до {limit} шаблонов. Удалите ненужный, чтобы сделать новый.</div>
      : <Button variant="primary" icon="plus" disabled={!list} onClick={make}>Новый шаблон</Button>}
    <div className="dim small" style={{ marginTop: 12, lineHeight: 1.4 }}>
      Подопечному без Telegram рутины добавляются прямо в его дневник. Подопечному из Telegram приходит предложение, он принимает его сам. {routinesCount(20)} в одном шаблоне, не больше.
    </div>
  </>
}
