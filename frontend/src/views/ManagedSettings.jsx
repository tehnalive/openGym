// The settings of a client's diary opened by the trainer (lib/managed-mode.js): kilograms or pounds, and the data
// of the client (a copy to download, deleting the diary). The account, sign-in, notifications, Coach, sharing and the
// rest are the client's own and are not here. Russian only, like the other trainer screens.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { managedInfo, leaveManagedMode } from '../lib/managed-mode.js'
import { trainerApi, errorText } from '../lib/trainer.js'
import { exportFile, saveFile } from '../lib/trainer-managed.js'
import { copyLink } from '../lib/plan-link.js'
import { Segmented } from '../components/ui.jsx'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'

const toast = m => useUI.getState().toast(m)

export default function ManagedSettings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const setUnit = useStore(s => s.setUnit)
  const info = managedInfo()
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
  const exportData = async () => {
    try {
      const file = exportFile(await trainerApi.managedExport(info.id))
      if (saveFile(file.name, file.text)) toast('Файл сохранён')
      else toast(await copyLink(file.text) ? 'Файл не сохранился, данные скопированы текстом' : 'Не удалось выгрузить данные')
    } catch (e) { toast(errorText(e)) }
  }
  const removeClient = () => confirmSheet({
    title: 'Удалить подопечного?', message: `Дневник «${info.name}» будет стёрт без возврата. Если нужна копия, сначала скачайте данные.`,
    confirmText: 'Удалить навсегда', danger: true,
    onConfirm: async () => {
      try {
        await trainerApi.deleteManaged(info.id)
        // This diary's own copy on the device (the clear is scoped to it: managed-mode.js), then back to the cabinet.
        try { localStorage.clear() } catch { /* nothing to clear */ }
        leaveManagedMode('Подопечный удалён')
      } catch (e) { toast(errorText(e)) }
    },
  })
  return <>
    <div className="hdr"><button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label="Назад"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Настройки</h1>
        <div className="sub">Режим тренера · дневник: {info?.name || 'подопечного'}</div></div></div>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="tt" style={{ marginBottom: 8 }}>Единицы веса</div>
      <Segmented value={unit} onChange={switchUnit} options={[{ value: 'kg', label: 'кг' }, { value: 'lb', label: 'фунты' }]} />
    </div>
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="tt" style={{ marginBottom: 4 }}>Данные подопечного</div>
      <div className="dim small" style={{ lineHeight: 1.4, marginBottom: 10 }}>
        У подопечного нет Telegram, поэтому дневник хранится на сервере под вашей ответственностью. Скачайте копию в любой момент; когда у подопечного появится свой аккаунт, он загрузит её в приложении: Настройки → Импорт копии.
      </div>
      <button className="btn" style={{ marginBottom: 8 }} onClick={exportData}>Скачать данные подопечного</button>
      <button className="btn danger" onClick={removeClient}>Удалить подопечного</button>
    </div>
    <div className="dim small" style={{ lineHeight: 1.4 }}>
      Остальные настройки принадлежат самому подопечному и здесь недоступны.
    </div>
  </>
}
