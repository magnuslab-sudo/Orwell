import { dobrarConversa, Session } from "@enclave/client-core"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import {
  ate,
  canalComTodos,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"

/**
 * The fixes from the S6 review (retrying sends rejected by rate limit), with
 * a real server and the rejections injected by hand.
 *
 * The server's cap stays at its normal value: the rejections measured here are
 * chosen by the test, one at a time, on a socket placed between the `Session` and the
 * server (`filtroDeEnvios`). This way each case rejects exactly the send it wants,
 * and the rest of the path (the encryption, the echo, the server's ordering, the
 * receiver's fold) is genuine.
 */

interface Trama {
  t: string
  channel?: string
  kind?: string
  ciphertext?: string
  ref?: string
  address?: string
  recipient?: string
}

/** What the filter does to a `channel.send`: let it through, reject it for rate limit, or reply something else. */
type Decisao = { recusar: number } | { responder: Record<string, unknown> } | null

interface Visto {
  endereco: string | undefined
  trama: Trama
  at: number
}

/**
 * Sockets opened after this pass `channel.send` through `regra`. A rejection doesn't
 * reach the server: the filter returns to the `Session` the `channel.rejected` with
 * `rate-limited`, as the server would.
 */
function filtroDeEnvios() {
  const Original = globalThis.WebSocket
  const estado = {
    regra: null as ((trama: Trama, endereco: string | undefined) => Decisao) | null,
    passadas: [] as Visto[],
    recusadas: [] as Visto[],
    sockets: [] as Filtrado[],
    /** A frame from the "server" to live sockets at this address. */
    injectar(endereco: string, frame: Record<string, unknown>): void {
      for (const socket of estado.sockets) if (socket.endereco === endereco && socket.readyState === 1) socket.entregar(frame)
    },
    repor(): void {
      globalThis.WebSocket = Original
    },
  }
  class Filtrado extends Original {
    endereco: string | undefined
    readonly #ouvintes: ((evento: MessageEvent) => void)[] = []
    constructor(...argumentos: ConstructorParameters<typeof WebSocket>) {
      super(...argumentos)
      estado.sockets.push(this)
    }
    override addEventListener(tipo: string, ouvinte: EventListenerOrEventListenerObject, opcoes?: boolean | AddEventListenerOptions): void {
      if (tipo === "message") {
        this.#ouvintes.push((evento) => (typeof ouvinte === "function" ? ouvinte(evento) : ouvinte.handleEvent(evento)))
      }
      super.addEventListener(tipo, ouvinte, opcoes)
    }
    entregar(frame: Record<string, unknown>): void {
      const dados = JSON.stringify(frame)
      setTimeout(() => {
        for (const ouvinte of this.#ouvintes) ouvinte(new MessageEvent("message", { data: dados }))
      }, 2)
    }
    override send(dados: Parameters<WebSocket["send"]>[0]): void {
      const trama = JSON.parse(String(dados)) as Trama
      if (trama.t === "auth.begin") this.endereco = trama.address
      if (trama.t === "channel.send") {
        const decisao = estado.regra?.(trama, this.endereco) ?? null
        const visto = { endereco: this.endereco, trama, at: Date.now() }
        if (decisao && "recusar" in decisao) {
          estado.recusadas.push(visto)
          this.entregar({
            t: "channel.rejected",
            channel: trama.channel,
            reason: "rate-limited",
            retryAfterMs: decisao.recusar,
            ...(trama.ref !== undefined ? { ref: trama.ref } : {}),
          })
          return
        }
        if (decisao && "responder" in decisao) {
          estado.recusadas.push(visto)
          this.entregar({ ...decisao.responder, ...(trama.ref !== undefined ? { ref: trama.ref } : {}) })
          return
        }
        estado.passadas.push(visto)
      }
      super.send(dados)
    }
  }
  globalThis.WebSocket = Filtrado as typeof WebSocket
  return estado
}

let servidor: ServidorDeTeste
let filtro: ReturnType<typeof filtroDeEnvios>
const abertas: ContaDeTeste[] = []
const PRAZO_ORIGINAL = Session.PRAZO_DOS_REENVIOS_MS

beforeAll(async () => {
  servidor = await levantarServidor()
  filtro = filtroDeEnvios()
}, 30_000)
afterEach(() => {
  filtro.regra = null
  Session.PRAZO_DOS_REENVIOS_MS = PRAZO_ORIGINAL
  desligarContas(abertas.splice(0))
})
afterAll(async () => {
  filtro?.repor()
  await servidor?.fechar()
})

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mensagem = (id: string, body: string) => ({ t: "message", id, body, sentAt: Date.now(), attachments: [] }) as never

async function contas(nomes: string[]): Promise<ContaDeTeste[]> {
  const novas = await contasDeTeste(servidor, nomes)
  abertas.push(...novas)
  return novas
}

/** An account's `status` values, with detail and timestamp. */
function estados(conta: ContaDeTeste): { code: string | undefined; detail: string; level: string | undefined; at: number }[] {
  const lista: { code: string | undefined; detail: string; level: string | undefined; at: number }[] = []
  conta.session.on("status", (evento) => lista.push({ code: evento.code, detail: evento.detail, level: evento.level, at: Date.now() }))
  return lista
}

/** Any rejection of a send from this account in this channel, to open the pause and slow mode. */
async function abrirPausa(conta: ContaDeTeste, canal: string, esperaMs: number): Promise<void> {
  let feita = false
  const antes = filtro.recusadas.length
  filtro.regra = (trama, endereco) => {
    if (feita || endereco !== conta.address || trama.channel !== canal || trama.kind !== "application") return null
    feita = true
    return { recusar: esperaMs }
  }
  // A typing signal still in progress (`until` in the future) is not retried: it only opens the pause.
  await conta.session.send(canal, { t: "typing", until: Date.now() + 3_000 } as never)
  await ate(() => filtro.recusadas.length > antes && conta.avisos.includes("send-rate-limited"), "a pausa abre")
}

describe("revisão de S6: a ordem do autor (achado 2)", () => {
  it("duas edições seguidas, a primeira recusada: fica o texto da segunda, para toda a gente", async () => {
    const [ana, dora] = await contas(["Ana", "Dora"])
    const canal = await canalComTodos(servidor, ana!, [dora!])
    const id = crypto.randomUUID()
    await ana!.session.send(canal, mensagem(id, "original"))
    await ate(() => dora!.session.history(canal).some((e) => e.payload["id"] === id), "a Dora tem a mensagem")
    await esperar(500)

    await abrirPausa(ana!, canal, 600)
    // The first edit is large, so the filter can recognize it by size.
    const antiga = "y".repeat(6_000)
    let recusouE1 = false
    filtro.regra = (trama, endereco) => {
      if (recusouE1 || endereco !== ana!.address || trama.channel !== canal || (trama.ciphertext?.length ?? 0) < 7_000) return null
      recusouE1 = true
      return { recusar: 400 }
    }
    // Both queued during the pause, without waiting for each other.
    await Promise.all([ana!.session.editMessage(canal, id, antiga), ana!.session.editMessage(canal, id, "final")])
    const edicoes = () => dora!.session.history(canal).filter((e) => e.payload["t"] === "edit" && e.payload["target"] === id)
    await ate(() => edicoes().length === 2, "as duas edições chegam à Dora", 30_000)
    expect(recusouE1).toBe(true)
    const vista = dobrarConversa(dora!.session.history(canal)).find((e) => e.payload["id"] === id)
    expect(vista?.payload["body"]).toBe("final")
  }, 90_000)
})

describe("revisão de S6: a troca de conta (achado 3)", () => {
  it("uma repetição pendente nunca sai depois de `reset()`, nem como a conta seguinte", async () => {
    const [ana, bia, dora] = await contas(["Ana", "Bia", "Dora"])
    const canal = await canalComTodos(servidor, ana!, [bia!, dora!])
    await esperar(500)

    const segredo = `segredo-da-ana-${crypto.randomUUID()}`
    let recusada = false
    filtro.regra = (trama, endereco) => {
      if (recusada || endereco !== ana!.address || trama.channel !== canal || trama.kind !== "application") return null
      recusada = true
      return { recusar: 4_000 }
    }
    await ana!.session.send(canal, mensagem(crypto.randomUUID(), segredo))
    await ate(() => recusada && ana!.avisos.includes("send-rate-limited"), "a mensagem da Ana é recusada")
    filtro.regra = null

    // The account switch, the way the bridge does it when importing another vault.
    const cofreDaBia = await bia!.vault.exportVault("frase-passe-de-teste")
    bia!.session.disconnect()
    ana!.session.disconnect()
    ana!.session.reset()
    await ana!.vault.importVault(cofreDaBia, "frase-passe-de-teste")
    await ana!.vault.unlock("frase-passe-de-teste")
    expect(ana!.session.loadIdentity().address).toBe(bia!.address)
    await ana!.session.connect()
    await ate(() => ana!.session.connection === "online" && ana!.session.channels.includes(canal), "a Bia está ligada na sessão que era da Ana")

    // After the pause, with room to spare: none of that goes out, from anyone.
    await esperar(6_000)
    const viu = dora!.session.history(canal).filter((e) => e.payload["body"] === segredo)
    expect(viu).toEqual([])
    expect(ana!.session.ritmoDosEnvios().porRepetir).toBe(0)
  }, 90_000)
})

describe("revisão de S6: a espera em ciclo (achado 4)", () => {
  it("uma pausa alargada por outra recusa é respeitada até ao fim", async () => {
    const [ana, dora] = await contas(["Ana", "Dora"])
    const canal = await canalComTodos(servidor, ana!, [dora!])
    await esperar(500)

    await abrirPausa(ana!, canal, 600)
    filtro.regra = null
    const desde = Date.now()
    const id = crypto.randomUUID()
    // The message is already waiting for the first pause when another rejection, without
    // `ref`, extends it to 3 s. The waiting send must see the new pause.
    const enviou = ana!.session.send(canal, mensagem(id, "depois da pausa"))
    await esperar(100)
    filtro.injectar(ana!.address, { t: "channel.rejected", channel: canal, reason: "rate-limited", retryAfterMs: 3_000 })
    await ate(() => dora!.session.history(canal).some((e) => e.payload["id"] === id), "a mensagem chega", 20_000)
    await enviou
    const primeiro = filtro.passadas.find((v) => v.endereco === ana!.address && v.trama.channel === canal && v.at >= desde)
    expect(primeiro).toBeDefined()
    expect(primeiro!.at - desde).toBeGreaterThanOrEqual(2_900)
  }, 60_000)

  it("um commit espera pela pausa do seu balde logo no primeiro envio", async () => {
    const [ana, bia, carla] = await contas(["Ana", "Bia", "Carla"])
    const c1 = await canalComTodos(servidor, ana!, [])
    const c2 = await canalComTodos(servidor, ana!, [])
    await esperar(500)

    // Ana's first commit is rejected for rate limit: it opens the commit pause.
    // Written inside the filter: without the `as`, TypeScript narrows it to `null` forever.
    let recusou = null as number | null
    filtro.regra = (trama, endereco) => {
      if (recusou !== null || endereco !== ana!.address || trama.kind !== "handshake") return null
      recusou = Date.now()
      return { recusar: 2_000 }
    }
    const primeiro = ana!.session.seat(c1, bia!.address)
    await ate(() => recusou !== null, "o primeiro commit é recusado")
    const segundo = ana!.session.seat(c2, carla!.address)
    await Promise.all([primeiro, segundo])
    await ate(() => bia!.session.channels.includes(c1) && carla!.session.channels.includes(c2), "as duas entram", 30_000)
    const commits = filtro.passadas.filter((v) => v.endereco === ana!.address && v.trama.kind === "handshake" && v.at >= (recusou as number))
    expect(commits.length).toBeGreaterThanOrEqual(2)
    // No commit went out during the pause: not the retry, not the first send from the other channel.
    for (const commit of commits) expect(commit.at - (recusou as number)).toBeGreaterThanOrEqual(1_950)
  }, 60_000)
})

describe("revisão de S6: a voz não se repete velha (achado 5)", () => {
  it("um `voice.join` repete-se se ainda é fresco, e nunca passados cinco segundos do `at`", async () => {
    const [ana, dora] = await contas(["Ana", "Dora"])
    const canal = await canalComTodos(servidor, ana!, [dora!])
    await esperar(500)
    const vistos: string[] = []
    dora!.session.on("voice", (evento) => {
      if (evento.from === ana!.address && evento.payload.t === "voice.join") vistos.push(String(evento.payload.joinId))
    })

    // Everything Ana sends in this channel for 1.5 s is rejected, with a 2 s wait.
    const fim = Date.now() + 1_500
    filtro.regra = (trama, endereco) =>
      endereco === ana!.address && trama.channel === canal && trama.kind === "application" && Date.now() < fim ? { recusar: 2_000 } : null
    const join = (joinId: string, at: number) => ({ t: "voice.join", at, video: false, sframe: false, alone: false, joinId }) as never
    // One 3.5 s old (by the time it is retried it will be over 5 s old) and one just sent.
    await ana!.session.send(canal, join("velho", Date.now() - 3_500))
    await ana!.session.send(canal, join("fresco", Date.now()))
    await ate(() => vistos.includes("fresco"), "o fresco repete-se e chega", 20_000)
    await esperar(1_000)
    expect(vistos).not.toContain("velho")
  }, 60_000)
})

describe("revisão de S6: desistir pelo tempo (achado 1)", () => {
  it("um envio sempre recusado repete-se até ao prazo, e não até um número de tentativas", async () => {
    const [ana, dora] = await contas(["Ana", "Dora"])
    const canal = await canalComTodos(servidor, ana!, [dora!])
    await esperar(500)
    Session.PRAZO_DOS_REENVIOS_MS = 6_000
    const lista = estados(ana!)

    // `retryAfterMs` of 1 ms, as the server says when only one slot is left.
    filtro.regra = (trama, endereco) =>
      endereco === ana!.address && trama.channel === canal && trama.kind === "application" ? { recusar: 1 } : null
    const inicio = Date.now()
    await ana!.session.send(canal, mensagem(crypto.randomUUID(), "nunca passa"))
    await ate(() => lista.some((s) => s.detail.includes("desisti")), "a Ana desiste", 30_000)
    const desistiu = lista.find((s) => s.detail.includes("desisti"))!
    expect(desistiu.at - inicio).toBeGreaterThanOrEqual(6_000)
    // More than the twenty from before, and none overtaking another: one at a time.
    expect(filtro.recusadas.filter((v) => v.endereco === ana!.address && v.at >= inicio).length).toBeGreaterThan(21)
    expect(ana!.session.ritmoDosEnvios().lento.envios).toBe(true)
  }, 60_000)
})

describe("revisão de S6: o que se repete pelo seu caminho (achados 8, 9 e 11)", () => {
  it("o livro: um pedido de amizade recusado repete-se, e o recibo chega", async () => {
    const [ana, bruno] = await contas(["Ana", "Bruno"])
    const dm = await ana!.session.openDirect(bruno!.address)
    await ate(() => bruno!.session.channels.includes(dm), "o Bruno entra na directa")
    await esperar(500)
    let recusas = 0
    filtro.regra = (trama, endereco) => {
      if (recusas >= 2 || endereco !== ana!.address || trama.channel !== dm || trama.kind !== "application") return null
      recusas += 1
      return { recusar: 300 }
    }
    await ana!.session.sendFriendRequest(dm)
    expect(recusas).toBe(2)
    await ate(() => bruno!.session.friendTies().get(ana!.address)?.link === "pedido-recebido", "o pedido chega ao Bruno")
    expect(ana!.session.friendTies().get(bruno!.address)?.link).toBe("pedido-enviado")
  }, 60_000)

  it("o commit e o Welcome: recusados por ritmo, repetem-se, e quem foi sentado entra", async () => {
    const [ana, bia] = await contas(["Ana", "Bia"])
    const canal = await canalComTodos(servidor, ana!, [])
    await esperar(500)
    const recusados = new Set<string>()
    filtro.regra = (trama, endereco) => {
      if (endereco !== ana!.address || trama.channel !== canal) return null
      const kind = trama.kind ?? ""
      if ((kind !== "handshake" && kind !== "welcome") || recusados.has(kind)) return null
      recusados.add(kind)
      return { recusar: 300 }
    }
    await ana!.session.seat(canal, bia!.address)
    await ate(() => bia!.session.channels.includes(canal), "a Bia entra", 30_000)
    expect([...recusados].sort()).toEqual(["handshake", "welcome"])
    expect(filtro.passadas.filter((v) => v.endereco === ana!.address && v.trama.kind === "welcome" && v.trama.channel === canal)).toHaveLength(1)
  }, 60_000)

  it("um commit recusado por ritmo e depois por epoch não deixa o registo de «por confirmar» para trás", async () => {
    const [ana, bia] = await contas(["Ana", "Bia"])
    const canal = await canalComTodos(servidor, ana!, [])
    await esperar(500)
    const primeiros: string[] = []
    filtro.regra = (trama, endereco) => {
      if (endereco !== ana!.address || trama.channel !== canal || trama.kind !== "handshake") return null
      primeiros.push(trama.ciphertext ?? "")
      if (primeiros.length === 1) return { recusar: 200 }
      // The same bytes on retry; the server now says the epoch has passed.
      if (primeiros.length === 2) return { responder: { t: "channel.rejected", channel: canal, reason: "stale-epoch", epoch: 99 } }
      return null
    }
    await ana!.session.seat(canal, bia!.address).catch(() => undefined)
    await ate(() => primeiros.length >= 2, "a repetição sai e é recusada por epoch")
    await esperar(1_000)
    expect(primeiros[1]).toBe(primeiros[0])
    await ana!.session.flush()
    const guardados = JSON.stringify(ana!.vault.contents).includes(primeiros[0]!.slice(0, 64))
    expect(guardados).toBe(false)
  }, 60_000)

  it("uma lista de amigos recusada repete-se, mesmo sendo a terceira seguida", async () => {
    const [ana] = await contas(["Ana"])
    const feed = await ana!.session.ensureFeed()
    await esperar(500)
    const lista = estados(ana!)
    const listas = () => filtro.passadas.filter((v) => v.endereco === ana!.address && v.trama.channel === feed)
    const antes = listas().length
    let vistas = 0
    filtro.regra = (trama, endereco) => {
      if (endereco !== ana!.address || trama.channel !== feed || trama.kind !== "application") return null
      vistas += 1
      return vistas === Session.LISTAS_SEGUIDAS_MAX ? { recusar: 300 } : null
    }
    for (let i = 0; i < Session.LISTAS_SEGUIDAS_MAX; i++) {
      await ana!.session.send(feed, { t: "friends.shown", shown: [], updatedAt: Date.now() + i } as never)
    }
    await ate(() => listas().length - antes === Session.LISTAS_SEGUIDAS_MAX, "as três listas passam", 10_000)
    expect(lista.filter((s) => s.detail.includes("falhou"))).toEqual([])
  }, 60_000)
})
