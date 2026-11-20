import { Timestamp } from 'firebase/firestore'
import type { Calendar, Course, Row, ScheduleVersion } from '../src/domain/models'
import type { PlanData } from '../src/domain/planning'
import { FIRST_INSTANT, LAST_INSTANT } from '../src/domain/time'

export const at = (iso: string) => Timestamp.fromDate(new Date(iso))
export const utc = { zone: 'UTC', boundary: '04:00' }
export const slot = { id: 'am', label: 'Утро', time: '08:00', deadline: '09:00', quantity: 1000 }
export const medicine = { name: 'Тестовый препарат', unit: 'табл.', strength: '', warningDays: 7 }
export const schedule = {
  start: '2023-11-01', end: null,
  slots: [slot], weekdays: [1, 2, 3, 4, 5, 6, 7],
}

export function fixture(options: Partial<ScheduleVersion> = {}): PlanData {
  const calendar: Row<Calendar> = { id: 'clock', ownerId: 'alice', ...utc, from: FIRST_INSTANT, until: LAST_INSTANT }
  const course: Row<Course> = {
    id: 'course', ownerId: 'alice', medicineId: 'med', versionId: 'old', revision: 1,
    endedAt: null, manualPauseId: null,
  }
  return {
    calendars: [calendar], courses: [course], pauses: [],
    versions: [{
      id: 'old', ownerId: 'alice', courseId: 'course', medicineId: 'med', ...medicine,
      ...schedule, from: FIRST_INSTANT, until: LAST_INSTANT, ...options,
    }],
  }
}
