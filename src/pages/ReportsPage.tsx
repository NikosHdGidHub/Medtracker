import { groupBy } from '../domain/groupBy'
import { useMemo, useState } from 'react'
import type { Course, Medicine, Row } from '../domain/models'
import { addDays, dateLabel, daysBetween } from '../domain/time'
import { summarize } from '../domain/planning'
import { dosesCsv, download } from '../domain/export'
import { usePlanned, useRows } from '../hooks/data'
import type { Tracker } from '../services/tracker'
import { Empty, Failure, Field, Header } from '../components/common'

function percent(numerator: number, denominator: number) {
  return denominator ? `${Math.round(100 * numerator / denominator)}%` : '—'
}

export function ReportsPage({ tracker, courses, today, now }: {
  tracker: Tracker; courses: Row<Course>[]; today: string; now: number
}) {
  const [period, setPeriod] = useState(7)
  const [medicineId, setMedicineId] = useState('')
  const first = addDays(today, -period)
  const last = addDays(today, -1)
  const range = usePlanned(tracker, first, last, courses)
  const source = useMemo(() => tracker.group('medicines'), [tracker])
  const medicines = useRows<Medicine>(tracker, source)
  const doses = range.doses.filter(dose => !medicineId || dose.medicineId === medicineId)
  const totals = summarize(doses, now)
  const days = groupBy(doses, dose => dose.logicalDate)
  const detail = groupBy(doses, dose => dose.medicineId)
  const error = range.error || medicines?.error
  return <>
    <Header title="Отчёты" subtitle="Последние завершённые логические дни." />
    <section className="panel">
      <div className="report-filter">
        <Field label="Период"><select className="control" value={period} onChange={event => setPeriod(Number(event.target.value))}>
          <option value={7}>Последние 7 дней</option><option value={30}>Последние 30 дней</option>
        </select></Field>
        <Field label="Лекарство"><select className="control" value={medicineId} onChange={event => setMedicineId(event.target.value)}>
          <option value="">Все лекарства</option>{medicines?.data.map(medicine => <option key={medicine.id} value={medicine.id}>{medicine.name}{medicine.archived ? ' (архив)' : ''}</option>)}
        </select></Field>
        <button className="btn secondary" disabled={!range.fresh} onClick={() => download(`medtracker-${first}_${last}.csv`, dosesCsv(doses, now), 'text/csv;charset=utf-8')}>Скачать CSV</button>
      </div>
      <p className="small muted gap-top">{dateLabel(first)} — {dateLabel(last)}</p>
    </section>
    {error ? <Failure>{error}</Failure> : !range.ready ? <p role="status">Расчёт отчёта…</p> : <>
      <div className="metrics gap-top">
        <div className="metric green"><strong>{percent(totals.taken, totals.planned)}</strong><span>Выполнение · {totals.taken}/{totals.planned}</span></div>
        <div className="metric"><strong>{percent(totals.onTime, totals.onTime + totals.late)}</strong><span>В срок · из отметок со временем</span></div>
        <div className="metric amber"><strong>{totals.skipped}</strong><span>Пропущено явно</span></div>
        <div className="metric red"><strong>{totals.overdue}</strong><span>Просрочено без отметки</span></div>
      </div>
      <section className="panel">
        <h2>По дням</h2>
        {!totals.planned ? <Empty>В выбранном периоде нет запланированных приёмов.</Empty> :
          daysBetween(first, last).map(day => {
            const daily = summarize(days.get(day) ?? [], now)
            return <div className="report-day" key={day}><span>{dateLabel(day, { day: 'numeric', month: 'short' })}</span>
              <progress max={daily.planned || 1} value={daily.taken} aria-label={`Подтверждения за ${dateLabel(day)}`} />
              <strong>{daily.taken}/{daily.planned}</strong></div>
          })}
        <p className="small muted gap-top">В срок {totals.onTime} · позже {totals.late} · время неизвестно {totals.unknown} · ожидают {totals.waiting}</p>
      </section>
      {!medicineId && detail.size > 0 && <section className="panel"><h2>По лекарствам</h2>
        {[...detail].map(([id, entries]) => {
          const value = summarize(entries, now)
          return <div className="report-day" key={id}><span>{medicines?.data.find(medicine => medicine.id === id)?.name ?? entries[0].name}</span>
            <progress max={value.planned || 1} value={value.taken} aria-label="Подтверждённые приёмы" /><strong>{value.taken}/{value.planned}</strong></div>
        })}
      </section>}
    </>}
  </>
}
