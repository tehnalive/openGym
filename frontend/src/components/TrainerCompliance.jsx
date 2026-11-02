// Plan compliance on the trainer's screens (TG14): the "needs attention" card of the cabinet and the three tiles of a
// client's screen. The numbers come from the server (api/trainer-compliance.js); the client never sees them. Russian
// only, like the other trainer screens.
import { complianceTiles } from '../lib/trainer.js'
import Icon from './Icon.jsx'

/** "Нужно внимание": who went quiet or whose week fell. Nothing when there is nobody. */
export function AttentionCard({ items, onOpen }) {
  if (!items || !items.length) return null
  return <div className="card" style={{ marginBottom: 12 }} aria-label="Нужно внимание">
    <div className="tt" style={{ marginBottom: 6 }}>Нужно внимание</div>
    {items.map(x => <div key={x.linkId} className="row" role="button" tabIndex={0} style={{ padding: '6px 0', gap: 8, alignItems: 'center', cursor: 'pointer' }}
      onClick={() => onOpen(x.client)} onKeyDown={e => { if (e.key === 'Enter') onOpen(x.client) }}>
      <span style={{ color: 'var(--red)', display: 'inline-flex' }}><Icon name="bell" /></span>
      <span style={{ flex: 1, lineHeight: 1.35 }}>{x.text}</span>
      <Icon name="chevronRight" className="chev" />
    </div>)}
  </div>
}

/** "Соблюдение плана": 7, 30 and 90 days. `onSchedule` (optional) opens the schedule sheet when there is no schedule yet. */
export function ComplianceBlock({ compliance, onSchedule }) {
  if (!compliance) return null
  const tiles = complianceTiles(compliance)
  return <div className="card" style={{ marginBottom: 12 }} aria-label="Соблюдение плана">
    <div className="tt" style={{ marginBottom: 8 }}>Соблюдение плана</div>
    <div style={{ display: 'flex', gap: 8 }}>
      {tiles.map(t => <div key={t.key} role="group" aria-label={`${t.label}: ${t.pct}, ${t.sub}`}
        style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: 'var(--surface-3)' }}>
        <div className="dim small">{t.label}</div>
        <div className="tt" style={{ fontSize: 22, lineHeight: 1.2, color: t.color || 'var(--label)', fontVariantNumeric: 'tabular-nums' }}>{t.pct}</div>
        <div className="dim small" style={{ lineHeight: 1.3 }}>{t.sub}</div>
      </div>)}
    </div>
    {compliance.hasSchedule
      ? <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>Считаются дни из расписания, кроме пауз. Сегодня не входит, пока нет тренировки.</div>
      : <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>Задайте расписание, чтобы видеть соблюдение плана.</div>}
    {!compliance.hasSchedule && onSchedule && <button className="btn" style={{ marginTop: 8 }} onClick={onSchedule}>Задать расписание</button>}
  </div>
}
