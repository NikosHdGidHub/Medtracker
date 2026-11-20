import { useState } from 'react'
import {
  createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile,
} from 'firebase/auth'
import type { Auth } from 'firebase/auth'
import { Icon } from '../components/Icon'
import { Failure, Field } from '../components/common'
import { useAction } from '../components/useAction'

export function AuthPage({ auth }: { auth: Auth }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [visible, setVisible] = useState(false)
  const [success, setSuccess] = useState(false)
  const action = useAction()
  return <div className="auth-shell">
    <div className="brand"><div className="brand-icon"><Icon name="brand" /></div><strong>Мои лекарства</strong></div>
    <form className="panel auth-form" key={mode} onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const email = String(form.get('email')).trim()
      const password = String(form.get('password') ?? '')
      void action.run(async () => {
        if (mode === 'reset') {
          try { await sendPasswordResetEmail(auth, email) } catch (error) {
            if (!(error instanceof Error) || !('code' in error) || error.code !== 'auth/user-not-found') throw error
          }
          setSuccess(true)
        } else if (mode === 'register') {
          const name = String(form.get('name')).trim()
          if (!name) throw new Error('Введите имя.')
          if (password !== form.get('confirm')) throw new Error('Пароли не совпадают.')
          const { user } = await createUserWithEmailAndPassword(auth, email, password)
          await updateProfile(user, { displayName: name })
        } else {
          await signInWithEmailAndPassword(auth, email, password)
        }
      })
    }}>
      <h1>{mode === 'login' ? 'Вход' : mode === 'register' ? 'Регистрация' : 'Восстановление пароля'}</h1>
      {mode === 'register' && <Field label="Имя"><input className="control" name="name" autoComplete="name" required maxLength={100} /></Field>}
      <Field label="Email"><input className="control" name="email" type="email" autoComplete="email" required /></Field>
      {mode !== 'reset' && <>
        <Field label="Пароль"><input className="control" name="password" type={visible ? 'text' : 'password'}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 6 : 1} /></Field>
        {mode === 'register' && <Field label="Подтверждение пароля"><input className="control" name="confirm" type={visible ? 'text' : 'password'}
          autoComplete="new-password" required minLength={6} /></Field>}
        <label className="check-row"><input type="checkbox" checked={visible} onChange={event => setVisible(event.target.checked)} /> Показать пароль</label>
      </>}
      {action.error && <Failure>{action.error}</Failure>}
      {success && mode === 'reset' && <p role="status">Если аккаунт с этим адресом существует, на почту придёт письмо для смены пароля.</p>}
      <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'Подождите…' : mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Отправить письмо'}</button>
      <div className="row-actions">
        {mode === 'login' ? <>
          <button className="btn secondary" type="button" disabled={action.busy} onClick={() => { setSuccess(false); setMode('reset') }}>Забыли пароль?</button>
          {import.meta.env.VITE_ALLOW_REGISTRATION !== 'false' && <button className="btn secondary" type="button" disabled={action.busy} onClick={() => setMode('register')}>Регистрация</button>}
        </> : <button className="btn secondary" type="button" disabled={action.busy} onClick={() => { setVisible(false); setMode('login') }}>Ко входу</button>}
      </div>
    </form>
  </div>
}
