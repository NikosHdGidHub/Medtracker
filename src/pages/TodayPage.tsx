import { Timestamp } from 'firebase/firestore'
import { useEffect, useRef } from 'react'
import type { Dose, Timing } from '../domain/models'
import { summarize } from '../domain/planning'
import { dateLabel, localInput, localInstant, addDays } from '../domain/time'
import type { Tracker } from '../services/tracker'
import { DoseList } from '../components/Doses'
import { Header } from '../components/common'

export function TodayPage({
  today,
  timing,
  now,
  doses,
  tracker,
  ready,
  editable,
}: {
  today: string
  timing: Timing
  now: number
  doses: Dose[]
  tracker: Tracker
  ready: boolean
  editable: boolean
}) {
  const active = doses.filter((dose) => dose.status !== 'canceled')
  const total = summarize(active, now)
  const chronology = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  useEffect(() => {
    if (!ready || scrolled.current) return
    scrolled.current = true
    const list = chronology.current
    const item =
      list?.querySelector('[data-active="open"]') ?? list?.querySelector('[data-active="future"]')
    if (item && item.getBoundingClientRect().bottom > window.innerHeight) {
      item.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    }
  }, [ready])
  const end = localInstant(addDays(today, 1), timing.boundary, timing.zone).toMillis() - 60_000
  return (
    <>
      <Header title="Сегодня" subtitle={`${dateLabel(today)} `} />
      <div className="metrics">
        <div className="metric green">
          <strong>
            {total.taken}/{total.planned}
          </strong>
          <span>Подтверждено</span>
        </div>
        <div className="metric red">
          <strong>{total.overdue}</strong>
          <span>Просрочено</span>
        </div>
        <div className="metric amber">
          <strong>{total.waiting}</strong>
          <span>Ожидает</span>
        </div>
        <div className="metric">
          <strong>{total.skipped}</strong>
          <span>Пропущено</span>
        </div>
      </div>
      <h2 className="section-label">Приёмы · по времени</h2>
      {!ready ? (
        <p role="status">Загрузка расписания…</p>
      ) : (
        <div ref={chronology}>
          <DoseList
            doses={active}
            now={now}
            tracker={tracker}
            editable={editable}
            canRead
            empty="На этот логический день приёмов нет."
          />
          {!active.length && (
            <div className="row-actions">
              <a href="#/meds/new" className="btn">
                Добавить лекарство
              </a>
            </div>
          )}
        </div>
      )}
    </>
  )
}
