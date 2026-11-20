import { useMemo, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import type { Medicine, Settings } from '../domain/models'
import { toUnits } from '../domain/models'
import { localInput } from '../domain/time'
import { useRows } from '../hooks/data'
import type { Tracker } from '../services/tracker'
import { Dialog, Failure, Field } from './common'
import { useAction } from './useAction'

export function OneOffDose({ tracker, settings, editable, close }: {
  tracker: Tracker; settings: Settings; editable: boolean; close: () => void
}) {
  const source = useMemo(() => tracker.group('medicines'), [tracker])
  const snapshot = useRows<Medicine>(tracker, source)
  const medicines = (snapshot?.data ?? []).filter(medicine => !medicine.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  const [selected, setSelected] = useState('')
  const [initialTime] = useState(() => localInput(Timestamp.now(), settings.zone))
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
          await tracker.addOneOff(medicine.id, toUnits(String(data.get('quantity'))), String(data.get('time')), calendarId)
          close()
        })
      }}>
        <p className="muted">Разовый приём вне курса. Будущий приём можно найти в календаре.</p>
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
        <Field label={`Дата и время · ${settings.zone}`}>
          <input className="control" name="time" type="datetime-local" required max="9998-12-30T23:59" defaultValue={initialTime} />
        </Field>
        {timezoneChanged && <Failure>Часовой пояс или граница дня изменились. Откройте форму заново.</Failure>}
        {action.error && <Failure>{action.error}</Failure>}
        <button className="btn align-start" type="submit" disabled={action.busy || !editable || !snapshot.fresh ||
          timezoneChanged || !medicine}>Сохранить приём</button>
      </form>}
  </Dialog>
}
