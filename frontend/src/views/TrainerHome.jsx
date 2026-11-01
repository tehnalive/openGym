// The trainer's cabinet, stage 1 (TG14): the clients, and the way to invite one. Read only: nothing here
// writes to a client. Russian only, like the other Telegram-only screens.
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, grantsText, daysSince, ago, scheduleText, clientsOn, weekPlan, isoWeekday } from '../lib/trainer.js'
import { scheduleSheet } from '../components/TrainerSchedule.jsx'
import { sendLink, copyLink } from '../lib/plan-link.js'
import { takeManagedNotice } from '../lib/managed-mode.js'
import { openManagedDiary } from '../components/ManagedBar.jsx'
import { Button, Section, Row, Check, TextField, Segmented } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import ProfileAvatar from '../components/ProfileAvatar.jsx'

const toast = m => useUI.getState().toast(m)
// A Telegram client opens the read-only view; a client without Telegram opens as the ordinary app, in their name.
const openClient = (c, nav) => { if (c.managed) openManagedDiary(c.linkId, c.name); else nav('/trainer/' + c.linkId) }
const inviteText = 'Приглашаю вас в Жимолость: откройте ссылку, и я смогу смотреть ваш дневник тренировок. Вы сами решите, что мне открыть, и сможете закрыть доступ в любой момент.'
const when = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) }

export default function TrainerHome() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [clients, setClients] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null)   // the invitation just made: { link, expires }
  const [adding, setAdding] = useState(null)   // null, 'choose' (Telegram or not) or 'managed' (the form)
  const [form, setForm] = useState({ name: '', note: '', unit: 'kg', age: false })

  const load = useCallback(async () => {
    try {
      const m = await trainerApi.me()
      setMe(m)
      if (m.trainer.enabled) setClients((await trainerApi.clients()).clients)
    } catch (e) { setError(errorText(e)) }
  }, [])
  useEffect(() => { load() }, [load])
  // Sent back from a client's diary that could not be opened (managed-mode.js): said once.
  useEffect(() => { const n = takeManagedNotice(); if (n) toast(n) }, [])

  if (me && !me.trainer.enabled) return <Navigate to="/settings" replace />

  const addManaged = async () => {
    setBusy(true); setError('')
    try {
      const made = await trainerApi.addManaged({ name: form.name, note: form.note, unit: form.unit, ageConfirmed: form.age })
      toast('Подопечный добавлен')
      if (!openManagedDiary(made.linkId, made.name)) nav('/trainer/m/' + made.linkId)
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const invite = async () => {
    setAdding(null)
    setBusy(true); setError('')
    try {
      const made = await trainerApi.invite({})
      setFresh(made)
      const how = await sendLink(made.link, inviteText)
      if (how === 'copied') toast('Ссылка скопирована. Отправьте её подопечному.')
      await load()
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const revoke = async id => {
    try { await trainerApi.revokeInvite(id); setFresh(f => (f && f.id === id ? null : f)); toast('Приглашение отозвано'); await load() }
    catch (e) { toast(errorText(e)) }
  }
  const setSchedule = (linkId, schedule) => setClients(list => list.map(c => (c.linkId === linkId ? { ...c, schedule } : c)))
  const today = clients ? clientsOn(clients, isoWeekday()) : []
  const planned = !!clients && clients.some(c => c.schedule?.days?.length)
  const full = me && clients && clients.length >= me.trainer.limit
  const invites = me?.trainer.invites || []

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label="Настройки"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Кабинет тренера</h1>
        <div className="sub">{me ? `Подопечных: ${clients ? clients.length : me.trainer.clients} из ${me.trainer.limit}` : ' '}</div></div>
      <button className="iconbtn" onClick={() => nav('/library')} aria-label="Упражнения" title="Упражнения"><Icon name="dumbbell" /></button></div>

    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '0 0 12px', lineHeight: 1.4 }}>{error}</div>}

    {clients && clients.length > 0 && <>
      <div className="card" style={{ marginBottom: 12 }} aria-label="Сегодня">
        <div className="tt" style={{ marginBottom: 6 }}>Сегодня</div>
        {today.length
          ? today.map(x => <div key={x.linkId} className="row between" role="button" tabIndex={0} style={{ padding: '6px 0', gap: 10 }}
            onClick={() => openClient(x.client, nav)} onKeyDown={e => { if (e.key === 'Enter') openClient(x.client, nav) }}>
            <span><strong>{x.time || 'В любое время'}</strong> · {x.name}</span>{x.remind && <Icon name="bell" />}</div>)
          : <div className="dim small" style={{ lineHeight: 1.4 }}>{planned ? 'Сегодня никто не записан.' : 'Отметьте у подопечных, в какие дни они приходят, и здесь появится расписание.'}</div>}
      </div>
      {planned && <div className="card" style={{ marginBottom: 12 }} aria-label="Неделя">
        <div className="tt" style={{ marginBottom: 6 }}>Неделя</div>
        {weekPlan(clients).map(d => <div key={d.iso} className="row" style={{ padding: '4px 0', gap: 10, alignItems: 'baseline', fontWeight: d.iso === isoWeekday() ? 600 : 400 }}>
          <span style={{ width: 28 }}>{d.short}</span>
          <span className={d.clients.length ? '' : 'dim'} style={{ flex: 1 }}>{d.clients.length ? d.clients.map(x => (x.time ? x.time + ' ' : '') + x.name).join(', ') : '–'}</span></div>)}
      </div>}
    </>}

    {clients && (clients.length
      ? <div className="list">{clients.map(c => <div key={c.linkId} className="item" role="button" tabIndex={0}
        onClick={() => openClient(c, nav)} onKeyDown={e => { if (e.key === 'Enter') openClient(c, nav) }}>
        {/* The client's Telegram picture, else the initial on a grey disc; a client without Telegram has the initial only. */}
        <ProfileAvatar user={{ id: c.linkId, name: c.name, avatarUrl: c.avatarUrl }} size={38} neutral />
        <div className="grow"><div className="tt">{c.name}</div>
          <div className="ss">{(c.managed ? 'Без Telegram · ' : '') + (c.workouts === undefined ? 'Открыто: ' + grantsText(c.grants) : `${c.workouts} трен. · ${ago(daysSince(c.lastWorkout))}`)}</div>
          {scheduleText(c.schedule) && <div className="ss">{scheduleText(c.schedule)}</div>}</div>
        <button className="iconbtn" aria-label={'Расписание: ' + c.name} title="Расписание"
          onClick={e => { e.stopPropagation(); scheduleSheet({ linkId: c.linkId, name: c.name, schedule: c.schedule, onSaved: sc => setSchedule(c.linkId, sc) }) }} onKeyDown={e => e.stopPropagation()}><Icon name="calendar" /></button>
        {c.managed && <button className="iconbtn" aria-label={'Данные подопечного: ' + c.name} title="Данные, скачать, удалить"
          onClick={e => { e.stopPropagation(); nav('/trainer/m/' + c.linkId) }} onKeyDown={e => e.stopPropagation()}><Icon name="gear" /></button>}
        <Icon name="chevronRight" className="chev" />
      </div>)}</div>
      : <div className="empty"><div className="ico"><Icon name="personCircle" /></div>Подопечных пока нет. Пригласите первого по ссылке.</div>)}

    <div style={{ height: 12 }} />
    {full
      ? <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 12 }}>Сейчас доступно {me.trainer.limit} подопечных, позже появится возможность добавить больше.</div>
      : adding === 'managed'
        ? <div className="card">
          <div className="tt" style={{ marginBottom: 6 }}>Подопечный без Telegram</div>
          <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 8 }}>Вы будете вести его дневник сами в таком же приложении, как у вас: тренировки, программа, вес и замеры. Данные хранятся на сервере, вы можете скачать их и удалить в любой момент.</div>
          <TextField value={form.name} maxLength={40} placeholder="Имя" aria-label="Имя подопечного" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <div style={{ height: 8 }} />
          <TextField value={form.note} maxLength={200} placeholder="Заметка (необязательно)" aria-label="Заметка" onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
          <div style={{ height: 8 }} />
          <Segmented value={form.unit} onChange={unit => setForm(f => ({ ...f, unit }))} options={[{ value: 'kg', label: 'кг' }, { value: 'lb', label: 'фунты' }]} />
          <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'flex-start' }}>
            <Check checked={form.age} onChange={age => setForm(f => ({ ...f, age }))} label="Подопечному есть 18 лет и он согласен" />
            <span className="small" style={{ lineHeight: 1.4 }}>Подопечному есть 18 лет, он согласен, что я веду его дневник</span>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <Button variant="primary" disabled={busy || !form.age || !form.name.trim()} onClick={addManaged}>{busy ? 'Создаём…' : 'Добавить'}</Button>
            <Button onClick={() => setAdding(null)}>Отмена</Button>
          </div>
        </div>
        : adding === 'choose'
          ? <div className="card">
            <div className="tt" style={{ marginBottom: 8 }}>Как добавить подопечного?</div>
            <Button variant="primary" icon="share" disabled={busy || !me} onClick={invite}>Через Telegram</Button>
            <div className="dim small" style={{ margin: '4px 0 10px', lineHeight: 1.4 }}>Он откроет ссылку и сам решит, что вам показать.</div>
            <Button icon="personCircle" onClick={() => setAdding('managed')}>У него нет Telegram</Button>
            <div className="dim small" style={{ margin: '4px 0 10px', lineHeight: 1.4 }}>Вы ведёте его дневник сами.</div>
            <Button onClick={() => setAdding(null)}>Отмена</Button>
          </div>
          : <Button variant="primary" icon="plus" disabled={busy || !me} onClick={() => setAdding('choose')}>{busy ? 'Создаём…' : 'Добавить подопечного'}</Button>}

    {fresh && <div style={{ marginTop: 12 }}>
      <div className="dim small" style={{ marginBottom: 6, lineHeight: 1.4 }}>Ссылка работает один раз до {when(fresh.expires)}. Она ваша: отправляйте только тому, кого приглашаете.</div>
      <input readOnly value={fresh.link} aria-label="Ссылка-приглашение" onFocus={e => e.target.select()} style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />
      <Button onClick={async () => toast(await copyLink(fresh.link) ? 'Ссылка скопирована' : 'Не удалось скопировать')}>Скопировать ссылку</Button>
    </div>}

    {invites.length > 0 && <Section title="Ждут ответа" footer="Ссылку можно отозвать, пока её не приняли.">
      {invites.map(i => <Row key={i.id} icon="link" iconTint="var(--blue)" title={i.label || 'Приглашение'} subtitle={'до ' + when(i.expires)}>
        <button className="iconbtn" aria-label="Отозвать приглашение" onClick={() => revoke(i.id)}><Icon name="trash" /></button>
      </Row>)}
    </Section>}
  </>
}
