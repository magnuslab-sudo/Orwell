import { formatInviteLink, parseInviteLink, sameHomeserver } from "@enclave/client-core"
import { eMoradaOpaca } from "@enclave/protocol"
import { nomeSeguro, semMarcasNemControlos } from "./ficheiros.js"
import { serverOf, shortName } from "./format.js"

/** What an invite link says, after being read. */
export type ConviteLido = NonNullable<ReturnType<typeof parseInviteLink>>

/**
 * The invite with which the page was opened, delivered by the HOST.
 *
 * A prop of `App` and not a field of the bridge, on purpose. The bridge is the
 * list of what a host can DO, and `bridge.paridade.test.ts` requires that both
 * do the same; this is not a capability, it is startup data, like the language
 * that `main.tsx` already reads from the address. The installed app has no address
 * to read it from: it does not pass the prop, and everything that lives here stays
 * inert, with no divergence to declare.
 *
 * Who reads and clears the address is the host (`apps/web/src/convite-arranque.ts`),
 * before the first draw. This package never sees the address.
 */
export interface StartupInvite {
  /** The invite read from the address, or what stayed stored in this tab. */
  invite: ConviteLido | null
  /**
   * The short link read from the address (`/app/c#…`, 1.0 "Arca", slice 5b-2), or
   * the stored one. It does not say the channel: it resolves on the server
   * (`invites.resolve`) after the gate, and only then becomes `invite`.
   */
  curta?: string | null
  /** The page was opened by an invite link that cannot be read. */
  invalid: boolean
  /** Clears what the host stored. Called when the invite resolves, one way or another. */
  forget: () => void
}

/**
 * What to do with an invite, decided in one place.
 *
 * Serves both the pasted link and the link the page opened with, so the two
 * cannot diverge on the rule that matters most: an invite from another server
 * cannot be redeemed. `invite.redeem` is local to a server (the code hash only
 * exists in the table of who issued it), so sending it to ours would tell it a
 * secret that is not theirs and get nowhere.
 */
export type DestinoDoConvite =
  | { que: "outro-servidor"; deles: string; meu: string }
  | { que: "ja-la-estou"; canal: string }
  | { que: "redimir"; canal: string; servidor: string; link: string }

export function destinoDoConvite(
  convite: ConviteLido,
  address: string | null,
  canais: readonly string[],
): DestinoDoConvite {
  const meu = serverOf(address)
  if (!sameHomeserver(convite.server, meu)) return { que: "outro-servidor", deles: convite.server, meu }
  if (canais.includes(convite.channel)) return { que: "ja-la-estou", canal: convite.channel }
  // Rebuilt and not forwarded: what goes to the core is always the canonical
  // form, whether the invite came from a new link, an old one, or startup.
  return { que: "redimir", canal: convite.channel, servidor: convite.server, link: formatInviteLink(convite.server, convite.channel, convite.code) }
}

/**
 * A name that came in a LINK, ready to show to a person.
 *
 * The channel and server of an invite are text from who sent the link, and are
 * read by someone about to decide whether to join. It is the same problem as
 * the name of an attachment, and solved the same way: strip direction marks (a
 * U+202E makes "lareg" read as "geral"), strip control characters, and cap at
 * 120 with tilde, so a name of two hundred thousand characters does not become
 * the entire dialog.
 */
export function canalParaMostrar(canal: string): string {
  return nomeSeguro(shortName(canal) || canal)
}

export function servidorParaMostrar(servidor: string): string {
  return nomeSeguro(servidor)
}

/** What the invite seal says (1.0 "Arca", slice 5c). See `invites.nome` in the bridge. */
export interface NomeDoConvite {
  canal: string
  quem?: string
}

/** The cap on a name from a seal, on screen. `space.meta` has 100. */
const NOME_DO_SELO_MAX = 100

/** A name read from a seal, cleaned like those from the link, or `null` if nothing remains. */
function nomeDoSeloParaMostrar(texto: string | undefined): string | null {
  const limpo = semMarcasNemControlos(texto ?? "")
  if (!limpo) return null
  return limpo.length <= NOME_DO_SELO_MAX ? limpo : `${limpo.slice(0, NOME_DO_SELO_MAX)}…`
}

/**
 * The channel name in the invite prompt, or `null` for "a channel".
 *
 * In order: the seal name (what whoever created the invite wrote, encrypted
 * with the code); without a seal, the name the address carries, if it is an
 * address with a name (those before 1.0, `!geral:orwell.pt`). An opaque address
 * (slice 3) is not a name: showing it would put `i8rwt9b44ce…` in a prompt to a
 * person.
 */
export function canalDoConviteParaMostrar(canal: string, nome: NomeDoConvite | null): string | null {
  const doSelo = nomeDoSeloParaMostrar(nome?.canal)
  if (doSelo) return doSelo
  return eMoradaOpaca(canal) ? null : canalParaMostrar(canal)
}

/** The name of who invited, from the seal, or `null`. Only with the channel name. */
export function quemConvidaParaMostrar(nome: NomeDoConvite | null): string | null {
  return nome && nomeDoSeloParaMostrar(nome.canal) ? nomeDoSeloParaMostrar(nome.quem) : null
}

/** The channel name the seal gave, cleaned, or `null`. Kept for the wait. */
export function nomeDoSelo(nome: NomeDoConvite | null): string | null {
  return nomeDoSeloParaMostrar(nome?.canal)
}

/**
 * The name of a channel we are waiting to join (the "waiting" line in the
 * sidebar and the notice "You joined …"), or `null` for a prompt without a
 * name.
 *
 * An address with a name (before 1.0) states its name, as always. An opaque
 * address is not a name: use the seal name, then the published channel name
 * (`space.meta`), and with neither of the two there is no name. The address
 * itself never does.
 */
export function canalAEsperaParaMostrar(canal: string, doSelo: string | null, publicado: string | undefined): string | null {
  if (!eMoradaOpaca(canal)) return canalParaMostrar(canal)
  return doSelo ?? nomeDoSeloParaMostrar(publicado)
}
