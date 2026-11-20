import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import type { Course, Settings } from './domain/models'
import { addDays, logicalDay } from './domain/time'
import { useClock, usePlanned, useRows, useSettings } from './hooks/data'
import { useNotifications } from './hooks/notifications'
import { AuthPage } from './pages/AuthPage'
import { HistoryPage } from './pages/HistoryPage'
import { MedicinesPage } from './pages/MedicinesPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TodayPage } from './pages/TodayPage'
import { Icon } from './components/Icon'
import { Failure } from './components/common'
import { useHash } from './hooks/hash'
import { useAction } from './components/useAction'
import { errorMessage, firebase } from './services/firebase'
import { Tracker } from './services/tracker'

type Firebase = NonNullable<typeof firebase>

export default function App() {
  if (!firebase) return <div className="auth-shell"><div className="panel stack">
    <div className="brand-icon"><Icon name="brand" /></div>
    <h1>Medtracker</h1>
    <Failure>Подключение к Firebase не настроено. Владелец проекта должен заполнить конфигурацию Web SDK и пересобрать приложение.</Failure>
  </div></div>
  return <Session firebase={firebase} />
}

function Session({ firebase }: { firebase: Firebase }) {
  const [user, setUser] = useState<User | null>()
  useEffect(() => onAuthStateChanged(firebase.auth, setUser), [firebase])
  if (user === undefined) return <p className="auth-shell" role="status">Проверка сессии…</p>
  if (!user) return <AuthPage auth={firebase.auth} />
  return <AccessGate key={user.uid} firebase={firebase} user={user} />
}

function AccessGate({ firebase, user }: { firebase: Firebase; user: User }) {
  const [access, setAccess] = useState<{ enabled: boolean; fresh: boolean; error?: string }>()
  const tracker = useMemo(() => new Tracker(firebase.db, user.uid), [firebase, user.uid])
  const logout = () => signOut(firebase.auth)
  const action = useAction()

  useEffect(() => onSnapshot(doc(firebase.db, 'access', user.uid), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.metadata.fromCache) setAccess({ enabled: snapshot.data()?.enabled === true, fresh: true })
    else setAccess(previous => previous ? { ...previous, fresh: false } : previous)
  }, error => setAccess({ enabled: false, fresh: false, error: errorMessage(error) })), [firebase, user.uid])

  if (access?.enabled) return <Profile tracker={tracker} user={user} logout={logout} accessFresh={access.fresh} />
  return <div className="auth-shell"><div className="panel stack">
    <div className="brand-icon"><Icon name="brand" /></div>
    <h1>{access?.error ? 'Доступ недоступен' : access ? 'Ожидание подтверждения доступа' : 'Проверка доступа…'}</h1>
    {access?.error && <Failure>{access.error}</Failure>}
    {access && !access.error && <p>Передайте владельцу проекта ваш UID. После подтверждения эта страница обновится автоматически.</p>}
    {!access && <p className="muted">Для первичной проверки нужно подключение к сети.</p>}
    <p className="small uid">UID <code>{user.uid}</code></p>
    {action.error && <Failure>{action.error}</Failure>}
    <button className="btn secondary align-start" disabled={action.busy} onClick={() => void action.run(logout, false)}>Выйти</button>
  </div></div>
}

function Profile({ tracker, user, logout, accessFresh }: {
  tracker: Tracker; user: User; logout: () => Promise<void>; accessFresh: boolean
}) {
  const settings = useSettings(tracker)
  const [failure, setFailure] = useState('')
  const [attempt, setAttempt] = useState(0)
  const initialize = accessFresh && settings?.fresh && settings.data === null
  useEffect(() => {
    if (initialize) void tracker.initialize(user.displayName ?? '').catch(error => setFailure(errorMessage(error)))
  }, [attempt, initialize, tracker, user.displayName])
  if (settings?.data) return <Workspace tracker={tracker} settings={settings.data} user={user} logout={logout}
    profileFresh={accessFresh && settings.fresh} />
  return <div className="auth-shell"><div className="panel stack">
    <h1>Подготовка профиля</h1>
    {failure || settings?.error ? <Failure>{failure || settings?.error}</Failure> : <p role="status">Загрузка настроек…</p>}
    {failure && <button className="btn align-start" onClick={() => { setFailure(''); setAttempt(attempt + 1) }}>Повторить</button>}
    <button className="btn secondary align-start" onClick={() => void logout()}>Выйти</button>
  </div></div>
}

const navigation = [
  ['today', 'Сегодня'], ['meds', 'Лекарства'], ['history', 'История'],
  ['reports', 'Отчёты'], ['settings', 'Настройки'],
] as const

function Workspace({ tracker, settings, user, logout, profileFresh }: {
  tracker: Tracker; settings: Settings; user: User; logout: () => Promise<void>; profileFresh: boolean
}) {
  const path = useHash()
  const page = path.split('/')[0]
  const now = useClock()
  const today = logicalDay(now, settings)
  const courseSource = useMemo(() => tracker.group('courses'), [tracker])
  const courseRows = useRows<Course>(tracker, courseSource)
  const courses = useMemo(() => courseRows?.data ?? [], [courseRows?.data])
  const range = usePlanned(tracker, settings.reminders ? addDays(today, -2) : today, today, courses,
    !!courseRows && (page === 'today' || settings.reminders))
  const current = useMemo(() => range.doses.filter(dose => dose.logicalDate === today), [range.doses, today])
  const editable = profileFresh && !!courseRows?.fresh && navigator.onLine
  const notifications = useNotifications(range.doses, now, today, settings, editable && range.fresh)

  const links = (compact: boolean) => navigation.slice(0, compact ? 4 : 5).map(([route, label]) => <a
    href={`#/${route}`} key={route} aria-current={page === route ? 'page' : undefined}
    className={`${compact ? 'tab' : 'nav'} ${page === route ? 'active on' : ''}`}>
    <span className="nav-icon"><Icon name={route} /></span><span>{label}</span>
  </a>)
  return <>
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/today"><div className="brand-icon"><Icon name="brand" /></div><div><strong>Мои лекарства</strong><span>Medtracker</span></div></a>
        <nav className="navigation" aria-label="Главная навигация">{links(false)}</nav>
        <div className="sidebar-foot"><strong>{user.displayName || 'Пользователь'}</strong>{settings.zone}</div>
      </aside>
      <main className="content" id="main">
        {(!navigator.onLine || !profileFresh) && <p className="notice offline" role="status">Нет подтверждённой связи с сервером. Изменения недоступны.</p>}
        {notifications.messages.length > 0 && <div className="notice offline" role="status">
          {notifications.messages.map(message => <p key={message}>{message}</p>)}
          <button className="btn secondary smallbtn" onClick={notifications.clear}>Закрыть напоминания</button>
        </div>}
        <div key={page} className="page-view">
          {courseRows?.error && <Failure>{courseRows.error}</Failure>}
          {page === 'today' && (range.error ? <Failure>{range.error}</Failure> : <TodayPage key={today} today={today} settings={settings}
            now={now} doses={current} tracker={tracker} ready={range.ready && !!courseRows} editable={editable && range.fresh} />)}
          {page === 'meds' && courseRows && <MedicinesPage key={path} tracker={tracker} path={path} courses={courses}
            today={today} settings={settings} now={now} editable={editable} />}
          {page === 'history' && courseRows && <HistoryPage tracker={tracker} courses={courses} today={today} now={now} editable={editable} />}
          {page === 'reports' && courseRows && <ReportsPage tracker={tracker} courses={courses} today={today} now={now} />}
          {page === 'settings' && <SettingsPage tracker={tracker} settings={settings} user={user} logout={logout} editable={profileFresh && navigator.onLine} />}
          {!courseRows && !['settings', 'today'].includes(page) && <p role="status">Загрузка данных…</p>}
          {!navigation.some(([route]) => route === page) && <p className="notice">Раздел не найден. <a href="#/today">Вернуться на главную</a></p>}
        </div>
      </main>
    </div>
    <nav className="bottom-nav" aria-label="Нижняя навигация">{links(true)}</nav>
  </>
}
