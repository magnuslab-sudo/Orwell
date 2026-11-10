import { CRYPTOGRAPHIC_POWERS, IRREVERSIBLE_POWERS, POWERS, type Power } from "@enclave/protocol"
import { strings } from "../strings.js"

/*
  Re-exported from the protocol, not written here again.

  They were copied in this file, which is exactly what the comment on
  `POWERS` warns not to do, and the warning caught itself: when `eliminar`
  entered the protocol list, the local copy did not have it, and the
  responsibility existed in the core with no way to assign it. The symptom
  would be silent: a role missing a power no one saw missing.
*/
export { CRYPTOGRAPHIC_POWERS, IRREVERSIBLE_POWERS, POWERS }

function nomearPoderes(powers: readonly Power[]): string {
  return powers.map((poder) => strings.roles.powers[poder] ?? poder).join(", ")
}

/**
 * The three kinds of responsibility, by weight order.
 *
 * **There are three not two, and the protocol says so.** It stores two lists
 * because it asks two different questions: `CRYPTOGRAPHIC_POWERS` asks what the
 * cipher guarantees against an ALTERED client, and `IRREVERSIBLE_POWERS` asks
 * what does not undo for those who COMPLY. The answers do not match, and the
 * place where they diverge has a name: `eliminar`. It is convention, an
 * altered client ignores the tombstone and keeps what it had, and at the same
 * time it has no reverse gesture: those who comply release the channel and
 * delete what they had from it.
 *
 * The interface read only the first list all the time the second one existed,
 * and the result was this sentence, on a role card:
 *
 *     Agreed between clients: end the channel, change the name.
 *
 * Two verbs on the same line, same color and same size, where one undoes the
 * channel for everyone and the other undoes by writing again. This is not a
 * copy imprecision: it is the interface stating that both things are of the
 * same kind at the exact moment someone is giving them to another person.
 *
 * The partition is total and with no overlap, each responsibility falls in one
 * tier and only one, and it comes from the protocol lists instead of a list
 * written here. A fourth responsibility that tomorrow enters
 * `IRREVERSIBLE_POWERS` appears in the right tier without anyone remembering
 * this file.
 */
export interface Degraus {
  /** What the cipher guarantees. Today `expulsar`, and only that. */
  cifra: Power[]
  /** Convention, and even so with no undo. Today `eliminar`. */
  semVolta: Power[]
  /** Convention with reverse gesture: change name, move, pin, answer. */
  combinado: Power[]
}

export function degrausDe(powers: readonly Power[]): Degraus {
  const cifra = powers.filter((poder) => CRYPTOGRAPHIC_POWERS.includes(poder))
  // Without those from the cipher: `expulsar` is in both lists, and a power that
  // appears in two tiers makes the interface promise two things with one
  // responsibility.
  const semVolta = powers.filter((poder) => IRREVERSIBLE_POWERS.includes(poder) && !CRYPTOGRAPHIC_POWERS.includes(poder))
  const combinado = powers.filter(
    (poder) => !CRYPTOGRAPHIC_POWERS.includes(poder) && !IRREVERSIBLE_POWERS.includes(poder),
  )
  return { cifra, semVolta, combinado }
}

/**
 * The groups of the "Permissions" section, arranged like Discord arranges a
 * role.
 *
 * Owner's request on 27 October 2026: "reorganize the menu, just like in
 * Discord". Replaces, in the FORM, the three boxes by kind (cipher, no undo,
 * convention). The kind is not lost: the cipher group stays at the head with
 * its mark, and each responsibility with no undo gets the mark "Permanent" on
 * the line. The cards in the list and the profile still read `degrausDe`, which
 * is their question.
 *
 * **The partition stays total and with no overlap.** The cipher comes out of
 * `degrausDe`, not from a list written here. The rest goes by subject, and a
 * responsibility a future version brings with no subject falls into `outras`
 * instead of staying without a toggle. That was the silent flaw of `eliminar`.
 *
 * There is no empty "Voice" group: `mover` is the voice responsibility (move
 * someone between voice rooms) and it fills it.
 */
export type GrupoDePermissoes = "cifra" | "gerir" | "membros" | "mensagens" | "voz" | "outras"

const ASSUNTO: Partial<Record<Power, Exclude<GrupoDePermissoes, "cifra" | "outras">>> = {
  renomear: "gerir",
  eliminar: "gerir",
  gerircargos: "gerir",
  gerirsalas: "gerir",
  convidar: "membros",
  expulsar: "membros",
  fixar: "mensagens",
  atender: "mensagens",
  // Delete messages and closed reports, and change nicknames: it is about what
  // is said in the channel, and so it lives next to pin and answer.
  moderar: "mensagens",
  // `@all`: it is about what is said in the channel, like in Discord ("Mention @everyone").
  mencionartodos: "mensagens",
  mover: "voz",
  desligar: "voz",
}

const ORDEM_DOS_GRUPOS: readonly GrupoDePermissoes[] = ["cifra", "gerir", "membros", "mensagens", "voz", "outras"]

export function gruposDePermissoes(powers: readonly Power[]): { grupo: GrupoDePermissoes; poderes: Power[] }[] {
  const { cifra } = degrausDe(powers)
  const grupoDe = (poder: Power): GrupoDePermissoes =>
    cifra.includes(poder) ? "cifra" : (ASSUNTO[poder] ?? "outras")
  return ORDEM_DOS_GRUPOS.map((grupo) => ({ grupo, poderes: powers.filter((poder) => grupoDe(poder) === grupo) })).filter(
    (entrada) => entrada.poderes.length > 0,
  )
}

/**
 * What a role gives, stated in the three registers that exist.
 *
 * Lives apart because the split is done in two places: whoever defines the
 * roles sees it in the channel properties, and whoever looks at a person sees
 * it in their profile. Duplicating the `filter` would let the two halves
 * diverge, and what would diverge is exactly the line between what the cipher
 * guarantees and what clients merely agree on, which is the only thing here
 * that cannot fail.
 *
 * The role editor had its own copy of the `filter`, with two lines instead of
 * three, even though this component exists right next door. That is why the
 * middle tier was born missing from both screens at the same time: the copy
 * followed the wrong list, and the original did too.
 *
 * **The order is by weight, not the order from `POWERS`.** What does not undo
 * reads first, because it is what changes the decision to give a role to
 * someone.
 */
export function RolePowers({ powers }: { powers: readonly Power[] }): React.JSX.Element {
  if (powers.length === 0)
    return (
      <span className="role-poderes">
        <span className="role-line role-vazio">{strings.roles.accessOnly}</span>
      </span>
    )

  const { cifra, semVolta, combinado } = degrausDe(powers)
  return (
    <span className="role-poderes">
      {cifra.length > 0 && <span className="role-line role-sealed">{strings.roles.cryptographic(nomearPoderes(cifra))}</span>}
      {semVolta.length > 0 && (
        <span className="role-line role-final">{strings.roles.irreversible(nomearPoderes(semVolta))}</span>
      )}
      {combinado.length > 0 && <span className="role-line">{strings.roles.convention(nomearPoderes(combinado))}</span>}
    </span>
  )
}
