// A trainer's invitation, as the client sees it (TG14, stage 1). The launch link `startapp=t_<token>`
// is only a key to look up: the server decides who may accept what (lib/plan-link.js, api/trainer.js).
// Text is Russian only, like the other Telegram-only screens (SharedPlan.jsx).
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { takePendingTrainer } from '../lib/plan-link.js'
import { trainerApi, errorText, canConsent, normalizeGrants, SECTIONS } from '../lib/trainer.js'
import { Button, Switch } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

export const trainerConsentSheet = (token, preview) =>
  ui().openSheet(close => <TrainerConsent token={token} preview={preview} close={close} />, { locked: false })

export function TrainerConsent({ token, preview, close, onAccepted }) {
  const [age, setAge] = useState(false)
  const [grants, setGrants] = useState({ history: true, measures: true, stats: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, on) => setGrants(g => normalizeGrants({ ...g, [key]: on, ...(key === 'history' && !on ? { stats: false } : {}) }))
  const ready = canConsent({ age, grants })
  const accept = async () => {
    if (!ready || busy) return
    setBusy(true); setError('')
    try {
      await trainerApi.accept(token, true, grants)
      close()
      toast(`Доступ открыт: ${preview.coachName}`)
      onAccepted?.()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }
  return <>
    <h3>{preview.coachName} просит доступ к вашему дневнику</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      Тренер будет только смотреть. Менять ваши записи он не сможет. Вы выбираете, что открыть:
    </div>
    <div style={{ marginBottom: 12 }}>
      {SECTIONS.map(s => {
        const locked = s.key === 'stats' && !grants.history
        return <div key={s.key} className="row between" style={{ padding: '8px 2px', gap: 12, opacity: locked ? 0.5 : 1 }}>
          <div><div className="tt" style={{ fontSize: 15 }}>{s.label}</div>
            {s.key === 'stats' && <div className="small dim">Считается по истории тренировок</div>}</div>
          <Switch checked={!!grants[s.key]} disabled={locked} aria-label={s.label} onChange={on => set(s.key, on)} />
        </div>
      })}
    </div>
    <div className="small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      Не увидит никогда: фото прогресса, чат с AI-коучем, настройки, ваш Telegram ID.
    </div>
    <label className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
      <input type="checkbox" checked={age} onChange={e => setAge(e.target.checked)} style={{ marginTop: 3 }} />
      <span className="tt" style={{ fontSize: 15 }}>Мне есть 18 лет</span>
    </label>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      Прекратить доступ можно в любой момент: Настройки → Мой тренер. Ваши данные остаются у вас, но то, что тренер уже увидел, вернуть нельзя.
      Приложение ведёт дневник и не заменяет врача; решения о нагрузке вы принимаете сами.
    </div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>}
    <Button variant="primary" disabled={!ready || busy} onClick={accept}>{busy ? 'Открываем…' : 'Доверить'}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>Отклонить</Button>
  </>
}

/** Opens the consent sheet for the invitation a launch link carried, once the app is past sign-in
 *  and first-run setup (`blocked` false). Declining is closing the sheet: nothing is sent. */
export default function TrainerConsentGate({ blocked }) {
  useEffect(() => {
    if (blocked) return
    const token = takePendingTrainer()
    if (!token) return
    ;(async () => {
      try {
        const preview = await trainerApi.preview(token)
        trainerConsentSheet(token, preview)
      } catch (e) {
        toast(e?.status === 404 || e?.status === 409 || e?.status === 410 ? errorText(e)
          : e?.status === 429 ? 'Слишком много запросов. Откройте ссылку чуть позже.'
          : 'Не удалось открыть приглашение. Проверьте соединение и откройте ссылку снова.')
      }
    })()
  }, [blocked])
  return null
}
