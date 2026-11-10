import { useEffect, useRef, useState } from "react"
import { strings } from "../../strings.js"

/**
 * The status text, being edited.
 *
 * It goes out as a profile update to every channel you are in, which is the only
 * way anyone can see it, there is no presence server to push it to, and it is
 * something you wrote, not something inferred from your activity.
 *
 * Up to 0.9 it was a fixed line on the account card, which became a field on
 * click. The banner the owner chose on 27 October 2026 is one line only, and
 * this line came out of it: it mounts only when the "Custom…" in the status menu
 * asks for it, and `onFim` unmounts it. The written text continues to show in
 * the profile and member list.
 */
export function StatusBar({
  value,
  onSave,
  onFim,
}: {
  value: string
  onSave: (status: string) => void
  /** Editing done: saved (Enter, blur) or discarded (Esc). */
  onFim: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  /*
    Editing ends once. Enter saves and unmounts the field, and a browser
    that sends `blur` when removing the focused field from the document would call
    `commit` again: two sends of the same profile to all channels.
  */
  const acabou = useRef(false)

  useEffect(() => setDraft(value), [value])

  const commit = (): void => {
    if (acabou.current) return
    acabou.current = true
    const trimmed = draft.trim()
    if (trimmed !== value) onSave(trimmed)
    onFim()
  }

  return (
    <input
      className="status-input"
      autoFocus
      value={draft}
      maxLength={128}
      aria-label={strings.sidebar.statusPrompt}
      placeholder={strings.sidebar.statusPrompt}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit()
        if (event.key === "Escape") {
          acabou.current = true
          setDraft(value)
          onFim()
        }
      }}
    />
  )
}
