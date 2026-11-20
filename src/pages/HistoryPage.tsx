import { groupBy } from '../domain/groupBy'
import { useState } from 'react'
import type { Course, Row } from '../domain/models'
import { WEEKDAYS } from '../domain/models'
import { daysBetween, dateLabel, monthGrid } from '../domain/time'
import { dosesCsv, download } from '../domain/export'
import { usePlanned } from '../hooks/data'
import type { Tracker } from '../services/tracker'
import { DoseList } from '../components/Doses'
import { Failure, Field, Header } from '../components/common'

export function HistoryPage({ tracker, courses, today, now, editable }: {
  tracker: Tracker; courses: Row<Course>[]; today: string; now: number; editable: boolean
}) {
  const [selected, setSelected] = useState(today)
  const month = monthGrid(selected)
  const { doses, ready, fresh, error } = usePlanned(tracker, month.first, month.last, courses)
  const rows = groupBy(doses, dose => dose.logicalDate)
  return <>
    <Header title="История" subtitle="Выберите логический день, чтобы просмотреть или исправить отметки." />
    <section className="panel calendar">
      <div className="panel-head">
        <button className="btn secondary iconbtn" aria-label="Предыдущий месяц" disabled={month.prev < '1901-01-01'} onClick={() => setSelected(month.prev)}>‹</button>
        <h2>{month.label}</h2>
        <button className="btn secondary iconbtn" aria-label="Следующий месяц" disabled={month.next > '9998-12-01'} onClick={() => setSelected(month.next)}>›</button>
      </div>
      <Field label="Перейти к дате"><input className="control calendar-input" type="date" min="1901-01-01" max="9998-12-30" value={selected}
        onChange={event => { if (event.currentTarget.validity.valid && event.target.value) setSelected(event.target.value) }} /></Field>
      <div className="calendar-grid" aria-label="Логические дни месяца">
        {WEEKDAYS.map(day => <div className="calendar-weekday" key={day}>{day}</div>)}
        {Array.from({ length: month.leading }, (_, index) => <div key={index} />)}
        {daysBetween(month.first, month.last).map(day => {
          const planned = (rows.get(day) ?? []).filter(dose => dose.status !== 'canceled')
          const status = day === today ? ['current', 'день продолжается'] :
            !planned.length ? ['none', 'нет назначений'] :
              planned.some(dose => dose.status === 'pending') ? ['unresolved', 'есть неподтверждённые'] : ['resolved', 'все отметки разобраны']
          return <button key={day} className={`cal-day ${selected === day ? 'selected' : ''}`} onClick={() => setSelected(day)}
            aria-pressed={selected === day} aria-label={`${dateLabel(day)}, ${ready ? status[1] : 'загрузка'}`}>
            {Number(day.slice(-2))}<i className={`cal-indicator ${status[0]}`} aria-hidden="true" />
          </button>
        })}
      </div>
      <div className="calendar-legend">
        <span><i className="cal-indicator resolved" /> Все отметки разобраны</span>
        <span><i className="cal-indicator unresolved" /> Есть неподтверждённые</span>
        <span><i className="cal-indicator current" /> День продолжается</span>
        <span><i className="cal-indicator none" /> Нет назначений</span>
      </div>
    </section>
    <div className="panel-head gap-top">
      <h2>{dateLabel(selected)}</h2>
      <button className="btn secondary smallbtn" disabled={!fresh} onClick={() => download(`medtracker-${month.first.slice(0, 7)}.csv`, dosesCsv(doses, now), 'text/csv;charset=utf-8')}>CSV за месяц</button>
    </div>
    {error ? <Failure>{error}</Failure> : !ready ? <p role="status">Загрузка истории…</p> :
      <DoseList key={selected} doses={rows.get(selected) ?? []} now={now} tracker={tracker} historical
        editable={editable && fresh && selected <= today} canRead={false} empty="На этот день приёмов нет." />}
  </>
}
