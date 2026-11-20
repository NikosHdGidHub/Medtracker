import { useEffect, useMemo, useState } from 'react'
import type { Query } from 'firebase/firestore'
import type { Calendar, Course, DoseRecord, Pause, Row, ScheduleVersion, Settings } from '../domain/models'
import { buildDoses } from '../domain/planning'
import { errorMessage } from '../services/firebase'
import type { Tracker } from '../services/tracker'

type Snapshot<T> = { data: T; fresh: boolean; error?: string }

export function useRows<T>(tracker: Tracker, source: Query | null) {
  const [value, setValue] = useState<{ source: Query; snapshot: Snapshot<Row<T>[]> }>()
  useEffect(() => source ? tracker.watchRows<T>(source,
    (data, fresh) => setValue({ source, snapshot: { data, fresh } }),
    error => setValue({ source, snapshot: { data: [], fresh: false, error: errorMessage(error) } }),
  ) : undefined, [tracker, source])
  return value?.source === source ? value.snapshot : undefined
}

export function useSettings(tracker: Tracker) {
  const [value, setValue] = useState<Snapshot<Settings | null>>()
  useEffect(() => tracker.watchSettings(
    (data, fresh) => setValue({ data, fresh }),
    error => setValue({ data: null, fresh: false, error: errorMessage(error) }),
  ), [tracker])
  return value
}

export function useRange(tracker: Tracker, first: string, last: string, enabled = true) {
  const sources = useMemo(() => ({
    versions: tracker.overlapping('scheduleVersions', first, last),
    calendars: tracker.overlapping('calendars', first, last),
    pauses: tracker.overlapping('pauses', first, last),
    records: tracker.doseRange(first, last),
  }), [tracker, first, last])
  const versions = useRows<ScheduleVersion>(tracker, enabled ? sources.versions : null)
  const calendars = useRows<Calendar>(tracker, enabled ? sources.calendars : null)
  const pauses = useRows<Pause>(tracker, enabled ? sources.pauses : null)
  const records = useRows<DoseRecord>(tracker, enabled ? sources.records : null)
  return {
    versions: versions?.data, calendars: calendars?.data, pauses: pauses?.data, records: records?.data,
    error: versions?.error || calendars?.error || pauses?.error || records?.error,
    ready: !!versions && !!calendars && !!pauses && !!records,
    fresh: !!versions?.fresh && !!calendars?.fresh && !!pauses?.fresh && !!records?.fresh,
  }
}

export function useClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const update = () => setNow(Date.now())
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return now
}

export function usePlanned(tracker: Tracker, first: string, last: string, courses: Row<Course>[], enabled = true) {
  const range = useRange(tracker, first, last, enabled)
  const { versions, calendars, pauses, records } = range
  const doses = useMemo(() => versions && calendars && pauses && records && !range.error
    ? buildDoses(first, last, { courses, versions, calendars, pauses }, records) : [],
  [calendars, courses, first, last, pauses, range.error, records, versions])
  return { doses, ready: range.ready, fresh: range.fresh, error: range.error }
}
