import type { Timestamp } from 'firebase/firestore'

export type SavedStatus = 'pending' | 'taken' | 'skipped' | 'canceled'
export type DoseStatus = SavedStatus | 'future' | 'waiting' | 'overdue' | 'on_time' | 'late' | 'time_unknown'

export interface Owned {
  ownerId: string
}

export interface Medicine extends Owned {
  name: string
  unit: string
  strength: string
  stock: number
  stockEventId: string
  warningDays: number
  archived: boolean
  currentCourseId: string
}

export interface Course extends Owned {
  medicineId: string
  versionId: string
  revision: number
  endedAt: Timestamp | null
  manualPauseId: string | null
}

export interface Slot {
  id: string
  label: string
  time: string
  deadline: string
  quantity: number
}

export interface Schedule {
  start: string
  end: string | null
  weekdays: number[]
  slots: Slot[]
}

export interface Validity {
  from: Timestamp
  until: Timestamp
}

export interface ScheduleVersion extends Owned, Schedule, Validity {
  courseId: string
  medicineId: string
  name: string
  unit: string
}

export interface Timing {
  zone: string
  boundary: string
}

export interface Calendar extends Owned, Timing, Validity {}

export interface Pause extends Owned, Validity {
  courseId: string
  mode: 'manual' | 'dates'
}

export interface Settings extends Owned, Timing {
  calendarId: string
  reminders: boolean
  repeatMinutes: number
  repeats: number
  privateText: boolean
}

export interface DosePlan extends Owned, Timing {
  medicineId: string
  courseId: string
  versionId: string
  calendarId: string
  slotId: string
  logicalDate: string
  scheduledAt: Timestamp
  deadlineAt: Timestamp
  name: string
  unit: string
  label: string
  quantity: number
}

export interface DoseRecord extends DosePlan {
  status: SavedStatus
  actualAt: Timestamp | null
  actualQuantity: number
  recordedAt: Timestamp
  revision: number
}

export type Row<T> = T & { id: string }
export type Dose = Row<DosePlan> & {
  status: SavedStatus
  record?: DoseRecord
  courseRevision?: number
}

export type StockKind = 'initial' | 'restock' | 'inventory' | 'dose' | 'correction'

export interface StockEntry extends Owned {
  medicineId: string
  doseId: string | null
  delta: number
  kind: StockKind
  balance: number
  at: Timestamp
}

export interface AuditEvent extends Owned {
  entityId: string
  medicineId: string | null
  action: string
  at: Timestamp
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
export const defaultTiming: Timing = {
  zone: browserZone?.includes('/') ? browserZone : 'UTC',
  boundary: '04:00',
}

export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
export const MAX_SLOTS = 8
export const MAX_QUANTITY = 1_000_000_000

export function toUnits(value: string) {
  const amount = Number(value)
  const units = Math.round(amount * 1000)
  if (!value.trim() || !Number.isFinite(amount) || amount < 0 || units > MAX_QUANTITY ||
    Math.abs(amount * 1000 - units) > 0.00001) {
    throw new Error('Введите неотрицательное число с точностью до 0,001.')
  }
  return units
}

export function quantityLabel(value: number) {
  return (value / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}
