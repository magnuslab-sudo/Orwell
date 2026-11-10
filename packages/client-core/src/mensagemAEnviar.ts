import { kindOf } from "@enclave/crypto"
import type { MessageExtras, Payload } from "@enclave/protocol"

type MensagemDoFio = Extract<Payload, { t: "message" }>

/**
 * The payload of a message written in the box, as both hosts send it.
 *
 * It lived written twice, in the browser host and the desktop host, with a
 * comment asking them to stay identical. An image, a poll or a reply sent from
 * the desktop and browser had to arrive identical to the same group, or only one
 * would render. Now it's this function, in both.
 *
 * - The default room carries no tag: that's how messages from before rooms and
 *   messages now stay in the same place.
 * - Images and files go into the SAME attachments list, and `kindOf` separates
 *   them again on the reader's side. On the wire they're the same thing.
 * - Mentions are resolved by whoever wrote them: forwarding a notification never
 *   needs a regex on the text.
 * - The poll and the reply only go when they exist. Absent is absent: a normal
 *   message doesn't carry those fields on the wire.
 */
export function mensagemAEnviar(
  body: string,
  room: string | undefined,
  extras: MessageExtras | undefined,
  { id, sentAt }: { id: string; sentAt: number },
): MensagemDoFio {
  return {
    t: "message",
    id,
    sentAt,
    body,
    ...(room ? { room } : {}),
    attachments: [...(extras?.images ?? []), ...(extras?.files ?? [])].map((item) => ({
      url: "",
      inline: item.dataUrl,
      key: "",
      nonce: "",
      digest: "",
      kind: kindOf(item.mediaType),
      name: item.name,
      mediaType: item.mediaType,
      byteLength: item.bytes,
    })),
    links: extras?.links ?? [],
    mentions: extras?.mentions ?? [],
    ...(extras?.poll ? { poll: extras.poll } : {}),
    ...(extras?.replyTo ? { replyTo: extras.replyTo } : {}),
  }
}
