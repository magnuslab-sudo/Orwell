import {
  CAPACIDADE_SINAL_EFEMERO,
  fromBase64,
  generateIdentity,
  parseServerName,
  sign,
  toBase64,
  type ClientFrame,
  type ServerFrame,
  PROTOCOL_VERSION,
  moradaDeSala,
} from "@enclave/protocol"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { conviteComProva } from "../testes/convite-com-prova.js"
import { buildServer, type Enclave } from "./app.js"
import { loadConfig, TECTOS_DO_SINAL, type ServerConfig } from "./config.js"

/**
 * `channel.sinal` with real connections (absolute sync, phase S3).
 *
 * What we prove: the signal reaches the connected members and no one else; it does
 * not store or repeat to those who come back; a non-member is refused; all three
 * caps fire with the correct code; persistence closes the connection; and a client
 * that announces nothing keeps working as before, never seeing the frame.
 */

let HOME: ReturnType<typeof parseServerName>
let enclave: Enclave
let dataDir: string
let gatewayUrl: string
let config: ServerConfig

class Cliente {
  #socket: WebSocket
  #fila: ServerFrame[] = []
  #espera: ((frame: ServerFrame) => void)[] = []
  fechado = false

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const quem = this.#espera.shift()
      if (quem) quem(frame)
      else this.#fila.push(frame)
    })
    socket.on("close", () => {
      this.fechado = true
    })
  }

  static async ligar(): Promise<Cliente> {
    const socket = new WebSocket(gatewayUrl)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    return new Cliente(socket)
  }

  enviar(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame))
  }

  proxima(): Promise<ServerFrame> {
    const pronta = this.#fila.shift()
    if (pronta) return Promise.resolve(pronta)
    return new Promise((resolve) => {
      this.#espera.push(resolve)
      setTimeout(() => resolve({ t: "error", code: "timeout", message: "no frame", fatal: false }), 3000)
    })
  }

  async proximaDe<K extends ServerFrame["t"]>(t: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 20; i++) {
      const frame = await this.proxima()
      if (frame.t === t) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`nunca chegou ${t}`)
  }

  /** A round-trip ping: everything the server had for this connection has arrived. */
  async sincronizar(): Promise<void> {
    this.enviar({ t: "ping" })
    // Stores what arrives before the pong: tests that say "nothing arrived" look at this with `pendentes()`, and discarding it hid an echo.
    const vistas: ServerFrame[] = []
    for (let i = 0; i < 50; i++) {
      const frame = await this.proxima()
      if (frame.t === "pong") break
      if (frame.t === "error" && frame.code === "timeout") throw new Error("nunca chegou pong")
      vistas.push(frame)
    }
    this.#fila.unshift(...vistas)
  }

  /** What arrived and has not yet been read, without waiting. */
  pendentes(): ServerFrame[] {
    return this.#fila.splice(0)
  }

  fechar(): void {
    this.#socket.close()
  }
}

/** An authenticated account. `capacidades` is what `hello` announces. */
async function entrar(
  capacidades?: string[],
  identidade = generateIdentity(HOME),
): Promise<{ cliente: Cliente; endereco: string; identidade: ReturnType<typeof generateIdentity>; hello: Extract<ServerFrame, { t: "hello.ok" }> }> {
  const cliente = await Cliente.ligar()
  cliente.enviar({ t: "hello", version: PROTOCOL_VERSION, ...(capacidades ? { capabilities: capacidades } : {}) })
  const hello = await cliente.proximaDe("hello.ok")
  cliente.enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
  const desafio = await cliente.proximaDe("auth.challenge")
  cliente.enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
  await cliente.proximaDe("auth.ok")
  return { cliente, endereco: identidade.address, identidade, hello }
}

const NOVO = ["commit-after-echo", CAPACIDADE_SINAL_EFEMERO]
const ANTIGO = ["commit-after-echo"]

/** A new opaque address: the server at 1.0 j does not introduce `!<nome>`. */
function canalNovo(): string {
  return moradaDeSala(HOME)
}

/** The first claims the channel; the others enter by redeemed invite, as in reality. */
async function sentar(anfitriao: Cliente, outros: { cliente: Cliente; endereco: string }[], canal: string): Promise<void> {
  anfitriao.enviar({ t: "channel.subscribe", channels: [canal] })
  await anfitriao.sincronizar()
  for (const { cliente: outro, endereco } of outros) {
    // With code proof, as 1.0 rescues (slice 6a).
    const convite = conviteComProva()
    anfitriao.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: 1 })
    await anfitriao.proximaDe("invite.created")
    outro.enviar(convite.resgate(endereco))
    await anfitriao.proximaDe("invite.request")
    // The redemption is a request, not a seat (INV-01): the seat comes from the
    // Welcome sent by whoever is already there, which is what a member sends when
    // admitting.
    anfitriao.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: endereco })
    await outro.proximaDe("channel.event")
    outro.enviar({ t: "channel.subscribe", channels: [canal] })
    await outro.sincronizar()
  }
  // Presences and invite requests that stayed in the queue do not matter here.
  for (const c of [anfitriao, ...outros.map((o) => o.cliente)]) {
    await c.sincronizar()
    c.pendentes()
  }
}

const abertos: Cliente[] = []
function guardar<T extends { cliente: Cliente }>(x: T): T {
  abertos.push(x.cliente)
  return x
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-sinal-"))
  config = {
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir,
    databasePath: join(dataDir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
  }
  enclave = await buildServer(config)
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  const port = (enclave.app.server.address() as { port: number }).port
  HOME = parseServerName(`localhost:${port}`)
  config.serverName = HOME
  gatewayUrl = `ws://127.0.0.1:${port}/_enclave/gateway`
})

afterEach(() => {
  delete config.sinal
  for (const c of abertos.splice(0)) c.fechar()
})

afterAll(async () => {
  await enclave?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

describe("channel.sinal", () => {
  it("o hello.ok anuncia sinal-efemero, também a quem não anuncia nada", async () => {
    const novo = guardar(await entrar(NOVO))
    const semNada = guardar(await entrar())
    expect(novo.hello.capabilities).toContain(CAPACIDADE_SINAL_EFEMERO)
    expect(semNada.hello.capabilities).toContain(CAPACIDADE_SINAL_EFEMERO)
  })

  it("chega a todos os outros membros ligados, sem eco e sem resposta a quem envia", async () => {
    const ana = guardar(await entrar(NOVO))
    const bruno = guardar(await entrar(NOVO))
    const carla = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno, carla], canal)

    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AAECAw", ref: "r1" })
    for (const quem of [bruno, carla]) {
      const recebido = await quem.cliente.proximaDe("channel.sinal")
      expect(recebido).toStrictEqual({ t: "channel.sinal", channel: canal, from: ana.endereco, sinal: "AAECAw" })
    }
    await ana.cliente.sincronizar()
    expect(ana.cliente.pendentes()).toStrictEqual([])
  })

  it("não chega a quem está desligado, não se guarda, e não se repete a quem volta", async () => {
    const ana = guardar(await entrar(NOVO))
    const bruno = await entrar(NOVO)
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno], canal)

    bruno.cliente.fechar()
    await new Promise((r) => setTimeout(r, 100))
    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "QU5URVM" })
    await ana.cliente.sincronizar()
    // Bruno's presence leaving may come; a signal or a refusal may not.
    expect(ana.cliente.pendentes().filter((f) => f.t.startsWith("channel.sinal"))).toStrictEqual([])

    // It was not stored: the channel still has no events.
    ana.cliente.enviar({ t: "channel.backfill", channel: canal, afterSeq: -1, limit: 50 })
    const pagina = await ana.cliente.proximaDe("channel.backfill.page")
    expect(pagina.events).toStrictEqual([])

    // Bruno comes back with the same account and only hears what comes after.
    const deVolta = guardar(await entrar(NOVO, bruno.identidade))
    deVolta.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    await deVolta.cliente.sincronizar()
    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "REVQT0lT" })
    const recebido = await deVolta.cliente.proximaDe("channel.sinal")
    expect(recebido.sinal).toBe("REVQT0lT")
    await deVolta.cliente.sincronizar()
    expect(deVolta.cliente.pendentes().filter((f) => f.t === "channel.sinal")).toStrictEqual([])
  })

  it("recusa um não-membro com sinal-no-seat, e ninguém recebe nada", async () => {
    const ana = guardar(await entrar(NOVO))
    const intruso = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [], canal)

    // Trying to subscribe makes no difference: the channel is already claimed by Ana.
    intruso.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    intruso.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AAEC", ref: "x" })
    const recusa = await intruso.cliente.proximaDe("channel.sinal.rejected")
    expect(recusa).toMatchObject({ channel: canal, code: "sinal-no-seat", ref: "x" })
    expect(recusa.retryAfterMs).toBeUndefined()

    await ana.cliente.sincronizar()
    expect(ana.cliente.pendentes().filter((f) => f.t === "channel.sinal")).toStrictEqual([])
    expect(intruso.cliente.fechado).toBe(false)
  })

  it("um cliente que não anuncia nada continua a funcionar e nunca vê a trama", async () => {
    const ana = guardar(await entrar(NOVO))
    const antigo = guardar(await entrar(ANTIGO))
    const canal = canalNovo()
    await sentar(ana.cliente, [antigo], canal)

    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AAEC" })
    await ana.cliente.sincronizar()
    await antigo.cliente.sincronizar()
    expect(antigo.cliente.pendentes().filter((f) => f.t.startsWith("channel.sinal"))).toStrictEqual([])

    // The usual conversation goes both ways.
    antigo.cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: "b2zDoQ", ref: "m1" })
    const eco = await antigo.cliente.proximaDe("channel.event")
    expect(eco.ref).toBe("m1")
    const naAna = await ana.cliente.proximaDe("channel.event")
    expect(naAna.ciphertext).toBe("b2zDoQ")

    await antigo.cliente.sincronizar()
    expect(antigo.cliente.pendentes().filter((f) => f.t === "channel.sinal")).toStrictEqual([])

    // And if the old client sends one by mistake, here is why it hears it back.
    antigo.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AAEC" })
    const recusa = await antigo.cliente.proximaDe("channel.sinal.rejected")
    expect(recusa.code).toBe("sinal-not-announced")
  })

  it("um sinal acima do tamanho do operador é sinal-too-large", async () => {
    config.sinal = { maxBytes: 8 }
    const ana = guardar(await entrar(NOVO))
    const bruno = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno], canal)

    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "A".repeat(9) })
    expect((await ana.cliente.proximaDe("channel.sinal.rejected")).code).toBe("sinal-too-large")
    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "A".repeat(8) })
    expect((await bruno.cliente.proximaDe("channel.sinal")).sinal).toBe("A".repeat(8))
  })

  it("o tecto por ligação dá sinal-rate-limited com o tempo de espera", async () => {
    config.sinal = { porMinutoPorLigacao: 2 }
    const ana = guardar(await entrar(NOVO))
    const bruno = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno], canal)

    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AQ" })
    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "Ag" })
    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "Aw", ref: "3" })
    const recusa = await ana.cliente.proximaDe("channel.sinal.rejected")
    expect(recusa).toMatchObject({ code: "sinal-rate-limited", ref: "3" })
    expect(recusa.retryAfterMs).toBeGreaterThan(50_000)
    expect(recusa.retryAfterMs).toBeLessThanOrEqual(60_000)

    expect((await bruno.cliente.proximaDe("channel.sinal")).sinal).toBe("AQ")
    expect((await bruno.cliente.proximaDe("channel.sinal")).sinal).toBe("Ag")
    await bruno.cliente.sincronizar()
    expect(bruno.cliente.pendentes()).toStrictEqual([])
    expect(ana.cliente.fechado).toBe(false)
  })

  it("o tecto de saída do canal soma todos os membros, e conta as cópias", async () => {
    // 40 caracteres a dois membros custam 80. O segundo sinal levava a 160.
    config.sinal = { bytesPorCanalPorMinuto: 100 }
    const ana = guardar(await entrar(NOVO))
    const bruno = guardar(await entrar(NOVO))
    const carla = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno, carla], canal)

    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "A".repeat(40) })
    await bruno.cliente.proximaDe("channel.sinal")
    // Another member, another connection: the bucket belongs to the channel, not to the sender.
    bruno.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "B".repeat(40) })
    const ocupado = await bruno.cliente.proximaDe("channel.sinal.rejected")
    expect(ocupado.code).toBe("sinal-channel-busy")
    expect(ocupado.retryAfterMs).toBeGreaterThan(0)

    // A signal that costs by itself more than the cap does not wait: it is too big.
    carla.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "C".repeat(60) })
    const grande = await carla.cliente.proximaDe("channel.sinal.rejected")
    expect(grande.code).toBe("sinal-too-large")
    expect(grande.retryAfterMs).toBeUndefined()
  })

  it("não fecha à primeira; fecha com sinal-abuse quem insiste depois das recusas", async () => {
    config.sinal = { recusasAteFechar: 3 }
    const intruso = guardar(await entrar(NOVO))
    const canal = canalNovo()

    for (let i = 0; i < 3; i++) {
      intruso.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AA" })
      expect((await intruso.cliente.proximaDe("channel.sinal.rejected")).code).toBe("sinal-no-seat")
    }
    expect(intruso.cliente.fechado).toBe(false)

    intruso.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AA" })
    expect((await intruso.cliente.proximaDe("channel.sinal.rejected")).code).toBe("sinal-no-seat")
    const fatal = await intruso.cliente.proximaDe("error")
    expect(fatal).toMatchObject({ code: "sinal-abuse", fatal: true })
    await new Promise((r) => setTimeout(r, 100))
    expect(intruso.cliente.fechado).toBe(true)
  })

  it("as métricas contam por minuto, sem canal nem conta", async () => {
    const antes = enclave.gateway.metricasDoSinal().actual
    const ana = guardar(await entrar(NOVO))
    const bruno = guardar(await entrar(NOVO))
    const carla = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno, carla], canal)

    ana.cliente.enviar({ t: "channel.sinal", channel: canal, sinal: "AAAA" })
    await bruno.cliente.proximaDe("channel.sinal")
    await carla.cliente.proximaDe("channel.sinal")
    ana.cliente.enviar({ t: "channel.sinal", channel: "!outro:x", sinal: "AA" })
    await ana.cliente.proximaDe("channel.sinal.rejected")

    const depois = enclave.gateway.metricasDoSinal().actual
    // The minute may have turned in the middle; in that case only the shape is checked.
    if (depois.minuto === antes.minuto) {
      expect(depois.aceites - antes.aceites).toBe(1)
      expect(depois.entregas - antes.entregas).toBe(2)
      expect(depois.bytesEnviados - antes.bytesEnviados).toBe(8)
      expect((depois.recusas["sinal-no-seat"] ?? 0) - (antes.recusas["sinal-no-seat"] ?? 0)).toBe(1)
    }
    const texto = JSON.stringify(enclave.gateway.metricasDoSinal())
    expect(texto).not.toContain(canal)
    expect(texto).not.toContain(ana.endereco)
  })
})

describe("o disco por canal e por dia (revisão de S4, achado 8)", () => {
  it("conta os bytes guardados por canal, sem nomes", async () => {
    const antes = enclave.gateway.metricasDoDisco().hoje
    const ana = guardar(await entrar(NOVO))
    const bruno = guardar(await entrar(NOVO))
    const canal = canalNovo()
    await sentar(ana.cliente, [bruno], canal)
    const depoisDeSentar = enclave.gateway.metricasDoDisco().hoje
    ana.cliente.enviar({ t: "channel.send", channel: canal, kind: "application", ciphertext: Buffer.alloc(300, 7).toString("base64url") })
    await bruno.cliente.proximaDe("channel.event")
    const depois = enclave.gateway.metricasDoDisco()
    if (depois.hoje.dia === antes.dia) {
      expect(depois.hoje.bytes - depoisDeSentar.bytes).toBe(300)
      expect(depois.hoje.maiorCanal).toBeGreaterThanOrEqual(300)
    }
    const texto = JSON.stringify(depois)
    expect(texto).not.toContain(canal)
    expect(texto).not.toContain(ana.endereco)
  })
})

describe("tectos do sinal no ambiente", () => {
  it("vazio dá os valores por omissão", () => {
    expect(loadConfig({}).sinal).toStrictEqual({ ...TECTOS_DO_SINAL })
  })

  it("lê cada tecto e recusa lixo, zero e acima do protocolo", () => {
    expect(loadConfig({ ENCLAVE_SINAL_POR_MINUTO: "30" }).sinal?.porMinutoPorLigacao).toBe(30)
    expect(() => loadConfig({ ENCLAVE_SINAL_POR_MINUTO: "0" })).toThrow(/ENCLAVE_SINAL_POR_MINUTO/)
    expect(() => loadConfig({ ENCLAVE_SINAL_BYTES_POR_CANAL: "muito" })).toThrow(/ENCLAVE_SINAL_BYTES_POR_CANAL/)
    expect(() => loadConfig({ ENCLAVE_SINAL_MAX_BYTES: String(64 * 1024 + 1) })).toThrow(/ENCLAVE_SINAL_MAX_BYTES/)
  })
})
