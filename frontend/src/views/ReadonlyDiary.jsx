// The screens of a Telegram client's diary opened read only by the trainer (lib/managed-mode.js, kind readonly):
// Home, History, Stats and Measures, inside the app's own shell (header, tab bar, theme, language). The data is what
// the client opened, held by the store like any diary; what the client did not open shows as an empty section.
// Nothing here writes. Russian only, like the other trainer screens.
//
// The ordinary History, Stats and Measures screens are not used: each has a dozen entry points that change the
// diary (edit, repeat, delete, log), and a read only diary must have none. These are the trainer's read only
// components (views/TrainerClient.jsx) on the same document.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { diaryGrants, managedInfo } from '../lib/managed-mode.js'
import { clientView, workoutRows } from '../lib/trainer.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { History, Measures, Muscles, WorkoutCard } from './TrainerClient.jsx'
import Icon from '../components/Icon.jsx'

const CLOSED = 'Подопечный не открыл этот раздел.'
const Closed = () => <div className="empty" role="status"><div className="ico"><Icon name="lock" /></div>{CLOSED}</div>

function useView() {
  const S = useStore(s => s.S)
  return useMemo(() => clientView(S), [S])
}

function Header({ title, sub }) {
  return <div className="hdr"><div><h1>{title}</h1><div className="sub">{sub}</div></div></div>
}

export function ReadonlyHome() {
  const nav = useNavigate()
  const view = useView()
  const grants = diaryGrants()
  const name = managedInfo()?.name || 'подопечного'
  const rows = useMemo(() => workoutRows(view).slice(0, 3), [view])
  const weights = [...view.bodyweight].filter(b => b?.d).sort((a, b) => (a.d < b.d ? 1 : -1))
  const last = weights[0]
  return <>
    <Header title={'Профиль: ' + name} sub="Вы в режиме тренера · только чтение" />
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="tt" style={{ marginBottom: 6 }}>Последние тренировки</div>
      {!grants.history ? <Closed />
        : rows.length ? <div className="list">{rows.map(r => <WorkoutCard key={r.id + r.d} row={r} unit={view.unit} />)}</div>
          : <div className="dim small">Тренировок пока нет.</div>}
      {grants.history && <button className="btn" style={{ marginTop: 10 }} onClick={() => nav('/history')}>Вся история</button>}
    </div>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="tt" style={{ marginBottom: 6 }}>Вес</div>
      {!grants.measures ? <Closed />
        : last ? <div><strong>{fmtNum(last.w)} {view.unit}</strong> <span className="dim small">{fmtDate(last.d, true)}</span></div>
          : <div className="dim small">Взвешиваний пока нет.</div>}
      {grants.measures && <button className="btn" style={{ marginTop: 10 }} onClick={() => nav('/measurements')}>Вес и замеры</button>}
    </div>
    {grants.stats && <button className="btn" onClick={() => nav('/stats')}>Статистика по мышцам</button>}
  </>
}

export function ReadonlyHistory() {
  const view = useView()
  return <>
    <Header title="История" sub={'Дневник: ' + (managedInfo()?.name || '')} />
    {diaryGrants().history ? <History view={view} /> : <Closed />}
  </>
}

export function ReadonlyMeasures() {
  const view = useView()
  return <>
    <Header title="Вес и замеры" sub={'Дневник: ' + (managedInfo()?.name || '')} />
    {diaryGrants().measures ? <Measures view={view} /> : <Closed />}
  </>
}

export function ReadonlyStats() {
  const view = useView()
  return <>
    <Header title="Статистика" sub={'Дневник: ' + (managedInfo()?.name || '')} />
    {diaryGrants().stats ? <Muscles view={view} /> : <Closed />}
  </>
}
