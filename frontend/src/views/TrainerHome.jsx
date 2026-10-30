// The trainer's cabinet, stage 1 (TG14): the clients, and the way to invite one. Read only: nothing here
// writes to a client. Russian only, like the other Telegram-only screens.
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, grantsText, daysSince, ago } from '../lib/trainer.js'
import { sendLink, copyLink } from '../lib/plan-link.js'
import { Button, Section, Row } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const toast = m => useUI.getState().toast(m)
const inviteText = 'Приглашаю вас в Жимолость: откройте ссылку, и я смогу смотреть ваш дневник тренировок. Вы сами решите, что мне открыть, и сможете закрыть доступ в любой момент.'
const when = iso => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) }

export default function TrainerHome() {
  const nav = useNavigate()
  const [me, setMe] = useState(null)
  const [clients, setClients] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState(null)   // the invitation just made: { link, expires }

  const load = useCallback(async () => {
    try {
      const m = await trainerApi.me()
      setMe(m)
      if (m.trainer.enabled) setClients((await trainerApi.clients()).clients)
    } catch (e) { setError(errorText(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  if (me && !me.trainer.enabled) return <Navigate to="/settings" replace />

  const invite = async () => {
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
  const full = me && clients && clients.length >= me.trainer.limit
  const invites = me?.trainer.invites || []

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label="Настройки"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Кабинет тренера</h1>
        <div className="sub">{me ? `Подопечных: ${clients ? clients.length : me.trainer.clients} из ${me.trainer.limit}` : ' '}</div></div></div>

    {error && <div role="alert" className="small" style={{ color: 'var(--red)', margin: '0 0 12px', lineHeight: 1.4 }}>{error}</div>}

    {clients && (clients.length
      ? <div className="list">{clients.map(c => <div key={c.linkId} className="item" role="button" tabIndex={0}
        onClick={() => nav('/trainer/' + c.linkId)} onKeyDown={e => { if (e.key === 'Enter') nav('/trainer/' + c.linkId) }}>
        <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8 }}><Icon name="personCircle" /></span>
        <div className="grow"><div className="tt">{c.name}</div>
          <div className="ss">{c.workouts === undefined ? 'Открыто: ' + grantsText(c.grants) : `${c.workouts} трен. · ${ago(daysSince(c.lastWorkout))}`}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}</div>
      : <div className="empty"><div className="ico"><Icon name="personCircle" /></div>Подопечных пока нет. Пригласите первого по ссылке.</div>)}

    <div style={{ height: 12 }} />
    {full
      ? <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 12 }}>Сейчас доступно {me.trainer.limit} подопечных, позже появится возможность добавить больше.</div>
      : <Button variant="primary" icon="share" disabled={busy || !me} onClick={invite}>{busy ? 'Создаём…' : 'Пригласить подопечного'}</Button>}

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
