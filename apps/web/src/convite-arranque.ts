import {
  formatShortInviteLink,
  INVITE_PATH,
  PAIR_PATH,
  parseInviteLink,
  parsePairLink,
  parseShortInviteLink,
  SHORT_INVITE_PATH,
} from "@enclave/client-core"
import { eCaminhoDeAmigo, lerLigacaoDeAmigo, type StartupInvite, type StartupPairing } from "@enclave/ui"

/**
 * The invite link that opened the page.
 *
 * An invite link is `https://<servidor>/app/convite#<canal>/<código>`, or the
 * short link from 1.0, `/app/c#<código curto>.<código>` (the `/c#…` copied
 * here arrives via Caddy redirect). The path lands on `index.html` like any
 * other, and this function reads it, called ONCE by `main.tsx`, before the
 * first render and before any `await`.
 *
 * Three steps, in this order, and order is security:
 *
 *  1. Read the address.
 *  2. CLEAR the address right away with `replaceState`, whether the link
 *     works or not. The code is a bearer secret: while it sits in the bar it
 *     lives in history, in tab sync across devices, and in any screenshot.
 *     `replaceState` replaces the entry instead of stacking another, so
 *     "back" won't bring it back either.
 *  3. Store the invite in `sessionStorage`: per tab, dies with it, and it's
 *     where the vault key already lives (`bridge.ts`). Needed because account
 *     creation or unlock can reload the page, and the invite must be on the
 *     other side of the gate.
 *
 * Nothing here writes the code to a log, console, or error message.
 */

/** Follows the convention of other keys on this host. The protocol is called `enclave`. */
export const CHAVE_DO_CONVITE = "enclave.convite-pendente"
/** The pairing link waiting, by the same convention and for the same reason. */
export const CHAVE_DO_EMPARELHAMENTO = "enclave.emparelhamento-pendente"
/** The address of a friend link waiting at the gate. */
export const CHAVE_DO_AMIGO = "enclave.amigo-pendente"

type Convite = NonNullable<StartupInvite["invite"]>

/** What this function needs from the browser, and nothing more: that's what lets it be tested without one. */
export interface AmbienteDoArranque {
  location: Pick<Location, "href" | "pathname">
  history: Pick<History, "replaceState">
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null
  /** The `import.meta.env.BASE_URL`: `/app/`. */
  base: string
}

/**
 * What goes in the tab: the invite read, or the short link to resolve
 * (`{ curta }`, 1.0 "Arca", slice 5b-2). A key just for the two of them, because an
 * open link afterward replaces the previous one, whatever form each takes.
 */
type Guardado = Convite | { curta: string }

function guardar(storage: AmbienteDoArranque["storage"], convite: Guardado): void {
  try {
    storage?.setItem(CHAVE_DO_CONVITE, JSON.stringify(convite))
  } catch {
    // Storage full or locked: the invite stays in memory only, and is lost
    // on a reload. It is a convenience less, not a defect.
  }
}

function esquecer(storage: AmbienteDoArranque["storage"]): void {
  try {
    storage?.removeItem(CHAVE_DO_CONVITE)
  } catch {
    // Idem.
  }
}

function guardado(storage: AmbienteDoArranque["storage"]): Guardado | null {
  try {
    const cru = storage?.getItem(CHAVE_DO_CONVITE)
    if (!cru) return null
    const lido = JSON.parse(cru) as (Partial<Convite> & { curta?: unknown }) | null
    // The short link stored is read again by the core: what was left from another
    // version, or corrupted, is thrown away like the rest.
    if (lido && typeof lido.curta === "string" && parseShortInviteLink(lido.curta)) return { curta: lido.curta }
    if (
      lido &&
      typeof lido.server === "string" &&
      typeof lido.channel === "string" &&
      typeof lido.code === "string" &&
      lido.server &&
      lido.channel &&
      lido.code
    ) {
      return { server: lido.server, channel: lido.channel, code: lido.code }
    }
  } catch {
    // Corrupted JSON or locked storage: there is no invite.
  }
  esquecer(storage)
  return null
}

export function lerConviteDeArranque(ambiente: AmbienteDoArranque): StartupInvite {
  const { location, history, storage, base } = ambiente
  const forget = (): void => esquecer(storage)

  // `INVITE_PATH` and `SHORT_INVITE_PATH` are the core's literals, and they are the
  // only paths that matter.
  const curta = location.pathname === SHORT_INVITE_PATH
  if (location.pathname !== INVITE_PATH && !curta) {
    const visto = guardado(storage)
    return visto && "curta" in visto
      ? { invite: null, curta: visto.curta, invalid: false, forget }
      : { invite: visto, curta: null, invalid: false, forget }
  }

  const endereco = location.href
  // Before looking at what was there. See point 2 above.
  try {
    history.replaceState(null, "", base)
  } catch {
    /*
      `replaceState` throws on an opaque origin, and Safari throws when it goes
      over a hundred calls in thirty seconds. This runs at the top of `main.tsx`: an
      exception here was the app drawing NOTHING, and the code in the bar stays,
      which is the worst of both worlds. Carry on: the invite is read,
      the person enters, and the bar is left uncleared only where there was no way.
    */
  }

  if (curta) {
    /*
      The short link does not say the channel: the link is saved, in the core's
      canonical form, and is resolved after the gate (`invites.resolve`). The invite
      code goes with it to the tab, as the long one already did.
    */
    const lida = parseShortInviteLink(endereco)
    if (!lida) {
      forget()
      return { invite: null, curta: null, invalid: true, forget }
    }
    const canonica = formatShortInviteLink(lida.server, lida.codigoCurto, lida.code)
    guardar(storage, { curta: canonica })
    return { invite: null, curta: canonica, invalid: false, forget }
  }

  const invite = parseInviteLink(endereco)
  if (!invite) {
    // A corrupted link does not wait either: what was stored
    // from a previous click on this tab has been replaced by this one.
    forget()
    return { invite: null, curta: null, invalid: true, forget }
  }
  guardar(storage, invite)
  return { invite, curta: null, invalid: false, forget }
}

/** The `sessionStorage`, or nothing: there are browsers that throw just by touching it. */
export function armazenamentoDoSeparador(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * The pairing link that opened the page: `/app/emparelhar#<segredo>`.
 *
 * Same move as `lerConviteDeArranque`, with more at stake: whoever holds the
 * secret joins the pairing box. Read, CLEAR the address right now (before
 * looking at what was there), and store on the tab so the gate finds it on
 * the other side of vault creation. What we store is the FULL link, that's
 * what the core reads; the secret doesn't get split off here.
 *
 * Nothing here writes the secret to a log, console, or message.
 */
export function lerEmparelhamentoDeArranque(ambiente: AmbienteDoArranque): StartupPairing {
  const { location, history, storage, base } = ambiente
  const forget = (): void => {
    try {
      storage?.removeItem(CHAVE_DO_EMPARELHAMENTO)
    } catch {
      // Idem.
    }
  }

  if (location.pathname !== PAIR_PATH) {
    let guardado: string | null = null
    try {
      const cru = storage?.getItem(CHAVE_DO_EMPARELHAMENTO)
      // Only what is still a link: what was left from another version is thrown away.
      guardado = cru && parsePairLink(cru) ? cru : null
      if (cru && !guardado) forget()
    } catch {
      guardado = null
    }
    return { link: guardado, invalid: false, forget }
  }

  const endereco = location.href
  try {
    history.replaceState(null, "", base)
  } catch {
    // See the same note in `lerConviteDeArranque`: carry on.
  }

  if (!parsePairLink(endereco)) {
    forget()
    return { link: null, invalid: true, forget }
  }
  try {
    storage?.setItem(CHAVE_DO_EMPARELHAMENTO, endereco)
  } catch {
    // Stays in memory only.
  }
  return { link: endereco, invalid: false, forget }
}

/**
 * The friend link that opened the page: the short one from 1.0, `/app/a#<id>`
 * (the `/a#<id>` copied here arrives via Caddy redirect), or the long one,
 * `/app/amigo#@<id>:<servidor>`, which still works during 1.0.
 *
 * Same structural form as `StartupFriend` (`@enclave/ui`, `bridge.ts`),
 * written here so this file doesn't depend on a type that the UI package
 * hasn't exported yet.
 */
export interface AmigoDeArranque {
  address: string | null
  invalid: boolean
  forget: () => void
}

/**
 * The same three steps as `lerConviteDeArranque`, in the same order: read,
 * CLEAR the address with `replaceState`, and save to the tab.
 *
 * There is no secret here (an address is meant to be shared), and the clear
 * happens anyway, for two reasons. A bar with another person's address is a
 * bit of the social graph in the browser's history and in tab sync, which is
 * what this design avoids having outside the vault. And a reload with the link
 * in the bar would open the profile sheet again after the person already
 * resolved it. The ADDRESS is saved, already validated by the core
 * (`lerLigacaoDeAmigo`, which validates via the core's `parseFriendLink`), not the link.
 */
export function lerAmigoDeArranque(ambiente: AmbienteDoArranque): AmigoDeArranque {
  const { location, history, storage, base } = ambiente
  const forget = (): void => {
    try {
      storage?.removeItem(CHAVE_DO_AMIGO)
    } catch {
      // Idem.
    }
  }

  if (!eCaminhoDeAmigo(location.pathname)) {
    let guardado: string | null = null
    try {
      const cru = storage?.getItem(CHAVE_DO_AMIGO) ?? null
      // Only what is still an account address: the rest is thrown away.
      guardado = cru && /^@[^\s:@/#?]+:[^\s@/#?]+$/.test(cru) ? cru : null
      if (cru && !guardado) forget()
    } catch {
      guardado = null
    }
    return { address: guardado, invalid: false, forget }
  }

  const endereco = location.href
  try {
    history.replaceState(null, "", base)
  } catch {
    // See the same note in `lerConviteDeArranque`: carry on.
  }

  const lido = lerLigacaoDeAmigo(endereco)
  if (!lido) {
    forget()
    return { address: null, invalid: true, forget }
  }
  try {
    storage?.setItem(CHAVE_DO_AMIGO, lido.address)
  } catch {
    // Stays in memory only.
  }
  return { address: lido.address, invalid: false, forget }
}
