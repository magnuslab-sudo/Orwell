import { useEffect, useState } from "react"

/** Wall-clock length of the current call, ticking once a second. */
export function useElapsed(): string {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setSeconds((current) => current + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}
