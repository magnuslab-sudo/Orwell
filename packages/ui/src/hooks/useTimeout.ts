import { useEffect, useState } from "react"

/**
 * Has `ms` passed since the component mounted?
 *
 * One timer and one extra draw when the deadline ends: does not count seconds,
 * because whoever uses this only wants to know if the wait is already long. A
 * new `ms` restarts the count.
 */
export function useTimeout(ms: number): boolean {
  const [passou, setPassou] = useState(false)

  useEffect(() => {
    setPassou(false)
    const temporizador = setTimeout(() => setPassou(true), ms)
    return () => clearTimeout(temporizador)
  }, [ms])

  return passou
}
