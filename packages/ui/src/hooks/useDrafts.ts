import { useCallback, useState } from "react"

/** Pure update: set (or clear, for "") one channel's draft without mutating. */
export function withDraft(drafts: ReadonlyMap<string, string>, channel: string, text: string): ReadonlyMap<string, string> {
  const next = new Map(drafts)
  if (text === "") next.delete(channel)
  else next.set(channel, text)
  return next
}

/**
 * One draft per channel, in memory only.
 *
 * Deliberately not persisted: a draft is unencrypted plaintext, and writing it
 * anywhere durable would leak message content outside the vault. Surviving a
 * channel switch is what matters; surviving a restart is not worth that trade.
 */
export function useDrafts(): {
  draftFor: (channel: string | null) => string
  setDraft: (channel: string, text: string) => void
} {
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map())

  const draftFor = useCallback(
    (channel: string | null) => (channel ? (drafts.get(channel) ?? "") : ""),
    [drafts],
  )

  const setDraft = useCallback((channel: string, text: string) => {
    setDrafts((current) => withDraft(current, channel, text))
  }, [])

  return { draftFor, setDraft }
}
