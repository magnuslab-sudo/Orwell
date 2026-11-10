import { moradaDeTeste } from "../testes/moradas.js"
import { declaredEpoch, deviceKeyAtLeaf, importSession, leavesOf } from "@enclave/crypto"
import {
  devicePublicKeyOf,
  fromBase64,
  generateDeviceKey,
  parseAddress,
  signDeviceCert,
  signDeviceManifest,
  toBase64,
  type DeviceManifestWire,
} from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { PairEvento } from "./emparelhar.js"
import { Session } from "./session.js"
import { Vault, type VaultBackend } from "./vault.js"

/**
 * The profile the same on all devices of the account (phase 1e).
 *
 * The owner's report (27/10/2026): "I log into the app: I don't have the same
 * profile photo I had in the browser". Three parts, and each one has its
 * test here: the profile travels in pairing and the new device is born with it;
 * each change goes through the account channel and the newest wins, with whoever
 * adopts it republishing it; and with no profile in time the new device publishes nothing.
 *
 * The relay is from `session.estado.test.ts` (copied, as that one copied from
 * `session.dois-aparelhos.test.ts`): pools per device, manifests, claim
 * in bundle, pairing boxes.
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

/**
 * Pair a new mobile to the `pc`, the whole way through. Also returns the
 * phases the mobile saw, and the profiles it sent to any channel,
 * watched from BEFORE the first `connect()`.
 */
async function emparelhar(pc: Conta): Promise<Conta & { fases: string[]; perfisEnviados: { channel: string; displayName: string; updatedAt: number }[] }> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const telemovel = new Session(vault)
  abertas.push(telemovel)
  const perfisEnviados = espiarPerfis(telemovel)
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
  return { session: telemovel, address: identidade.address, vault, deviceKey: toBase64(identidade.deviceSigningPublicKey), avisos, fases, perfisEnviados }
}


/** The `profile` payloads that a session sends on any channel. */
function espiarPerfis(session: Session): { channel: string; displayName: string; updatedAt: number }[] {
  const enviados: { channel: string; displayName: string; updatedAt: number }[] = []
  const original = session.send.bind(session)
  session.send = (channel, payload) => {
    if (payload.t === "profile") enviados.push({ channel, displayName: payload.displayName, updatedAt: payload.updatedAt })
    return original(channel, payload)
  }
  return enviados
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

const RETRATO = `data:image/png;base64,${"R".repeat(4_000)}`

describe("o perfil no emparelhamento (fase 1e, parte 1)", () => {
  it("o telemóvel nasce com o nome e o retrato do PC, e não publica outro", async () => {
    const ana = await conta("Ana")
    await ana.vault.update((contents) => {
      contents.profile = { displayName: "Ana", bio: "do PC", donations: [], avatarDataUrl: RETRATO, updatedAt: 1_000 }
    })
    const telemovel = await emparelhar(ana)
    expect(telemovel.fases).toContain("certificado:inteiro")
    expect(telemovel.session.profile).toEqual({ displayName: "Ana", bio: "do PC", donations: [], avatarDataUrl: RETRATO, updatedAt: 1_000 })
    await settle(40)
    // What the mobile device publishes is the SAME version as the PC, never an empty one.
    expect(telemovel.perfisEnviados.every((enviado) => enviado.displayName === "Ana" && enviado.updatedAt === 1_000)).toBe(true)
  }, 60_000)
})

describe("o perfil pelo canal da conta (fase 1e, parte 2)", () => {
  it("uma edição no telemóvel chega ao PC, que a adopta e a republica nos canais", async () => {
    const ana = await conta("Ana")
    await ana.session.createSpaceChannel(moradaDeTeste("sala"))
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")

    const perfisDoPc = espiarPerfis(ana.session)
    const avisos: string[] = []
    ana.session.on("perfil", ({ profile }) => avisos.push(profile.displayName))
    await telemovel.session.updateProfile({ displayName: "Ana B", donations: [], avatarDataUrl: RETRATO })
    const novo = telemovel.session.profile.updatedAt

    await ate(() => ana.session.profile.displayName === "Ana B", "o perfil novo chegar ao PC")
    expect(ana.session.profile).toEqual({ displayName: "Ana B", donations: [], avatarDataUrl: RETRATO, updatedAt: novo })
    expect(avisos).toEqual(["Ana B"])
    // And the PC republishes it on its channels, with the same version.
    await ate(
      () => perfisDoPc.some((enviado) => enviado.channel === moradaDeTeste("sala") && enviado.updatedAt === novo),
      "o PC republicar o perfil na sala",
    )
  }, 90_000)

  it("um perfil mais antigo que chega pelo canal da conta não passa por cima", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    await ana.session.updateProfile({ displayName: "Ana de hoje", donations: [] })
    await ate(() => telemovel.session.profile.displayName === "Ana de hoje", "o perfil de hoje chegar ao telemóvel")

    // The mobile device reports a profile from yesterday, manually, on the account channel.
    await telemovel.session.send(proprio, { t: "profile", displayName: "Ana de ontem", donations: [], updatedAt: 1 })
    await esperar(1_500)
    expect(ana.session.profile.displayName).toBe("Ana de hoje")
  }, 90_000)

  it("um perfil sem nome que chega pelo canal da conta não apaga o do PC", async () => {
    const ana = await conta("Ana")
    await ana.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO })
    const telemovel = await emparelhar(ana)
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    await telemovel.session.send(proprio, { t: "profile", displayName: "", donations: [], updatedAt: Date.now() + 60_000 })
    await esperar(1_500)
    expect(ana.session.profile.avatarDataUrl).toBe(RETRATO)
  }, 90_000)
})

describe("sem perfil a tempo (fase 1e, parte 3)", () => {
  it("o telemóvel não publica um perfil vazio, e adopta o do PC quando os dois estão ligados", async () => {
    const ana = await conta("Ana")
    // The PC has no profile yet: the snapshot goes out without it.
    await ana.vault.update((contents) => {
      contents.profile = { displayName: "", donations: [], updatedAt: 0 }
    })
    const telemovel = await emparelhar(ana)
    expect(telemovel.session.profile.displayName).toBe("")
    // The UI records the activity state in an empty profile: nothing goes out.
    await telemovel.session.updateProfile({ displayName: "", donations: [] })
    await settle(40)
    expect(telemovel.perfisEnviados).toEqual([])

    // The PC picks the profile, and it reaches the mobile device without any action from the person.
    const proprio = canalDaConta(ana)
    await ate(() => telemovel.vault.contents.groups[proprio] !== undefined, "o telemóvel entrar no canal da conta")
    await ana.session.updateProfile({ displayName: "Ana", donations: [], avatarDataUrl: RETRATO })
    await ate(() => telemovel.session.profile.displayName === "Ana", "o perfil chegar ao telemóvel")
    expect(telemovel.session.profile.avatarDataUrl).toBe(RETRATO)
  }, 90_000)
})
