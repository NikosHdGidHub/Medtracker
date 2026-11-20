import type { Dose } from './models'
import { displayStatus } from './planning'

function csvCell(value: string | number | undefined) {
  const text = String(value ?? '')
  const safe = typeof value === 'string' && /^\s*[=+\-@\t\r\n]/.test(value) ? "'" + text : text
  return '"' + safe.replaceAll('"', '""') + '"'
}

export function dosesCsv(doses: Dose[], now: number) {
  const header = ['Логический день', 'Лекарство', 'Слот', 'Часовой пояс', 'План UTC', 'Дедлайн UTC',
    'Плановая доза', 'Единица', 'Статус', 'Фактическое время UTC', 'Фактическая доза', 'Отметка UTC']
  const rows = doses.map(dose => [
    dose.logicalDate, dose.name, dose.label, dose.zone, dose.scheduledAt.toDate().toISOString(),
    dose.deadlineAt.toDate().toISOString(), dose.quantity / 1000, dose.unit, displayStatus(dose, now),
    dose.record?.actualAt?.toDate().toISOString(), dose.status === 'taken' ? (dose.record?.actualQuantity ?? 0) / 1000 : undefined,
    dose.record?.recordedAt.toDate().toISOString(),
  ])
  return '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
}

export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
