import { useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Dose, DoseStatus } from '../domain/models'
import { isOneOff, quantityLabel, toUnits } from '../domain/models'
import { displayStatus } from '../domain/planning'
import { dateLabel, localInput, localInstant, timestampLabel } from '../domain/time'
import type { Tracker } from '../services/tracker'
import { Icon } from './Icon'
import { Audit } from './Audit'
import { Dialog, Empty, Failure, Field } from './common'
import { useAction } from './useAction'

const labels: Record<DoseStatus, string> = {
  taken: 'Принято', skipped: 'Пропущено', canceled: 'Отменено', pending: 'Не подтверждено',
  future: 'Позже', waiting: 'Ожидает', overdue: 'Просрочено',
  on_time: 'В срок', late: 'Позже дедлайна', time_unknown: 'Время неизвестно',
}

export function DoseList({ doses, now, tracker, historical = false, editable, canRead, empty }: {
  doses: Dose[]; now: number; tracker: Tracker; historical?: boolean; editable: boolean; canRead: boolean; empty: string
}) {
  const [selection, setSelection] = useState<string>()
  const selected = doses.find(dose => dose.id === selection)
  const action = useAction(editable)
  return <>
    {action.error && <Failure>{action.error}</Failure>}
    {!doses.length && <Empty>{empty}</Empty>}
    <div className="list">{doses.map(dose => {
      const display = displayStatus(dose, now)
      const nextDay = localInput(dose.scheduledAt, dose.zone).slice(0, 10)
      const deadlineDate = localInput(dose.deadlineAt, dose.zone).slice(0, 10)
      const kind = display === 'overdue' ? 'overdue' : dose.status === 'taken' ? 'taken' : dose.status === 'canceled' ? 'canceled' : ''
      return <article className={`dose ${kind}`} data-active={display === 'waiting' || display === 'overdue' ? 'open' : display} key={dose.id}>
        <div className="time-col">{timestampLabel(dose.scheduledAt, dose.zone)}{nextDay !== dose.logicalDate &&
          <em>{dateLabel(nextDay, { day: 'numeric', month: 'short' })}<br />след. день</em>}</div>
        <div className="dose-main">
          <div className="dose-name">{dose.name}{dose.label && <span className="small muted"> · {dose.label}</span>}</div>
          <div className="dose-sub">{quantityLabel(dose.quantity)} {dose.unit} · дедлайн {timestampLabel(dose.deadlineAt, dose.zone)}
            {deadlineDate !== nextDay && ` · ${dateLabel(deadlineDate, { day: 'numeric', month: 'short' })}`}</div>
          <div className="dose-status">
            <span className={`chip ${kind === 'overdue' ? 'danger' : dose.status === 'skipped' ? 'warn' : kind === 'taken' ? '' : 'neutral'}`}>
              {labels[dose.status === 'taken' ? 'taken' : display]}
            </span>
            {dose.status === 'taken' && <span className="small">
              {labels[display]}{dose.record?.actualAt && ` · ${timestampLabel(dose.record.actualAt, dose.zone, true)}`}
            </span>}
          </div>
        </div>
        <div className="dose-actions">
          {!historical && dose.status === 'pending' && <button className="btn smallbtn" disabled={action.busy || !editable}
            onClick={() => void action.run(() => tracker.saveDose(dose, { status: 'taken', actualAt: Timestamp.now(), actualQuantity: dose.quantity }, true))}>✓ Принял</button>}
          <button className="btn secondary smallbtn" onClick={() => setSelection(dose.id)} aria-label={`Карточка приёма «${dose.name}»`}>
            {dose.status === 'canceled' || !editable ? 'Подробнее' : !historical && dose.status === 'pending' ? 'Ещё' : 'Изменить'}
          </button>
        </div>
      </article>
    })}</div>
    {selected && <DoseDetails key={selected.id} dose={selected} tracker={tracker} now={now}
      editable={editable && selected.status !== 'canceled'}
      canMark={canRead || selected.scheduledAt.toMillis() <= now}
      close={() => setSelection(undefined)} />}
  </>
}

function DoseDetails({ dose, tracker, now, editable, canMark, close }: {
  dose: Dose; tracker: Tracker; now: number; editable: boolean; canMark: boolean; close: () => void
}) {
  const { record, zone } = dose
  const action = useAction(editable)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState(dose.status)
  const [unknown, setUnknown] = useState(record?.status === 'taken' && record.actualAt === null)
  const [quantity, setQuantity] = useState(String((record?.actualQuantity || dose.quantity) / 1000))
  const initialActual = record?.actualAt ? localInput(record.actualAt, zone) : ''
  const [actual, setActual] = useState(initialActual)
  const original = useState(dose)[0]
  const changedElsewhere = original.record?.revision !== dose.record?.revision
  const canSave = editable && !changedElsewhere
  return <Dialog title={dose.name} close={close} busy={action.busy}>
    <div className="data-grid">
      <p>Логический день <strong>{dateLabel(dose.logicalDate)}</strong></p>
      <p>План <strong>{timestampLabel(dose.scheduledAt, zone, true)}</strong></p>
      <p>Дедлайн <strong>{timestampLabel(dose.deadlineAt, zone, true)}</strong></p>
      <p>Доза <strong>{quantityLabel(dose.quantity)} {dose.unit}</strong></p>
      <p>Статус <strong>{labels[displayStatus(dose, now)]}</strong></p>
      {record && <p>Последняя отметка <strong>{timestampLabel(record.recordedAt, zone, true)}</strong></p>}
    </div>
    {changedElsewhere && <Failure>Запись изменилась. Откройте её снова.</Failure>}
    {editable && canMark && !deleting && <form className="stack" onSubmit={event => {
      event.preventDefault()
      void action.run(async () => {
        if (!canSave || status === 'canceled') return
        const amount = status === 'taken' ? toUnits(quantity) : 0
        if (status === 'taken' && amount === 0) throw new Error('Количество должно быть больше нуля.')
        let actualAt = null
        if (status === 'taken' && !unknown) {
          if (!actual) throw new Error('Укажите фактическое время или отметьте, что оно неизвестно.')
          actualAt = actual === initialActual && record?.actualAt ? record.actualAt
            : localInstant(actual.slice(0, 10), actual.slice(11), zone)
          if (actualAt.toMillis() > Date.now()) throw new Error('Фактическое время ещё не наступило.')
        }
        await tracker.saveDose(original, { status, actualAt, actualQuantity: amount })
        close()
      })
    }}>
      <Field label="Исправить отметку"><select className="control" value={status} onChange={event => {
        const next = event.target.value as typeof status
        setStatus(next)
        if (next === 'taken' && !actual) setActual(localInput(Timestamp.now(), zone))
      }}>
        <option value="pending">Не подтверждено</option><option value="taken">Принято</option><option value="skipped">Пропущено</option>
      </select></Field>
      {status === 'taken' && <>
        <Field label={`Количество · ${dose.unit}`}><input className="control" type="number" min="0.001" step="0.001" value={quantity} onChange={event => setQuantity(event.target.value)} required /></Field>
        <label className="check-row"><input type="checkbox" checked={unknown} onChange={event => setUnknown(event.target.checked)} /> Точное время неизвестно</label>
        {!unknown && <Field label={`Фактическое время · ${zone}`}><input className="control" type="datetime-local" value={actual} onChange={event => setActual(event.target.value)} required /></Field>}
      </>}
      <button type="submit" className="btn" disabled={action.busy || !canSave}>Сохранить отметку</button>
    </form>}
    {editable && (deleting ? <div className="notice error gap-top">
      <p>Удалить этот приём? {isOneOff(dose) ? 'Запись исчезнет из календаря.' : 'Остальные приёмы по курсу сохранятся.'}
        {dose.status === 'taken' && ' Списанное количество вернётся в остаток.'}</p>
      <div className="row-actions">
        <button type="button" className="btn destructive" disabled={action.busy || !canSave}
          onClick={() => void action.run(async () => {
            await tracker.saveDose(original, { status: 'canceled', actualAt: null, actualQuantity: 0 })
            close()
          })}>Подтвердить удаление</button>
        <button type="button" className="btn secondary" disabled={action.busy} onClick={() => setDeleting(false)}>Назад</button>
      </div>
    </div> : <div className="row-actions">
      <button type="button" className="btn destructive-outline" disabled={action.busy || !canSave}
        onClick={() => setDeleting(true)}><Icon name="trash" /> Удалить приём</button>
    </div>)}
    {action.error && <Failure>{action.error}</Failure>}
    {record && <Audit tracker={tracker} id={dose.id} zone={dose.zone} kind="dose" />}
  </Dialog>
}
