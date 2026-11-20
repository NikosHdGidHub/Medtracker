import { useState } from 'react'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import type { AuditEvent, Row, StockEntry } from '../domain/models'
import { quantityLabel } from '../domain/models'
import { timestampLabel } from '../domain/time'
import type { Tracker } from '../services/tracker'
import { Failure } from './common'
import { useAction } from './useAction'

const labels: Record<string, string> = {
  medicine_created: 'Добавление лекарства', schedule_updated: 'Изменение расписания',
  pause: 'Начало паузы', resume: 'Возобновление', dates: 'Пауза по датам', end: 'Завершение',
  archive: 'Архивирование', restart: 'Новый курс', restock: 'Пополнение', inventory: 'Инвентаризация',
  dose_changed: 'Изменение приёма', dose: 'Списание', correction: 'Компенсация', initial: 'Начальный запас',
}

type Entry = Row<AuditEvent> | Row<StockEntry>
export function Audit({ tracker, id, zone, kind }: {
  tracker: Tracker; id: string; zone: string; kind: 'dose' | 'medicine' | 'stock'
}) {
  const action = useAction()
  const [entries, setEntries] = useState<Entry[]>()
  const [cursor, setCursor] = useState<QueryDocumentSnapshot>()
  function load() {
    void action.run(async () => {
      const result = kind === 'stock' ? await tracker.stockHistory(id, cursor)
        : await tracker.auditHistory(kind === 'dose' ? 'entityId' : 'medicineId', id, cursor)
      setEntries(previous => [...previous ?? [], ...result.rows])
      setCursor(result.cursor)
    })
  }

  return <section className="audit-section">
    <h3>{kind === 'stock' ? 'Движения запасов' : 'История изменений'}</h3>
    {entries?.length === 0 && <p className="muted">Записей пока нет.</p>}
    {entries && entries.map(entry => <div key={entry.id} className="event">
      <div><strong>{labels['action' in entry ? entry.action : entry.kind]}</strong> · {timestampLabel(entry.at, zone, true)}</div>
      {'delta' in entry
        ? <p>{entry.delta > 0 ? '+' : ''}{quantityLabel(entry.delta)} · остаток {quantityLabel(entry.balance)}</p>
        : <details><summary>До и после</summary><pre>{JSON.stringify({ до: entry.before, после: entry.after }, (key, value) =>
          value && typeof value === 'object' && typeof value.seconds === 'number' &&
          typeof value.nanoseconds === 'number' ? new Date(value.seconds * 1000 + value.nanoseconds / 1e6).toISOString()
            : ['ownerId', 'stockEventId'].includes(key) ? undefined : value, 2)}</pre></details>}
    </div>)}
    {action.error && <Failure>{action.error}</Failure>}
    {(!entries || cursor) && <button className="btn secondary smallbtn" disabled={action.busy} onClick={load}>
      {action.busy ? 'Загрузка…' : entries ? 'Показать ещё' : 'Загрузить журнал'}
    </button>}
  </section>
}
