import { useMemo, useState } from 'react'
import { query, where } from 'firebase/firestore'
import type { Course, Dose, Medicine, Pause, Row, Schedule, ScheduleVersion, Settings, Slot } from '../domain/models'
import { EVERY_DAY, MAX_SLOTS, quantityLabel, toUnits, WEEKDAYS } from '../domain/models'
import { buildDoses } from '../domain/planning'
import { addDays, dateLabel, LAST_INSTANT, timestampLabel } from '../domain/time'
import { useRange, useRows } from '../hooks/data'
import type { MedicineInput, Tracker } from '../services/tracker'
import { Icon } from '../components/Icon'
import { Audit } from '../components/Audit'
import { Dialog, Empty, Failure, Field, Header } from '../components/common'
import { useAction } from '../components/useAction'

type Item = { medicine: Row<Medicine>; course: Row<Course>; version: Row<ScheduleVersion> }

export function MedicinesPage({ tracker, path, courses, today, settings, now, editable }: {
  tracker: Tracker; path: string; courses: Row<Course>[]; today: string; settings: Settings; now: number; editable: boolean
}) {
  const [page, id, mode] = path.split('/')
  const source = useMemo(() => tracker.group('medicines'), [tracker])
  const medicineRows = useRows<Medicine>(tracker, source)
  const versionSource = useMemo(() => query(tracker.group('scheduleVersions'), where('until', '==', LAST_INSTANT)), [tracker])
  const versionRows = useRows<ScheduleVersion>(tracker, versionSource)
  const pauseSource = useMemo(() => id ? null : tracker.overlapping('pauses', today, today), [id, today, tracker])
  const pauses = useRows<Pause>(tracker, pauseSource)
  const activePauses = new Set(pauses?.data.filter(pause =>
    pause.from.toMillis() <= now && now < pause.until.toMillis()).map(pause => pause.courseId))
  const fresh = editable && !!medicineRows?.fresh && !!versionRows?.fresh
  if (page !== 'meds') return null
  if (id === 'new') return <MedicineWizard tracker={tracker} today={today} editable={editable} />
  const error = medicineRows?.error || versionRows?.error || pauses?.error
  if (error) return <Failure>{error}</Failure>
  if (!medicineRows || !versionRows) return <p role="status">Загрузка лекарств…</p>
  const versions = new Map(versionRows.data.map(version => [version.id, version]))
  const courseMap = new Map(courses.map(course => [course.id, course]))
  const items: Item[] = medicineRows.data.flatMap(medicine => {
    const course = courseMap.get(medicine.currentCourseId)
    const version = course && versions.get(course.versionId)
    return course && version ? [{ medicine, course, version }] : []
  }).sort((a, b) => Number(a.medicine.archived) - Number(b.medicine.archived) ||
    a.medicine.name.localeCompare(b.medicine.name, 'ru'))
  if (id) {
    const item = items.find(entry => entry.medicine.id === id)
    if (!item) return <><Header title="Лекарство" /><Empty>Карточка не найдена. <a href="#/meds">К списку</a></Empty></>
    if (mode === 'edit' && !finished(item, today)) return <MedicineWizard key={id} tracker={tracker} today={today} previous={item} editable={fresh} />
    return <MedicineDetails key={id} item={item} tracker={tracker} today={today} settings={settings} now={now} editable={fresh} courses={courses} />
  }
  return <>
    <Header title="Лекарства" subtitle="Курсы лечения, расписания и запасы"><a className="btn" href="#/meds/new"><Icon name="plus" /> Добавить</a></Header>
    {items.length ? <div className="list">{items.map(item => {
      const { medicine, version, course } = item
      const status = medicine.archived ? 'В архиве' : finished(item, today) ? 'Завершён' : (course.manualPauseId || activePauses.has(course.id)) ? 'Пауза' : version.start > today ? 'Запланирован' : 'Активен'
      return <a className="panel med-list-card" href={`#/meds/${medicine.id}`} key={medicine.id}>
        <div className="med-icon"><Icon name="meds" /></div>
        <div><h2>{medicine.name}</h2><p className="muted">{medicine.unit}{medicine.strength && ` · ${medicine.strength}`} · {scheduleLabel(version)}</p>
          <p>Остаток <strong>{quantityLabel(medicine.stock)} {medicine.unit}</strong></p></div>
        <span className={`chip ${status === 'Активен' ? '' : 'neutral'}`}>{status}</span>
      </a>
    })}</div> : <Empty>Добавьте первое лекарство, чтобы составить расписание.</Empty>}
  </>
}

function finished(item: Item, today: string) {
  return !!item.course.endedAt || (item.version.end !== null && item.version.end < today)
}

function scheduleLabel(schedule: Schedule) {
  return schedule.weekdays.length === 7 ? 'Ежедневно' : schedule.weekdays.map(day => WEEKDAYS[day - 1]).join(', ')
}

function MedicineDetails({ item, tracker, today, settings, now, editable, courses }: {
  item: Item; tracker: Tracker; today: string; settings: Settings; now: number; editable: boolean; courses: Row<Course>[]
}) {
  const { medicine, course, version } = item
  const [modal, setModal] = useState<'stock' | 'pause' | 'end' | 'archive' | 'restart'>()
  const action = useAction(editable)
  const ended = finished(item, today)
  const forecastRange = useRange(tracker, today, addDays(today, 90))
  const planned = useMemo(() => forecastRange.versions && forecastRange.calendars && forecastRange.pauses && forecastRange.records
    ? buildDoses(today, addDays(today, 90), {
      courses,
      versions: forecastRange.versions.filter(entry => entry.medicineId === medicine.id),
      calendars: forecastRange.calendars, pauses: forecastRange.pauses,
    }, forecastRange.records.filter(entry => entry.medicineId === medicine.id))
    : [], [courses, forecastRange.calendars, forecastRange.pauses, forecastRange.records, forecastRange.versions, medicine.id, today])
  const depletion = firstDepletion(planned, medicine.stock, now)
  const pauseActive = forecastRange.pauses?.some((pause: Row<Pause>) => pause.courseId === course.id &&
    pause.from.toMillis() <= now && now < pause.until.toMillis())
  const low = medicine.stock <= 0 || (depletion && depletion.logicalDate <= addDays(today, medicine.warningDays))
  return <>
    <Header title={medicine.name} subtitle={[medicine.unit, medicine.strength, scheduleLabel(version)].filter(Boolean).join(' · ')}>
      <a className="btn secondary" href="#/meds">Все лекарства</a>
    </Header>
    <section className="panel">
      <div className="panel-head"><h2>Курс и расписание</h2><span className="chip">
        {medicine.archived ? 'В архиве' : ended ? 'Завершён' : pauseActive ? 'Пауза' : version.start > today ? 'Запланирован' : 'Активен'}
      </span></div>
      <p className="small muted">{dateLabel(version.start)} — {version.end ? dateLabel(version.end) : 'бессрочно'}</p>
      <div className="slots-read">{version.slots.map(slot => <p key={slot.id} className="slot-chip">
        <strong>{slot.time}</strong> {slot.label && `· ${slot.label}`} · {quantityLabel(slot.quantity)} {medicine.unit} · до {slot.deadline}
      </p>)}</div>
      {course.endedAt && <p>Завершён {timestampLabel(course.endedAt, settings.zone, true)}</p>}
      {!ended && forecastRange.pauses?.filter(pause => pause.courseId === course.id && pause.mode === 'dates' && pause.until.toMillis() > now).map(pause =>
        <p className="small muted" key={pause.id}>Пауза с {timestampLabel(pause.from, settings.zone, true)} до {timestampLabel(pause.until, settings.zone, true)}</p>)}
      <div className="row-actions">
        {!ended && !medicine.archived && <>
          <a className="btn secondary" href={`#/meds/${medicine.id}/edit`}>Редактировать</a>
          <button className="btn secondary" disabled={action.busy || !editable}
            onClick={() => void action.run(() => tracker.changeCourse(medicine, course, course.manualPauseId ? 'resume' : 'pause'))}>
            {course.manualPauseId ? 'Возобновить' : 'Пауза сейчас'}
          </button>
          <button className="btn secondary" disabled={!editable} onClick={() => setModal('pause')}>Пауза по датам</button>
          <button className="btn secondary" disabled={!editable} onClick={() => setModal('end')}>Завершить</button>
        </>}
        {ended && <button className="btn secondary" disabled={!editable} onClick={() => setModal('restart')}>Начать новый курс</button>}
        {!medicine.archived && <button className="btn secondary" disabled={!editable} onClick={() => setModal('archive')}>В архив</button>}
      </div>
      {action.error && <Failure>{action.error}</Failure>}
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Запасы</h2>{low && <span className="chip warn">Малый остаток</span>}</div>
      <div className="stock-line"><strong>{quantityLabel(medicine.stock)}</strong> {medicine.unit}</div>
      <p className="muted">{forecastRange.error ? 'Прогноз недоступен.' : medicine.stock < 0 ? 'По журналу расход превышает запас. Сверьте фактический остаток.' :
        ended ? 'Курс завершён.' : depletion ? `По расписанию запас иссякнет ${dateLabel(depletion.logicalDate)}`
          : forecastRange.ready ? 'По текущему расписанию запас не иссякнет в ближайшие 90 дней.' : 'Расчёт прогноза…'}</p>
      <div className="row-actions"><button className="btn secondary" disabled={!editable} onClick={() => setModal('stock')}>Изменить остаток</button></div>
      <Audit tracker={tracker} id={medicine.id} zone={settings.zone} kind="stock" />
    </section>
    <section className="panel"><Audit tracker={tracker} id={medicine.id} zone={settings.zone} kind="medicine" /></section>
    {modal && <MedicineOperation mode={modal} close={() => setModal(undefined)} item={item} today={today} tracker={tracker} editable={editable} />}
  </>
}

function firstDepletion(doses: Dose[], stock: number, now: number) {
  let balance = stock
  for (const dose of doses) {
    if (dose.status !== 'pending' || dose.scheduledAt.toMillis() < now) continue
    balance -= dose.quantity
    if (balance <= 0) return dose
  }
}

function MedicineOperation({ mode, close, item, today, tracker, editable }: {
  mode: 'stock' | 'pause' | 'end' | 'archive' | 'restart'; close: () => void; item: Item; today: string; tracker: Tracker; editable: boolean
}) {
  const action = useAction(editable)
  const title = { stock: 'Изменить остаток', pause: 'Пауза по датам', end: 'Завершить курс', archive: 'Архивировать', restart: 'Начать новый курс' }[mode]
  return <Dialog title={title} close={close} busy={action.busy}>
    <form className="stack" onSubmit={event => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      void action.run(async () => {
        if (mode === 'stock') await tracker.updateStock(item.medicine.id, data.get('kind') === 'inventory' ? 'inventory' : 'restock', toUnits(String(data.get('quantity'))))
        else await tracker.changeCourse(item.medicine, item.course, mode === 'pause' ? 'dates' : mode, {
          first: String(data.get('first') ?? today), last: String(data.get('last') ?? today),
        })
        close()
      })
    }}>
      {mode === 'stock' && <>
        <Field label="Операция"><select className="control" name="kind"><option value="restock">Добавить к остатку</option><option value="inventory">Установить фактический остаток</option></select></Field>
        <Field label={`Количество · ${item.medicine.unit}`}><input className="control" name="quantity" type="number" min="0" step="0.001" required /></Field>
      </>}
      {(mode === 'pause' || mode === 'restart') && <Field label={mode === 'pause' ? 'Начало паузы' : 'Дата начала нового курса'}>
        <input className="control" name="first" type="date" min={today} defaultValue={today} required /></Field>}
      {mode === 'pause' && <Field label="Последний день паузы"><input className="control" name="last" type="date" min={today} defaultValue={today} required /></Field>}
      {(mode === 'archive' || mode === 'end') && <p>Будущие приёмы отменятся. Предыдущие отметки и журнал сохранятся.</p>}
      {mode === 'restart' && <p>Будет создан новый бессрочный курс с последним расписанием. Старые записи сохранятся.</p>}
      {action.error && <Failure>{action.error}</Failure>}
      <button className={`btn ${mode === 'end' || mode === 'archive' ? 'destructive' : ''}`} type="submit" disabled={action.busy || !editable}>{title}</button>
    </form>
  </Dialog>
}

type SlotForm = Omit<Slot, 'quantity'> & { amount: string }
const newSlot = (): SlotForm => ({ id: crypto.randomUUID(), label: '', time: '08:00', deadline: '09:00', amount: '1' })

function MedicineWizard({ tracker, today, previous, editable }: {
  tracker: Tracker; today: string; previous?: Item; editable: boolean
}) {
  const [original] = useState(previous)
  const [step, setStep] = useState(0)
  const [input, setInput] = useState<MedicineInput>(previous?.medicine ? {
    name: previous.medicine.name, unit: previous.medicine.unit, strength: previous.medicine.strength, warningDays: previous.medicine.warningDays,
  } : { name: '', unit: 'табл.', strength: '', warningDays: 7 })
  const [start, setStart] = useState(previous?.version.start ?? today)
  const [end, setEnd] = useState(previous?.version.end ?? '')
  const [weekdays, setWeekdays] = useState(previous?.version.weekdays ?? EVERY_DAY)
  const [slots, setSlots] = useState<SlotForm[]>(() => previous?.version.slots.map(slot => ({ ...slot, amount: String(slot.quantity / 1000) })) ?? [newSlot()])
  const [stock, setStock] = useState('0')
  const [validation, setValidation] = useState('')
  const action = useAction(editable)
  const steps = ['Препарат', 'Периодичность', 'Приёмы', 'Запасы', 'Проверка']
  const patchSlot = (id: string, fields: Partial<SlotForm>) =>
    setSlots(current => current.map(slot => slot.id === id ? { ...slot, ...fields } : slot))

  function validate() {
    if (step === 0 && (!input.name.trim() || !input.unit.trim())) throw new Error('Укажите название и единицу учёта.')
    if (step === 1 && (!weekdays.length || (end && end < start))) throw new Error('Выберите дни недели и проверьте даты курса.')
    if (step === 2) {
      if (slots.some(slot => toUnits(slot.amount) <= 0)) throw new Error('Доза должна быть больше нуля.')
      const keys = slots.map(slot => `${slot.time}|${slot.deadline}|${toUnits(slot.amount)}|${slot.label.trim().toLowerCase()}`)
      if (new Set(keys).size !== keys.length) throw new Error('Одинаковые слоты нужно объединить или назвать по-разному.')
    }
    if (step === 3) toUnits(stock)
  }

  return <>
    <Header title={previous ? 'Редактирование лекарства' : 'Добавить лекарство'} subtitle={previous ? 'Прошедшие слоты сохранят своё расписание.' : undefined} />
    <section className="panel">
      <div className="wizard-track" aria-label="Шаги">{steps.map((name, index) =>
        <button className={`step-pill ${index === step ? 'active' : ''}`} key={name} disabled={index > step || action.busy}
          aria-current={index === step ? 'step' : undefined} onClick={() => { setValidation(''); setStep(index) }}>{name}</button>)}</div>
      <form className="stack wizard-form" onSubmit={event => {
        event.preventDefault()
        setValidation('')
        try { validate() } catch (error) { setValidation((error as Error).message); return }
        if (step < steps.length - 1) { setStep(step + 1); return }
        const previousRoute = window.location.hash
        void action.run(async () => {
          const id = await tracker.saveMedicine({ ...input, name: input.name.trim(), unit: input.unit.trim(), strength: input.strength.trim() }, {
            start, end: end || null, weekdays: [...weekdays].sort(),
            slots: slots.map(({ id, label, time, deadline, amount }) => ({ id, label: label.trim(), time, deadline, quantity: toUnits(amount) })),
          }, toUnits(stock), original)
          if (window.location.hash === previousRoute) window.location.hash = `/meds/${id}`
        })
      }}>
        <div className="step-content" key={step}>
          <h2>{steps[step]}</h2>
          {step === 0 && <>
            <Field label="Название"><input className="control" autoComplete="off" required maxLength={120} value={input.name} onChange={event => setInput({ ...input, name: event.target.value })} /></Field>
            <Field label="Единица учёта (например, табл., капс., мл)"><input className="control" required maxLength={20} value={input.unit} onChange={event => setInput({ ...input, unit: event.target.value })} /></Field>
            <Field label="Сила одной единицы, если нужна"><input className="control" maxLength={60} value={input.strength} onChange={event => setInput({ ...input, strength: event.target.value })} /></Field>
          </>}
          {step === 1 && <>
            <label className="check-row"><input type="checkbox" checked={weekdays.length === 7} onChange={event => setWeekdays(event.target.checked ? EVERY_DAY : [])} /> Ежедневно</label>
            <div className="weekday-picker">{WEEKDAYS.map((day, index) => <label className="check-row" key={day}><input type="checkbox" checked={weekdays.includes(index + 1)}
              onChange={event => setWeekdays(event.target.checked ? [...weekdays, index + 1] : weekdays.filter(value => value !== index + 1))} /> {day}</label>)}</div>
            <div className="data-grid">
              <Field label="Начало курса"><input className="control" type="date" required min="1901-01-01" max="9998-12-30" value={start} onChange={event => setStart(event.target.value)} /></Field>
              <Field label="Окончание включительно (пусто для бессрочного)"><input className="control" type="date" min={start} max="9998-12-30" value={end} onChange={event => setEnd(event.target.value)} /></Field>
            </div>
          </>}
          {step === 2 && <>
            <p className="muted">Дедлайн, равный времени приёма или раньше него, относится к следующей календарной дате.</p>
            {slots.map((slot, index) => <fieldset className="slot-fields" key={slot.id}>
              <legend>Приём {index + 1}</legend>
              <Field label="Метка (необязательно)"><input className="control" maxLength={60} value={slot.label} onChange={event => patchSlot(slot.id, { label: event.target.value })} /></Field>
              <Field label="Время"><input className="control" type="time" required value={slot.time} onChange={event => patchSlot(slot.id, { time: event.target.value })} /></Field>
              <Field label="Дедлайн"><input className="control" type="time" required value={slot.deadline} onChange={event => patchSlot(slot.id, { deadline: event.target.value })} /></Field>
              <Field label="Количество"><input className="control" type="number" min="0.001" step="0.001" required value={slot.amount} onChange={event => patchSlot(slot.id, { amount: event.target.value })} /></Field>
              {slots.length > 1 && <button className="btn destructive-outline smallbtn" type="button" onClick={() => setSlots(slots.filter(value => value.id !== slot.id))}><Icon name="trash" /> Убрать приём {index + 1}</button>}
            </fieldset>)}
            <button className="btn secondary" type="button" disabled={slots.length >= MAX_SLOTS} onClick={() => setSlots([...slots, newSlot()])}><Icon name="plus" /> Добавить приём</button>
            {slots.length >= MAX_SLOTS && <p className="small muted">В одном расписании можно сохранить до {MAX_SLOTS} приёмов в день.</p>}
          </>}
          {step === 3 && <>
            {!previous && <Field label="Начальный остаток"><input className="control" type="number" min="0" step="0.001" required value={stock} onChange={event => setStock(event.target.value)} /></Field>}
            <Field label="Предупреждать об исчерпании за столько дней"><input className="control" type="number" required min="0" max="365" value={input.warningDays}
              onChange={event => setInput({ ...input, warningDays: Number(event.target.value) })} /></Field>
          </>}
          {step === 4 && <div className="summary-card">
            <h3>{input.name} · {input.unit}{input.strength && ` · ${input.strength}`}</h3>
            <p>{weekdays.length === 7 ? 'Ежедневно' : weekdays.map(day => WEEKDAYS[day - 1]).join(', ')} · {dateLabel(start)} — {end ? dateLabel(end) : 'бессрочно'}</p>
            <ul>{slots.map(slot => <li key={slot.id}>{slot.time} → {slot.deadline} · {slot.amount} {input.unit} {slot.label}</li>)}</ul>
            {!previous && <p>Начальный остаток {stock} {input.unit}</p>}
          </div>}
        </div>
        {(validation || action.error) && <Failure>{validation || action.error}</Failure>}
        <div className="row-actions">
          {step > 0 && <button type="button" className="btn secondary" disabled={action.busy} onClick={() => { setValidation(''); setStep(step - 1) }}><Icon name="previous" /> Назад</button>}
          <button type="submit" className="btn" disabled={action.busy || (!editable && step === 4)}>{step === 4 ? 'Сохранить лекарство' : 'Далее'}</button>
        </div>
      </form>
    </section>
  </>
}
