import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FriendTie } from "@enclave/protocol"
import type { EnclaveBridge } from "../bridge.js"
import type { Friendships } from "../lib/friendship.js"
import { isDirect } from "../lib/format.js"
import { strings, traduzirErro } from "../strings.js"
import { useConfirmar } from "./useConfirmar.js"
import type { ToastLevel } from "./useToasts.js"

/**
 * Where the relationship with a person stands, from the button's point of view.
 *
 * Five states, not the five of the link (`FriendLink`): the cross reads here
 * as "received", because accepting is what closes it on both sides. See
 * `openRequestsOf`, in the protocol.
 */
export type EstadoDaAmizade = "eu" | "amigos" | "pedido-enviado" | "pedido-recebido" | "nenhum"

/**
 * The state the single button shows, calculated and never stored.
 *
 * `ehAmigo` comes from outside because the link has short memory: an old
 * friendship may no longer have `friend.accept` in view. It must be the HARD
 * fact (swapped feed slots, see `amigoDeFacto` in the shell) and never `friends`,
 * which counts any direct conversation as a relationship.
 */
export function estadoDaAmizade(
  who: string,
  me: string | null,
  tie: FriendTie | undefined,
  ehAmigo: boolean,
): EstadoDaAmizade {
  if (who === me) return "eu"
  /*
    The loop first, and the cryptographic fact only after.

    A standing request is what the person needs to see, and only the link knows
    it. The fact (`ehAmigo`) exists because the link has short memory: an old
    friendship may no longer have `friend.accept` in view. Read before the loop,
    a weak fact would hide the request.
  */
  if (tie?.link === "amigos") return "amigos"
  if (tie?.link === "pedido-recebido" || tie?.link === "cruzado") return "pedido-recebido"
  if (tie?.link === "pedido-enviado") return "pedido-enviado"
  if (ehAmigo && !tie?.severed) return "amigos"
  return "nenhum"
}

export interface Amizade {
  /**
   * Request friendship. The note goes with the request when there is a write. Resolves
   * `true` when the request went out.
   */
  pedir: (who: string, note?: string) => Promise<boolean>
  aceitar: (who: string) => void
  recusar: (who: string) => void
  /** Ask first, because they stop being read. */
  desfazer: (who: string) => void
  /** Withdraw our unanswered request. No prompt: request again when you want to. */
  cancelar: (who: string) => void
  /** Ask first, with the verb in red: they stop talking. */
  bloquear: (who: string) => void
  desbloquear: (who: string) => void
  /**
   * Who is blocked on THIS device, newest to oldest.
   * Empty when the host does not know how to block.
   */
  bloqueados: readonly { address: string; at: number }[]
  /** The same, to ask quickly. */
  estaBloqueado: (who: string) => boolean
  /** The host knows how to block. Without this, the block buttons do not appear. */
  podeBloquear: boolean
  /** The host knows how to cancel a request. */
  podeCancelar: boolean
  /**
   * This link is a request of ours that we already canceled, waiting for the echo. Who
   * draws treats it as "none" so "Request friendship" returns right away, without waiting
   * for the link to see the `decline withdrawn`. A new request (another `at`) does not count.
   */
  cancelouJa: (tie: FriendTie | undefined) => boolean
  /** Who has a response in progress, so the buttons stop while it runs. */
  respondendo: string | null
}

/**
 * The friendship gestures, one function each and in all channels.
 *
 * They lived in `App.tsx`, each one asking the channel from whoever called it. That
 * forced each channel to know where the request had come from: the Friends screen
 * and the bell knew, the profile sheet and menu did not. Here the channel resolves
 * itself inside, and the caller only says who.
 *
 * **The channel comes from the link, or from the direct.** Responding goes through
 * the channel where the connection last spoke (`tie.channel`), which is where the
 * other side waits for the response. Requesting goes ALWAYS through a direct: it is
 * the only channel where exactly the two people are. In a shared channel the request
 * would reach all members.
 *
 * **Validated and not optimistic.** A request only leaves the screen when the link
 * stops counting it, and never because you clicked a button. Admitting someone to an
 * MLS group can fail, and a request that vanishes before it is done leaves no trace.
 */
export function useAmizade({
  bridge,
  friendships,
  aviso,
  nomeDe,
  estaLigado,
  pronto = true,
}: {
  bridge: EnclaveBridge
  friendships: Friendships
  aviso: (detail: string, level?: ToastLevel) => void
  nomeDe: (who: string) => string
  /** Who is connected now: says if acceptance is done on both sides already. */
  estaLigado: (who: string) => boolean
  /**
   * The vault is open and the session is standing. The blocked list only reads
   * after that: before, the bridge still has no vault to ask.
   */
  pronto?: boolean | undefined
}): Amizade {
  const [respondendo, setRespondendo] = useState<string | null>(null)
  const [bloqueados, setBloqueados] = useState<readonly { address: string; at: number }[]>([])
  /** Who had the request canceled here, and the `at` of that request. See `cancelouJa`. */
  const [cancelados, setCancelados] = useState<ReadonlyMap<string, number>>(() => new Map())
  const confirmar = useConfirmar()

  /*
    By ref and not by the dependency list.

    The returned functions go to menus and sheets that mount with them and do not
    remake each time a message arrives. Read by ref, they always see the link and
    current names. The guard for "there is already a response running" also lives here:
    two clicks in the same instant see the same ref, and React state only updates
    after the second.
  */
  const vivo = useRef({ bridge, friendships, aviso, nomeDe, estaLigado, confirmar, ocupado: null as string | null })
  vivo.current = { ...vivo.current, bridge, friendships, aviso, nomeDe, estaLigado, confirmar }

  const falhou = useCallback((error: Error): void => {
    vivo.current.aviso(traduzirErro(error), "error")
  }, [])

  /** Mark a response in progress. Returns false when there was already another running. */
  const comecar = useCallback((who: string): boolean => {
    if (vivo.current.ocupado) return false
    vivo.current.ocupado = who
    setRespondendo(who)
    return true
  }, [])
  const acabar = useCallback((): void => {
    vivo.current.ocupado = null
    setRespondendo(null)
  }, [])

  /** The channel of a response: where the connection spoke, or the direct. */
  const canalDaResposta = useCallback(async (who: string): Promise<string> => {
    const tie = vivo.current.friendships.ties.get(who)
    return tie?.channel ?? (await vivo.current.bridge.social.openDirect(who))
  }, [])

  /*
    Requesting also goes through the guard for "a response running": a double click
    would send two requests. Returns if the request went out, so whoever has the note
    field can clear it only then.
  */
  const pedir = useCallback(
    (who: string, note?: string): Promise<boolean> => {
      if (!comecar(who)) return Promise.resolve(false)
      const nota = note?.trim()
      return (async () => {
        const tie = vivo.current.friendships.ties.get(who)
        // Only a direct serves. See the hook note.
        const canal =
          tie?.channel && isDirect(tie.channel) ? tie.channel : await vivo.current.bridge.social.openDirect(who)
        await vivo.current.bridge.social.friendRequest(canal, nota ? nota : undefined)
        vivo.current.aviso(strings.userMenu.friendSent)
        return true
      })()
        .catch((error: Error) => {
          falhou(error)
          return false
        })
        .finally(acabar)
    },
    [comecar, acabar, falhou],
  )

  const aceitar = useCallback(
    (who: string) => {
      if (!comecar(who)) return
      void (async () => {
        const canal = await canalDaResposta(who)
        await vivo.current.bridge.social.acceptFriend(canal, who)
        const nome = vivo.current.nomeDe(who)
        // Friendship becomes mutual, but not always at the same time: the
        // return slot depends on the device of who requested. With that
        // person connected it is immediate and is reported; without them, we say what is missing.
        vivo.current.aviso(
          vivo.current.estaLigado(who) ? strings.people.acceptedMutual(nome) : strings.people.acceptedPending(nome),
        )
      })()
        .catch((error: Error) => {
          // "Already on this channel" is not a failure you can do anything about:
          // the settlement layer already treats it as success.
          if (error.message === "that person is already in this channel") vivo.current.aviso(strings.people.accepted)
          else falhou(error)
        })
        .finally(acabar)
    },
    [comecar, acabar, canalDaResposta, falhou],
  )

  /**
   * Declining gives no access. Closes the request on both sides: it leaves here
   * because the link stops counting it, and it leaves there because the requester
   * stops waiting and can request again later.
   */
  const recusar = useCallback(
    (who: string) => {
      if (!comecar(who)) return
      void (async () => {
        const canal = await canalDaResposta(who)
        await vivo.current.bridge.social.declineFriend(canal)
        vivo.current.aviso(strings.people.declined)
      })()
        .catch(falhou)
        .finally(acabar)
    },
    [comecar, acabar, canalDaResposta, falhou],
  )

  /**
   * Undo the friendship: both slots, not one. The core removes this person's slot
   * from my feed and asks their client to remove mine from theirs. What was already
   * read stays read, and the prompt says that before anyone clicks.
   *
   * Ask with `Confirmar` at home, not in red: undoing friendship does not destroy
   * anything, and you can request again when you want. But the other stops being read,
   * and that does not happen by accident.
   */
  const desfazer = useCallback(
    (who: string) => {
      const nome = vivo.current.nomeDe(who)
      void vivo.current
        .confirmar({
          titulo: strings.people.unfriendTitle(nome),
          corpo: strings.people.unfriendConfirm,
          verbo: strings.people.unfriend,
        })
        .then(async (sim) => {
          if (!sim) return
          await vivo.current.bridge.social.unfriend(who)
          vivo.current.aviso(strings.people.unfriendDone(nome))
        })
        .catch(falhou)
    },
    [falhou],
  )

  /**
   * Cancel our request. The core closes it on both sides, and on the other side
   * the request leaves the bell. No prompt: nothing is lost, and you can request again.
   */
  const cancelar = useCallback(
    (who: string) => {
      const cancelarNaPonte = vivo.current.bridge.social.cancelFriendRequest
      if (!cancelarNaPonte || !comecar(who)) return
      const pedido = vivo.current.friendships.ties.get(who)
      void cancelarNaPonte(who)
        .then(() => {
          if (pedido) setCancelados((antes) => new Map(antes).set(who, pedido.at))
          vivo.current.aviso(strings.people.cancelled)
        })
        .catch(falhou)
        .finally(acabar)
    },
    [comecar, acabar, falhou],
  )

  /*
    The blocked list lives in the vault of this device and is read from the bridge.
    It re-reads after each block and unblock: the bridge is the truth, and an
    optimistic copy here would diverge from it at the first failure.
  */
  const relerBloqueados = useCallback(async (): Promise<void> => {
    const ler = vivo.current.bridge.social.blocked
    if (!ler) return
    const lista = await ler()
    setBloqueados([...lista].sort((a, b) => b.at - a.at))
  }, [])
  /*
    A read that fails (the vault still opening, the bridge busy) tries again
    in a few seconds, up to five times. Without this, a failure at opening would
    leave the list empty the whole session, and the blocked person would return to screens.
  */
  const [tentativa, setTentativa] = useState(0)
  useEffect(() => {
    if (!pronto) return
    let vivo = true
    let temporizador: ReturnType<typeof setTimeout> | null = null
    void relerBloqueados().catch(() => {
      if (!vivo || tentativa >= 5) return
      temporizador = setTimeout(() => setTentativa((n) => n + 1), 3000)
    })
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
    }
  }, [pronto, bridge, relerBloqueados, tentativa])

  /*
    A sibling device blocked or unblocked someone (account channel, phase 5).
    The list refreshes from the bridge, just as after a gesture from here.
  */
  useEffect(() => {
    const ouvir = bridge.on?.bloqueio
    if (!pronto || !ouvir) return
    return ouvir(() => {
      void relerBloqueados().catch(() => {})
    })
  }, [pronto, bridge, relerBloqueados])

  /**
   * Block with a confirmation prompt first, button text in red. The core ends
   * the friendship and stops recording what the person says in direct messages
   * and feeds. What they already read stays with them, and the prompt explains
   * that.
   */
  const bloquear = useCallback(
    (who: string) => {
      const bloquearNaPonte = vivo.current.bridge.social.block
      if (!bloquearNaPonte) return
      const nome = vivo.current.nomeDe(who)
      void vivo.current
        .confirmar({
          titulo: strings.people.blockTitle(nome),
          corpo: strings.people.blockBody,
          verbo: strings.people.block,
          destructive: true,
        })
        .then(async (sim) => {
          // Same guard as responses: two consecutive Block taps do not block twice.
          if (!sim || !comecar(who)) return
          try {
            await bloquearNaPonte(who)
            await relerBloqueados()
            vivo.current.aviso(strings.people.blockDone(nome))
          } finally {
            acabar()
          }
        })
        .catch(falhou)
    },
    [comecar, acabar, falhou, relerBloqueados],
  )

  /** Unblock does not ask: it deletes nothing, and friendship does not come back on its own. */
  const desbloquear = useCallback(
    (who: string) => {
      const desbloquearNaPonte = vivo.current.bridge.social.unblock
      if (!desbloquearNaPonte) return
      const nome = vivo.current.nomeDe(who)
      void desbloquearNaPonte(who)
        .then(async () => {
          await relerBloqueados()
          vivo.current.aviso(strings.people.unblockDone(nome))
        })
        .catch(falhou)
    },
    [falhou, relerBloqueados],
  )

  const conjuntoDeBloqueados = useMemo(() => new Set(bloqueados.map((entrada) => entrada.address)), [bloqueados])
  const estaBloqueado = useCallback((who: string) => conjuntoDeBloqueados.has(who), [conjuntoDeBloqueados])
  const podeBloquear = Boolean(bridge.social.block && bridge.social.unblock)
  const podeCancelar = Boolean(bridge.social.cancelFriendRequest)
  const cancelouJa = useCallback(
    (tie: FriendTie | undefined) => tie?.link === "pedido-enviado" && cancelados.get(tie.peer) === tie.at,
    [cancelados],
  )

  // An object stays stable while no one responds: putting it in a dependency
  // list does not trigger a re-render on every frame.
  return useMemo(
    () => ({
      pedir,
      aceitar,
      recusar,
      desfazer,
      cancelar,
      bloquear,
      desbloquear,
      bloqueados,
      estaBloqueado,
      podeBloquear,
      podeCancelar,
      cancelouJa,
      respondendo,
    }),
    [pedir, aceitar, recusar, desfazer, cancelar, bloquear, desbloquear, bloqueados, estaBloqueado, podeBloquear, podeCancelar, cancelouJa, respondendo],
  )
}
