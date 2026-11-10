import {
  fromBase64,
  moradaDeSala,
  parseServerName,
  PROTOCOL_VERSION,
  sign,
  toBase64,
  type ClientFrame,
  type Identity,
  type ServerFrame,
  type ServerName,
} from "@enclave/protocol"
import {
  resumoDoCanal,
  Session,
  tiposDiferentes,
  Vault,
  type ResumoNivel0,
  type TipoDoResumo,
  type VaultBackend,
} from "@enclave/client-core"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { buildServer, type Enclave } from "../src/app.js"
import type { ServerConfig } from "../src/config.js"

/**
 * A raw socket client and a real server, for the gateway tests.
 *
 * Outside `src/` on purpose: does not enter `tsc -b` or the image `dist/`.
 */

/** The guarantee that a client from 13/9/2026 onward states in `hello`. */
export const COMMIT_DEPOIS_DO_ECO = "commit-after-echo"

export class Cliente {
  #socket: WebSocket
  #fila: ServerFrame[] = []
  #esperas: ((frame: ServerFrame) => void)[] = []

  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.on("message", (raw: Buffer) => {
      const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
      const espera = this.#esperas.shift()
      if (espera) espera(frame)
      else this.#fila.push(frame)
    })
  }

  /**
   * Connect, send `hello`, and authenticate.
   *
   * `capacidades: null` is the `hello` from clients before 13/9/2026, which do
   * not bring the field, exactly what the bundle `eabfd6c` sends.
   */
  static async ligar(
    url: string,
    identidade: Identity,
    { capacidades = [COMMIT_DEPOIS_DO_ECO] }: { capacidades?: string[] | null } = {},
  ): Promise<Cliente> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve())
      socket.once("error", reject)
    })
    const cliente = new Cliente(socket)
    cliente.enviar(
      capacidades === null
        ? { t: "hello", version: PROTOCOL_VERSION }
        : { t: "hello", version: PROTOCOL_VERSION, capabilities: capacidades },
    )
    await cliente.proximoDe("hello.ok")
    cliente.enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
    const desafio = await cliente.proximoDe("auth.challenge")
    cliente.enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
    await cliente.proximoDe("auth.ok")
    await cliente.ateAoPong()
    return cliente
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

  /**
   * Everything that arrived up to the `pong` of a `ping` just sent.
   *
   * The way to prove that something did NOT arrive without waiting for a timeout:
   * the server processes in order, and receiving the pong proves it already
   * passed through. See `common-room.test.ts`.
   */
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

  /**
   * Stop reading from the socket, like a phone with the network stuck: the
   * server keeps writing, and what it writes builds up in its queue
   * (`bufferedAmount`).
   */
  pausarLeitura(): void {
    this.#socket.pause()
  }

  /** Resume reading. A paused socket also does not read the close: the `close` arrives when resuming. */
  retomarLeitura(): void {
    this.#socket.resume()
  }

  /** Resolves when the socket closes, from either end. Immediate if it already closed. */
  fechado(): Promise<void> {
    if (this.#socket.readyState === WebSocket.CLOSED) return Promise.resolve()
    return new Promise((resolve) => this.#socket.once("close", () => resolve()))
  }
}

export interface ServidorDeTeste {
  enclave: Enclave
  url: string
  casa: ServerName
  /** The common room of this server. */
  sala: string
  /** The server's SQLite file, for a test to delete events (server that loses events). */
  baseDeDados: string
  fechar: () => Promise<void>
}

/**
 * A server on an ephemeral port, with the shared room `!orwell:<casa>`.
 *
 * `extra` adds to the standard config whatever a test needs to connect (the
 * minimum client version, the port for opaque addresses). Without it, the server
 * is the same as before, byte for byte.
 */
export async function levantarServidor(extra: Partial<ServerConfig> = {}): Promise<ServidorDeTeste> {
  const dir = mkdtempSync(join(tmpdir(), "enclave-rede-"))
  const config: ServerConfig = {
    serverName: parseServerName("localhost"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    dataDir: dir,
    databasePath: join(dir, "test.sqlite"),
    sfuPort: 0,
    sfuAnnouncedIp: "",
    retentionDays: 30,
    allowlist: [],
    turnUrls: [],
    turnSecret: "",
    turnTtl: 600,
    communityMode: false,
    commonRoom: "",
    ...extra,
  }
  const enclave = await buildServer(config)
  await enclave.app.listen({ host: config.bindHost, port: 0 })
  const porta = (enclave.app.server.address() as { port: number }).port
  const casa = parseServerName(`localhost:${porta}`)
  const sala = `!orwell:${casa}`
  config.serverName = casa
  config.commonRoom = sala
  return {
    enclave,
    url: `ws://127.0.0.1:${porta}/_enclave/gateway`,
    casa,
    sala,
    baseDeDados: config.databasePath,
    fechar: async () => {
      await enclave.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

// ---------------------------------------------------------------------------
// N Sessions (phase S0 of absolute sync, 20/10/2026).
//
// Above: a raw socket, for the gateway tests. Below: real accounts, each with
// `Session` and its own vault, all against the same `ServidorDeTeste`.
// I only add: what is above did not change shape.
// ---------------------------------------------------------------------------

/** An in-memory vault backend that counts writes. */
export class CofreEmMemoria implements VaultBackend {
  bytes: Uint8Array | null = null
  escritas = 0
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
    this.escritas++
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

export interface ContaDeTeste {
  nome: string
  session: Session
  vault: Vault
  backend: CofreEmMemoria
  address: string
  /** The `status` codes that the session emitted, in order. */
  avisos: string[]
}

/**
 * N accounts connected to the same server, one per name, with published profile.
 *
 * The server from `levantarServidor` has the name with the port: each `Session`
 * gets the gateway address from it. The caller disconnects them with
 * `desligarContas` at the end.
 */
export async function contasDeTeste(servidor: ServidorDeTeste, nomes: readonly string[]): Promise<ContaDeTeste[]> {
  const contas: ContaDeTeste[] = []
  for (const nome of nomes) {
    const backend = new CofreEmMemoria()
    const vault = new Vault(backend)
    await vault.create("frase-passe-de-teste")
    const session = new Session(vault)
    const identidade = await session.createIdentity(servidor.casa)
    const avisos: string[] = []
    session.on("status", (evento) => {
      if (evento.code) avisos.push(evento.code)
    })
    await session.connect()
    await session.updateProfile({ displayName: nome, donations: [] })
    contas.push({ nome, session, vault, backend, address: identidade.address, avisos })
  }
  return contas
}

export function desligarContas(contas: readonly ContaDeTeste[]): void {
  for (const conta of contas) conta.session.disconnect()
}

/** Waits for the predicate, or throws with the label. Returns the ms it waited. */
export async function ate(predicado: () => boolean, rotulo: string, prazoMs = 15_000, passoMs = 50): Promise<number> {
  const inicio = Date.now()
  while (Date.now() - inicio < prazoMs) {
    if (predicado()) return Date.now() - inicio
    await new Promise((resolve) => setTimeout(resolve, passoMs))
  }
  throw new Error(`esgotou-se o prazo à espera de: ${rotulo}`)
}

/** A new channel founded by `owner`, with the others joining one by one. */
export async function canalComTodos(
  servidor: ServidorDeTeste,
  dono: ContaDeTeste,
  outros: readonly ContaDeTeste[],
): Promise<string> {
  // An opaque room, as 1.0 creates it (slice 3).
  const canal = moradaDeSala(servidor.casa)
  await dono.session.createSpaceChannel(canal)
  await ate(() => dono.session.founderOf(canal) === dono.address, `${dono.nome} funda o canal`)
  for (const outro of outros) {
    await dono.session.seat(canal, outro.address)
    await ate(() => outro.session.channels.includes(canal), `${outro.nome} entra no canal`)
  }
  return canal
}

/** The level-0 summary of an account, with its members and address. */
export function resumoDe(conta: ContaDeTeste, canal: string, desde?: number): ResumoNivel0 {
  return resumoDoCanal(conta.vault.contents, canal, {
    membros: conta.session.membersOf(canal).map(String),
    proprio: conta.address,
    ...(desde !== undefined ? { desde } : {}),
  })
}

/** The types in which accounts diverge from the first. Empty: summaries are the same. */
export function divergencias(contas: readonly ContaDeTeste[], canal: string, desde?: number): TipoDoResumo[] {
  const [primeira, ...resto] = contas
  if (!primeira) return []
  const base = resumoDe(primeira, canal, desde)
  const tipos = new Set<TipoDoResumo>()
  for (const conta of resto) for (const tipo of tiposDiferentes(base, resumoDe(conta, canal, desde))) tipos.add(tipo)
  return [...tipos]
}

// ---------------------------------------------------------------------------
// A second device of the same account, via real pairing (1.0 "Arca",
// slice 3). The phone does not hold the account's private key: this is the case
// where opaque addresses arrive from the vault and are never computed.
// ---------------------------------------------------------------------------

function esperarFaseDoPar(session: Session, fase: string, prazoMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => {
      desligar()
      reject(new Error(`o emparelhamento nunca chegou a ${fase}`))
    }, prazoMs)
    const desligar = session.on("pair", (evento) => {
      if (evento.fase === fase) {
        clearTimeout(prazo)
        desligar()
        resolve()
      } else if (evento.fase === "falhou") {
        clearTimeout(prazo)
        desligar()
        reject(new Error(`o emparelhamento falhou: ${evento.razao}`))
      }
    })
  })
}

/** Pairs a new device with `account`, and returns it connected. The caller disconnects it. */
export async function emparelharAparelho(conta: ContaDeTeste, nome = `${conta.nome} (telemóvel)`): Promise<ContaDeTeste> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  await vault.create("frase-do-telemovel")
  const session = new Session(vault)
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  const sasComputador = esperarFaseDoPar(conta.session, "sas")
  const { link } = await conta.session.emparelharComoAnfitriao()
  const sasTelemovel = esperarFaseDoPar(session, "sas")
  session.emparelharComoConvidado(link)
  await Promise.all([sasComputador, sasTelemovel])
  const certificado = esperarFaseDoPar(session, "certificado")
  const concluido = esperarFaseDoPar(conta.session, "concluido", 30_000)
  await session.confirmarSas()
  await conta.session.confirmarSas()
  await certificado
  const identidade = session.loadIdentity()
  await session.connect()
  session.concluirEmparelhamento()
  await concluido
  return { nome, session, vault, backend, address: identidade.address, avisos }
}
