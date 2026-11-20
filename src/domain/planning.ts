import { groupBy } from './groupBy'
import { Temporal } from '@js-temporal/polyfill'
import type {
  Calendar, Course, Dose, DosePlan, DoseRecord, DoseStatus, Pause, Row, SavedStatus, ScheduleVersion, Validity,
} from './models'
import { isOneOff } from './models'
import { daysBetween, logicalDay, slotTimes } from './time'

export interface PlanData {
  versions: Row<ScheduleVersion>[]
  calendars: Row<Calendar>[]
  pauses: Row<Pause>[]
  courses: Row<Course>[]
}

export const inside = (ms: number, interval: Validity) =>
  ms >= interval.from.toMillis() && ms < interval.until.toMillis()

export function buildDoses(
  first: string, last: string, data: PlanData, records: Row<DoseRecord>[] = [],
): Dose[] {
  const bySlot = new Map<string, Dose>()
  const courses = new Map(data.courses.map(course => [course.id, course]))
  const pauses = groupBy(data.pauses, pause => pause.courseId)
  const days = daysBetween(first, last).map(date => Temporal.PlainDate.from(date))
  for (const version of data.versions) {
    const course = courses.get(version.courseId)
    if (!course) continue
    for (const day of days) {
      const logicalDate = day.toString()
      if (logicalDate < version.start || (version.end && logicalDate > version.end) ||
        !version.weekdays.includes(day.dayOfWeek)) continue

      for (const calendar of data.calendars) {
        if (course.endedAt && logicalDate > logicalDay(course.endedAt.toMillis(), calendar)) continue
        for (const slot of version.slots) {
          const times = slotTimes(logicalDate, slot.time, slot.deadline, calendar)
          const ms = times.scheduledAt.toMillis()
          if (!inside(ms, calendar) || !inside(ms, version)) continue

          const id = [version.id, calendar.id, logicalDate, slot.id].join('_')
          const canceled = (course.endedAt !== null && ms >= course.endedAt.toMillis()) ||
            pauses.get(course.id)?.some(pause => inside(ms, pause))
          const key = [course.id, logicalDate, slot.id].join('_')
          // An elapsed occurrence keeps its slot for that logical date.
          const existing = bySlot.get(key)
          if (existing && existing.scheduledAt.toMillis() <= ms) continue
          bySlot.set(key, {
            id, ownerId: version.ownerId, medicineId: version.medicineId, courseId: course.id,
            versionId: version.id, calendarId: calendar.id, slotId: slot.id, logicalDate,
            zone: calendar.zone, boundary: calendar.boundary, ...times,
            name: version.name, unit: version.unit, label: slot.label, quantity: slot.quantity,
            status: canceled ? 'canceled' : 'pending', courseRevision: course.revision,
          })
        }
      }
    }
  }

  const markedSlots = new Map(records.filter(record => record.status !== 'pending')
    .map(record => [[record.courseId, record.logicalDate, record.slotId].join('_'), record.id]))
  const result = new Map([...bySlot].filter(([key, dose]) =>
    !markedSlots.has(key) || markedSlots.get(key) === dose.id).map(([, dose]) => [dose.id, dose]))

  for (const row of records) {
    const { id, ...record } = row
    if (record.status === 'canceled') {
      // Keep the stored cancellation as a tombstone for this slot and date.
      result.delete(id)
      continue
    }
    const plan = result.get(id)
    // A factual mark remains visible even after a schedule change. Undoing a
    // factual mark on an already withdrawn slot restores its cancellation.
    const status = record.status === 'pending' && !isOneOff(record) ? plan?.status ?? 'canceled' : record.status
    result.set(id, { ...record, id, status, record, courseRevision: plan?.courseRevision })
  }
  return [...result.values()].sort((a, b) =>
    a.scheduledAt.toMillis() - b.scheduledAt.toMillis() || a.id.localeCompare(b.id))
}

export function dosePlan(dose: Dose): DosePlan {
  const { ownerId, medicineId, courseId, versionId, calendarId, slotId, logicalDate,
    zone, boundary, scheduledAt, deadlineAt, name, unit, label, quantity } = dose
  return { ownerId, medicineId, courseId, versionId, calendarId, slotId, logicalDate,
    zone, boundary, scheduledAt, deadlineAt, name, unit, label, quantity }
}

export function displayStatus(dose: Dose, now: number): DoseStatus {
  if (dose.status === 'taken') {
    const actual = dose.record?.actualAt
    if (!actual) return 'time_unknown'
    return actual.toMillis() <= dose.deadlineAt.toMillis() ? 'on_time' : 'late'
  }
  if (dose.status !== 'pending') return dose.status
  if (now >= dose.deadlineAt.toMillis()) return 'overdue'
  return now >= dose.scheduledAt.toMillis() ? 'waiting' : 'future'
}

export function summarize(doses: Dose[], now: number) {
  const total = { planned: 0, taken: 0, onTime: 0, late: 0, unknown: 0, skipped: 0, overdue: 0, waiting: 0 }
  for (const dose of doses) {
    if (dose.status === 'canceled') continue
    total.planned += 1
    if (dose.status === 'taken') total.taken += 1
    switch (displayStatus(dose, now)) {
      case 'on_time': total.onTime += 1; break
      case 'late': total.late += 1; break
      case 'time_unknown': total.unknown += 1; break
      case 'skipped': total.skipped += 1; break
      case 'overdue': total.overdue += 1; break
      case 'waiting': total.waiting += 1; break
    }
  }
  return total
}

export interface DoseChange {
  status: SavedStatus
  actualAt: DoseRecord['actualAt']
  actualQuantity: number
}

export function changeStock(previous: DoseRecord | undefined, next: DoseChange) {
  return (previous?.status === 'taken' ? previous.actualQuantity : 0) -
    (next.status === 'taken' ? next.actualQuantity : 0)
}

export function sameMark(previous: DoseRecord | undefined, next: DoseChange) {
  return (previous?.status ?? 'pending') === next.status &&
    (previous?.actualAt?.toMillis() ?? null) === (next.actualAt?.toMillis() ?? null) &&
    (previous?.actualQuantity ?? 0) === next.actualQuantity
}
