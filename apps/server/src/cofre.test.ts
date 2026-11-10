import {
  CAPACIDADE_COFRE_CIFRADO,
  fromBase64,
  generateIdentity,
  moradaDeSala,
  PROTOCOL_VERSION,
  sign,
  toBase64,
  type ClientFrame,
  type Identity,
  type ServerFrame,
} from "@enclave/protocol"
import { createCipheriv, createHmac, randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { WebSocket } from "ws"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { COMMIT_DEPOIS_DO_ECO, levantarServidor, type ServidorDeTeste } from "../testes/cliente-de-teste.js"
import { conviteComProva } from "../testes/convite-com-prova.js"
import { loadConfig, TECTOS_DO_COFRE } from "./config.js"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * The encrypted vault on the server (phase 3a of the encrypted state plan).
 *
 * What we prove with real connections: write, read by delta, and tombstone
 * delete; CAS via `versaoEsperada`; limits per entry, per scope, and per
 * minute, with the right code; that non-members of the channel cannot read or
 * write; that the `conta:` scope belongs only to the account itself; that
 * versions arrive after `auth.ok`, after each `channel.subscribe`, and after
 * each alien write; that metrics have no names; and that a thief with the
 * database file cannot read what is stored there.
 */

const COM_COFRE = [COMMIT_DEPOIS_DO_ECO, CAPACIDADE_COFRE_CIFRADO]

/** An opaque key as 3b will make it: HMAC of the logical key under the vault key, 16 bytes. */
function chaveOpaca(k: Uint8Array, logica: string): string {
  return toBase64(createHmac("sha256", k).update(logica).digest().subarray(0, 16))
}

/** An opaque key of any kind, for tests that only need one. */
function chaveQualquer(): string {
  return toBase64(randomBytes(16))
}

/** Padded cipher: `buckets` × 1 KiB of random bytes, in base64url. */
function cifra(baldes = 1): string {
  return toBase64(randomBytes(baldes * 1024))
}

/**
 * A raw socket, like the `Cliente` from `cliente-de-teste.ts`, but that can be
 * built here: the `entrar` below needs to see what arrives between `auth.ok`
 * and `pong`, which `Cliente.ligar` throws away.
 */
class Ligacao {
  #socket: WebSocket
  #fila: ServerFrame[] = []
  #esperas: ((frame: ServerFrame) => void)[] = []

  constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const espera = this.#esperas.shift()
      if (espera) espera(frame)
      else this.#fila.push(frame)
    })
  }

  enviar(frame: ClientFrame): void {
    this.#socket.send(JSON.stringify(frame))
  }

  proximo(): Promise<ServerFrame> {
    const pronto = this.#fila.shift()
    if (pronto) return Promise.resolve(pronto)
    return new Promise((resolve) => {
      const espera = (frame: ServerFrame): void => resolve(frame)
      this.#esperas.push(espera)
      setTimeout(() => {
        const indice = this.#esperas.indexOf(espera)
        if (indice >= 0) this.#esperas.splice(indice, 1)
        resolve({ t: "error", code: "timeout", message: "no frame", fatal: false })
      }, 5000)
    })
  }

  async proximoDe<K extends ServerFrame["t"]>(tipo: K): Promise<Extract<ServerFrame, { t: K }>> {
    for (let i = 0; i < 20; i++) {
      const frame = await this.proximo()
      if (frame.t === tipo) return frame as Extract<ServerFrame, { t: K }>
      if (frame.t === "error" && frame.code === "timeout") break
    }
    throw new Error(`nunca chegou um ${tipo}`)
  }

  /** Everything that arrived up to the `pong` of a `ping` sent now. */
  async ateAoPong(): Promise<ServerFrame[]> {
    this.enviar({ t: "ping" })
    const recebidos: ServerFrame[] = []
    for (let i = 0; i < 50; i++) {
      const frame = await this.proximo()
      if (frame.t === "pong") return recebidos
      if (frame.t === "error" && frame.code === "timeout") throw new Error("o servidor não respondeu ao ping")
      recebidos.push(frame)
    }
    throw new Error("frames a mais antes do pong")
  }

  fechar(): void {
    this.#socket.close()
  }
}

/** Connect and authenticate, saving what arrived between `auth.ok` and `pong`. */
async function entrar(
  servidor: ServidorDeTeste,
  capacidades: string[] | null = COM_COFRE,
  identidade: Identity = generateIdentity(servidor.casa),
): Promise<{ cliente: Ligacao; endereco: string; identidade: Identity; aposLogin: ServerFrame[] }> {
  const socket = new WebSocket(servidor.url)
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve())
    socket.once("error", reject)
  })
  const cliente = new Ligacao(socket)
  cliente.enviar(capacidades === null ? { t: "hello", version: PROTOCOL_VERSION } : { t: "hello", version: PROTOCOL_VERSION, capabilities: capacidades })
  await cliente.proximoDe("hello.ok")
  cliente.enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
  const desafio = await cliente.proximoDe("auth.challenge")
  cliente.enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
  await cliente.proximoDe("auth.ok")
  const aposLogin = await cliente.ateAoPong()
  return { cliente, endereco: identidade.address, identidade, aposLogin }
}

/** The first claims the channel; the others enter by redeemed invite, as in reality. */
async function sentar(anfitriao: Ligacao, outros: { cliente: Ligacao; endereco: string }[], canal: string): Promise<void> {
  anfitriao.enviar({ t: "channel.subscribe", channels: [canal] })
  await anfitriao.ateAoPong()
  for (const { cliente: outro, endereco } of outros) {
    const convite = conviteComProva()
    anfitriao.enviar({ t: "invite.create", channel: canal, ...convite.criar, expiresAt: null, maxUses: 1 })
    await anfitriao.proximoDe("invite.created")
    outro.enviar(convite.resgate(endereco))
    await anfitriao.proximoDe("invite.request")
    // The redemption is a request, not a seat (INV-01): the seat comes from the
    // Welcome sent by whoever is already there, which is what a member sends when
    // admitting.
    anfitriao.enviar({ t: "channel.send", channel: canal, kind: "welcome", ciphertext: toBase64(crypto.getRandomValues(new Uint8Array(64))), recipient: endereco })
    await outro.proximoDe("channel.event")
    outro.enviar({ t: "channel.subscribe", channels: [canal] })
    await outro.ateAoPong()
  }
  for (const c of [anfitriao, ...outros.map((o) => o.cliente)]) await c.ateAoPong()
}

const abertos: Ligacao[] = []
function guardar<T extends { cliente: Ligacao }>(x: T): T {
  abertos.push(x.cliente)
  return x
}

let servidor: ServidorDeTeste

beforeAll(async () => {
  servidor = await levantarServidor()
})

afterAll(async () => {
  for (const c of abertos.splice(0)) c.fechar()
  await servidor?.fechar()
})

describe("o cofre com ligações reais", () => {
  it("o hello.ok anuncia cofre-cifrado, também a quem não o anuncia", async () => {
    const socket = new WebSocket(servidor.url)
    await new Promise<void>((resolve) => socket.once("open", () => resolve()))
    const hello = new Promise<ServerFrame>((resolve) => socket.once("message", (raw: Buffer) => resolve(JSON.parse(raw.toString("utf8")))))
    socket.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION }))
    const frame = await hello
    expect(frame.t).toBe("hello.ok")
    expect((frame as Extract<ServerFrame, { t: "hello.ok" }>).capabilities).toContain(CAPACIDADE_COFRE_CIFRADO)
    socket.close()
  })

  it("put, get por delta e del com lápide versionada", async () => {
    const ana = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [], canal)
    const escopo = `canal:${canal}`
    const [k1, k2] = [chaveQualquer(), chaveQualquer()]
    const [c1, c2] = [cifra(1), cifra(2)]

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k1, conteudo: c1 }, { chave: k2, conteudo: c2 }], ref: "p1" })
    expect(await ana.cliente.proximoDe("cofre.put.result")).toEqual({
      t: "cofre.put.result",
      escopo,
      aceites: [
        { chave: k1, versao: 1 },
        { chave: k2, versao: 2 },
      ],
      recusadas: [],
      versaoGlobal: 2,
      ref: "p1",
    })

    ana.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 0 })
    const tudo = await ana.cliente.proximoDe("cofre.entradas")
    expect(tudo).toMatchObject({ versaoGlobal: 2, completo: true, ate: 2, mais: false, lapides: [] })
    expect(tudo.entradas).toEqual([
      { chave: k1, versao: 1, conteudo: c1 },
      { chave: k2, versao: 2, conteudo: c2 },
    ])

    ana.cliente.enviar({ t: "cofre.del", escopo, chave: k1, ref: "d1" })
    expect(await ana.cliente.proximoDe("cofre.del.result")).toEqual({
      t: "cofre.del.result",
      escopo,
      chave: k1,
      versao: 3,
      versaoGlobal: 3,
      ref: "d1",
    })

    // The delta since 2 says only that k1 left.
    ana.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 2 })
    const delta = await ana.cliente.proximoDe("cofre.entradas")
    expect(delta).toMatchObject({ versaoGlobal: 3, completo: false, ate: 3, mais: false, entradas: [], lapides: [{ chave: k1, versao: 3 }] })

    // Nothing changed since 3: an empty delta, not the whole vault.
    ana.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 3 })
    expect(await ana.cliente.proximoDe("cofre.entradas")).toMatchObject({ completo: false, entradas: [], lapides: [], ate: 3 })

    // Counters count only what is alive.
    expect(servidor.enclave.store.cofreContadores(escopo)).toEqual({ versaoGlobal: 3, bytes: 2048, entradas: 1, lapides: 1, podadoAte: 0 })

    // Rewriting the deleted key resurrects it with a new version.
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k1, conteudo: c1 }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).aceites).toEqual([{ chave: k1, versao: 4 }])
    expect(servidor.enclave.store.cofreContadores(escopo)).toMatchObject({ entradas: 2, lapides: 0, bytes: 3072 })
  })

  it("CAS: a versaoEsperada errada recusa só aquela entrada e diz a versão actual", async () => {
    const ana = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [], canal)
    const escopo = `canal:${canal}`
    const k = chaveQualquer()
    const nova = chaveQualquer()

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k, conteudo: cifra(), versaoEsperada: 0 }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).aceites).toEqual([{ chave: k, versao: 1 }])

    // Two writing the same key from version 0: the second loses.
    ana.cliente.enviar({
      t: "cofre.put",
      escopo,
      entradas: [
        { chave: k, conteudo: cifra(), versaoEsperada: 0 },
        { chave: nova, conteudo: cifra(), versaoEsperada: 0 },
      ],
    })
    const corrida = await ana.cliente.proximoDe("cofre.put.result")
    expect(corrida.recusadas).toEqual([{ chave: k, razao: "versao", versao: 1 }])
    expect(corrida.aceites).toEqual([{ chave: nova, versao: 2 }])

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k, conteudo: cifra(), versaoEsperada: 1 }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).aceites).toEqual([{ chave: k, versao: 3 }])

    ana.cliente.enviar({ t: "cofre.del", escopo, chave: k, versaoEsperada: 1 })
    expect(await ana.cliente.proximoDe("cofre.del.result")).toMatchObject({ razao: "versao", versao: 3, versaoGlobal: 3 })
    ana.cliente.enviar({ t: "cofre.del", escopo, chave: chaveQualquer() })
    expect(await ana.cliente.proximoDe("cofre.del.result")).toMatchObject({ razao: "inexistente", versao: 0 })
    expect(servidor.enclave.store.cofreContadores(escopo).versaoGlobal).toBe(3)
  })

  it("o conteúdo tem de vir acolchoado a 1 KiB, e uma chave que não é opaca não passa no molde", async () => {
    const ana = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [], canal)
    const escopo = `canal:${canal}`
    const k = chaveQualquer()
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k, conteudo: toBase64(randomBytes(1000)) }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).recusadas).toEqual([{ chave: k, razao: "acolchoamento" }])

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: "sala:geral", conteudo: cifra() }] } as unknown as ClientFrame)
    expect(await ana.cliente.proximoDe("error")).toMatchObject({ code: "bad-frame" })
    expect(servidor.enclave.store.cofreContadores(escopo).entradas).toBe(0)
  })

  it("quem tem lugar lê e escreve; quem não tem é recusado, e nada se escreve", async () => {
    const ana = guardar(await entrar(servidor))
    const bruno = guardar(await entrar(servidor))
    const carla = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [bruno], canal)
    const escopo = `canal:${canal}`
    const k = chaveQualquer()

    bruno.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k, conteudo: cifra() }] })
    expect((await bruno.cliente.proximoDe("cofre.put.result")).aceites).toHaveLength(1)
    ana.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 0 })
    expect((await ana.cliente.proximoDe("cofre.entradas")).entradas.map((e) => e.chave)).toEqual([k])

    // Carla tries to subscribe (she has no seat) and then read and write.
    carla.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    await carla.cliente.ateAoPong()
    carla.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 0, ref: "g" })
    expect(await carla.cliente.proximoDe("cofre.rejected")).toMatchObject({ escopo, code: "cofre-sem-lugar", ref: "g" })
    carla.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: chaveQualquer(), conteudo: cifra() }] })
    expect(await carla.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    carla.cliente.enviar({ t: "cofre.del", escopo, chave: k })
    expect(await carla.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    expect(servidor.enclave.store.cofreContadores(escopo)).toMatchObject({ versaoGlobal: 1, entradas: 1 })

    // And she never gets the notice of versions from a channel where she is not.
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: chaveQualquer(), conteudo: cifra() }] })
    await ana.cliente.proximoDe("cofre.put.result")
    expect((await carla.cliente.ateAoPong()).map((f) => f.t)).not.toContain("cofre.versoes")
  })

  it("o escopo conta: é só da própria conta", async () => {
    const ana = guardar(await entrar(servidor))
    const bruno = guardar(await entrar(servidor))
    const escopo = `conta:${ana.endereco}`
    const k = chaveQualquer()

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: k, conteudo: cifra() }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).aceites).toEqual([{ chave: k, versao: 1 }])

    bruno.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 0 })
    expect(await bruno.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    bruno.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: chaveQualquer(), conteudo: cifra() }] })
    expect(await bruno.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    bruno.cliente.enviar({ t: "cofre.del", escopo, chave: k })
    expect(await bruno.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    expect(servidor.enclave.store.cofreContadores(escopo)).toMatchObject({ versaoGlobal: 1, entradas: 1 })

    // A second device (another connection of the same account) hears the version
    // right after auth.ok, and hears the writes from the first.
    const outro = guardar(await entrar(servidor, COM_COFRE, ana.identidade))
    expect(outro.aposLogin).toContainEqual({ t: "cofre.versoes", cofres: [{ escopo, versaoGlobal: 1 }] })
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: chaveQualquer(), conteudo: cifra() }] })
    await ana.cliente.proximoDe("cofre.put.result")
    expect(await outro.cliente.proximoDe("cofre.versoes")).toEqual({ t: "cofre.versoes", cofres: [{ escopo, versaoGlobal: 2 }] })
    // Bruno is not from this account: he hears nothing.
    expect((await bruno.cliente.ateAoPong()).map((f) => f.t)).not.toContain("cofre.versoes")
  })

  it("as versões chegam no subscribe e quando outro membro escreve, nunca a quem escreveu", async () => {
    const ana = guardar(await entrar(servidor))
    const bruno = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    const vazio = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [bruno], canal)
    const escopo = `canal:${canal}`
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: chaveQualquer(), conteudo: cifra() }] })
    await ana.cliente.proximoDe("cofre.put.result")
    expect(await bruno.cliente.proximoDe("cofre.versoes")).toEqual({ t: "cofre.versoes", cofres: [{ escopo, versaoGlobal: 1 }] })
    expect((await ana.cliente.ateAoPong()).map((f) => f.t)).not.toContain("cofre.versoes")

    // Subscribe again (a reconnect) says the version of the channel with vault,
    // and nothing from the channel that has no vault.
    ana.cliente.enviar({ t: "channel.subscribe", channels: [vazio] })
    await ana.cliente.ateAoPong()
    bruno.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    expect(await bruno.cliente.proximoDe("cofre.versoes")).toEqual({ t: "cofre.versoes", cofres: [{ escopo, versaoGlobal: 1 }] })
    ana.cliente.enviar({ t: "channel.subscribe", channels: [canal, vazio] })
    expect(await ana.cliente.proximoDe("cofre.versoes")).toEqual({ t: "cofre.versoes", cofres: [{ escopo, versaoGlobal: 1 }] })
  })

  it("uma ligação que não anunciou o cofre é recusada, e não recebe versões", async () => {
    const ana = guardar(await entrar(servidor))
    const antigo = guardar(await entrar(servidor, [COMMIT_DEPOIS_DO_ECO], ana.identidade))
    expect(antigo.aposLogin.map((f) => f.t)).not.toContain("cofre.versoes")
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [], canal)
    antigo.cliente.enviar({ t: "channel.subscribe", channels: [canal] })
    expect((await antigo.cliente.ateAoPong()).map((f) => f.t)).not.toContain("cofre.versoes")
    antigo.cliente.enviar({ t: "cofre.get", escopo: `canal:${canal}`, desdeVersao: 0 })
    expect(await antigo.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-nao-anunciado" })
  })

  it("um ladrão com o ficheiro da base não lê nada: nem o texto, nem a chave lógica, nem quem escreveu", async () => {
    const ana = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [], canal)
    const escopo = `canal:${canal}`

    // What phase 3b will do: encrypt under K_canal, opaque key via HMAC, pad.
    const kCanal = randomBytes(32)
    const segredo = "SEGREDO-o-nome-da-sala-e-o-cargo-do-Bruno-administrador"
    const iv = randomBytes(12)
    const cifrador = createCipheriv("aes-256-gcm", kCanal, iv)
    const claro = Buffer.alloc(1024 - 12 - 16)
    claro.write(segredo)
    const conteudo = Buffer.concat([iv, cifrador.update(claro), cifrador.final(), cifrador.getAuthTag()])
    expect(conteudo.length).toBe(1024)
    const chave = chaveOpaca(kCanal, "sala:geral-dos-segredos")

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave, conteudo: toBase64(conteudo) }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).aceites).toHaveLength(1)

    // The file and the WAL, as they are on the server disk.
    const caminhos = [servidor.baseDeDados, `${servidor.baseDeDados}-wal`].filter((c) => existsSync(c))
    const disco = Buffer.concat(caminhos.map((c) => readFileSync(c)))
    // Proof that we are reading the right place: the cipher is there.
    expect(disco.includes(conteudo)).toBe(true)
    expect(disco.includes(Buffer.from(segredo))).toBe(false)
    expect(disco.includes(Buffer.from("sala:geral-dos-segredos"))).toBe(false)
    expect(disco.includes(Buffer.from("SEGREDO"))).toBe(false)

    // No account next to the cipher: the table has no author column, and the entry
    // row does not carry the address of who wrote it.
    const db = openDatabase(servidor.baseDeDados)
    const colunas = (db.prepare("PRAGMA table_info(cofres)").all() as { name: string }[]).map((c) => c.name)
    expect(colunas).toEqual(["escopo", "chave", "versao", "conteudo", "lapide", "epoch", "at_minute"])
    const linha = db.prepare("SELECT * FROM cofres WHERE escopo = ? AND chave = ?").get(escopo, chave) as Record<string, unknown>
    db.close()
    const textoDaLinha = Object.values(linha)
      .filter((valor) => typeof valor === "string")
      .join("\n")
    expect(textoDaLinha).not.toContain(ana.endereco)
    // And in the disk bytes, Ana's address appears only outside the vault (accounts,
    // subscriptions): never glued to the cipher. The SQLite cell of the entry carries
    // the scope and key next to the content; 512 bytes on each side cover it.
    let copias = 0
    for (let i = disco.indexOf(conteudo); i >= 0; i = disco.indexOf(conteudo, i + 1)) {
      copias += 1
      const vizinhanca = disco.subarray(Math.max(0, i - 512), i + conteudo.length + 512)
      expect(vizinhanca.includes(Buffer.from(escopo))).toBe(true)
      expect(vizinhanca.includes(Buffer.from(ana.endereco))).toBe(false)
    }
    expect(copias).toBeGreaterThan(0)
  })

  it("as métricas são só números do processo: nem escopos, nem contas", async () => {
    const ana = guardar(await entrar(servidor))
    const canal = moradaDeSala(servidor.casa)
    await sentar(ana.cliente, [], canal)
    const antes = servidor.enclave.gateway.metricasDoCofre().actual
    ana.cliente.enviar({ t: "cofre.put", escopo: `canal:${canal}`, entradas: [{ chave: chaveQualquer(), conteudo: cifra(2) }] })
    await ana.cliente.proximoDe("cofre.put.result")
    ana.cliente.enviar({ t: "cofre.get", escopo: `canal:${canal}`, desdeVersao: 0 })
    await ana.cliente.proximoDe("cofre.entradas")
    const depois = servidor.enclave.gateway.metricasDoCofre().actual
    if (depois.minuto === antes.minuto) {
      expect(depois.escritas - antes.escritas).toBe(1)
      expect(depois.bytesEscritos - antes.bytesEscritos).toBe(2048)
      expect(depois.leituras - antes.leituras).toBe(1)
    }
    const texto = JSON.stringify(servidor.enclave.gateway.metricasDoCofre())
    expect(texto).not.toContain(canal)
    expect(texto).not.toContain(ana.endereco)
    expect(texto).not.toContain("canal:")
  })
})

describe("os tectos do cofre", () => {
  let apertado: ServidorDeTeste
  const tectos = {
    entradaMaxBytes: 2048,
    entradasPorEscopo: 3,
    bytesPorEscopoDeCanal: 5 * 1024,
    bytesPorEscopoDeConta: 2 * 1024,
    escritasPorMinuto: 8,
    leiturasPorMinuto: 3,
    recusasAteFechar: 4,
  }

  beforeAll(async () => {
    apertado = await levantarServidor({ cofre: tectos })
  })

  afterAll(async () => {
    await apertado?.fechar()
  })

  it("por entrada, por número de entradas e por bytes do escopo, entrada a entrada", async () => {
    const ana = guardar(await entrar(apertado))
    const canal = moradaDeSala(apertado.casa)
    await sentar(ana.cliente, [], canal)
    const escopo = `canal:${canal}`
    const [a, b, c, d] = [chaveQualquer(), chaveQualquer(), chaveQualquer(), chaveQualquer()]

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: a, conteudo: cifra(3) }] })
    expect((await ana.cliente.proximoDe("cofre.put.result")).recusadas).toEqual([{ chave: a, razao: "tecto" }])

    ana.cliente.enviar({
      t: "cofre.put",
      escopo,
      entradas: [
        { chave: a, conteudo: cifra(2) },
        { chave: b, conteudo: cifra(2) },
        // 2 + 2 + 2 KiB exceeds the 5 KiB of the scope.
        { chave: c, conteudo: cifra(2) },
        { chave: c, conteudo: cifra(1) },
      ],
    })
    const r = await ana.cliente.proximoDe("cofre.put.result")
    expect(r.aceites.map((x) => x.chave)).toEqual([a, b, c])
    expect(r.recusadas).toEqual([{ chave: c, razao: "tecto" }])

    // Three live entries: the fourth does not fit, but rewriting one of the three does.
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: d, conteudo: cifra(1) }, { chave: a, conteudo: cifra(1) }] })
    const r2 = await ana.cliente.proximoDe("cofre.put.result")
    expect(r2.recusadas).toEqual([{ chave: d, razao: "tecto" }])
    expect(r2.aceites.map((x) => x.chave)).toEqual([a])
    expect(apertado.enclave.store.cofreContadores(escopo)).toMatchObject({ entradas: 3, bytes: 4096 })
  })

  it("o escopo conta: tem o seu tecto de bytes, mais apertado", async () => {
    const ana = guardar(await entrar(apertado))
    const escopo = `conta:${ana.endereco}`
    const [a, b] = [chaveQualquer(), chaveQualquer()]
    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: [{ chave: a, conteudo: cifra(2) }, { chave: b, conteudo: cifra(1) }] })
    const r = await ana.cliente.proximoDe("cofre.put.result")
    expect(r.aceites.map((x) => x.chave)).toEqual([a])
    expect(r.recusadas).toEqual([{ chave: b, razao: "tecto" }])
  })

  it("escritas e leituras por minuto, por conta, com quando há lugar", async () => {
    const ana = guardar(await entrar(apertado))
    const canal = moradaDeSala(apertado.casa)
    await sentar(ana.cliente, [], canal)
    const escopo = `canal:${canal}`
    const k = chaveQualquer()

    // More entries in one frame than the whole minute: waiting does not solve it.
    ana.cliente.enviar({
      t: "cofre.put",
      escopo,
      entradas: Array.from({ length: 9 }, () => ({ chave: k, conteudo: cifra() })),
    })
    const grande = await ana.cliente.proximoDe("cofre.rejected")
    expect(grande).toMatchObject({ code: "cofre-ritmo" })
    expect(grande.retryAfterMs).toBeUndefined()

    ana.cliente.enviar({ t: "cofre.put", escopo, entradas: Array.from({ length: 8 }, () => ({ chave: k, conteudo: cifra() })) })
    expect((await ana.cliente.proximoDe("cofre.put.result")).aceites).toHaveLength(8)
    ana.cliente.enviar({ t: "cofre.del", escopo, chave: k, ref: "a-mais" })
    const ritmo = await ana.cliente.proximoDe("cofre.rejected")
    expect(ritmo).toMatchObject({ code: "cofre-ritmo", ref: "a-mais" })
    expect(ritmo.retryAfterMs).toBeGreaterThan(0)
    expect(ritmo.retryAfterMs).toBeLessThanOrEqual(60_000)

    for (let i = 0; i < 3; i++) {
      ana.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 0 })
      await ana.cliente.proximoDe("cofre.entradas")
    }
    ana.cliente.enviar({ t: "cofre.get", escopo, desdeVersao: 0 })
    expect(await ana.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-ritmo" })

    // The limit is per account: another account writes to the same one.
    const bruno = guardar(await entrar(apertado))
    bruno.cliente.enviar({ t: "cofre.put", escopo: `conta:${bruno.endereco}`, entradas: [{ chave: chaveQualquer(), conteudo: cifra() }] })
    expect((await bruno.cliente.proximoDe("cofre.put.result")).aceites).toHaveLength(1)
  })

  it("quem insiste depois das recusas é fechado com cofre-abuso", async () => {
    const ana = guardar(await entrar(apertado))
    const alheio = `conta:${generateIdentity(apertado.casa).address}`
    for (let i = 0; i < tectos.recusasAteFechar; i++) {
      ana.cliente.enviar({ t: "cofre.get", escopo: alheio, desdeVersao: 0 })
      expect(await ana.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    }
    ana.cliente.enviar({ t: "cofre.get", escopo: alheio, desdeVersao: 0 })
    expect(await ana.cliente.proximoDe("cofre.rejected")).toMatchObject({ code: "cofre-sem-lugar" })
    expect(await ana.cliente.proximoDe("error")).toMatchObject({ code: "cofre-abuso", fatal: true })
  })
})

describe("o Store do cofre", () => {
  const LIMITES = { entradaMaxBytes: 64 * 1024, entradas: 4096, bytes: 16 * 1024 * 1024 }
  const ESCOPO = "canal:!x:localhost"
  const ANA = "@ana:localhost"

  function novoStore(): Store {
    return new Store(openDatabase(":memory:"))
  }

  function escrever(store: Store, quantas: number, baldes = 1): string[] {
    const chaves = Array.from({ length: quantas }, () => chaveQualquer())
    store.cofrePut(ESCOPO, chaves.map((chave) => ({ chave, conteudo: new Uint8Array(baldes * 1024) })), LIMITES)
    return chaves
  }

  it("pagina por bytes: cada página cabe no orçamento, e a seguinte pede-se desde `ate`", () => {
    const store = novoStore()
    const chaves = escrever(store, 5, 2)
    const p1 = store.cofreGet(ESCOPO, 0, 4096, 100)
    expect(p1).toMatchObject({ completo: true, mais: true, ate: 2 })
    expect(p1.entradas.map((e) => e.chave)).toEqual(chaves.slice(0, 2))
    const p2 = store.cofreGet(ESCOPO, p1.ate, 4096, 100)
    expect(p2).toMatchObject({ completo: false, mais: true, ate: 4 })
    const p3 = store.cofreGet(ESCOPO, p2.ate, 4096, 100)
    expect(p3).toMatchObject({ completo: false, mais: false, ate: 5 })
    expect(p3.entradas.map((e) => e.chave)).toEqual(chaves.slice(4))
    // An entry larger than the budget goes out on its own, so reading can continue.
    expect(store.cofreGet(ESCOPO, 0, 100, 100).entradas).toHaveLength(1)
    // E por linhas.
    expect(store.cofreGet(ESCOPO, 0, 1 << 20, 3)).toMatchObject({ mais: true, ate: 3 })
  })

  it("as lápides podam-se acima do tecto, e um delta de antes da poda recebe o cofre inteiro", () => {
    const store = novoStore()
    const [a, b, c, d] = escrever(store, 4)
    for (const chave of [a, b, c]) store.cofreDel(ESCOPO, chave as string, undefined, 2)
    // Three tombstones with limit of two: the one for `a` (version 5) left.
    expect(store.cofreContadores(ESCOPO)).toMatchObject({ versaoGlobal: 7, entradas: 1, lapides: 2, podadoAte: 5 })
    const antes = store.cofreGet(ESCOPO, 4, 1 << 20, 100)
    expect(antes.completo).toBe(true)
    expect(antes.entradas.map((e) => e.chave)).toEqual([d])
    const depois = store.cofreGet(ESCOPO, 5, 1 << 20, 100)
    expect(depois.completo).toBe(false)
    expect(depois.lapides.map((l) => l.chave)).toEqual([b, c])
  })

  it("um delta desde uma versão que o escopo nunca deu é o cofre inteiro (servidor limpo ou reposto)", () => {
    const store = novoStore()
    escrever(store, 2)
    expect(store.cofreGet(ESCOPO, 99, 1 << 20, 100)).toMatchObject({ completo: true, versaoGlobal: 2 })
    expect(store.cofreGet("canal:!nunca:localhost", 7, 1 << 20, 100)).toMatchObject({ completo: true, versaoGlobal: 0, entradas: [] })
  })

  it("varrerCofres: desligado com 0 dias; marca, espera e apaga só canais sem subscritores", () => {
    const store = novoStore()
    const comGente = "canal:!com:localhost"
    const semGente = "canal:!sem:localhost"
    const conta = "conta:@ana:localhost"
    for (const escopo of [comGente, semGente, conta]) {
      store.cofrePut(escopo, [{ chave: chaveQualquer(), conteudo: new Uint8Array(1024) }], LIMITES)
    }
    store.subscribe("!com:localhost", ANA)
    const dia = 24 * 60
    expect(store.varrerCofres(1000, 0)).toBe(0)
    expect(store.varrerCofres(1000, 90)).toBe(0)
    expect(store.varrerCofres(1000 + 89 * dia, 90)).toBe(0)
    expect(store.cofreContadores(semGente).entradas).toBe(1)
    expect(store.varrerCofres(1000 + 90 * dia, 90)).toBe(1)
    expect(store.cofreContadores(semGente)).toMatchObject({ versaoGlobal: 0, entradas: 0 })
    expect(store.cofreContadores(comGente).entradas).toBe(1)
    expect(store.cofreContadores(conta).entradas).toBe(1)

    // Someone who subscribes again forgets the mark: the count restarts.
    const volta = "canal:!volta:localhost"
    store.cofrePut(volta, [{ chave: chaveQualquer(), conteudo: new Uint8Array(1024) }], LIMITES)
    store.varrerCofres(0, 90)
    store.subscribe("!volta:localhost", ANA)
    store.varrerCofres(50 * dia, 90)
    store.unsubscribe("!volta:localhost", ANA)
    store.varrerCofres(60 * dia, 90)
    expect(store.varrerCofres(120 * dia, 90)).toBe(0)
    expect(store.varrerCofres(150 * dia, 90)).toBe(1)
  })
})

describe("TECTOS_DO_COFRE e ENCLAVE_COFRE_* no arranque", () => {
  const com = (env: Record<string, string>) => loadConfig(env as NodeJS.ProcessEnv)

  it("os por omissão são os do plano, e o varrimento vem desligado", () => {
    expect(TECTOS_DO_COFRE).toEqual({
      entradaMaxBytes: 65536,
      entradasPorEscopo: 4096,
      bytesPorEscopoDeCanal: 16 * 1024 * 1024,
      bytesPorEscopoDeConta: 2 * 1024 * 1024,
      escritasPorMinuto: 120,
      leiturasPorMinuto: 60,
      recusasAteFechar: 30,
    })
    const config = com({})
    expect(config.cofre).toEqual(TECTOS_DO_COFRE)
    expect(config.cofreGcDias).toBe(0)
    expect(com({ ENCLAVE_COFRE_GC_DIAS: " 90 " }).cofreGcDias).toBe(90)
    expect(com({ ENCLAVE_COFRE_ESCRITAS_POR_MINUTO: "30" }).cofre?.escritasPorMinuto).toBe(30)
  })

  it("lixo é erro no arranque, alto", () => {
    expect(() => com({ ENCLAVE_COFRE_GC_DIAS: "noventa" })).toThrow(/ENCLAVE_COFRE_GC_DIAS/)
    expect(() => com({ ENCLAVE_COFRE_GC_DIAS: "1.5" })).toThrow(/ENCLAVE_COFRE_GC_DIAS/)
    expect(() => com({ ENCLAVE_COFRE_GC_DIAS: "-1" })).toThrow(/ENCLAVE_COFRE_GC_DIAS/)
    expect(() => com({ ENCLAVE_COFRE_ESCRITAS_POR_MINUTO: "0" })).toThrow(/ENCLAVE_COFRE_ESCRITAS_POR_MINUTO/)
    expect(() => com({ ENCLAVE_COFRE_BYTES_POR_CANAL: "16MB" })).toThrow(/ENCLAVE_COFRE_BYTES_POR_CANAL/)
    // Above the protocol limit, or outside the 1 KiB bucket.
    expect(() => com({ ENCLAVE_COFRE_ENTRADA_MAX_BYTES: String(128 * 1024) })).toThrow(/ENCLAVE_COFRE_ENTRADA_MAX_BYTES/)
    expect(() => com({ ENCLAVE_COFRE_ENTRADA_MAX_BYTES: "1500" })).toThrow(/multiple of 1024/)
  })
})
