import { ticketThread, type StoredChatMessage, type Ticket, type TicketLine } from "@enclave/client-core"
import type { ChatMessage } from "../types.js"
import { useEffect, useState } from "react"
import type { EnclaveBridge } from "../bridge.js"

/**
 * The frame of tickets in the open room, and the conversation of the open
 * ticket.
 *
 * **Reread from the core, not folded here.** Who decides what a ticket says is
 * `ticketsOf`, in the session, because permission to handle depends on
 * `powersOf`, which knows the channel foundation and the roles saved in the
 * vault. A second fold written in this layer would have to repeat that judgment,
 * and disagreed with it on the first hard case: a channel with no known
 * foundation, a deleted role, a person who gained the position two minutes ago.
 *
 * `messages` is the trigger, not the source: same choice as `useRooms`. A
 * message arrives, reread the vault, which has it by then, because the core
 * saves before emitting. The ticket's OWN conversation is what folds here, over
 * the messages the interface already has, because that depends on no permission:
 * it is the messages with that mark, and nothing else.
 *
 * A host that knows nothing of tickets returns an empty frame instead of
 * breaking, like what happens with rooms and categories. See `bridge.ts`.
 */
export function useTickets(
  bridge: EnclaveBridge,
  channel: string | null,
  room: string,
  /** The layout of the room. Outside a ticket room, this does not work. */
  layout: string | undefined,
  messages: ChatMessage[],
  aberto: string | null,
): { tickets: Ticket[]; linhas: TicketLine[] } {
  const [tickets, setTickets] = useState<Ticket[]>([])

  useEffect(() => {
    if (channel === null || layout !== "tickets") {
      setTickets([])
      return
    }
    setTickets(bridge.channels.tickets?.(channel, room) ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `messages` is the trigger for re-reading the vault
  }, [bridge, channel, room, layout, messages])

  /**
   * What the interface has in hand is not what the vault stores: it lacks the
   * `at`, which is read here from the sender's timestamp. Reconstructed on entry,
   * not assumed inside, the core cannot start accepting a looser form for the
   * convenience of its callers.
   */
  const linhas =
    channel === null || aberto === null || layout !== "tickets"
      ? []
      : ticketThread(
          messages
            .filter((entrada) => entrada.channel === channel)
            .map(
              (entrada): StoredChatMessage => ({
                seq: entrada.seq,
                sender: entrada.sender,
                at: entrada.payload.sentAt ?? 0,
                payload: entrada.payload as StoredChatMessage["payload"],
              }),
            ),
          room,
          aberto,
        )

  return { tickets, linhas }
}
