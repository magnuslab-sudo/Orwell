import { useState } from "react"
import { strings } from "../strings.js"

/**
 * Text hidden until someone decides to read it. It is the `||assim||` of writing.
 *
 * **Hiding must actually hide.** A spoiler that reads at a glance when you pass
 * the mouse over it, or jumps out on Ctrl+A selection, is not a spoiler, it is
 * a decoration, and a decoration that spoils the ending of a film for someone who trusted
 * it. The two things that make it work are not in this file, they are in the
 * stylesheet, and it is worth saying here what they are:
 *
 * - `visibility: hidden` on the text inside. Not `opacity: 0` and not
 *   `color: transparent`: those two still let you select and copy the
 *   text underneath. `visibility: hidden` removes it from painting, selection, copy,
 *   tab order and the accessibility tree, and keeps its
 *   width, which makes the block the size of the hidden sentence.
 * - `user-select: none` on the wrapper, like a second belt.
 *
 * **And there is no `:hover` rule.** Hovering does not unhide,
 * on purpose: unhiding is a decision, and a decision needs a click.
 *
 * **Each one has its own state.** A shared toggle would unhide the whole
 * conversation at once, which is the opposite of what the markup promises.
 *
 * **It is a `span` with button role, not a `<button>`.** What is hidden
 * can carry links and mentions inside, and a button inside a button is invalid
 * HTML, the browser breaks it and what comes out is not what was written. While hidden,
 * the content is out of keyboard reach
 * (`visibility: hidden` handles that) and so there are no two targets competing;
 * unhidden, the button role leaves and the links inside become the
 * targets.
 */
export function Spoiler({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [aberto, setAberto] = useState(false)

  if (aberto) {
    return (
      <span className="spoiler aberto">
        <span className="spoiler-texto">{children}</span>
      </span>
    )
  }

  return (
    <span
      className="spoiler"
      role="button"
      tabIndex={0}
      aria-label={strings.common.spoilerShow}
      onClick={() => setAberto(true)}
      onKeyDown={(event) => {
        // The two keys that "press" a button. The `preventDefault` is for space:
        // without it, the bar scrolls the conversation while unhiding, and the line
        // just uncovered leaves the screen in the same gesture.
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        setAberto(true)
      }}
    >
      {/*
        The text is in the document, and that is inherent to unhiding that
        happens on this device: to show it without fetching anything, it must be
        here. What `aria-hidden` ensures is that nobody finds it by accident.
        Someone hearing the message hears "show hidden text", not the ending.
      */}
      <span className="spoiler-texto" aria-hidden="true">
        {children}
      </span>
    </span>
  )
}
