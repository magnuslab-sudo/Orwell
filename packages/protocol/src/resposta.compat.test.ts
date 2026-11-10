import { describe, expect, it } from "vitest"
import { decodePayload, encodePayload, Payload } from "./payload.js"

/**
 * A reply (`replyTo`, with and without the author mention) in older schemas.
 *
 * The wire format has not changed: the reply uses the `replyTo` field the
 * payload has had since 0.5, and the mention uses `mentions`, which has always
 * existed. This proves that the schemas from 0.5.7, 0.7.2 and 0.8.0, copied to
 * `testes/`, read the full reply without rejecting anything. A rejected payload
 * counted as an ignored event, and a series of them declared the channel deaf.
 *
 * Version 1.3.2 reads with the schema from `src/` as it stands: this branch only
 * added a TypeScript type (`MessageExtras.replyTo`), which does not travel.
 */

const ORIGINAL = "0123456789abcdef"
const BRUNO = "@bruno-alto-pe-leve:exemplo"

const COM_MENCAO = {
  t: "message",
  id: "fedcba9876543210",
  sentAt: 1,
  body: "Eu vou.",
  replyTo: ORIGINAL,
  attachments: [],
  links: [],
  mentions: [BRUNO],
}
const SEM_MENCAO = { ...COM_MENCAO, id: "fedcba9876543211", mentions: [] }

type Antigo = { decodePayload: (bytes: Uint8Array) => Record<string, unknown> }
async function esquema(versao: "0.5.7" | "0.7.2" | "0.8.0"): Promise<Antigo> {
  const ficheiro = versao === "0.5.7" ? "../testes/payload-0.5.7.ts" : `../testes/v${versao}/payload.ts`
  return (await import(/* @vite-ignore */ new URL(ficheiro, import.meta.url).href)) as Antigo
}

describe("a resposta no esquema de hoje", () => {
  it("lê o `replyTo` e a menção", () => {
    const lido = Payload.parse(decodePayload(encodePayload(COM_MENCAO as unknown as Payload)))
    expect(lido).toMatchObject({ replyTo: ORIGINAL, mentions: [BRUNO], body: "Eu vou." })
  })
})

describe.each(["0.5.7", "0.7.2", "0.8.0"] as const)("a resposta no esquema da %s", (versao) => {
  it("lê a resposta com menção como uma mensagem, sem reprovar", async () => {
    const { decodePayload: antigo } = await esquema(versao)
    expect(antigo(encodePayload(COM_MENCAO as unknown as Payload))).toMatchObject({
      t: "message",
      body: "Eu vou.",
      replyTo: ORIGINAL,
      mentions: [BRUNO],
    })
  })

  it("lê a resposta sem menção como uma mensagem normal", async () => {
    const { decodePayload: antigo } = await esquema(versao)
    expect(antigo(encodePayload(SEM_MENCAO as unknown as Payload))).toMatchObject({ t: "message", mentions: [] })
  })
})
