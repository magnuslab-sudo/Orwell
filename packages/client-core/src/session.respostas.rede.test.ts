import { existsSync, readFileSync } from "node:fs"
import type { Payload } from "@enclave/protocol"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { mensagemAEnviar } from "./mensagemAEnviar.js"
import type { ReceivedMessage } from "./session.js"
// The harness server's server, for real, on an ephemeral port.
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../../../apps/server/testes/cliente-de-teste.js"

/**
 * Replying to a message, between real clients (4/11/2026).
 *
 * Ana replies to Bruno twice: with "@ Mention" on and off.
 * Bruno receives both with `replyTo` intact; the first mentions him, the
 * second doesn't. And the server learns nothing: neither the identifier of the
 * original nor the field name appear in plain in its database.
 *
 * Both replies are built by the same function both hosts use (`mensagemAEnviar`),
 * with the extras the compose box delivers.
 */

let servidor: ServidorDeTeste
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  servidor = await levantarServidor()
}, 30_000)

afterEach(() => {
  desligarContas(abertas.splice(0))
})

afterAll(async () => {
  await servidor?.fechar()
})

type Mensagem = Extract<Payload, { t: "message" }>

function recebidas(conta: ContaDeTeste): Mensagem[] {
  const vistas: Mensagem[] = []
  conta.session.on("message", (evento: ReceivedMessage) => {
    if (evento.payload.t === "message") vistas.push(evento.payload)
  })
  return vistas
}

/** The bytes the server stored, with the SQLite log included. */
function bytesDoServidor(): string {
  return [servidor.baseDeDados, `${servidor.baseDeDados}-wal`]
    .filter((caminho) => existsSync(caminho))
    .map((caminho) => readFileSync(caminho).toString("latin1"))
    .join("")
}

describe("responder a uma mensagem, entre dois clientes", () => {
  it("o Bruno recebe a resposta com e sem a menção, e o servidor não vê nada novo", async () => {
    const [ana, bruno] = await contasDeTeste(servidor, ["Ana", "Bruno"])
    abertas.push(ana!, bruno!)
    const canal = await canalComTodos(servidor, ana!, [bruno!])
    const daAna = recebidas(ana!)
    const doBruno = recebidas(bruno!)

    const ORIGINAL = "original-do-bruno-0001"
    await bruno!.session.send(canal, mensagemAEnviar("Quem vem amanhã?", undefined, undefined, { id: ORIGINAL, sentAt: Date.now() }))
    await ate(() => daAna.some((m) => m.id === ORIGINAL), "a Ana recebe a pergunta do Bruno", 30_000)

    // With "@ Mention" on: the compose box puts the author in `mentions`.
    await ana!.session.send(
      canal,
      mensagemAEnviar("Eu vou.", undefined, { replyTo: ORIGINAL, mentions: [bruno!.address] }, { id: "resposta-com-0001", sentAt: Date.now() }),
    )
    // Off: the reply doesn't mention anyone.
    await ana!.session.send(
      canal,
      mensagemAEnviar("Eu também.", undefined, { replyTo: ORIGINAL }, { id: "resposta-sem-0001", sentAt: Date.now() }),
    )

    await ate(() => doBruno.some((m) => m.id === "resposta-sem-0001"), "o Bruno recebe as duas respostas", 30_000)
    const com = doBruno.find((m) => m.id === "resposta-com-0001")
    const sem = doBruno.find((m) => m.id === "resposta-sem-0001")
    expect(com).toMatchObject({ body: "Eu vou.", replyTo: ORIGINAL, mentions: [bruno!.address] })
    expect(sem).toMatchObject({ body: "Eu também.", replyTo: ORIGINAL, mentions: [] })

    // Bruno's vault stores the field, so the quote can be read after a reload.
    const guardadas = bruno!.vault.contents.history[canal] ?? []
    expect(guardadas.find((entrada) => (entrada.payload as { id?: string }).id === "resposta-com-0001")?.payload).toMatchObject({
      replyTo: ORIGINAL,
    })

    // The server stores ciphertext: neither the identifier of the original, nor the
    // field name, nor the body appears in plain.
    const bytes = bytesDoServidor()
    // Control: the read catches what the server knows in plain (the channel address).
    expect(bytes).toContain(canal)
    expect(bytes).not.toContain(ORIGINAL)
    expect(bytes).not.toContain("replyTo")
    expect(bytes).not.toContain("Eu vou.")
  }, 120_000)
})
