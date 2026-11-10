import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HISTORY_MAX_PER_CHANNEL } from "@enclave/client-core"
import type { EnclaveBridge } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { procurar, type Achado } from "../lib/procura.js"

/**
 * Search the open channel against what the vault on this device holds.
 *
 * **What we search is the VAULT history, not what is on screen.** The
 * shell brings to memory the two hundred most recent messages from each channel and
 * pages the rest on demand, searching only those would search half of what
 * exists, with no way to know. `channels.history` returns everything
 * stored, which is the most a search can reach.
 *
 * **And there is a limit above that, which must be reported.** The vault stores at most
 * `HISTORY_MAX_PER_CHANNEL` entries per channel and discards the oldest for each
 * new one that arrives. A search that does not find what has left the vault is
 * indistinguishable from a message that never existed, and the conclusion someone
 * draws is about the other person, not the product. Hence `noTecto`,
 * which the interface puts into words.
 *
 * **Plus what has not yet reached the vault.** Saving is deferred by 1500 ms to
 * avoid re-encrypting the entire vault for each phrase spoken (`Session.FLUSH_MS`),
 * and during that window a message is already on screen but not yet stored.
 * Searching only the vault opens a one-and-a-half second window where the phrase someone
 * just read cannot be found: the worst possible moment for a
 * search to fail, because it is the only moment when you know for sure the message
 * exists. Hence the join with what is in memory, by identifier.
 *
 * **Read once, filter per keystroke.** Reading the vault is a clone of
 * everything in it (0.673 ms measured with a full media budget, see
 * `scripts/medir-pesquisa.mjs`); the scan per keystroke costs 1.252 ms on the
 * same vault. Reading per keystroke would pay for the first scan four times per
 * second without getting anything, because the vault does not change between keystrokes.
 *
 * None of this goes anywhere else. The server carries encrypted text and cannot
 * index it because it cannot read it; the index that would help is one it will never
 * have. See `lib/procura.ts`, which explains why there is no index on this
 * side either.
 */
export interface EstadoDaProcura {
  /** What is written in the box. */
  termo: string
  definirTermo: (termo: string) => void
  /** The messages that match, from most recent to oldest. */
  resultados: Achado[]
  /** The vault is at its cap: what is oldest has left, and we do not search there. */
  noTecto: boolean
  /** How many messages from this channel the search managed to see. */
  procuradas: number
  /** The vault read is in progress. */
  aLer: boolean
}

export function useProcura(
  bridge: EnclaveBridge,
  channel: string | null,
  aberta: boolean,
  messages: ChatMessage[],
  /** Where a vault that cannot be read goes. Without this, it fails silently. */
  aoFalhar?: (erro: string) => void,
): EstadoDaProcura {
  const [termo, definirTermo] = useState("")
  const [guardadas, setGuardadas] = useState<ChatMessage[]>([])
  const [noTecto, setNoTecto] = useState(false)
  const [aLer, setALer] = useState(false)

  // The bridge by reference, never by dependency. See the note in
  // `useSpaceMeta`: a host that recreates it each render puts this in an endless
  // loop.
  const ponte = useRef(bridge)
  ponte.current = bridge
  const falhar = useRef(aoFalhar)
  falhar.current = aoFalhar

  /**
   * How many messages from this channel have passed through memory.
   *
   * It is the trigger for re-reading, and it is just a number: the content does not matter here,    * the vault keeps that. Counting instead of comparing lists is the same design
   * as `usePins`, for the same reason. Without this, a message that arrived with the
   * sheet open would not be found until it closes and opens again.
   */
  const carimbo = messages.reduce((conta, message) => (message.channel === channel ? conta + 1 : conta), 0)

  /**
   * The guard for this read.
   *
   * Two reads in flight at the same time is the normal case for someone switching channels
   * with the sheet open. Without a guard, the slower one wins by arriving
   * last, and the search starts responding about the wrong conversation.
   */
  const senha = useRef(0)

  useEffect(() => {
    if (!aberta || !channel) return
    const minha = ++senha.current
    setALer(true)
    void ponte.current.channels
      .history(channel)
      .then((entradas) => {
        if (senha.current !== minha) return
        setNoTecto(entradas.length >= HISTORY_MAX_PER_CHANNEL)
        setGuardadas(
          entradas.map((entrada) => ({
            channel,
            seq: entrada.seq,
            sender: entrada.sender,
            payload: entrada.payload as ChatMessage["payload"],
          })),
        )
        setALer(false)
      })
      .catch((erro: Error) => {
        if (senha.current !== minha) return
        setGuardadas([])
        setNoTecto(false)
        setALer(false)
        falhar.current?.(erro.message)
      })
  }, [channel, aberta, carimbo])

  /**
   * New channel: the box clears and what was found goes with it.
   *
   * In a `setState` during render, not in an effect, which is the pattern
   * React documents for syncing state with a prop that changed: an effect
   * would let a render pass showing results from the previous channel, and
   * jumping to one would take someone to a conversation they already left.
   */
  const [ultimo, setUltimo] = useState(channel)
  if (ultimo !== channel) {
    setUltimo(channel)
    definirTermo("")
    setGuardadas([])
    setNoTecto(false)
  }

  /**
   * Everything this device knows about this channel: the vault, plus what has not
   * arrived yet.
   *
   * Only if the sheet is open. With it closed this would be a scan over
   * all messages for each phrase that arrives on any channel, to feed
   * a search that nobody is doing.
   */
  const alcance = useMemo(() => {
    if (!aberta || !channel) return []
    const conhecidas = new Set(guardadas.map(chaveDa))
    const porGravar = messages.filter((message) => message.channel === channel && !conhecidas.has(chaveDa(message)))
    return porGravar.length === 0 ? guardadas : [...guardadas, ...porGravar]
  }, [aberta, channel, guardadas, messages])

  /*
    With moderation (phase 3): a message deleted by a moderator cannot be found,
    as it is not visible. Without this, search would be the door it comes back through.
    The request goes through the bridge, like a message.
  */
  const resultados = useMemo(
    () =>
      procurar(alcance, termo, {
        modera: (quem) => (channel ? (ponte.current.channels.mayModerate?.(channel, quem) ?? false) : false),
      }),
    [alcance, termo, channel],
  )
  const procuradas = useMemo(
    () => alcance.reduce((conta, message) => (message.payload.t === "message" ? conta + 1 : conta), 0),
    [alcance],
  )

  const escrever = useCallback((novo: string) => definirTermo(novo), [])

  return { termo, definirTermo: escrever, resultados, noTecto, procuradas, aLer }
}

/**
 * The same message, from vault or memory, with the same key.
 *
 * By identifier, which is what survives storage. Without it, and a friend
 * request has none, it falls to the type with the sequence, which is unique per
 * channel. Two different keys for the same phrase would put it twice in the
 * results list, and both would jump to the same place.
 */
function chaveDa(message: ChatMessage): string {
  return message.payload.id ?? `${message.payload.t}-${message.seq}`
}
