import { useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Medicine, Settings } from '../domain/models'
import { toUnits } from '../domain/models'
import { dateLabel, localInput } from '../domain/time'
import { useRows } from '../hooks/data'
import type { Tracker } from '../services/tracker'
import { Dialog, Failure, Field } from './common'
import { useAction } from './useAction'

export function OneOffDose({ tracker, settings, today, editable, close }: {
  tracker: Tracker; settings: Settings; today: string; editable: boolean; close: () => void
}) {
  const source = useMemo(() => tracker.group('medicines'), [tracker])
  const snapshot = useRows<Medicine>(tracker, source)
  const medicines = (snapshot?.data ?? []).filter(medicine => !medicine.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const [selected, setSelected] = useState('')
  const [time, setTime] = useState(() => {
    const local = localInput(Timestamp.now(), settings.zone)
    return local.startsWith(today) ? local.slice(11) : ''
  })
  const [calendarId] = useState(settings.calendarId)
  const medicine = medicines.find(entry => entry.id === selected)
  const timezoneChanged = calendarId !== settings.calendarId
  const action = useAction(editable && !!snapshot?.fresh && !timezoneChanged)

  return <Dialog title="Добавить приём" close={close} busy={action.busy}>
    {!snapshot ? <p role="status">Загрузка лекарств…</p> :
      snapshot.error ? <Failure>{snapshot.error}</Failure> :
      medicines.length === 0 ? <p>Сначала <a href="#/meds/new" onClick={close}>добавьте лекарство</a>.</p> :
      <form className="stack" onSubmit={event => {
        event.preventDefault()
        if (!medicine) return
        const data = new FormData(event.currentTarget)
        void action.run(async () => {
          await tracker.addOneOff(medicine.id, toUnits(String(data.get('quantity'))), time, String(data.get('deadline')), { calendarId, day: today })
          close()
        })
      }}>
        <p className="muted">Разовый приём на {dateLabel(today, { day: 'numeric', month: 'long' })}</p>
        <Field label="Лекарство"><select className="control" required value={selected}
          onChange={event => setSelected(event.target.value)}>
          <option value="">Выберите лекарство</option>
          {medicines.map(entry => <option value={entry.id} key={entry.id}>
            {entry.name}{entry.strength && ` · ${entry.strength}`} · {entry.unit}
          </option>)}
        </select></Field>
        <Field label={medicine ? `Количество · ${medicine.unit}` : 'Количество'}>
          <input className="control" name="quantity" type="number" required min="0.001" max="1000000" step="0.001" defaultValue="1" />
        </Field>
        <div className="data-grid">
          <Field label="Время приёма">
            <input className="control" type="time" required value={time} onChange={event => setTime(event.target.value)} />
          </Field>
          <Field label="Дедлайн">
            <input className="control" name="deadline" type="time" required min={time || undefined} />
          </Field>
        </div>
        <p className="small muted">Дедлайн — время, до которого нужно отметить приём. Оба времени относятся к указанной дате.</p>
        {timezoneChanged && <Failure>Часовой пояс или граница дня изменились. Откройте форму заново.</Failure>}
        {action.error && <Failure>{action.error}</Failure>}
        <button className="btn align-start" type="submit" disabled={action.busy || !editable || !snapshot.fresh ||
          timezoneChanged || !medicine}>Сохранить приём</button>
      </form>}
  </Dialog>
}
