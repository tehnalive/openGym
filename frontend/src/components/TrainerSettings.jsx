// Settings card for trainer mode (TG14, stage 1): the trainer role, the way into the cabinet, and "my trainer".
// Shown to Telegram profiles only. Russian only, like the other Telegram-only screens.
import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { nav } from '../lib/nav.js'
import { trainerApi, errorText, grantsText } from '../lib/trainer.js'
import { Row, Section, Switch } from './ui.jsx'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)

export default function TrainerSettings() {
  const user = useStore(s => s.user)
  const [me, setMe] = useState(null)
  const [age, setAge] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => trainerApi.me().then(setMe).catch(() => setMe(false)), [])
  useEffect(() => { if (user) load() }, [user?.id, load])
  if (!user || me === false) return null
  if (!me) return null

  const trainer = me.trainer
  const toggle = async on => {
    setBusy(true)
    try {
      await trainerApi.setRole(on, age); setAge(false)
      // The tab bar shows the cabinet instead of the exercise library for a trainer (components/TabBar.jsx).
      useStore.setState(s => ({ user: s.user ? { ...s.user, trainer: on } : s.user }))
      await load()
    }
    catch (e) { toast(errorText(e)) }
    finally { setBusy(false) }
  }
  const endTrust = () => confirmSheet({
    title: 'Прекратить доступ тренера?',
    message: `${me.asClient.coachName} сразу перестанет видеть ваш дневник. Ваши данные останутся у вас. То, что тренер уже увидел, вернуть нельзя.`,
    confirmText: 'Прекратить', danger: true,
    onConfirm: async () => {
      try { await trainerApi.endLink(me.asClient.linkId); toast('Доступ закрыт'); await load() }
      catch (e) { toast(errorText(e)) }
    },
  })

  return <>
    {me.asClient && <Section title="Мой тренер" footer="Тренер только смотрит. Вы можете закрыть доступ в любой момент.">
      <Row icon="personCircle" iconTint="var(--blue)" title={me.asClient.coachName} subtitle={'Открыто: ' + grantsText(me.asClient.grants)} />
      <Row icon="signOut" iconTint="var(--red)" title="Прекратить доступ" danger onClick={endTrust} />
    </Section>}
    <Section title="Режим тренера"
      footer={trainer.enabled ? `Подопечных: ${trainer.clients} из ${trainer.limit}. Данные подопечных остаются у них.` : 'Тренер приглашает подопечных ссылкой и смотрит историю, замеры и статистику, которые они открыли. До 5 подопечных.'}>
      {trainer.enabled
        ? <>
          <Row icon="person" iconTint="var(--green)" title="Кабинет тренера" accessory="chevron" onClick={() => nav('/trainer')} />
          <Row icon="personCircle" iconTint="var(--grey)" title="Я тренер"><Switch checked disabled={busy} aria-label="Я тренер" onChange={() => toggle(false)} /></Row>
        </>
        : <>
          <label className="lrow" style={{ gap: 10 }}>
            <input type="checkbox" checked={age} onChange={e => setAge(e.target.checked)} />
            <span className="lrow-m"><span className="lrow-t">Мне есть 18 лет</span></span>
          </label>
          <Row icon="personCircle" iconTint="var(--grey)" title="Я тренер"><Switch checked={false} disabled={busy || !age} aria-label="Я тренер" onChange={() => toggle(true)} /></Row>
        </>}
    </Section>
  </>
}
