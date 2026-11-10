/**
 * The voice, drawn.
 *
 * ## Why this is not decoration
 *
 * The meter (`hooks/useNivelDeVoz.ts`) has existed since August 13, 2026 and
 * measured well; what it produced appeared on the screen as a three-pixel ring
 * around a video box which, in a voice-only call, is hidden with zero height.
 * In other words: the information was measured sixty times a second and reached
 * nobody.
 *
 * A bar that rises with the voice answers three questions the product already
 * knew how to answer and did not: **who is speaking** (in a list of identical
 * cards), **whether the microphone picks up** (before entering a call), and
 * **whether the connection broke** (a still wave with people talking on the
 * other side). None of them read in a dot that blinks to the beat of a clock.
 *
 * ## Everything that moves is the measurement. There is no animation.
 *
 * The first version of this piece had `@keyframes`: each bar oscillated on its
 * own, with out-of-sync rhythms, and the voice commanded the amplitude. It
 * looked good and cost **half a millisecond per frame in a SILENT call**, 49
 * bars being calculated in the main thread sixty times a second to show nothing
 * (measured in `scripts/medir-voz-visivel.mjs`: 562 µs against 51 µs without
 * waves). The frames contained `var()`, which stops Chromium from passing them
 * to the compositor.
 *
 * What stayed is better and almost free: the height of each bar is a function of
 * the level, and nothing else. In an eight-person call, silent, the entire page
 * costs 100 to 125 µs per frame (against 562 µs with the animation running on
 * nothing); with one person speaking, plus 110 to 170 µs; with all eight
 * speaking at the same time and new value in every frame, which does not
 * happen, plus 480 to 580 µs, or roughly 65 µs per person. Zero extra layouts,
 * always. The numbers come from `scripts/medir-voz-visivel.mjs`, three runs.
 *
 * And there is an advantage that is not about cost: **every pixel that moves is
 * measurement**. In a product that sells not having to believe anyone, a bar
 * dancing on its own was the only thing on the screen that pretended.
 *
 * The wave stays alive because the voice is alive: the level rises fast and
 * falls slow (see the meter), and the bars do not all rise at the same time,  * each one has its `--degrau`, and the wave grows from the center outward as
 * the voice tightens. Two people speaking with different strength draw different
 * shapes.
 *
 * ## What this piece DOES NOT do: measure
 *
 * It does not open any `AudioContext` and does not know `MediaStream`. It draws
 * `var(--voz)`, the property the meter writes on the card, and custom
 * properties INHERIT. A wave inside a card that already measures costs zero new
 * measurements, and that is what makes it cheap enough to appear on each
 * participant of each call.
 *
 * With no one measuring above, `var(--voz, 0)` gives zero and the wave stays at
 * rest. It does not disappear or complain: a still wave is the honest drawing of
 * silence.
 *
 * ## Movement
 *
 * What changes is `transform: scaleY()`, which does not touch layout. Nothing
 * here moves `height`, `width` or `margin`, in a grid of eight cards, a bar
 * moving height would force the page to recalculate sixty times a second. The
 * script counts layouts and fails if they grow.
 *
 * With `prefers-reduced-motion` the bars stop for good: they stay at full height
 * and light up in the same order, from center outward, each one at its
 * `--degrau`. The level is still all there, with nothing changing size. See
 * `components.css`.
 *
 * ## For those who hear the screen
 *
 * `aria-hidden`, and on purpose. A value that changes sixty times a second is not
 * announced, what would come out of there was a machine gun of numbers. In every
 * place this wave enters, the fact it illustrates is written in text next to it:
 * the name and state on the call card, "In call" on the dock, and the sentence
 * from the meter in Settings. The wave is the quick way to look; it is never the
 * only one.
 */

/**
 * What is left of height when no one speaks.
 *
 * A line, not nothing: a faded wave reads as a fault, and the drawing of a
 * silent room has to be a quiet stroke. Not too little: at 0.14 the bars
 * became squares, two pixels by two, and four squares in a row next to a
 * name, in a chat application, read as "is typing". At this value they are
 * vertical strokes, which is what a resting wave should be.
 *
 * It goes to CSS as a property and is not written there: the sheet only knows
 * `var(--repouso)`, and the value lives here, next to the `--peso` that has to
 * add up to exactly 1 with it.
 */
const REPOUSO = 0.26

/**
 * How out of sync the bar steps are.
 *
 * This is what stops the wave from being a shape inflating as a block. At zero,
 * all bars would rise at the same pace and the drawing would read as one object
 * growing. At 0.8, the middle bar starts rising right away and the ones at the
 * ends only near the end: the wave WIDENS with the voice, instead of just
 * getting fatter.
 */
const ESPALHA = 0.8

/**
 * The shape of the wave: low at the ends, high in the middle.
 *
 * A half-sine gives the curve of a wave without any table. This number decides
 * two things at the same time: the maximum height of the bar (`--peso`) and from
 * what level it starts to rise (`--degrau`, which is the inverse), and that
 * second one is what makes the wave grow from the center outward.
 */
function envelope(indice: number, total: number): number {
  return 0.42 + 0.58 * Math.sin((Math.PI * (indice + 0.5)) / total)
}

export function Onda({
  barras = 5,
  className,
}: {
  /** How many bars. Five on the dock, four on the card, twelve in Settings. */
  barras?: number
  className?: string | undefined
}): React.JSX.Element {
  return (
    <span
      className={className ? `onda ${className}` : "onda"}
      aria-hidden="true"
      /* The floor, written once and inherited by all bars. CSS does not know this
         number: it has to add up to 1 with the highest `--peso`, and two places
         storing half of that calculation is how it stays closed. */
      style={{ "--repouso": REPOUSO } as React.CSSProperties}
    >
      {Array.from({ length: barras }, (_, indice) => {
        const forma = envelope(indice, barras)
        return (
          <span
            key={indice}
            className="onda-barra"
            style={
              {
                /* The height of this bar at maximum voice, from 0 to 1 minus the rest.
                   The two parts add up to the entire box and never more. */
                "--peso": ((1 - REPOUSO) * forma).toFixed(3),
                /* From what level this bar starts to rise. The inverse of the shape: the
                   middle one starts right away, the ones at the ends at the end. */
                "--degrau": ((1 - forma) * ESPALHA).toFixed(3),
              } as React.CSSProperties
            }
          />
        )
      })}
    </span>
  )
}
