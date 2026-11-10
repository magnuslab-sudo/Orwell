/**
 * There are people talking there: the voices, standing.
 *
 * ## What this replaces
 *
 * A pill: rounded capsule, ten-pixel text, accent outline, pulsing. It is the
 * default seal of any interface kit, and it said little: "in call" when we were
 * inside, and a bare number when we were not, the same in everything as the
 * counts left to read that live beside it. Two capsules with a 3 each, on the
 * same line, saying two different things.
 *
 * ## The design
 *
 * The house mark is the rewritten O: horizontal bars, one of them slipped out
 * of alignment. The house voice is the `Onda`: bars standing up. They are the
 * same shape, and that is where this comes from. **One bar standing per person.**
 *
 * - **Two or more voices sit side by side**: they are talking. The symbol COUNTS,
 *   which is what the pill almost never did. The heights are staggered and fixed
 *   by order of arrival: whoever enters adds a bar, and the ones already there
 *   do not change size.
 * - **One voice alone calls**: it leans like a clapper, between unequal arcs.
 *   It is the "ringing" of a direct conversation, it is who sits alone in a room
 *   waiting for company, and it is us when we enter first. It stands out from
 *   talking voices by FORM, not by pulsing faster.
 * - **Our voice is the light bar that slipped off center**, as in the mark. With
 *   it in front, we are inside; without it, the call goes on without us.
 * - After four voices from others, a `+`. The exact number goes in the label.
 *
 * ## Wide, and in whole pixels
 *
 * The first version had bars of 3 with a gap of 2, and at real size it read tight:
 * the owner asked for it "wider and more legible". Now they are bars of 4 with
 * a gap of 3, heights that go from 6 to 16 (the difference between neighbors
 * is never less than 4), and the cap dropped from five to four before the `+`,
 * which is what pays for the width. All coordinates are INTEGERS: at 1x and 2x
 * each edge lands on a pixel, and a bar of 4 px does not end up with half a
 * pixel of gray on each side. A test guards that.
 *
 * ## It is still, and on purpose
 *
 * The rule comes from `Onda`: each pixel that moves is measurement. Here no one
 * measures anything (the sidebar has no call sound at all, much less one we are
 * not in), so nothing here moves on its own. The old pill pulsed at 1.6 s forever,
 * at the tick of a clock.
 *
 * The only exception is an entry gesture on the calling voice: the clapper shakes
 * twice when it appears and stops. It is `transform` and nothing else, with no
 * `var()` in the frames (which blocked Chromium from passing them to the
 * compositor), and whoever asked for less movement does not see it. See
 * `styles/vozes.css`.
 *
 * ## For those who hear the screen
 *
 * The text left the screen and did not leave the product. `rotulo` is mandatory
 * in the type: there is no way to draw this without deciding what it says in
 * words. It goes in `aria-label` and in `title`, and the drawing is `aria-hidden`
 * so it does not speak twice. Inside the row button, the accessible name becomes
 * "Redacção 3 people in call", which is more than was heard before.
 */

/** The heights of other people's voices, in the order they arrive. In 16 units of height. */
const ALTURAS = [16, 8, 12, 6] as const
/** Where each one starts: slightly off center, never the same, and an integer. */
const TOPOS = [0, 5, 1, 5] as const

const LARGURA = 4
const PASSO = 7
const ALTURA = 16
/** The `+`: arms of 2 thickness in an 8-square, at a gap from the bars. */
const MAIS = 8
/** Our bar: ten height, flush to the floor, three below center. */
const EU = { altura: 10, topo: 6 } as const

/** How many voices from others are drawn before the rest becomes a `+`. */
export const VOZES_A_VISTA = ALTURAS.length

export interface Tarja {
  x: number
  y: number
  altura: number
  /** Ours, or someone else's. */
  minha: boolean
}

export type DesenhoDasVozes =
  | { forma: "chama"; minha: boolean }
  | { forma: "conversa"; tarjas: Tarja[]; mais: boolean; largura: number }

/**
 * What is drawn for `other` people and, maybe, us.
 *
 * Outside the component so it can be saved by count: generated geometry that
 * breaks produces a plausible drawing instead of crashing.
 */
export function desenharVozes(outros: number, eu: boolean): DesenhoDasVozes | null {
  const gente = Math.max(0, Math.floor(outros))
  const total = gente + (eu ? 1 : 0)
  if (total === 0) return null
  if (total === 1) return { forma: "chama", minha: eu }

  const tarjas: Tarja[] = []
  let x = 0
  if (eu) {
    tarjas.push({ x, y: EU.topo, altura: EU.altura, minha: true })
    x += PASSO
  }
  const aVista = Math.min(gente, VOZES_A_VISTA)
  for (let i = 0; i < aVista; i++) {
    const altura = ALTURAS[i] as number
    tarjas.push({ x, y: TOPOS[i] as number, altura, minha: false })
    x += PASSO
  }
  const mais = gente > VOZES_A_VISTA
  return { forma: "conversa", tarjas, mais, largura: mais ? x + MAIS : x - (PASSO - LARGURA) }
}

export function Vozes({
  outros,
  eu = false,
  rotulo,
  className,
}: {
  /** How many people are there, not counting us. */
  outros: number
  /** Are we inside? */
  eu?: boolean | undefined
  /**
   * What the drawing says, in words. Mandatory: see the header.
   *
   * `null` is a statement and not an omission: it means "the phrase next to it
   * already says this in full" (the call header, the invite banner), and the
   * drawing stays silent so the screen reader does not hear the same thing twice.
   */
  rotulo: string | null
  className?: string | undefined
}): React.JSX.Element | null {
  const desenho = desenharVozes(outros, eu)
  if (!desenho) return null

  const classes = ["vozes", desenho.forma === "chama" ? "vozes-chama" : "", className ?? ""].filter(Boolean).join(" ")

  return (
    <span
      className={classes}
      {...(rotulo === null ? { "aria-hidden": true } : { role: "img", "aria-label": rotulo, title: rotulo })}
    >
      {desenho.forma === "chama" ? (
        <svg width={24} height={ALTURA} viewBox={`0 0 24 ${ALTURA}`} fill="none" aria-hidden="true" focusable="false">
          {/* One voice alone (owner choice, October 28, 2026: full in the house grid):
              the bar of who is there, and three dots fading in front, which is
              the wait. It was a clapper with arcs calling. */}
          <rect
            className={desenho.minha ? "vozes-minha" : undefined}
            x={1}
            y={2}
            width={LARGURA}
            height={12}
            rx={2}
            fill="currentColor"
          />
          <circle cx={9.5} cy={8} r={1.5} fill="currentColor" opacity={0.9} />
          <circle cx={15} cy={8} r={1.5} fill="currentColor" opacity={0.55} />
          <circle cx={20.5} cy={8} r={1.5} fill="currentColor" opacity={0.3} />
        </svg>
      ) : (
        <svg
          width={desenho.largura}
          height={ALTURA}
          viewBox={`0 0 ${desenho.largura} ${ALTURA}`}
          aria-hidden="true"
          focusable="false"
        >
          {desenho.tarjas.map((tarja) => (
            <rect
              key={tarja.x}
              className={tarja.minha ? "vozes-minha" : undefined}
              x={tarja.x}
              y={tarja.y}
              width={LARGURA}
              height={tarja.altura}
              rx={2}
              fill="currentColor"
            />
          ))}
          {desenho.mais && (
            <>
              <rect x={desenho.largura - MAIS + 1} y={ALTURA / 2 - 1} width={6} height={2} rx={1} fill="currentColor" />
              <rect x={desenho.largura - MAIS + 3} y={ALTURA / 2 - 3} width={2} height={6} rx={1} fill="currentColor" />
            </>
          )}
        </svg>
      )}
    </span>
  )
}
