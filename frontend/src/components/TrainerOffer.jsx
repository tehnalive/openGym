// A program the trainer handed to a client who signed in with Telegram (TG14, section 17). The server only keeps the offer;
// the routines go into the client's own diary here, by the app's ordinary path (update -> PUT /api/data), marked
// `fromOffer` so adding is idempotent. Order: add first, tell the server after. If telling fails the routines are in and the
// offer is closed silently on the next open (the mark is seen); if adding fails nothing was told. Neither loses or doubles.
// Russian only, like the other Telegram-only screens.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { nav } from '../lib/nav.js'
import { trainerApi, errorText } from '../lib/trainer.js'
import { addOfferToState, offerAlreadyAdded, rememberOfferAdded, compositionLine, exercisesCount } from '../lib/trainer-templates.js'
import { Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/** Put the offer in the diary (once) and close it on the server. Resolves to { added, dropped, closed }. Exported for the tests. */
export async function acceptOffer(offer) {
  const store = useStore.getState()
  let added = 0, dropped = 0
  if (!offerAlreadyAdded(store.S, offer.id)) {
    store.update(s => { const r = addOfferToState(s, offer); added = r.added; dropped = r.dropped })
    rememberOfferAdded(offer.id)
  }
  let closed = true
  try { await trainerApi.acceptOffer(offer.id) } catch (e) { closed = e?.status === 404 }
  return { added, dropped, closed }
}

export async function declineOffer(offer) {
  try { await trainerApi.declineOffer(offer.id); return true } catch (e) { if (e?.status === 404) return true; throw e }
}

export const trainerOfferSheet = (coachName, offers) =>
  ui().openSheet(close => <TrainerOffer coachName={coachName} offers={offers} close={close} />, { locked: false })

/** The offers one after another: each is added or declined, then the next shows; "later" closes the sheet. */
export function TrainerOffer({ coachName, offers, close }) {
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const offer = offers[at]
  const next = () => { if (at + 1 < offers.length) { setAt(at + 1); setBusy(false) } else close() }
  const ex = (offer.routines || []).reduce((n, r) => n + (r.ex || []).length, 0)
  const add = async () => {
    setBusy(true); setError('')
    try {
      const r = await acceptOffer(offer)
      toast(!r.closed ? 'Добавлено в ваш план. Предложение закроется при следующем открытии.' : r.added ? 'Добавлено в ваш план' : 'Это уже есть в вашем плане')
      const last = at + 1 >= offers.length
      next()
      if (last) nav('/plan')
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  const decline = async () => {
    setBusy(true); setError('')
    try { await declineOffer(offer); toast('Отклонено'); next() }
    catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <>
    <h3>{coachName} прислал программу «{offer.templateName || 'Программа'}»</h3>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>{compositionLine((offer.routines || []).map(r => r.name), 8)} · {exercisesCount(ex)}</div>
    <div style={{ marginBottom: 14 }}>
      {(offer.routines || []).slice(0, 8).map((r, i) => <div key={r.id || i} className="row between small" style={{ padding: '4px 0', gap: 12 }}>
        <span>{r.name}</span><span className="dim">{exercisesCount((r.ex || []).length)}</span>
      </div>)}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>Рутины добавятся в ваш план как новые. Ничего из того, что у вас уже есть, не изменится.</div>
    {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>}
    <Button variant="primary" disabled={busy} onClick={add}>Добавить в мой план</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={decline}>Отклонить</Button>
    <div style={{ height: 4 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>Решу позже</Button>
  </>
}

/** On opening the app, once the client is signed in through Telegram: the offers waiting from the trainer. One already in
 *  the diary (the answer to the server was lost) is closed quietly; the others open as a sheet, one after another. */
export default function TrainerOfferGate({ blocked }) {
  const done = useRef(false)
  useEffect(() => {
    if (blocked || done.current) return
    done.current = true
    ;(async () => {
      let me
      try { me = await trainerApi.me() } catch { return }
      const offers = me?.asClient?.offers || []
      const S = useStore.getState().S
      const open = []
      for (const o of offers) {
        if (offerAlreadyAdded(S, o.id)) { trainerApi.acceptOffer(o.id).catch(() => {}); continue }
        open.push(o)
      }
      if (open.length) trainerOfferSheet(me.asClient.coachName, open)
    })()
  }, [blocked])
  return null
}
