import { declaredEpoch, deviceKeyAtLeaf, importSession, leavesOf } from "@enclave/crypto"
import {
  devicePublicKeyOf,
  fromBase64,
  generateDeviceKey,
  signDeviceCert,
  signDeviceManifest,
  toBase64,
  type DeviceManifestWire,
} from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { PairEvento } from "./emparelhar.js"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"
import type { CofreComRevogados } from "./revogacao.js"
import { moradaDeTeste } from "../testes/moradas.js"

/**
 * The account state across devices (phase 5): the pairing snapshot (F13, level M), the account
 * channel (F13, level L), a 0.5.7 leaf of the same account left out, and the reassignment that
 * drops only the dead leaf (F16).
 *
 * The relay is the one from `session.dois-aparelhos.test.ts` (pools per device, manifests,
 * claim in bundle, pairing boxes), with what this phase needs more: the `channel.rejoin.request`
 * broadcast to who is in the channel, like the gateway does (`broadcast`, the requester included).
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Frame {
  t: string
  [key: string]: unknown
}

interface Evento {
  seq: number
  kind: string
  ciphertext: string
  recipient?: string | undefined
  ref?: string | undefined
}

const TRAMAS_MAXIMAS = 20_000
const SEM_APARELHO = "-"

class Rele {
  readonly eventos = new Map<string, Evento[]>()
  readonly pools = new Map<string, string[]>()
  readonly manifestos = new Map<string, DeviceManifestWire>()
  readonly ligacoes = new Set<FakeSocket>()
  readonly caixas = new Map<string, { anfitriao: FakeSocket; convidado: FakeSocket | null }>()
  /** The seat requests that arrived, by channel. */
  readonly pedidosDeLugar: { channel: string; address: string }[] = []
  entregues = 0

  constructor(readonly capabilities: string[] = ["devices", "keypackage-bundle", "pairing"]) {}

  pool(address: string, device: string | null): string[] {
    const chave = `${address}|${device ?? SEM_APARELHO}`
    let pool = this.pools.get(chave)
    if (!pool) {
      pool = []
      this.pools.set(chave, pool)
    }
    return pool
  }

  frame(socket: FakeSocket, frame: Frame): void {
    switch (frame.t) {
      case "hello":
        socket.entregar({ t: "hello.ok", version: 1, capabilities: this.capabilities })
        return
      case "auth.begin":
        socket.address = frame.address as string
        socket.deviceKey = frame.accountKey !== undefined ? (frame.signingKey as string) : null
        socket.entregar({ t: "auth.challenge", nonce: "AAAA" })
        return
      case "auth.finish":
        socket.entregar({ t: "auth.ok", address: socket.address })
        return
      case "channel.subscribe":
        for (const canal of frame.channels as string[]) socket.canais.add(canal)
        return
      case "channel.unsubscribe":
        for (const canal of frame.channels as string[]) socket.canais.delete(canal)
        return
      case "keypackage.publish": {
        const address = socket.address ?? ""
        const device = (frame.device as string | undefined) ?? socket.deviceKey
        if (frame.replace) {
          this.pool(address, device).length = 0
          this.pool(address, null).length = 0
        }
        this.pool(address, device).push(...(frame.packages as string[]))
        return
      }
      case "keypackage.claim":
        socket.entregar(this.#reclamar(frame.address as string, frame.bundle === true, frame.devices as string[] | undefined))
        return
      case "manifest.get": {
        const address = frame.address as string
        socket.entregar({ t: "manifest.result", address, manifest: this.manifestos.get(address) ?? null })
        return
      }
      case "manifest.publish": {
        const manifesto = frame.manifest as DeviceManifestWire
        const atual = this.manifestos.get(manifesto.address)
        if (atual !== undefined && manifesto.version <= atual.version) {
          socket.entregar({ t: "manifest.published", address: manifesto.address, version: manifesto.version, ok: false, reason: "stale-version" })
          return
        }
        this.manifestos.set(manifesto.address, manifesto)
        socket.entregar({ t: "manifest.published", address: manifesto.address, version: manifesto.version, ok: true })
        return
      }
      case "channel.send": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const evento: Evento = {
          seq: log.length,
          kind: frame.kind as string,
          ciphertext: frame.ciphertext as string,
          recipient: frame.recipient as string | undefined,
          ref: frame.ref as string | undefined,
        }
        log.push(evento)
        this.eventos.set(canal, log)
        this.difundir(canal, evento)
        return
      }
      case "channel.backfill": {
        const canal = frame.channel as string
        const log = this.eventos.get(canal) ?? []
        const depois = (frame.afterSeq as number | undefined) ?? -1
        const visiveis = log.filter(
          (evento) => evento.seq > depois && (evento.recipient === undefined || evento.recipient === socket.address),
        )
        const pagina = visiveis.slice(0, (frame.limit as number | undefined) ?? 50)
        socket.entregar({
          t: "channel.backfill.page",
          channel: canal,
          events: pagina.map((evento) => ({ seq: evento.seq, kind: evento.kind, ciphertext: evento.ciphertext, receivedAtMinute: 0 })),
          more: pagina.length < visiveis.length,
        })
        return
      }
      case "welcome.resync": {
        for (const [canal, log] of this.eventos) {
          for (const evento of log) {
            if (evento.kind === "welcome" && evento.recipient === socket.address) socket.entregar(this.#comoEvento(canal, evento))
          }
        }
        return
      }
      case "channel.rejoin.request": {
        // Like the gateway: to all subscribed connections, the requester included.
        const canal = frame.channel as string
        this.pedidosDeLugar.push({ channel: canal, address: socket.address ?? "" })
        let ouviram = 0
        for (const ligacao of this.ligacoes) {
          if (!ligacao.address || !ligacao.canais.has(canal)) continue
          ouviram += 1
          ligacao.entregar({ t: "channel.rejoin", channel: canal, address: socket.address })
        }
        socket.entregar({ t: "channel.rejoin.sent", channel: canal, ouviram })
        return
      }
      case "pair.open": {
        const pairId = frame.pairId as string
        this.caixas.set(pairId, { anfitriao: socket, convidado: null })
        socket.entregar({ t: "pair.opened", pairId })
        return
      }
      case "pair.join": {
        const pairId = frame.pairId as string
        const caixa = this.caixas.get(pairId)
        if (!caixa || caixa.convidado !== null) {
          socket.entregar({ t: "pair.rejected", pairId, reason: caixa ? "full" : "unknown" })
          return
        }
        caixa.convidado = socket
        caixa.anfitriao.entregar({ t: "pair.joined", pairId })
        socket.entregar({ t: "pair.joined", pairId })
        return
      }
      case "pair.send": {
        const pairId = frame.pairId as string
        const caixa = this.caixas.get(pairId)
        if (!caixa) return
        const outro = caixa.anfitriao === socket ? caixa.convidado : caixa.anfitriao
        outro?.entregar({ t: "pair.message", pairId, payload: frame.payload })
        return
      }
      case "pair.close": {
        const pairId = frame.pairId as string
        const caixa = this.caixas.get(pairId)
        if (!caixa) return
        this.caixas.delete(pairId)
        const outro = caixa.anfitriao === socket ? caixa.convidado : caixa.anfitriao
        outro?.entregar({ t: "pair.closed", pairId, reason: "closed" })
        return
      }
      default:
        return
    }
  }

  #reclamar(address: string, bundle: boolean, devices: string[] | undefined): Frame {
    const singular = (): string | null => {
      for (const [chave, pool] of this.pools) {
        if (chave.startsWith(`${address}|`) && pool.length > 0) return pool.pop() as string
      }
      return null
    }
    if (!bundle) return { t: "keypackage.claimed", address, keyPackage: singular() }
    const manifest = this.manifestos.get(address) ?? null
    if (manifest === null) return { t: "keypackage.claimed", address, keyPackage: singular(), keyPackages: [], manifest: null }
    const pedidos = devices === undefined ? null : new Set(devices)
    const keyPackages: { deviceKey: string; keyPackage: string }[] = []
    for (const { deviceKey } of manifest.devices) {
      if (pedidos !== null && !pedidos.has(deviceKey)) continue
      const pacote = this.pool(address, deviceKey).pop()
      if (pacote !== undefined) keyPackages.push({ deviceKey, keyPackage: pacote })
    }
    const fallback = keyPackages.length === 0 ? (this.pool(address, null).pop() ?? null) : null
    return { t: "keypackage.claimed", address, keyPackage: keyPackages[0]?.keyPackage ?? fallback, keyPackages, manifest }
  }

  difundir(canal: string, evento: Evento): void {
    for (const ligacao of this.ligacoes) {
      if (!ligacao.address) continue
      if (evento.recipient) {
        if (ligacao.address !== evento.recipient) continue
      } else if (!ligacao.canais.has(canal)) continue
      ligacao.entregar(this.#comoEvento(canal, evento))
    }
  }

  #comoEvento(canal: string, evento: Evento): Frame {
    return {
      t: "channel.event",
      channel: canal,
      seq: evento.seq,
      kind: evento.kind,
      ciphertext: evento.ciphertext,
      receivedAtMinute: 0,
      ...(evento.ref !== undefined ? { ref: evento.ref } : {}),
    }
  }
}

let rele = new Rele()

class FakeSocket {
  address: string | null = null
  deviceKey: string | null = null
  readonly canais = new Set<string>()
  readyState = 0
  readonly #rele = rele
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    this.#rele.ligacoes.add(this)
    setTimeout(() => {
      this.readyState = 1
      this.#fire("open", {})
    }, 0)
  }

  addEventListener(kind: string, handler: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown): void => {
          this.removeEventListener(kind, wrapped)
          handler(event)
        }
      : handler
    this.#listeners.set(kind, [...(this.#listeners.get(kind) ?? []), wrapped])
  }

  removeEventListener(kind: string, handler: (event: unknown) => void): void {
    this.#listeners.set(kind, (this.#listeners.get(kind) ?? []).filter((item) => item !== handler))
  }

  send(raw: string): void {
    this.#rele.frame(this, JSON.parse(raw) as Frame)
  }

  entregar(frame: unknown): void {
    if (this.#rele.entregues++ > TRAMAS_MAXIMAS) return
    setTimeout(() => this.#fire("message", { data: JSON.stringify(frame) }), 0)
  }

  close(): void {
    this.readyState = 3
    this.#rele.ligacoes.delete(this)
    this.#fire("close", {})
  }

  #fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

async function settle(times = 200): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Until the condition holds, or fail with the description. */
async function ate(condicao: () => boolean | Promise<boolean>, descricao: string, prazoMs = 20_000): Promise<void> {
  const fim = Date.now() + prazoMs
  while (Date.now() < fim) {
    if (await condicao()) return
    await esperar(50)
  }
  throw new Error(`nunca aconteceu: ${descricao}`)
}

interface Conta {
  session: Session
  address: string
  vault: Vault
  deviceKey: string
  avisos: string[]
}

let abertas: Session[] = []

function vigiar(session: Session): string[] {
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  return avisos
}

async function conta(nome = "alguém"): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await vault.update((contents) => {
    contents.profile = { displayName: nome, donations: [], updatedAt: Date.now() }
  })
  abertas.push(session)
  const avisos = vigiar(session)
  await session.connect()
  await settle(40)
  return { session, address: session.identity.address, vault, deviceKey: toBase64(session.identity.deviceSigningPublicKey), avisos }
}

function esperarFase<F extends PairEvento["fase"]>(session: Session, fase: F, prazoMs = 20_000): Promise<Extract<PairEvento, { fase: F }>> {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => {
      desligar()
      reject(new Error(`nunca chegou a fase ${fase}`))
    }, prazoMs)
    const desligar = session.on("pair", (evento) => {
      if (evento.fase === fase) {
        clearTimeout(prazo)
        desligar()
        resolve(evento as Extract<PairEvento, { fase: F }>)
      } else if (evento.fase === "falhou") {
        clearTimeout(prazo)
        desligar()
        reject(new Error(`falhou: ${evento.razao}`))
      }
    })
  })
}

/** Pair a new phone to the `pc`, through the whole path. Also return the phases the phone saw. */
async function emparelhar(pc: Conta): Promise<Conta & { fases: string[] }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const telemovel = new Session(vault)
  abertas.push(telemovel)
  const avisos = vigiar(telemovel)
  const fases: string[] = []
  telemovel.on("pair", (evento) => {
    fases.push(evento.fase)
    if (evento.fase === "certificado" && evento.estado) fases.push(`certificado:${evento.estado}`)
  })

  const sasPc = esperarFase(pc.session, "sas")
  const { link } = await pc.session.emparelharComoAnfitriao()
  const sasTelemovel = esperarFase(telemovel, "sas")
  telemovel.emparelharComoConvidado(link)
  await Promise.all([sasPc, sasTelemovel])
  const certificado = esperarFase(telemovel, "certificado")
  const concluidoPc = esperarFase(pc.session, "concluido", 30_000)
  await telemovel.confirmarSas()
  await pc.session.confirmarSas()
  await certificado
  const identidade = telemovel.loadIdentity()
  await telemovel.connect()
  await settle(40)
  telemovel.concluirEmparelhamento()
  await concluidoPc
  return { session: telemovel, address: identidade.address, vault, deviceKey: toBase64(identidade.deviceSigningPublicKey), avisos, fases }
}

/**
 * A device of the `pc` account that behaves like a 0.5.7 client in what matters here: it never
 * says it knows it is in the account channel.
 *
 * The vault is what pairing writes (public account key, certificate, device key), and the
 * manifest with it is published here with the `pc` account key, as a 0.5.7 pairing would do.
 * What a 0.5.7 does not have is the `capacidades` field: this device's `send` drops it, like
 * the old schema, and its `pronto` never existed.
 */
async function aparelhoAntigo(pc: Conta): Promise<Conta> {
  const identidade = pc.session.identity
  if (!("signingPrivateKey" in identidade) || !identidade.signingPrivateKey) throw new Error("o pc não tem a chave de conta")
  const chaveDeConta = identidade.signingPrivateKey
  const chave = generateDeviceKey()
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  await vault.update((contents) => {
    contents.accountPublicKey = toBase64(identidade.signingPublicKey)
    contents.deviceCert = toBase64(signDeviceCert(chaveDeConta, chave.publicKey, identidade.address))
    contents.deviceSigningPrivateKey = toBase64(chave.privateKey)
    contents.homeserver = pc.vault.contents.homeserver
    contents.identityCreatedAtMinute = Math.floor(Date.now() / 60_000)
  })
  const atual = rele.manifestos.get(identidade.address)
  const devices = [
    ...(atual?.devices ?? []).map((device) => ({ deviceKey: fromBase64(device.deviceKey), addedAt: device.addedAt })),
    { deviceKey: chave.publicKey, addedAt: Math.floor(Date.now() / 1000) },
  ]
  rele.manifestos.set(
    identidade.address,
    signDeviceManifest(identidade.signingPrivateKey, {
      address: identidade.address,
      version: (atual?.version ?? 0) + 1,
      devices,
      signedAt: Math.floor(Date.now() / 1000),
    }),
  )
  const session = new Session(vault)
  abertas.push(session)
  const original = session.send.bind(session)
  session.send = (channel, payload) => {
    if (payload.t === "typing") {
      const { capacidades: _fora, ...antigo } = payload
      return original(channel, antigo)
    }
    return original(channel, payload)
  }
  const avisos = vigiar(session)
  session.loadIdentity()
  await session.connect()
  await settle(40)
  expect(toBase64(devicePublicKeyOf(chave.privateKey))).toBe(toBase64(session.identity.deviceSigningPublicKey))
  return { session, address: session.identity.address, vault, deviceKey: toBase64(chave.publicKey), avisos }
}

/**
 * Another device of the `pc` account WITH the account key: another vault, the same account
 * private key, and no device key (`loadIdentity` mints one). Its `#garantirManifesto` adds it
 * to the manifest. This is case I4.
 */
async function outroComChave(pc: Conta): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  await vault.update((contents) => {
    contents.signingPrivateKey = pc.vault.contents.signingPrivateKey
    contents.homeserver = pc.vault.contents.homeserver
    const minuto = pc.vault.contents.identityCreatedAtMinute
    if (minuto !== undefined) contents.identityCreatedAtMinute = minuto
    contents.profile = { ...pc.vault.contents.profile }
  })
  const session = new Session(vault)
  abertas.push(session)
  const avisos = vigiar(session)
  session.loadIdentity()
  await session.connect()
  await settle(40)
  expect(session.identity.address).toBe(pc.address)
  expect(session.temChaveDeConta).toBe(true)
  return { session, address: session.identity.address, vault, deviceKey: toBase64(session.identity.deviceSigningPublicKey), avisos }
}

/** The device keys of `address` leaves in a channel, as seen from the vault of the `caller`. */
async function folhasDe(quem: Conta, canal: string, address: string): Promise<string[]> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[canal]
  if (!blob) return []
  const gravada = await importSession(canal, fromBase64(blob))
  const arvore = gravada.state.ratchetTree
  return leavesOf(arvore, address as never).map((folha) => toBase64(deviceKeyAtLeaf(arvore, folha) as Uint8Array))
}

/** The indices of `address` leaves, by device key. */
async function indicesDe(quem: Conta, canal: string, address: string): Promise<Map<string, number>> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[canal]
  if (!blob) return new Map()
  const arvore = (await importSession(canal, fromBase64(blob))).state.ratchetTree
  return new Map(leavesOf(arvore, address as never).map((folha) => [toBase64(deviceKeyAtLeaf(arvore, folha) as Uint8Array), folha]))
}

function canalDaConta(quem: Conta): string {
  return quem.session.canalDaConta
}

const lidasMs = Session.LIDAS_MS
const provaMs = Session.PROVA_DE_VIDA_MS

beforeEach(() => {
  rele = new Rele()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
  Session.LIDAS_MS = 30
  Session.PROVA_DE_VIDA_MS = 400
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
  Session.LIDAS_MS = lidasMs
  Session.PROVA_DE_VIDA_MS = provaMs
})

describe("o instantâneo do emparelhamento (F13, nível M)", () => {
  it("o telemóvel nasce com as lidas, as preferências, o arquivo, o bloqueio, a lista mostrada e os laços do PC", async () => {
    const ana = await conta("Ana")
    const bruno = await conta("Bruno")
    const carlos = await conta("Carlos")
    await ana.session.marcarLido(moradaDeTeste("sala"), 1_000)
    await ana.session.definirPreferencia("tema", "escuro")
    await ana.session.arquivar(moradaDeTeste("velha"))
    await ana.session.block(bruno.address)
    // A friendship book made with Carlos, and the list shown, as the vault has them after living
    // them: the bonds fold from these events.
    const directa = moradaDeTeste("directa ana carlos")
    await ana.vault.update((contents) => {
      contents.history[directa] = [
        { seq: 3, sender: carlos.address, at: 10, payload: { t: "friend.request", sentAt: 10, note: "olá" } },
        { seq: 4, sender: ana.address, at: 11, payload: { t: "friend.accept", acceptedAt: 11 } },
      ]
      contents.shownFriends = { [ana.address]: { shown: [carlos.address], updatedAt: 5 } }
    })
    const lacosNoPc = [...ana.session.friendTies().values()]
    expect(lacosNoPc.map((laco) => [laco.peer, laco.link, laco.channel])).toEqual([[carlos.address, "amigos", directa]])

    const telemovel = await emparelhar(ana)

    // The step "receiving your state" happens before the certificate.
    expect(telemovel.fases.indexOf("estado")).toBeGreaterThan(-1)
    expect(telemovel.fases.indexOf("estado")).toBeLessThan(telemovel.fases.indexOf("certificado"))
    // And the certificate tells the UI the state arrived in full.
    expect(telemovel.fases).toContain("certificado:inteiro")
    expect(telemovel.session.lidas()).toEqual({ [moradaDeTeste("sala")]: 1_000 })
    expect(telemovel.session.preferencias()).toEqual({ tema: "escuro" })
    expect(Object.keys(telemovel.session.arquivo())).toEqual([moradaDeTeste("velha")])
    expect(telemovel.session.isBlocked(bruno.address)).toBe(true)
    expect(telemovel.vault.contents.shownFriends?.[ana.address]).toEqual({ shown: [carlos.address], updatedAt: 5 })
    // The bonds, with each one's channel, same as the PC: folded from the same book.
    expect([...telemovel.session.friendTies().values()]).toEqual(lacosNoPc)
    // And the inherited book is not a conversation: the phone's history does not have it.
    expect(telemovel.vault.contents.history[directa]).toBeUndefined()
  }, 60_000)

  it("sem estado no PC, o telemóvel entra sem esperar e sem nada inventado", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    expect(telemovel.session.lidas()).toEqual({})
    expect(telemovel.session.preferencias()).toEqual({})
    expect(telemovel.session.arquivo()).toEqual({})
    expect(telemovel.session.blocked()).toEqual([])
  }, 60_000)
})

describe("o canal da conta (F13, nível L)", () => {
  it("o PC cria-o com o telemóvel que se anunciou, e os deltas passam nos dois sentidos", async () => {
    const ana = await conta("Ana")
    const bruno = await conta("Bruno")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)

    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    expect((await folhasDe(ana, proprio, ana.address)).sort()).toEqual([ana.deviceKey, telemovel.deviceKey].sort())
    // Out of the channel list, on both.
    expect(ana.session.channels).not.toContain(proprio)
    expect(telemovel.session.channels).not.toContain(proprio)

    // Read marks: from PC to phone, with event.
    const lidasNoTelemovel: Record<string, number>[] = []
    telemovel.session.on("lidas", ({ lidas }) => lidasNoTelemovel.push({ ...lidas }))
    await ana.session.marcarLido(moradaDeTeste("sala"), 2_000)
    await ate(() => telemovel.session.lidas()[moradaDeTeste("sala")] === 2_000, "a marca de lido chegar ao telemóvel")
    expect(lidasNoTelemovel.at(-1)).toEqual({ [moradaDeTeste("sala")]: 2_000 })
    // An older marker does not lower what is there.
    await telemovel.session.marcarLido(moradaDeTeste("sala"), 1_500)
    expect(telemovel.session.lidas()[moradaDeTeste("sala")]).toBe(2_000)

    // Preferences: from phone to PC.
    await telemovel.session.definirPreferencia("tema", "claro")
    await ate(() => ana.session.preferencias()["tema"] === "claro", "a preferência chegar ao PC")

    // Archive: archive on PC, unarchive on phone, and the last gesture wins on both.
    await ana.session.arquivar(moradaDeTeste("conversa"))
    await ate(() => telemovel.session.arquivo()[moradaDeTeste("conversa")] !== undefined, "o arquivo chegar ao telemóvel")
    await telemovel.session.desarquivar(moradaDeTeste("conversa"))
    await ate(() => ana.session.arquivo()[moradaDeTeste("conversa")] === undefined, "o desarquivar chegar ao PC")

    // Block: on PC, and the filter takes effect on phone; unblock on phone goes back to PC.
    const bloqueios: { address: string; bloqueado: boolean }[] = []
    telemovel.session.on("bloqueio", (evento) => bloqueios.push(evento))
    await ana.session.block(bruno.address)
    await ate(() => telemovel.session.isBlocked(bruno.address), "o bloqueio chegar ao telemóvel")
    expect(bloqueios).toContainEqual({ address: bruno.address, bloqueado: true })
    await telemovel.session.unblock(bruno.address)
    await ate(() => !ana.session.isBlocked(bruno.address), "o desbloqueio chegar ao PC")

    // None of this made it into anyone's conversation.
    expect(ana.vault.contents.history[proprio]).toBeUndefined()
    expect(telemovel.vault.contents.history[proprio]).toBeUndefined()
  }, 90_000)

  it("uma folha 0.5.7 da mesma conta não é convidada e não fica surda", async () => {
    const ana = await conta("Ana")
    const carlos = await conta("Carlos")
    const antigo = await aparelhoAntigo(ana)
    // A channel with Carlos where both leaves of Ana are: this is where a new payload could reach the old one.
    const CANAL = moradaDeTeste("lagar")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    await carlos.session.seat(CANAL, ana.address)
    await ate(() => antigo.session.channels.includes(CANAL) && ana.session.channels.includes(CANAL), "a Ana entrar no lagar nos dois aparelhos")

    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    // The old one connected, announced itself without capacidades (the old schema drops the field),
    // and the PC went through the account channel again.
    antigo.session.disconnect()
    await antigo.session.connect()
    await settle(200)
    await ana.session.sincronizarAgora()
    await settle(200)

    // Leaves in the account channel: PC and phone, and not the old one.
    expect((await folhasDe(ana, proprio, ana.address)).sort()).toEqual([ana.deviceKey, telemovel.deviceKey].sort())
    expect(antigo.vault.contents.groups[proprio]).toBeUndefined()
    expect(antigo.session.channels).not.toContain(proprio)

    // PC and phone swap state freely...
    for (let vez = 0; vez < 8; vez++) {
      await ana.session.definirPreferencia("contador", String(vez))
      await ana.session.marcarLido(CANAL, 10_000 + vez)
      await settle(20)
    }
    await ate(() => telemovel.session.preferencias()["contador"] === "7", "as preferências chegarem ao telemóvel")
    // ...and in the common room where the old one is, no frame was left unopened for it.
    await settle(200)
    expect(antigo.session.deafChannels(1)).toEqual([])
    expect(antigo.avisos).not.toContain("channel-deaf")
    // The Welcome from the account channel went to the address and reached it: it does not open it,
    // and the seat request that follows has no one to answer with a seat.
    expect(antigo.vault.contents.deadWelcomes.some((marca) => marca.includes(proprio))).toBe(true)
    expect((await folhasDe(ana, proprio, ana.address)).length).toBe(2)
  }, 120_000)
})

describe('as lidas e o "por enviar" (M2)', () => {
  it('a marca vai ao cofre já com o "por enviar", e ele sai quando o delta passa', async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    await ate(() => ana.vault.contents.estadoPorEnviar !== true, "nada por enviar no PC")

    Session.LIDAS_MS = 1_500
    await ana.session.marcarLido(moradaDeTeste("sala"), 5_000)
    // Before the delta goes out: if the app closes here, the vault already knows state went out
    // unsent, and the next connection sends it all.
    expect(ana.vault.contents.lidas?.[moradaDeTeste("sala")]).toBe(5_000)
    expect(ana.vault.contents.estadoPorEnviar).toBe(true)

    await ate(() => telemovel.session.lidas()[moradaDeTeste("sala")] === 5_000, "a marca chegar ao telemóvel")
    await ate(() => ana.vault.contents.estadoPorEnviar !== true, 'o "por enviar" sair depois de o delta passar')
  }, 60_000)

  it("fechar antes de o delta sair: a ligação seguinte manda a marca", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")

    Session.LIDAS_MS = 60_000
    await ana.session.marcarLido(moradaDeTeste("sala"), 7_000)
    await ana.session.flush()
    // The app closes before the delta goes out, and opens again on the same vault.
    ana.session.disconnect()
    Session.LIDAS_MS = 30
    const pc = new Session(ana.vault)
    abertas.push(pc)
    pc.loadIdentity()
    await pc.connect()
    await ate(() => telemovel.session.lidas()[moradaDeTeste("sala")] === 7_000, "a marca chegar ao telemóvel na ligação seguinte")
  }, 60_000)
})

describe('as lidas e o "por enviar": uma marca nova com o delta em voo (M2)', () => {
  it('o "por enviar" fica até a marca nova sair, e não se apaga com o delta anterior', async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    await ate(() => ana.vault.contents.estadoPorEnviar !== true, "nada por enviar no PC")

    // The first delta stays in flight until we release it.
    let soltar: () => void = () => {}
    let emVoo = false
    const original = ana.session.send.bind(ana.session)
    ana.session.send = async (channel, payload) => {
      if (payload.t === "estado.lidas" && !emVoo) {
        emVoo = true
        await new Promise<void>((resolve) => {
          soltar = resolve
        })
      }
      return original(channel, payload)
    }
    Session.LIDAS_MS = 30
    await ana.session.marcarLido(moradaDeTeste("a"), 1_000)
    await ate(() => emVoo, "o primeiro delta sair")
    // With it in flight, another marker: its timer is armed.
    Session.LIDAS_MS = 60_000
    await ana.session.marcarLido(moradaDeTeste("b"), 2_000)
    soltar()
    await ate(() => telemovel.session.lidas()[moradaDeTeste("a")] === 1_000, "o primeiro delta chegar ao telemóvel")
    await settle(50)
    // The marker for !b has not left yet: the "pending send" must still be there.
    expect(ana.vault.contents.estadoPorEnviar).toBe(true)
    // When the delta of the new marker passes, it removes the marker.
    Session.LIDAS_MS = 30
    await ana.session.marcarLido(moradaDeTeste("c"), 3_000)
    await ate(() => telemovel.session.lidas()[moradaDeTeste("b")] === 2_000, "a marca nova chegar ao telemóvel")
    await ate(() => ana.vault.contents.estadoPorEnviar !== true, 'o "por enviar" sair com o delta da marca nova')
  }, 60_000)
})

describe("o estado de um irmão passa pelas guardas", () => {
  it("uma marca de lido no futuro chega cortada a um dia", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    const longe = Date.now() + 365 * 24 * 60 * 60_000
    await telemovel.session.send(proprio, { t: "estado.lidas", lidas: { [moradaDeTeste("sala")]: longe } })
    await ate(() => ana.session.lidas()[moradaDeTeste("sala")] !== undefined, "a marca chegar ao PC")
    expect(ana.session.lidas()[moradaDeTeste("sala")]).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60_000)
  }, 60_000)

  it("uma folha que o cofre sabe revogada não muda o estado", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    // Before: the mobile device sends, and the PC listens.
    await telemovel.session.definirPreferencia("tema", "claro")
    await ate(() => ana.session.preferencias()["tema"] === "claro", "a preferência chegar ao PC")
    // The PC vault now knows the mobile device is revoked (the leaf is still in the channel).
    // The field lives in the vault without being declared in `VaultContents` (see `revogacao.ts`).
    ;(ana.vault.contents as CofreComRevogados).revokedDevices = { [ana.address]: [telemovel.deviceKey] }
    await telemovel.session.definirPreferencia("tema", "escuro")
    await telemovel.session.definirPreferencia("controlo", "x")
    // A sign that the mobile frames arrived and were read: the relay delivered them.
    await settle(400)
    await esperar(300)
    expect(ana.session.preferencias()["tema"]).toBe("claro")
    expect(ana.session.preferencias()["controlo"]).toBeUndefined()
  }, 60_000)
})

describe("um canal eliminado por quem o administra", () => {
  it("o membro ouve que as mensagens do canal se apagam, e o histórico sai mesmo", async () => {
    const carlos = await conta("Carlos")
    const ana = await conta("Ana")
    const CANAL = moradaDeTeste("adega")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    await carlos.session.seat(CANAL, ana.address)
    await ate(() => ana.session.channels.includes(CANAL), "a Ana entrar na adega")
    await carlos.session.send(CANAL, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "olá", attachments: [], mentions: [], links: [] })
    await ate(() => (ana.vault.contents.history[CANAL] ?? []).length > 0, "a mensagem chegar à Ana")
    const frases: { detail: string; code?: string }[] = []
    ana.session.on("status", (estado) => frases.push(estado))
    await carlos.session.deleteChannel(CANAL)
    await ate(() => frases.some((frase) => frase.code === "channel-deleted"), "a Ana ouvir que o canal acabou")
    const frase = frases.find((f) => f.code === "channel-deleted")?.detail ?? ""
    // The phrase lives in the UI catalog; the core sends the key and the name.
    expect(frase).toMatch(/^channel-deleted: /)
    expect(frase).not.toContain("continuam neste aparelho")
    expect(ana.vault.contents.history[CANAL]).toBeUndefined()
  }, 60_000)
})

describe("o canal da conta só aceita folhas da própria conta (B1)", () => {
  it("a Eve monta um `!self-` com o nome do da Ana e convida-a: a Ana recusa, e nada do estado lhe vai", async () => {
    // This relay stores nothing (it is a compromised server, or an old server):
    // it lets Eve start the channel and delivers the Welcome. The client is who refuses.
    const ana = await conta("Ana")
    const eve = await conta("Eve")
    await ana.session.marcarLido(moradaDeTeste("sala"), 1_000)
    await ana.session.definirPreferencia("tema", "escuro")
    const alheio = canalDaConta(ana)

    await eve.session.createSpaceChannel(alheio)
    await settle(20)
    await eve.session.seat(alheio, ana.address)
    await ate(() => ana.avisos.includes("account-channel-foreign"), "a Ana recusar o canal da conta alheio")
    await settle(200)

    expect(ana.vault.contents.groups[alheio]).toBeUndefined()
    expect(ana.session.channels).not.toContain(alheio)
    // Refused at the gate and not released after: it never made it in.
    expect(ana.avisos).not.toContain("channel-joined")
    // The Welcome is marked dead: we do not try to open it again.
    expect(ana.vault.contents.deadWelcomes.some((marca) => marca.includes(alheio))).toBe(true)
    // And no frame from Ana entered Eve's channel: only what Eve put there.
    const eveFalou = (rele.eventos.get(alheio) ?? []).length
    await ana.session.marcarLido(moradaDeTeste("sala"), 2_000)
    await settle(200)
    expect((rele.eventos.get(alheio) ?? []).length).toBe(eveFalou)
  }, 60_000)
})

describe("o aparelho com a chave, surdo no canal da conta (I5)", () => {
  it("pede lugar, e o telemóvel (sem a chave) tira a folha morta e volta a convidá-la", async () => {
    const ana = await conta("Ana")
    /*
      No profile, so the account channel stays silent as this test needs.
      Since phase 1e the profile goes in the full state of whoever sees the
      channel grow, and the mobile device's signal in that epoch was proof of
      life: its seat request had no dead leaf to remove.
    */
    await ana.vault.update((contents) => {
      contents.profile = { displayName: "", donations: [], updatedAt: 0 }
    })
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    await ate(async () => (await folhasDe(ana, proprio, ana.address)).length === 2, "as duas folhas no canal da conta")

    // The PC ends up in a dead branch: we save its group now, the channel advances
    // two epochs (the mobile device's reseat), and the PC restarts with the saved
    // group. The mobile device's leaf is in its tree, so there is no one to invite:
    // just deafness.
    await ana.session.flush()
    const antigo = ana.vault.contents.groups[proprio] as string
    const commitsAntes = (rele.eventos.get(proprio) ?? []).filter((evento) => evento.kind === "handshake").length
    telemovel.session.requestRejoin(proprio)
    await ate(
      () => (rele.eventos.get(proprio) ?? []).filter((evento) => evento.kind === "handshake").length >= commitsAntes + 2,
      "o canal da conta avançar duas epochs",
    )
    await ate(() => telemovel.avisos.includes("channel-readopted"), "o telemóvel abrir o Welcome do reassento")
    await settle(100)
    ana.session.disconnect()
    await ana.vault.update((contents) => {
      contents.groups[proprio] = antigo
    })
    const pc = new Session(ana.vault)
    abertas.push(pc)
    const avisos = vigiar(pc)
    pc.loadIdentity()
    await pc.connect()
    await settle(60)

    // The mobile device writes, and the PC does not listen: it is deaf. That is what the detector does.
    await telemovel.session.definirPreferencia("tema", "escuro")
    await settle(60)
    expect(pc.preferencias()["tema"]).toBeUndefined()
    await pc.repairChannel(proprio)

    // The mobile device is who answers, and it does not have the account key.
    expect(telemovel.session.temChaveDeConta).toBe(false)
    await ate(() => avisos.includes("channel-readopted"), "o PC abrir o Welcome novo do canal da conta", 30_000)
    await telemovel.session.definirPreferencia("lingua", "pt")
    await ate(() => pc.preferencias()["lingua"] === "pt", "o PC voltar a ouvir o telemóvel no canal da conta")
  }, 90_000)
})

describe("dois aparelhos com a chave de conta (I4)", () => {
  /** The epoch 0 commits in the channel: the first invite for each group created with this name. */
  function criacoes(canal: string): number {
    return (rele.eventos.get(canal) ?? []).filter(
      (evento) => evento.kind === "handshake" && declaredEpoch(fromBase64(evento.ciphertext)) === 0n,
    ).length
  }

  it("os dois decidem ao mesmo tempo: só o de chave mais baixa cria, o outro entra por Welcome, e há um canal só", async () => {
    const ana = await conta("Ana")
    const outro = await outroComChave(ana)
    await ate(() => (rele.manifestos.get(ana.address)?.devices.length ?? 0) === 2, "o segundo aparelho entrar no manifesto")
    const proprio = canalDaConta(ana)
    expect(ana.vault.contents.groups[proprio]).toBeUndefined()
    expect(outro.vault.contents.groups[proprio]).toBeUndefined()

    // Each one already heard the other's signal: "I can be in the account channel, and I have the key".
    const agora = Date.now()
    await ana.vault.update((contents) => {
      contents.aparelhosComEstado = { [outro.deviceKey]: agora }
      contents.aparelhosComChave = { [outro.deviceKey]: agora }
    })
    await outro.vault.update((contents) => {
      contents.aparelhosComEstado = { [ana.deviceKey]: agora }
      contents.aparelhosComChave = { [ana.deviceKey]: agora }
    })
    // And both decide at the same instant.
    await Promise.all([ana.session.sincronizarAgora(), outro.session.sincronizarAgora()])

    const todos = [ana.deviceKey, outro.deviceKey].sort()
    await ate(async () => {
      const vistas = await Promise.all([ana, outro].map((quem) => folhasDe(quem, proprio, ana.address)))
      return vistas.every((folhas) => [...folhas].sort().join() === todos.join())
    }, "as duas folhas no mesmo canal da conta, vistas dos dois", 30_000)
    // One group only, created by one person only.
    expect(criacoes(proprio)).toBe(1)
    const epocas = await Promise.all(
      [ana, outro].map(async (quem) => {
        await quem.session.flush()
        return (await importSession(proprio, fromBase64(quem.vault.contents.groups[proprio] as string))).state.groupContext.epoch
      }),
    )
    expect(new Set(epocas.map(String)).size).toBe(1)

    // And state flows both ways.
    await outro.session.definirPreferencia("tema", "escuro")
    await ate(() => ana.session.preferencias()["tema"] === "escuro", "a preferência chegar do outro ao PC")
    await ana.session.definirPreferencia("lingua", "pt")
    await ate(() => outro.session.preferencias()["lingua"] === "pt", "a preferência chegar do PC ao outro")
  }, 120_000)

  it("o que não cria anuncia-se com a chave: o sinal dele diz `chave-de-conta`", async () => {
    const ana = await conta("Ana")
    const outro = await outroComChave(ana)
    await ate(() => (rele.manifestos.get(ana.address)?.devices.length ?? 0) === 2, "o segundo aparelho entrar no manifesto")
    // The other's signals, before entering the vault: from phase S1 of sync, the
    // first signal can be the resend announcement when the vault grows (§4.6),
    // which carries the same capabilities and reaches the PC earlier.
    const sinais: unknown[] = []
    const original = outro.session.send.bind(outro.session)
    outro.session.send = (channel, payload) => {
      if (payload.t === "typing") sinais.push(payload)
      return original(channel, payload)
    }
    const carlos = await conta("Carlos")
    const CANAL = moradaDeTeste("lagar")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    await carlos.session.seat(CANAL, ana.address)
    await ate(() => ana.session.channels.includes(CANAL) && outro.session.channels.includes(CANAL), "os dois aparelhos da Ana no lagar")
    // The other reconnects, outside the account channel: it announces itself in the vault.
    outro.session.disconnect()
    await outro.session.connect()
    await ate(() => ana.vault.contents.aparelhosComChave?.[outro.deviceKey] !== undefined, "o PC saber que o outro tem a chave")
    await ate(() => sinais.length > 0, "um sinal de aparelho do outro")
    expect(ana.vault.contents.aparelhosComEstado?.[outro.deviceKey]).toBeDefined()
    // The signal is born expired on any clock: `until: 0` (M4).
    // And `reenvio-v1` from phase S1 of sync (§4.6): the same signal says the device deduplicates the resend.
    // And `sincronia-v1` from S4: it knows about anti-entropy.
    // And `permissoes-v1` from 1.2: it reads the permissions model (the delegation gate).
    expect(sinais).toContainEqual({ t: "typing", until: 0, capacidades: ["estado-da-conta", "chave-de-conta", "reenvio-v1", "sincronia-v1", "permissoes-v1"] })
  }, 60_000)
})

describe("o reassento tira só a folha morta (F16)", () => {
  it("com dois aparelhos da Ana no canal, o pedido do telemóvel tira e repõe só a folha dele", async () => {
    const ana = await conta("Ana")
    const carlos = await conta("Carlos")
    const bruno = await conta("Bruno")
    const CANAL = moradaDeTeste("adega")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    await carlos.session.seat(CANAL, ana.address)
    await ate(() => ana.session.channels.includes(CANAL), "a Ana entrar na adega")
    const telemovel = await emparelhar(ana)
    await ate(() => telemovel.session.channels.includes(CANAL), "o telemóvel entrar na adega")
    // A new epoch where the PC speaks (the profile, on Bruno's entry) and the mobile
    // device stays silent. Silent for real: since phase S1 each device announces the
    // resend (a device signal) when the channel grows, and that signal is proof of
    // life; and since phase 1e the mobile device is born with the PC's profile and
    // also publishes it. Here the mobile device acts as a deaf leaf.
    const enviarDoTelemovel = telemovel.session.send.bind(telemovel.session)
    telemovel.session.send = async (channel, payload) => {
      if (payload.t === "typing" || payload.t === "profile") return
      return enviarDoTelemovel(channel, payload)
    }
    await carlos.session.seat(CANAL, bruno.address)
    await ate(() => bruno.session.channels.includes(CANAL), "o Bruno entrar na adega")
    await settle(300)
    telemovel.session.send = enviarDoTelemovel

    const antes = await indicesDe(carlos, CANAL, ana.address)
    expect([...antes.keys()].sort()).toEqual([ana.deviceKey, telemovel.deviceKey].sort())
    const commitsAntes = (rele.eventos.get(CANAL) ?? []).filter((evento) => evento.kind === "handshake").length

    telemovel.session.requestRejoin(CANAL)
    await ate(async () => {
      const agora = await indicesDe(carlos, CANAL, ana.address)
      return agora.size === 2 && (rele.eventos.get(CANAL) ?? []).filter((evento) => evento.kind === "handshake").length === commitsAntes + 2
    }, "o reassento do telemóvel")
    await settle(300)

    const depois = await indicesDe(carlos, CANAL, ana.address)
    // The same two leaves from Ana, one per device, before and after.
    expect([...depois.keys()].sort()).toEqual([ana.deviceKey, telemovel.deviceKey].sort())
    // The PC's stayed where it was: it did not leave, it did not need a Welcome.
    expect(depois.get(ana.deviceKey)).toBe(antes.get(ana.deviceKey))
    expect(ana.avisos).not.toContain("channel-readopted")
    // The mobile device's left and came back, and it opened the new Welcome.
    await ate(() => telemovel.avisos.includes("channel-readopted"), "o telemóvel abrir o Welcome novo")

    // And the PC keeps reading the channel: a message from Carlos reaches it.
    const lidas: string[] = []
    ana.session.on("message", (m) => {
      if (m.payload.t === "message") lidas.push(m.payload.body)
    })
    await carlos.session.send(CANAL, { t: "message", id: crypto.randomUUID(), body: "ainda me ouves?", sentAt: Date.now(), attachments: [] } as never)
    await ate(() => lidas.includes("ainda me ouves?"), "o PC ler o Carlos depois do reassento")
  }, 120_000)
})
