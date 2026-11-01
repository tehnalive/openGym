// The data of a client without Telegram (TG14, managed clients): the note, a copy to download, deleting the
// diary. The diary itself is the ordinary app, opened in the client's name from the cabinet
// (lib/managed-mode.js); nothing is recorded here. Russian only.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { trainerApi, errorText, clientView } from '../lib/trainer.js'
import { exportFile, saveFile } from '../lib/trainer-managed.js'
import { openManagedDiary } from '../components/ManagedBar.jsx'
import { copyLink } from '../lib/plan-link.js'
import Icon from '../components/Icon.jsx'
import { confirmSheet } from '../sheets.jsx'

const toast = m => useUI.getState().toast(m)

export default function TrainerManaged() {
  const { linkId } = useParams()
  const nav = useNavigate()
  const [res, setRes] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let gone = false
    setRes(null); setError('')
    trainerApi.managed(linkId).then(r => { if (!gone) setRes(r) }).catch(e => { if (!gone) setError(errorText(e)) })
    return () => { gone = true }
  }, [linkId])
  const back = () => nav('/trainer')
  const counts = res ? (() => { const v = clientView(res.data); return `${v.workouts.length} трен., ${v.bodyweight.length} взвеш., ${v.measurements.length} замеров` })() : ''

  const exportData = async () => {
    try {
      const file = exportFile(await trainerApi.managedExport(linkId))
      if (!saveFile(file.name, file.text)) throw new Error('save')
      toast('Файл сохранён')
    } catch {
      // Some in-app browsers cannot save a file: the same text goes to the clipboard instead.
      try {
        const file = exportFile(await trainerApi.managedExport(linkId))
        toast(await copyLink(file.text) ? 'Файл не сохранился, данные скопированы текстом' : 'Не удалось выгрузить данные')
      } catch (e) { toast(errorText(e)) }
    }
  }
  const removeClient = () => confirmSheet({
    title: 'Удалить подопечного?', message: `Дневник «${res.name}» будет стёрт без возврата. Если нужна копия, сначала скачайте данные.`,
    confirmText: 'Удалить навсегда', danger: true,
    onConfirm: async () => {
      try { await trainerApi.deleteManaged(linkId); toast('Подопечный удалён'); back() } catch (e) { toast(errorText(e)) }
    },
  })

  return <>
    <div className="hdr"><button className="iconbtn" data-back="/trainer" onClick={back} aria-label="Подопечные"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{res?.name || 'Подопечный'}</h1>
        <div className="sub">Данные подопечного</div></div></div>
    {error && <>
      <div role="alert" className="small" style={{ color: 'var(--red)', marginBottom: 12, lineHeight: 1.4 }}>{error}</div>
      <button className="btn" onClick={back}>К списку</button>
    </>}
    {res && <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="tt">{res.name}</div>
        {res.note && <div className="dim small" style={{ lineHeight: 1.4, marginTop: 4 }}>{res.note}</div>}
        <div className="dim small" style={{ lineHeight: 1.4, marginTop: 4 }}>В дневнике: {counts}</div>
      </div>
      <button className="btn primary" style={{ marginBottom: 8 }} onClick={() => openManagedDiary(res.linkId || linkId, res.name)}>Открыть дневник</button>
      <div className="dim small" style={{ margin: '14px 0 8px', lineHeight: 1.4 }}>
        У подопечного нет Telegram, поэтому дневник хранится на сервере под вашей ответственностью. Вы можете скачать его в любой момент и удалить целиком. Когда у подопечного появится свой аккаунт, он загрузит этот файл в приложении: Настройки → Импорт копии.
      </div>
      <button className="btn" style={{ marginBottom: 8 }} onClick={exportData}>Скачать данные подопечного</button>
      <button className="btn danger" onClick={removeClient}>Удалить подопечного</button>
    </>}
  </>
}
