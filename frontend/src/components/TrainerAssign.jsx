// Choosing the clients who get a template or a copy of routines (TG14, section 17). Used by the template card in the cabinet
// and by the routines block of a client's diary. Russian only, like the other trainer screens.
import { useEffect, useState } from 'react'
import { trainerApi, errorText } from '../lib/trainer.js'
import { assignSummary, allFailed } from '../lib/trainer-templates.js'
import { Button, Check } from './ui.jsx'

/** The trainer's clients with an active link (a client on pause is one; the archived come separately and are never offered), loaded once; `exclude` is a link id left out (the client the routines come from). */
export function useClients(exclude) {
  const [state, setState] = useState({ clients: null, error: '' })
  useEffect(() => {
    let live = true
    trainerApi.clients()
      .then(r => { if (live) setState({ clients: (r.clients || []).filter(c => c.linkId !== exclude), error: '' }) })
      .catch(e => { if (live) setState({ clients: null, error: errorText(e) }) })
    return () => { live = false }
  }, [exclude])
  return state
}

/** Check rows, one per client. A client who signed in with Telegram decides for themselves, and the row says so. */
export function ClientPicker({ clients, picked, onToggle }) {
  return <div style={{ marginBottom: 12 }}>
    {clients.map(c => {
      const on = picked.includes(c.linkId)
      return <div key={c.linkId} className="row" role="presentation" style={{ padding: '8px 2px', gap: 12, alignItems: 'center' }}
        onClick={() => onToggle(c.linkId)}>
        {/* The click on the box reaches the row, which toggles: one handler, not two. */}
        <Check checked={on} onChange={() => {}} label={c.name} />
        <div style={{ flex: 1 }}>
          <div className="tt" style={{ fontSize: 15 }}>{c.name}{c.pause && <span className="small dim" style={{ fontWeight: 400 }}> · на паузе</span>}</div>
          <div className="small dim" style={{ lineHeight: 1.35 }}>{c.managed ? 'Без Telegram: рутины добавятся в его дневник' : 'Придёт предложение, подопечный примет сам'}</div>
        </div>
      </div>
    })}
  </div>
}

/**
 * The step "to whom": the list of clients, the button, and the outcome. `send(linkIds)` resolves with the server's
 * `results`. A refusal of the whole request, or every client failing, keeps the choice for another try.
 */
export default function AssignPanel({ send, exclude, sendLabel = 'Назначить', empty = 'Других подопечных пока нет.', onDone }) {
  const { clients, error: loadError } = useClients(exclude)
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]))
  const go = async () => {
    setBusy(true); setError('')
    try {
      const r = await send(picked)
      const text = assignSummary(r.results, clients)
      if (allFailed(r.results)) setError(text)
      else { setDone(text); onDone?.(r.results) }
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  if (done) return <div role="status" style={{ lineHeight: 1.45, marginBottom: 12 }}>{done}</div>
  if (loadError) return <div role="alert" className="small" style={{ color: 'var(--red)', lineHeight: 1.4 }}>{loadError}</div>
  if (!clients) return <div className="dim small">Загружаем подопечных…</div>
  if (!clients.length) return <div className="dim small" style={{ lineHeight: 1.4 }}>{empty}</div>
  return <>
    <ClientPicker clients={clients} picked={picked} onToggle={toggle} />
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>}
    <Button variant="primary" disabled={!picked.length || busy} onClick={go}>{busy ? 'Отправляем…' : sendLabel}</Button>
  </>
}
