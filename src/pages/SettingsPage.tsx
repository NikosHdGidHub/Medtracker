import { useState } from 'react'
import type { User } from 'firebase/auth'
import type { Settings } from '../domain/models'
import { download } from '../domain/export'
import { notify } from '../domain/reminders'
import type { Tracker } from '../services/tracker'
import { Dialog, Failure, Field, Header } from '../components/common'
import { useAction } from '../components/useAction'

export function SettingsPage({ settings, user, tracker, editable, logout }: {
  settings: Settings; user: User; tracker: Tracker; editable: boolean; logout: () => Promise<void>
}) {
  const action = useAction(editable)
  const signout = useAction()
  const [message, setMessage] = useState('')
  const [deletion, setDeletion] = useState(false)
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const zones = Intl.supportedValuesOf('timeZone')
  return <>
    <Header title="Настройки" />
    <form className="panel stack" key={settings.calendarId} onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setMessage('')
      void action.run(async () => {
        await tracker.saveSettings({
          zone: String(data.get('zone')).trim(), boundary: String(data.get('boundary')),
          reminders: data.has('reminders'), privateText: data.has('privateText'),
          repeatMinutes: Number(data.get('repeatMinutes')), repeats: Number(data.get('repeats')),
        }, settings.calendarId)
        setMessage('Настройки сохранены.')
      })
    }}>
      <h2>Логический день</h2>
      <div className="data-grid">
        <Field label="Часовой пояс (IANA)"><input className="control" name="zone" list="timezones" defaultValue={settings.zone} required maxLength={100} /></Field>
        <datalist id="timezones"><option value="UTC" />{zones.map(zone => <option key={zone} value={zone} />)}</datalist>
        <Field label="Начало логического дня"><input className="control" name="boundary" type="time" defaultValue={settings.boundary} required /></Field>
      </div>
      <p className="muted">Смена часового пояса или границы дня применяется к будущим приёмам. Сохранённые отметки остаются на прежних датах.</p>
      <h2>Напоминания</h2>
      <label className="check-row"><input type="checkbox" name="reminders" defaultChecked={settings.reminders} /> Напоминать о неподтверждённых приёмах</label>
      <label className="check-row"><input type="checkbox" name="privateText" defaultChecked={settings.privateText} /> Скрывать название лекарства в уведомлениях</label>
      <div className="data-grid">
        <Field label="Интервал повтора, минут"><input className="control" type="number" name="repeatMinutes" min={5} max={60} defaultValue={settings.repeatMinutes} required /></Field>
        <Field label="Повторов после первого уведомления"><input className="control" type="number" name="repeats" min={0} max={5} defaultValue={settings.repeats} required /></Field>
      </div>
      <p className="muted">Напоминания работают, пока сайт выполняется в браузере. При закрытии сайта, остановке вкладки или блокировке устройства доставка не гарантируется.</p>
      <div className="row-actions">
        <button className="btn secondary" type="button" disabled={permission === 'unsupported' || permission === 'granted'}
          onClick={() => void Notification.requestPermission().then(setPermission).catch(() => setMessage('Запрос разрешения недоступен.'))}>Запросить разрешение</button>
        <button className="btn secondary" type="button" onClick={() => void notify('Medtracker', 'Тестовое уведомление Medtracker.', 'medtracker-test', setMessage)}>Тестовое уведомление</button>
      </div>
      <p className="small muted">{permission === 'granted' ? 'Разрешены системные уведомления.' : 'При отсутствии разрешения сообщение появится внутри приложения.'}</p>
      <button className="btn align-start" type="submit" disabled={action.busy || !editable}>Сохранить настройки</button>
      {message && <p role="status">{message}</p>}
      {action.error && <Failure>{action.error}</Failure>}
    </form>
    <section className="panel stack">
      <h2>Профиль и данные</h2>
      <p>{user.displayName || 'Пользователь'} · {user.email}</p>
      <p className="muted small uid">UID {user.uid}</p>
      <p className="muted">JSON содержит ваши записи и журналы. Храните файл в защищённом месте.</p>
      <div className="row-actions">
        <button className="btn secondary" disabled={action.busy || !editable} onClick={() => void action.run(async () => {
          const backup = await tracker.exportAll()
          download('medtracker-backup.json', JSON.stringify(backup, null, 2), 'application/json;charset=utf-8')
        })}>Экспорт JSON</button>
        <button className="btn secondary" onClick={() => setDeletion(true)}>Удаление данных</button>
        <button className="btn secondary" disabled={signout.busy} onClick={() => void signout.run(logout, false)}>Выйти</button>
      </div>
      {signout.error && <Failure>{signout.error}</Failure>}
      {deletion && <Deletion close={() => setDeletion(false)} tracker={tracker} editable={editable} />}
    </section>
  </>
}

function Deletion({ tracker, editable, close }: { tracker: Tracker; editable: boolean; close: () => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const [sent, setSent] = useState(false)
  const action = useAction(editable)
  return <Dialog title="Удаление данных и аккаунта" close={close} busy={action.busy}>
    <div className="stack">
      <p>По запросу владелец проекта отключит доступ и удалит аккаунт вместе с медицинскими записями. Перед отправкой можно скачать резервную копию.</p>
      <p>Сообщите владельцу этот UID <code>{tracker.uid}</code>, чтобы он нашёл запрос.</p>
      {sent ? <p role="status">Запрос сохранён. Свяжитесь с владельцем проекта для завершения.</p> : <>
        <label className="check-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Подтверждаю запрос на удаление всех данных</label>
        {action.error && <Failure>{action.error}</Failure>}
        <button className="btn align-start" disabled={!confirmed || action.busy || !editable} onClick={() =>
          void action.run(async () => { await tracker.requestDeletion(); setSent(true) })}>Отправить запрос</button>
      </>}
    </div>
  </Dialog>
}
