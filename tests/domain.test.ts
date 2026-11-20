import { describe, expect, it, vi } from 'vitest'
import { dosesCsv } from '../src/domain/export'
import { buildDoses, changeStock, displayStatus, dosePlan, sameMark, summarize } from '../src/domain/planning'
import { notify, reminderStep } from '../src/domain/reminders'
import { localInstant, logicalDay, slotTimes } from '../src/domain/time'
import type { Dose, DoseRecord } from '../src/domain/models'
import { at, fixture, slot, utc } from './fixtures'

const day = '2024-11-20'
const ms = (iso: string) => at(iso).toMillis()
const atDay = (data = fixture()) => buildDoses(day, day, data)
const mark = (dose: Dose, record: Partial<DoseRecord> = {}) => ({
  id: dose.id, ...dosePlan(dose), status: 'taken' as const,
  actualAt: at('2024-11-20T08:40:00Z'), actualQuantity: 1000,
  recordedAt: at('2024-11-20T08:40:00Z'), revision: 1, ...record,
})

describe('periods and calendar', () => {
  it('calculates a daily or weekly schedule and includes the last course day', () => {
    expect(buildDoses(day, '2024-11-24', fixture())).toHaveLength(5)
    expect(buildDoses(day, '2024-11-24', fixture({ weekdays: [1, 3, 5], end: '2024-11-22' }))
      .map(dose => dose.logicalDate)).toEqual([day, '2024-11-22'])
    expect(buildDoses(day, '2024-11-24', fixture({ end: '2024-11-19' }))).toEqual([])
  })

  it('sorts multiple slots chronologically and preserves the previous logical date for 01:30', () => {
    const result = atDay(fixture({ slots: [{ ...slot, id: 'night', time: '01:30', deadline: '05:00' },
      { ...slot, id: 'evening', time: '23:45', deadline: '00:15' }, slot] }))
    expect(result.map(dose => dose.slotId)).toEqual(['am', 'evening', 'night'])
    expect(result[1].deadlineAt.toDate().toISOString()).toBe('2024-11-21T00:15:00.000Z')
    expect(result[2].scheduledAt.toDate().toISOString()).toBe('2024-11-21T01:30:00.000Z')
    expect(result[2].deadlineAt.toDate().toISOString()).toBe('2024-11-21T05:00:00.000Z')
    expect(logicalDay(result[2].scheduledAt.toMillis(), utc)).toBe(day)
    expect(logicalDay(result[2].deadlineAt.toMillis(), utc)).toBe('2024-11-21')
  })

  it('resolves DST overlaps to the first occurrence and gaps forward', () => {
    expect(localInstant('2025-10-26', '02:30', 'Europe/Berlin').toDate().toISOString()).toBe('2025-10-26T00:30:00.000Z')
    expect(localInstant('2025-03-30', '02:30', 'Europe/Berlin').toDate().toISOString()).toBe('2025-03-30T01:30:00.000Z')
    const { scheduledAt, deadlineAt } = slotTimes('2025-03-29', '02:55', '03:05', { zone: 'Europe/Berlin', boundary: '04:00' })
    expect(deadlineAt.toMillis()).toBe(scheduledAt.toMillis())
    expect(logicalDay(ms('2025-10-26T01:10:00Z'), { zone: 'Europe/Berlin', boundary: '02:30' })).toBe('2025-10-26')
  })

  it('changes the time zone only at its cutover and retains old snapshots', () => {
    const data = fixture()
    const cutoff = at('2024-11-20T12:00:00Z')
    data.calendars.push({ ...data.calendars[0], id: 'new-clock', zone: 'America/New_York', from: cutoff })
    data.calendars[0].until = cutoff
    const result = buildDoses('2024-11-19', '2024-11-22', data)
    expect(result.map(dose => [dose.logicalDate, dose.scheduledAt.toDate().getUTCHours()])).toEqual([
      ['2024-11-19', 8], [day, 8], ['2024-11-21', 13], ['2024-11-22', 13],
    ])
  })

  it('restores pending and corrected historical doses after a schedule change without duplicates', () => {
    const data = fixture()
    const [original] = buildDoses('2023-11-20', '2023-11-20', data)
    const cutoff = at('2024-11-20T12:00:00Z')
    data.versions.push({ ...data.versions[0], id: 'new', from: cutoff,
      slots: [{ ...slot, id: 'additional', time: '20:00', deadline: '21:00' }] })
    data.versions[0].until = cutoff
    const records = [mark(original, { actualAt: at('2023-11-21T02:00:00Z') })]
    const rebuilt = buildDoses('2023-11-20', '2023-11-20', data, [...records, ...records])
    expect(rebuilt).toHaveLength(1)
    expect(rebuilt[0]).toMatchObject({ id: original.id, logicalDate: '2023-11-20', status: 'taken' })
    expect(atDay(data).map(dose => dose.versionId)).toEqual(['old', 'new'])
  })

  it('cancels only future slots in a pause or after ending the course', () => {
    const data = fixture({ slots: [slot, { ...slot, id: 'pm', time: '20:00', deadline: '21:00' }] })
    const from = at('2024-11-20T14:00:00Z')
    data.pauses = [{ id: 'pause', ownerId: 'alice', courseId: 'course', mode: 'manual', from, until: at('2024-11-21T12:00:00Z') }]
    expect(buildDoses(day, '2024-11-21', data).map(dose => dose.status)).toEqual(['pending', 'canceled', 'canceled', 'pending'])
    data.courses[0].endedAt = from
    expect(buildDoses(day, '2024-11-21', data).map(dose => dose.status)).toEqual(['pending', 'canceled'])
    const evening = atDay(data)[1]
    const earlyMark = mark(evening)
    expect(buildDoses(day, day, data, [earlyMark])[1].status).toBe('taken')
  })
})

describe('marks, stock and reports', () => {
  it('keeps a stable logical date and compensates cancellation and edited quantities', () => {
    const [dose] = atDay()
    const taken = { ...mark(dose, { actualQuantity: 2000 }), status: 'taken' as const }
    const correction = { ...mark(dose, { actualAt: null, actualQuantity: 1000 }), status: 'taken' as const }
    const undone = { status: 'pending' as const, actualAt: null, actualQuantity: 0 }
    const skipped = { ...undone, status: 'skipped' as const }
    expect(changeStock(undefined, taken)).toBe(-2000)
    expect(changeStock(taken, correction)).toBe(1000)
    expect(changeStock(taken, skipped)).toBe(2000)
    expect(changeStock(taken, undone)).toBe(2000)
    expect(sameMark(taken, taken)).toBe(true)
    expect(sameMark(taken, correction)).toBe(false)
    expect(buildDoses(day, day, fixture(), [correction])[0].logicalDate).toBe(day)
  })

  it('keeps explicit skips separate from overdue and excludes cancellations', () => {
    const [dose] = atDay()
    const before = ms('2024-11-20T07:00Z')
    const waiting = ms('2024-11-20T08:25Z')
    const after = ms('2024-11-20T10:00Z')
    expect([before, waiting, after].map(now => displayStatus(dose, now))).toEqual(['future', 'waiting', 'overdue'])
    const seeds = [dose, { ...dose, status: 'skipped' as const }, { ...dose, status: 'canceled' as const },
      ...[mark(dose), mark(dose, { actualAt: null }), mark(dose, { actualAt: at('2024-11-20T10:00Z') })]
        .map(record => ({ ...dose, status: 'taken' as const, record }))]
    expect(summarize(seeds, after)).toEqual({ planned: 5, taken: 3, onTime: 1, late: 1, unknown: 1, overdue: 1, skipped: 1, waiting: 0 })
  })

  it('quotes CSV and neutralizes spreadsheet formulas from user fields', () => {
    const csv = dosesCsv([{ ...atDay()[0], name: '=1+1', label: 'a"b' }], Date.now())
    expect(csv).toContain('"\'=1+1"')
    expect(csv).toContain('"a""b"')
  })
})

describe('reminders', () => {
  it('allows the initial notification and up to five repeats with one step on resume', () => {
    const [dose] = atDay()
    const timing = { repeats: 5, repeatMinutes: 15 }
    const deadline = dose.deadlineAt.toMillis()
    const step = (minutes: number) => reminderStep(dose, deadline + minutes * 60000, timing, day, deadline - 8 * 3600000)
    expect([-1, 0, 15, 30, 45, 60, 75, 90].map(step)).toEqual([null, 0, 1, 2, 3, 4, 5, null])
    expect(step(50)).toBe(3)
  })

  it('stops after a mark, has no replay after correction, but crosses the day boundary', () => {
    const [dose] = atDay(fixture({ slots: [{ ...slot, time: '01:30', deadline: '04:10' }] }))
    const deadline = dose.deadlineAt.toMillis()
    const timing = { repeats: 5, repeatMinutes: 15 }
    const after = deadline + 60_000
    const start = ms('2024-11-21T04:00Z')
    expect(reminderStep(dose, after, timing, '2024-11-21', start)).toBe(0)
    expect(reminderStep(dose, after, timing, '2024-11-21', after)).toBeNull()
    expect(reminderStep({ ...dose, status: 'taken' }, after, timing, '2024-11-21', start)).toBeNull()
    expect(reminderStep({ ...dose, status: 'skipped' }, after, timing, '2024-11-21', start)).toBeNull()
    expect(reminderStep({ ...dose, record: mark(dose, { status: 'pending', recordedAt: at('2024-11-21T04:11Z') }) },
      after, timing, '2024-11-21', start)).toBeNull()
  })

  it('uses in-app notifications when permission is denied', async () => {
    vi.stubGlobal('Notification', { permission: 'denied' })
    try {
      const fallback = vi.fn()
      await notify('Medtracker', 'Проверьте приём.', 'a', fallback)
      expect(fallback).toHaveBeenCalledWith('Проверьте приём.')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
