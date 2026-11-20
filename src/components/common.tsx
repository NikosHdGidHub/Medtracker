import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

export function Header({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return <div className="topline">
    <div><h1>{title}</h1>{subtitle && <p className="subtitle">{subtitle}</p>}</div>
    <div className="top-actions">{children}<a className="btn secondary iconbtn mobile-settings" href="#/settings" aria-label="Настройки"><Icon name="settings" /></a></div>
  </div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name="empty" /></span>{children}</div>
}

export function Failure({ children }: { children: ReactNode }) {
  return <p className="notice error" role="alert">{children}</p>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}

export function Dialog({ title, children, close, busy = false }: {
  title: string; children: ReactNode; close: () => void; busy?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = ref.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog className="dialog" aria-label={title} ref={ref} onCancel={event => {
    event.preventDefault()
    if (!busy) close()
  }}>
    <div className="panel-head"><h2>{title}</h2><button type="button" className="btn secondary iconbtn" aria-label="Закрыть" disabled={busy} onClick={close}><Icon name="close" /></button></div>
    {children}
  </dialog>
}
