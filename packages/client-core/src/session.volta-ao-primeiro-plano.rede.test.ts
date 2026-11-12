import { Session } from "@enclave/client-core"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
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
 * The suspended page that comes back (1.3.7).
 *
 * The report: «o telemóvel não sincroniza» (the phone does not sync). The
 * system suspends the page, the socket stays `OPEN` with nothing getting
 * through, and what is said in the channels meanwhile does not arrive. Here:
 * Bruno's socket goes silent in both directions, with no `close`, and messages
 * and commits pass in his two channels (three in one, more than the two epochs
 * the client keeps behind). The page comes back (`retomar`), and:
 *  - it connects again at once, without waiting for any `ping`;
 *  - each message arrives once, in order, readable;
 *  - no reseat (no `channel.rejoin.request`): the server still has the events;
 *  - what Bruno writes right after goes out in the current epoch: Eva, who
 *    joined in the last commit, reads it;
 *  - what he wrote to the silent socket is resent after connecting, and arrives once.
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

/** Bruno's sockets, to suspend them, and the frames they send. */
let dono: string | null = null
const doBruno: SocketSuspensivel[] = []
const mandadasPeloBruno: string[] = []
const WebSocketDeVerdade = globalThis.WebSocket
class SocketSuspensivel extends WebSocketDeVerdade {
  suspenso = false
  constructor(...args: ConstructorParameters<typeof WebSocket>) {
    super(...args)
    if (dono === "bruno") doBruno.push(this)
  }
  override send(dados: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.suspenso) return
    if (doBruno.includes(this)) {
      try {
        mandadasPeloBruno.push(String((JSON.parse(String(dados)) as { t?: string }).t))
      } catch {
        // Not JSON: does not count.
      }
    }
    super.send(dados)
  }
  override addEventListener(...args: Parameters<WebSocket["addEventListener"]>): void {
    const [tipo, ouvinte, opcoes] = args
    if (tipo !== "message" || ouvinte === null) return super.addEventListener(tipo, ouvinte, opcoes)
    const entrega = typeof ouvinte === "function" ? ouvinte : ouvinte.handleEvent.bind(ouvinte)
    super.addEventListener("message", (evento: Event) => {
      if (!this.suspenso) entrega.call(this, evento)
    }, opcoes)
  }
}

const mensagem = (body: string) =>
  ({ t: "message", id: crypto.randomUUID(), body, sentAt: Date.now(), attachments: [], links: [], mentions: [] }) as never

const corpos = (conta: ContaDeTeste, canal: string, prefixo: string): string[] =>
  conta.session
    .history(canal)
    .map((entrada) => String(entrada.payload["body"] ?? ""))
    .filter((corpo) => corpo.startsWith(prefixo))

describe("a página suspensa que volta", () => {
  it("mensagens e commits perdidos em dois canais chegam uma vez, por ordem, sem reassento; e o que se escreve a seguir lê-se", async () => {
    const ausencia = Session.AUSENCIA_QUE_RELIGA_MS
    Session.AUSENCIA_QUE_RELIGA_MS = 1_000
    globalThis.WebSocket = SocketSuspensivel as typeof WebSocket
    try {
      const [ana, carla, dora, eva] = await contasDeTeste(servidor, ["Ana", "Carla", "Dora", "Eva"])
      dono = "bruno"
      const [bruno] = await contasDeTeste(servidor, ["Bruno"])
      dono = null
      abertas.push(ana!, bruno!, carla!, dora!, eva!)
      const um = await canalComTodos(servidor, ana!, [bruno!])
      const dois = await canalComTodos(servidor, ana!, [bruno!])

      // The page is suspended: Bruno's socket goes silent, with no close.
      for (const socket of doBruno) socket.suspenso = true
      const suspensaEm = Date.now()
      // Bruno writes to the silent socket: the frame goes out and reaches nobody.
      await bruno!.session.send(um, mensagem("do-bruno-suspenso"))

      // Channel one: messages and three commits (Carla, Dora, Eva).
      await ana!.session.send(um, mensagem("um-1"))
      await ana!.session.send(um, mensagem("um-2"))
      for (const [i, quem] of [carla!, dora!, eva!].entries()) {
        await ana!.session.seat(um, quem.address)
        await ate(() => quem.session.channels.includes(um), `${quem.nome} entra no canal um`, 30_000)
        await ana!.session.send(um, mensagem(`um-${i + 3}`))
      }
      // Channel two: messages and one commit.
      await ana!.session.send(dois, mensagem("dois-1"))
      await ana!.session.seat(dois, carla!.address)
      await ate(() => carla!.session.channels.includes(dois), "a Carla entra no canal dois", 30_000)
      await ana!.session.send(dois, mensagem("dois-2"))
      await ana!.session.send(dois, mensagem("dois-3"))
      expect(corpos(bruno!, um, "um-")).toEqual([])
      expect(bruno!.session.connection).toBe("online")

      // The page comes back.
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1_100 - (Date.now() - suspensaEm))))
      dono = "bruno"
      const antesDaVolta = mandadasPeloBruno.length
      const partiu = Date.now()
      expect(bruno!.session.retomar({ escondidaMs: Date.now() - suspensaEm, suspende: true })).toBe("religar")
      await ate(() => bruno!.session.connection === "online", "o Bruno ligado outra vez", 30_000)
      const religou = Date.now() - partiu
      dono = null
      // Writes at once, with the recovery still running.
      await bruno!.session.send(um, mensagem("do-bruno-ao-voltar"))

      await ate(() => corpos(bruno!, um, "um-").length >= 5 && corpos(bruno!, dois, "dois-").length >= 3, "o Bruno recupera os dois canais", 60_000)
      expect(corpos(bruno!, um, "um-")).toEqual(["um-1", "um-2", "um-3", "um-4", "um-5"])
      expect(corpos(bruno!, dois, "dois-")).toEqual(["dois-1", "dois-2", "dois-3"])
      for (const quem of [ana!, carla!, dora!, eva!]) {
        await ate(() => corpos(quem, um, "do-bruno-ao-voltar").length === 1, `${quem.nome} lê o Bruno`, 30_000)
      }
      // What he wrote to the silent socket also arrives, once: it is resent after connecting again.
      await ate(() => corpos(ana!, um, "do-bruno-suspenso").length === 1, "a Ana lê o que o Bruno escreveu suspenso", 30_000)
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(corpos(ana!, um, "do-bruno-suspenso")).toHaveLength(1)
      expect(corpos(bruno!, um, "do-bruno-suspenso")).toHaveLength(1)
      expect(mandadasPeloBruno.slice(antesDaVolta)).not.toContain("channel.rejoin.request")
      expect(bruno!.avisos).not.toContain("rejoin-resync")
      console.log(`MEDIDA-VOLTA religou em ${religou} ms`)
    } finally {
      globalThis.WebSocket = WebSocketDeVerdade
      Session.AUSENCIA_QUE_RELIGA_MS = ausencia
      dono = null
    }
  }, 240_000)
})
