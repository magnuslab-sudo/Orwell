import { useEffect, useRef } from "react"
import type { Activity } from "../../bridge.js"
import { strings } from "../../strings.js"

/**
 * Choosing how you appear to the people who share channels with you.
 *
 * "Personalizado" deliberately does not invent a fourth state: it opens the
 * status line that already exists, and the dot keeps whichever base state is
 * chosen — a sentence about your day is not a different kind of presence.
 *
 * The invisibility note is not decoration. The server must know a connection
 * exists to deliver anything into it, so invisibility hides you from PEOPLE
 * and from nobody else; saying so where the choice is made is the difference
 * between a feature and a lie.
 */
export function ActivityMenu({
  activity,
  at,
  onChoose,
  onEditStatus,
  onClose,
}: {
  activity: Activity
  at: { x: number; y: number }
  onChoose: (activity: Activity) => void
  /** Put the status line in edit mode. Whoever has it is the shell, not this menu. */
  onEditStatus: () => void
  onClose: () => void
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const dismiss = (event: MouseEvent): void => {
      if (menu.current && event.target instanceof Node && menu.current.contains(event.target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("mousedown", dismiss, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", dismiss, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  const options: { value: Activity; label: string; dot: string }[] = [
    { value: "online", label: strings.activity.online, dot: "dot online" },
    { value: "ocupado", label: strings.activity.busy, dot: "dot busy" },
    { value: "ausente", label: strings.activity.away, dot: "dot away" },
    { value: "invisivel", label: strings.activity.invisible, dot: "dot invisible" },
  ]

  return (
    <div
      ref={menu}
      className="activity-menu"
      role="menu"
      aria-label={strings.activity.title}
      /**
       * `at.y` is the TOP of the button that opened it, like in all menus in
       * this app, and this is where it converts to the distance from the
       * bottom that this menu needs.
       *
       * The convention has to be one only. This component read `at.y` as distance
       * from the bottom while its neighbours read it as a coordinate from the
       * top, and whoever called it had to know which was which. It did not know:
       * all four buttons on the account card started sending the top, which
       * fixed three menus and put this one at the top of the window.
       *
       * Opens UPWARD on purpose: the card lives at the bottom of the column, and
       * a menu that went down from there would fall off the screen.
       */
      style={{ left: at.x, bottom: `calc(100dvh - ${at.y}px + 8px)` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="menuitemradio"
          aria-checked={option.value === activity}
          className={option.value === activity ? "activity-option on" : "activity-option"}
          onClick={() => {
            onClose()
            onChoose(option.value)
          }}
        >
          <span className={option.dot} />
          {option.label}
        </button>
      ))}

      <hr />

      <button
        role="menuitem"
        className="activity-option"
        onClick={() => {
          onClose()
          onEditStatus()
        }}
      >
        {strings.activity.custom}
      </button>

      {activity === "invisivel" && <p className="activity-note">{strings.activity.invisibleNote}</p>}
      {activity === "ocupado" && <p className="activity-note">{strings.activity.busyNote}</p>}
    </div>
  )
}
