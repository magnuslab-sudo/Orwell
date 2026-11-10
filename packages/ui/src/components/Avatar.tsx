import type { Profile } from "../bridge.js"
import { strings } from "../strings.js"

/**
 * The state the ring paints, by the house's words.
 *
 * `idle` is "offline" since forever (`strings.people.presenceIdle`), so it
 * paints gray. The yellow for "away" is `away`, a state the core does not yet
 * produce: the type accepts it already so the ring is ready when it arrives.
 */
export type EstadoDoAnel = "online" | "ausente" | "ocupado" | "offline"

export function estadoDoAnel(presence: "active" | "away" | "busy" | "idle" | undefined): EstadoDoAnel {
  if (presence === "active") return "online"
  if (presence === "away") return "ausente"
  if (presence === "busy") return "ocupado"
  // No known state is gray: the owner wants the ring on all faces, and
  // the color that asserts nothing is the one for no signal.
  return "offline"
}

/**
 * The presence ring attributes, for those drawing their own face.
 *
 * The account banner and call cards do not use this component, but they must
 * paint the same ring. The rule lives in `components.css` (`[data-anel]`) and
 * the attributes come from here, so there is only one way to write them.
 *
 * Attributes not classes: the classes on faces are already read by others
 * (`.avatar-wrap`, `.me-avatar`), and the ring adds itself without changing them.
 */
export function atributosDoAnel(
  estado: EstadoDoAnel,
  emChamada: boolean,
): { "data-anel": EstadoDoAnel; "data-em-chamada"?: "" } {
  return emChamada ? { "data-anel": estado, "data-em-chamada": "" } : { "data-anel": estado }
}

export function Avatar({
  profile,
  fallback,
  presence,
  presenceTitle,
  emChamada = false,
}: {
  profile: Profile | undefined
  fallback: string
  /** The person's state. Unknown: the screen does not know it, and the face has no ring. */
  presence?: "active" | "away" | "busy" | "idle" | undefined
  /** Overrides the default (derived-mode) tooltip when presence is live. */
  presenceTitle?: string | undefined
  /** The person is in a voice room or on a call: the ring pulses. */
  emChamada?: boolean | undefined
}): React.JSX.Element {
  /**
   * The initial of the NAME, when there is a name.
   *
   * Eight places draw avatars and six passed `endereco[1]`, the first
   * letter of the address, even though they had the profile in hand. Result: Zé appeared
   * with a round "D" above his name, the same family flaw as addresses in place of
   * names, only in a letter and so easier to miss. It was a screenshot for the homepage
   * that caught it, on August 13, 2026.
   *
   * Fixed here and not in the eight callers: the profile already reaches this
   * component, and the rule "name first" must live in one place only, or
   * the ninth caller will choose wrong again.
   */
  const inicial = profile?.displayName?.trim()?.[0] ?? fallback

  /*
    No `presence`, no ring.

    Gray means "offline", and it is an assertion. A screen that calls without state
    has no way to know; painting its faces gray would make the timeline say everyone
    is offline. Whoever knows the person is offline passes `idle`, and then the ring
    is gray.
  */
  const anel = presence === undefined ? {} : atributosDoAnel(estadoDoAnel(presence), emChamada)

  return (
    <span className="avatar-wrap" {...anel}>
      <span className="message-avatar">
        {profile?.avatarDataUrl ? <img src={profile.avatarDataUrl} alt="" /> : inicial.toUpperCase()}
      </span>
      {presence && (
        <span
          className={`presence-dot${presence === "idle" ? "" : ` ${presence}`}`}
          role="img"
          aria-label={
            presence === "active"
              ? strings.people.presence
              : presence === "away"
                ? strings.aneis.away
                : presence === "busy"
                  ? strings.people.presenceBusy
                  : strings.people.presenceIdle
          }
          title={presenceTitle ?? strings.people.presenceTitle}
        />
      )}
    </span>
  )
}
