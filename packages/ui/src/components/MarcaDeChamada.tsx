import { useId } from "react"
import { strings } from "../strings.js"

/**
 * What happens to ONE person in a call, shown by a drawing next to the name.
 *
 * ## Two silences that are not the same
 *
 * There was one mark, the crossed microphone, and it did not separate two opposite facts:
 * **the person muted their own microphone**, or **we put their volume to zero** (per-person
 * volume, `hooks/useVolumes.ts`). The second only existed as text on the call card ("muted
 * by you"), nowhere else: not on the video grid, not on the members list. Someone who turned
 * down someone else's audio ended up waiting for a reply they would never hear, convinced
 * the other person had muted themselves.
 *
 * They are now two drawings of DIFFERENT SHAPES, not two colors:
 *
 * - `calado`: a **crossed microphone**. It is theirs, it is their device, and it is what
 *   any phone shows when someone goes silent.
 * - `silenciado`: a **speaker with a cross beside it**. It is OUR audio that cuts it. Cross
 *   not stroke on purpose: two glyphs crossed by the same diagonal at 15 px are the same
 *   smudge with a different core. So one has a diagonal on top and the other has a mark
 *   beside, and the silhouette is enough.
 *
 * They can coexist on the same person, and both appear.
 *
 * ## The stroke: full, on the home grid, since October 28, 2026
 *
 * They were born full and round, "like on a phone call screen". On October 27 the owner
 * asked for a redesign "to match the general style of the platform" and, between two
 * directions, ended up with the full one on the home grid: filled shapes, but on the 24
 * grid, with the stroke and thin lines at 1.7 and the rounded corners of the rail icons.
 * The microphone stroke opens a band with a mask, as before; the speaker takes the cross
 * beside it, for the reason above; the screen takes the open arrow on it.
 *
 * ## Music (owner request October 27, 2026, 23:55)
 *
 * `musica`: two notes, filled balls, stems and the bar joining them at 1.7 stroke, on the
 * same grid. It serves the broadcast signal for voice rooms (`MarcaDeTransmissao`, below),
 * beside the `ecra`.
 */
export type TipoDeMarca = "calado" | "silenciado" | "ecra" | "musica"

const ROTULO: Record<TipoDeMarca, (nome: string) => string> = {
  calado: (nome) => strings.call.micOffOf(nome),
  silenciado: (nome) => strings.call.silencedByYouOf(nome),
  ecra: (nome) => strings.call.sharingOf(nome),
  musica: (nome) => strings.transmissao.musicaDe(nome),
}

/** The class each place already used to put the mark in place and give it color. */
export function MarcaDeChamada({
  tipo,
  nome,
  className,
  size = 16,
}: {
  tipo: TipoDeMarca
  /** Whom we are talking about. Goes into the label. */
  nome: string
  className: string
  size?: number
}): React.JSX.Element {
  const rotulo = ROTULO[tipo](nome)
  return (
    <span className={className} data-marca={tipo} role="img" aria-label={rotulo} title={rotulo}>
      <Glifo tipo={tipo} size={size} />
    </span>
  )
}

function Glifo({ tipo, size }: { tipo: TipoDeMarca; size: number }): React.JSX.Element {
  const mascara = `marca-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  const comum = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true,
    focusable: false,
  } as const
  if (tipo === "calado") {
    return (
      <svg {...comum}>
        <mask id={mascara} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
          <rect width={24} height={24} fill="#fff" />
          {/* The band the microphone line opens, wider than it. */}
          <path d="M4 3l16 18" stroke="#000" strokeWidth={5} strokeLinecap="round" />
        </mask>
        <g mask={`url(#${mascara})`}>
          <rect x={9} y={2.5} width={6} height={11} rx={3} fill="currentColor" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8 21h8" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
        </g>
        <path d="M4 3l16 18" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      </svg>
    )
  }
  if (tipo === "musica") {
    return (
      <svg {...comum}>
        {/* The stems and the bar joining them, at stroke; a full ball at each foot. */}
        <path d="M9 17.5V5.5l10-2v12" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={6.5} cy={17.5} r={2.6} fill="currentColor" />
        <circle cx={16.5} cy={15.5} r={2.6} fill="currentColor" />
      </svg>
    )
  }
  if (tipo === "silenciado") {
    return (
      <svg {...comum}>
        {/* The speaker box and cone, in one piece and full. */}
        <path d="M3 9.5h3.2l4.6-4V18.5l-4.6-4H3z" fill="currentColor" />
        {/* The cross where the waves would be: sound that does not leave here. */}
        <path d="M16.2 9.6l5 5M21.2 9.6l-5 5" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg {...comum}>
      <mask id={mascara} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
        <rect width={24} height={24} fill="#fff" />
        {/* The arrow leaving the screen, open on it: this goes from here to others. */}
        <path d="M12 14V8.2M9.3 10.9 12 8.2l2.7 2.7" stroke="#000" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      </mask>
      <rect x={2.5} y={4} width={19} height={13} rx={2.5} fill="currentColor" mask={`url(#${mascara})`} />
      <path d="M8 20.5h8" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" />
    </svg>
  )
}

/** What a person broadcasts in a voice room. */
export type Transmissao = "ecra" | "musica" | "ecra+musica"

const ROTULO_DA_TRANSMISSAO: Record<Transmissao, () => string> = {
  ecra: () => strings.transmissao.ecra,
  musica: () => strings.transmissao.musica,
  "ecra+musica": () => strings.transmissao.ambos,
}

/**
 * The broadcast indicator next to the face of whoever is sharing the screen or
 * playing music in a voice room on the sidebar (owner request, October 27, 2026,
 * 23:55: "stream icon in the communities column").
 *
 * The glyphs for the call badges, not a written "LIVE": in a narrow list you
 * read the shape, and the screen and notes are already the icons the call uses
 * for these two things. With both, the two glyphs side by side and one phrase
 * only, because it is ONE fact about the person.
 */
export function MarcaDeTransmissao({
  transmite,
  className = "marca-transmissao",
  size = 13,
}: {
  transmite: Transmissao
  className?: string
  size?: number
}): React.JSX.Element {
  const rotulo = ROTULO_DA_TRANSMISSAO[transmite]()
  return (
    <span className={className} data-transmite={transmite} role="img" aria-label={rotulo} title={rotulo}>
      {transmite !== "musica" && <Glifo tipo="ecra" size={size} />}
      {transmite !== "ecra" && <Glifo tipo="musica" size={size} />}
    </span>
  )
}

/**
 * What a call participant broadcasts based on what they said: the offered screen
 * (`ecraOferecido`) and the music playing (`aTocar`, or its stream). `undefined`
 * means they are not broadcasting anything.
 */
export function transmissaoDe(quem: {
  ecraOferecido?: boolean | undefined
  aTocar?: string | null | undefined
  musica?: MediaStream | null | undefined
}): Transmissao | undefined {
  const ecra = quem.ecraOferecido === true
  const musica = (quem.aTocar ?? null) !== null || (quem.musica ?? null) !== null
  if (ecra && musica) return "ecra+musica"
  if (ecra) return "ecra"
  if (musica) return "musica"
  return undefined
}
