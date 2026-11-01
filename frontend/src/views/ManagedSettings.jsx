// The only setting of a client's diary opened by the trainer (lib/managed-mode.js): kilograms or pounds.
// The account, sign-in, notifications, Coach, sharing and the rest are the client's own and are not here.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { managedInfo } from '../lib/managed-mode.js'
import { Segmented } from '../components/ui.jsx'
import { menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'

export default function ManagedSettings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const setUnit = useStore(s => s.setUnit)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  const switchUnit = v => {
    if (v === unit) return
    menuSheet({
      title: 'Перейти на ' + (v === 'kg' ? 'килограммы' : 'фунты') + '?',
      subtitle: 'Все веса в дневнике хранятся в «' + unit + '». Пересчитать числа или оставить их и поменять только подпись?',
      items: [
        { icon: 'calculator', label: 'Пересчитать числа', onClick: () => setUnit(v) },
        { icon: 'pencil', label: 'Оставить числа, поменять подпись', onClick: () => setUnit(v, { convert: false }) },
      ],
    })
  }
  return <>
    <div className="hdr"><button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label="Назад"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Настройки дневника</h1>
        <div className="sub">{managedInfo()?.name || 'Подопечный'}</div></div></div>
    <div className="card">
      <div className="tt" style={{ marginBottom: 8 }}>Единицы веса</div>
      <Segmented value={unit} onChange={switchUnit} options={[{ value: 'kg', label: 'кг' }, { value: 'lb', label: 'фунты' }]} />
    </div>
    <div className="dim small" style={{ marginTop: 12, lineHeight: 1.4 }}>
      Остальные настройки принадлежат самому подопечному и здесь недоступны. Дневник хранится на сервере; скачать его или удалить можно в кабинете тренера, на карточке подопечного.
    </div>
  </>
}
