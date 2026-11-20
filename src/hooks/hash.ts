import { useEffect, useState } from 'react'

export function useHash() {
  const read = () => window.location.hash.replace(/^#\/?/, '') || 'today'
  const [path, setPath] = useState(read)
  useEffect(() => {
    const change = () => {
      setPath(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return path
}
