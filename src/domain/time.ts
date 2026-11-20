import { Temporal } from '@js-temporal/polyfill'
import { Timestamp } from 'firebase/firestore'
import type { Timing } from './models'

export const FIRST_INSTANT = Timestamp.fromMillis(Date.UTC(1_900, 0, 1))
export const LAST_INSTANT = Timestamp.fromMillis(Date.UTC(9_999, 0, 1))

export const addDays = (date: string, count: number) =>
  Temporal.PlainDate.from(date).add({ days: count }).toString()

export function daysBetween(first: string, last: string) {
  const result: string[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) result.push(date)
  return result
}

export function localInstant(date: string, time: string, zone: string) {
  return Timestamp.fromMillis(Temporal.PlainDateTime.from(`${date}T${time}`)
    .toZonedDateTime(zone, { disambiguation: 'compatible' }).epochMilliseconds)
}

function local(ms: number, zone: string) {
  return Temporal.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)
}

export function logicalDay(ms: number, { zone, boundary }: Timing) {
  const value = local(ms, zone)
  const day = value.toPlainDate().toString()
  return ms < localInstant(day, boundary, zone).toMillis() ? addDays(day, -1) : day
}

export function slotTimes(day: string, time: string, deadline: string, timing: Timing) {
  const scheduledDay = time < timing.boundary ? addDays(day, 1) : day
  const scheduledAt = localInstant(scheduledDay, time, timing.zone)
  const deadlineDay = deadline <= time ? addDays(scheduledDay, 1) : scheduledDay
  let deadlineAt = localInstant(deadlineDay, deadline, timing.zone)
  // A spring-forward gap can shift the scheduled wall time past a later deadline.
  if (deadlineAt.toMillis() < scheduledAt.toMillis()) deadlineAt = scheduledAt
  return { scheduledAt, deadlineAt }
}

export function timestampLabel(value: Timestamp, zone: string, withDate = false) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: zone,
    ...(withDate && { month: 'short', day: 'numeric', year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  }).format(value.toDate())
}

export function localInput(value: Timestamp, zone: string) {
  return local(value.toMillis(), zone).toPlainDateTime().toString({ smallestUnit: 'minute' })
}

export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return Temporal.PlainDate.from(date).toLocaleString('ru-RU', options)
}

export function rangeBounds(first: string, last: string) {
  return {
    from: localInstant(addDays(first, -2), '00:00', 'UTC'),
    until: localInstant(addDays(last, 3), '00:00', 'UTC'),
  }
}

export function monthGrid(day: string) {
  const first = Temporal.PlainDate.from(day).with({ day: 1 })
  return {
    label: first.toLocaleString('ru-RU', { month: 'long', year: 'numeric' }),
    first: first.toString(),
    last: first.with({ day: first.daysInMonth }).toString(),
    leading: first.dayOfWeek - 1,
    prev: first.subtract({ months: 1 }).toString(),
    next: first.add({ months: 1 }).toString(),
  }
}
