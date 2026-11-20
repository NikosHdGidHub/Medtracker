import { useRef, useState } from 'react'
import { errorMessage } from '../services/firebase'

export function useAction(online = true) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<unknown>, needsNetwork = true) {
    if (lock.current) return false
    if (needsNetwork && (!online || !navigator.onLine)) {
      setError('Нет связи с сервером. Изменения не сохранены.')
      return false
    }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (error) {
      setError(errorMessage(error))
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return { busy, error, run }
}
