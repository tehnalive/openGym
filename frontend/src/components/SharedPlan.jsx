// Sending a training plan to a friend through Telegram, and opening one that was sent (TG19).
// Text is Russian only, like the other Telegram-only screens (App.jsx entry gate, first-run setup).
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { nav } from '../lib/nav.js'
import { buildPlanBundle, parsePlan, mergePlan } from '../lib/plan-share.js'
import {
  takePendingShare, alreadyAdded, addSharedPlan, rememberAdded, sendLink, copyLink,
  exercisesWord, routinesWord, scheduleDays,
} from '../lib/plan-link.js'
import { Button, Switch } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/* ------------------------------- sending ------------------------------- */

const shareText = name => name
  ? `Моя программа тренировок «${name}» в Жимолости. Откройте ссылку и добавьте её себе.`
  : 'Моя программа тренировок в Жимолости. Откройте ссылку и добавьте её себе.'

const daysLeft = iso => Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86400000))

export const sharePlanSheet = () => ui().openSheet(close => <SharePlan close={close} />)

function SharePlan({ close }) {
  const [share, setShare] = useState(null)   // { id, link, expires }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = 'Моя программа'

  const send = async link => {
    const how = await sendLink(link, shareText(name))
    if (how === 'copied') toast('Ссылка скопирована. Отправьте её другу.')
    else if (how === 'failed') setError('Не удалось открыть Telegram и скопировать ссылку. Выделите ссылку ниже и скопируйте вручную.')
  }
  const create = async () => {
    setBusy(true); setError('')
    try {
      const bundle = buildPlanBundle(useStore.getState().S, name)
      const made = await api('/api/shares', { method: 'POST', body: JSON.stringify({ bundle }) })
      if (!made?.link) throw new Error('bad-response')
      setShare(made)
      await send(made.link)
    } catch (e) {
      setError(e?.status === 429 ? 'Слишком много ссылок за час. Попробуйте позже.'
        : e?.code === 'share-limit' ? 'Слишком много активных ссылок. Отзовите одну из прежних.'
        : e?.status === 400 ? 'В программе пока нет упражнений.'
        : 'Не удалось создать ссылку. Проверьте соединение и повторите.')
    } finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true); setError('')
    try {
      await api('/api/shares/' + share.id, { method: 'DELETE' })
      toast('Ссылка отозвана')
      close()
    } catch (e) {
      if (e?.status === 404) { toast('Ссылка уже не действует'); close() }
      else setError('Не удалось отозвать ссылку. Повторите.')
    } finally { setBusy(false) }
  }

  return <>
    <h3>Поделиться программой</h3>
    {!share && <>
      <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
        Друг получит ссылку, которая откроет приложение с вашей программой и кнопкой «Добавить в мои программы». Тренировки, вес и настройки не передаются.
      </div>
      <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
        Ссылку сможет открыть любой, у кого она окажется, в том числе если ему перешлют сообщение. Ваше имя в Telegram будет видно.
        Ссылка действует 30 дней, её можно отозвать здесь же.
      </div>
      <Button variant="primary" disabled={busy} onClick={create}>{busy ? 'Создаём…' : 'Создать ссылку и отправить'}</Button>
    </>}
    {share && <>
      <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
        Ссылка готова и действует ещё {daysLeft(share.expires)} дн. Любой, у кого она есть, увидит программу.
      </div>
      <input readOnly value={share.link} aria-label="Ссылка на программу" onFocus={e => e.target.select()}
        style={{ width: '100%', marginBottom: 14, boxSizing: 'border-box' }} />
      <Button variant="primary" icon="share" onClick={() => send(share.link)}>Отправить ещё раз</Button>
      <div style={{ height: 8 }} />
      <Button onClick={async () => toast(await copyLink(share.link) ? 'Ссылка скопирована' : 'Не удалось скопировать')}>Скопировать ссылку</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" disabled={busy} onClick={revoke}>Отозвать ссылку</Button>
    </>}
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginTop: 12, lineHeight: 1.4 }}>{error}</div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>Закрыть</Button>
  </>
}

/* ------------------------------- receiving ------------------------------- */

export const sharedPlanSheet = (share, bundle) =>
  ui().openSheet(close => <SharedPlan share={share} bundle={bundle} close={close} />)

function SharedPlan({ share, bundle, close }) {
  const [schedule, setSchedule] = useState(false)
  const added = alreadyAdded(useStore.getState().S, share.id)
  const days = scheduleDays(bundle.week)
  const add = () => {
    useStore.getState().update(s => { addSharedPlan(s, bundle, share.id, mergePlan, { schedule }) })
    rememberAdded(share.id)
    close()
    toast(`Добавлено: ${routinesWord(bundle.routineCount)}`)
    nav('/plan')
  }
  return <>
    <h3>Тренировка от {share.author || 'друга'}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>
      {bundle.name ? `«${bundle.name}» · ` : ''}{exercisesWord(bundle.exerciseCount)} · {routinesWord(bundle.routineCount)}
      {days ? ` · дни: ${days}` : ''}
    </div>
    <div style={{ marginBottom: 14 }}>
      {bundle.routines.slice(0, 8).map((r, i) => <div key={i} className="row between small" style={{ padding: '4px 0', gap: 12 }}>
        <span>{r.name || 'Тренировка'}</span><span className="dim">{exercisesWord(r.ex.length)}</span>
      </div>)}
    </div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      Не все упражнения есть в вашей библиотеке: пропущено {bundle.dropped}.
    </div>}
    {added
      ? <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>Эта программа уже добавлена в ваши. Повторно она не добавляется.</div>
      : <>
        <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>Тренировки добавятся как новые. Ничего из того, что у вас уже есть, не изменится.</div>
        {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
          <div><div className="tt" style={{ fontSize: 15 }}>Взять расписание по дням</div><div className="small dim">Заменит ваши назначения на дни недели.</div></div>
          <Switch checked={schedule} onChange={setSchedule} />
        </div>}
        <Button variant="primary" onClick={add}>Добавить в мои программы</Button>
        <div style={{ height: 8 }} />
      </>}
    <Button variant="ghost" className="dim" onClick={close}>Закрыть</Button>
  </>
}

/** Opens the sheet for the plan a launch link named, once the app is ready to show it. Not
 *  `blocked` means signed in and past any first-run setup; until then the id simply waits. */
export default function SharedPlanGate({ blocked }) {
  useEffect(() => {
    if (blocked) return
    const id = takePendingShare()
    if (!id) return
    ;(async () => {
      try {
        const share = await api('/api/shares/' + id)
        const bundle = parsePlan(share.bundle, useStore.getState().S.unit || 'kg')
        if (!bundle.exerciseCount) throw Object.assign(new Error('empty'), { code: 'empty' })
        sharedPlanSheet({ id, author: share.author }, bundle)
      } catch (e) {
        toast(e?.status === 404 ? 'Эта ссылка отозвана или устарела.'
          : e?.status === 429 ? 'Слишком много запросов. Откройте ссылку чуть позже.'
          : e?.code === 'empty' || e?.code === 'not-plan' ? 'В ссылке нет программы, которую можно добавить.'
          : 'Не удалось открыть программу. Проверьте соединение и откройте ссылку снова.')
      }
    })()
  }, [blocked])
  return null
}
