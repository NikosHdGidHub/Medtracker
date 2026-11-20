import { useEffect, useRef, useState } from 'react'
import type { Dose, Settings } from '../domain/models'
import { notify, reminderStep } from '../domain/reminders'
import { localInstant } from '../domain/time'

interface Seen {
  [id: string]: { step: number; expires: number }
}

export function useNotifications(doses: Dose[], now: number, today: string, settings: Settings, fresh: boolean) {
  const [messages, setMessages] = useState<string[]>([])
  const seen = useRef<Seen>({})
  const key = `medtracker.reminders.${settings.ownerId}`
  useEffect(() => {
    if (!settings.reminders || !fresh || !navigator.onLine) return
    const start = localInstant(today, settings.boundary, settings.zone).toMillis()
    const due = doses.flatMap(dose => {
      const step = reminderStep(dose, now, settings, today, start)
      return step === null ? [] : [{ dose, step }]
    })
    if (!due.length) return
    const deliver = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Seen
        seen.current = Object.fromEntries(Object.entries({ ...seen.current, ...stored })
          .filter(([, value]) => value && value.expires > now))
      } catch {
        // Keep the in-memory deduplication if local storage is unavailable.
      }
      for (const { dose, step } of due) {
        if ((seen.current[dose.id]?.step ?? -1) >= step) continue
        seen.current[dose.id] = { step, expires: now + 2 * 86_400_000 }
        try { localStorage.setItem(key, JSON.stringify(seen.current)) } catch { /* in-memory fallback */ }
        const body = settings.privateText ? 'Проверьте, был ли запланированный приём.' : `Проверьте, был ли приём «${dose.name}».`
        void notify('Medtracker', body, dose.id, message =>
          setMessages(current => current.includes(message) ? current : [...current.slice(-4), message]))
      }
    }
    if (navigator.locks) void navigator.locks.request(key, deliver).catch(() => undefined)
    else deliver()
  }, [doses, fresh, key, now, settings, today])
  return { messages, clear: () => setMessages([]) }
}
