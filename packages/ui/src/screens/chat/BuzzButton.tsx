import { useEffect, useState } from "react"
import { BuzzIcon } from "../../icons.js"
import { strings } from "../../strings.js"

/**
 * The nudge button.
 *
 * Deliberately dumb: it doesn't know what a direct channel is, counts no time
 * and plays no sound. All of that lives in `useBuzz`, which is the piece you
 * take with you when direct chats move to the Friends page, this file follows
 * it, with no glue stuck to where it came from.
 *
 * Lives in the compose bar next to the emoji button, not in the header: a
 * nudge is something you SAY to someone, and the place for things you say is
 * the line where you write. In the header it sat between video and invite,
 * that is, between two things that open windows, bad company for a gesture
 * you make and it's done.
 *
 * While the interval runs, the button closes AND SAYS HOW MUCH TIME LEFT. In
 * MSN the button would block and you'd see it was blocked; a button that stops
 * responding with no explanation looks like a bug, and whoever presses it again
 * doesn't know if the first one went through.
 */

/** How long the echo stays in the nudge button of whoever nudged. */
const ECO_MS = 620

export function BuzzButton({
  onBuzz,
  cooldown,
}: {
  onBuzz: () => void
  /** Seconds left. Zero means free. */
  cooldown: number
}): React.JSX.Element {
  const à_espera = cooldown > 0

  /**
   * The echo on the button itself, and why it exists.
   *
   * The nudge shakes the OTHER person's screen, whoever nudged never sees the
   * shake, and that's how it has to be: shaking the screen of whoever pressed
   * the button would punish them for pressing it. But with nothing on this end,
   * there's a sound and nothing else, and a gesture that only makes noise looks
   * like a failed gesture. This echo is the receipt: it went out.
   *
   * Local state, not from `useBuzz`: the button only opens when the interval
   * passes, so a click that arrives is a click that sends. There's nothing here
   * that the piece above knows better.
   */
  const [eco, setEco] = useState(false)
  useEffect(() => {
    if (!eco) return
    const fim = setTimeout(() => setEco(false), ECO_MS)
    return () => clearTimeout(fim)
  }, [eco])

  return (
    <button
      // Inside the `<form>` of the compose bar, a button with no `type` SUBMITS:
      // a nudge would send the sentence in the middle of typing it.
      type="button"
      className={eco ? "composer-buzz buzzed" : "composer-buzz"}
      disabled={à_espera}
      title={à_espera ? strings.chat.buzzWait(cooldown) : strings.chat.buzzTitle}
      onClick={() => {
        setEco(true)
        onBuzz()
      }}
    >
      {/* The label is for screen readers, like its neighbors on this line. It's not
          `aria-label`: this way the accessible name ADDS to the count, "Nudge 5s"
          , instead of erasing it. Comes first so you hear it in that order, not
          "5s Nudge"; it's out of flow, so it doesn't move what you see. */}
      <span className="visually-hidden">{strings.chat.buzz}</span>
      {à_espera ? (
        // The count NEVER hides: it's the only thing that explains why the button
        // stopped responding. It takes the place of the icon instead of sitting next
        // to it, the box is 34 pixels and both don't fit.
        <span className="buzz-count">{strings.chat.buzzCounting(cooldown)}</span>
      ) : (
        <BuzzIcon size={17} />
      )}
    </button>
  )
}
