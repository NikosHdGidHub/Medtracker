import type { Dose, Settings } from './models'

export function reminderStep(dose: Dose, now: number,
  settings: Pick<Settings, 'repeatMinutes' | 'repeats'>, day: string, dayStart: number) {
  if (dose.status !== 'pending' || dose.logicalDate > day) return null
  const deadline = dose.deadlineAt.toMillis()
  const interval = settings.repeatMinutes * 60_000
  const step = Math.floor((now - deadline) / interval)
  if (step < 0 || step > settings.repeats) return null
  const scheduled = deadline + step * interval
  if (dose.logicalDate < day && scheduled < dayStart) return null
  if (dose.record && scheduled <= dose.record.recordedAt.toMillis()) return null
  return step
}

export async function notify(title: string, body: string, tag: string, fallback: (body: string) => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    fallback(body)
    return
  }
  try {
    const registration = 'serviceWorker' in navigator
      ? await navigator.serviceWorker.getRegistration() : undefined
    if (registration?.active) {
      await registration.showNotification(title, { body, tag, icon: import.meta.env.BASE_URL + 'icons/icon-192.png' })
    } else {
      new Notification(title, { body, tag })
    }
  } catch {
    fallback(body)
  }
}
