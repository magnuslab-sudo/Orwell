import { moradaDeTeste } from "../testes/moradas.js"
import { deviceKeyAtLeaf, generateKeyPackages, importSession, leavesOf, memberAccounts } from "@enclave/crypto"
import {
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  parseServerName,
  signDeviceManifest,
  toBase64,
  verifyDeviceManifest,
  type DeviceManifestWire,
} from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Session } from "./session.js"
import { hasTransmitted, Vault, type VaultBackend } from "./vault.js"
import type { PairEvento } from "./emparelhar.js"

/**
 * Two `Session` from the SAME account, against a relay that serves key packages
 * per device: the first test of this repository with two live devices.
 *
 * The seam is what pairing will produce: a second vault with the same account
 * key and NO device key, which `loadIdentity` mints on opening. Pairing does
 * not exist, so the manifest with both is born from `#garantirManifesto`
 * seeing itself outside its own account manifest and adding itself to it.
 *
 * The relay is from `session.corrida.test.ts`, with what this slice added to
 * the server: pools by (address, device), manifests stored if the version
 * rises, and the claim in bundle that requests one package per device from the
 * manifest, or only the requests in `devices`. What is asserted here counts
 * PACKAGES SPENT, because that is what the client who invites spends from whom
 * is invited, and no one gives them back.
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

const TRAMAS_MAXIMAS = 3_000
const SEM_APARELHO = "-"

class Rele {
  readonly eventos = new Map<string, Evento[]>()
  /** Pools by `${endereço}|${aparelho}`, with `-` for "no device". */
  readonly pools = new Map<string, string[]>()
  readonly manifestos = new Map<string, DeviceManifestWire>()
  readonly ligacoes = new Set<FakeSocket>()
  /** How many claims arrived per address, to count what an invite costs. */
  readonly claims = new Map<string, number>()
  /** How many `manifest.get` per address: the server's bucket is 60 per minute. */
  readonly leituras = new Map<string, number>()
  entregues = 0
  reterClaimsPara: string | null = null
  readonly retidas: (() => void)[] = []

  /** The gateway's pairing mailboxes, in miniature: two connections per pairId. */
  readonly caixas = new Map<string, { anfitriao: FakeSocket; convidado: FakeSocket | null }>()
  /** Everything that went through `pair.send`, to prove the secret and the private never go there. */
  readonly payloadsDePar: string[] = []

  constructor(readonly capabilities: string[] = ["devices", "keypackage-bundle", "pairing"]) {}

  libertarClaims(): void {
    this.reterClaimsPara = null
    for (const responder of this.retidas.splice(0)) responder()
  }

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
        // With chain, `signingKey` is the device's: that is what the real server uses
        // to allocate packages from whoever does not say `device`.
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
      case "keypackage.claim": {
        const address = frame.address as string
        this.claims.set(address, (this.claims.get(address) ?? 0) + 1)
        const responder = (): void => socket.entregar(this.#reclamar(address, frame.bundle === true, frame.devices as string[] | undefined))
        if (this.reterClaimsPara === address) this.retidas.push(responder)
        else responder()
        return
      }
      case "manifest.get": {
        const address = frame.address as string
        this.leituras.set(address, (this.leituras.get(address) ?? 0) + 1)
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
      case "pair.open": {
        const pairId = frame.pairId as string
        if (!socket.address) {
          socket.entregar({ t: "error", code: "unauthenticated", message: "authenticate first", fatal: true })
          return
        }
        if (this.caixas.has(pairId)) {
          socket.entregar({ t: "pair.rejected", pairId, reason: "exists" })
          return
        }
        this.caixas.set(pairId, { anfitriao: socket, convidado: null })
        socket.entregar({ t: "pair.opened", pairId })
        return
      }
      case "pair.join": {
        const pairId = frame.pairId as string
        const caixa = this.caixas.get(pairId)
        if (!caixa) {
          socket.entregar({ t: "pair.rejected", pairId, reason: "unknown" })
          return
        }
        if (caixa.convidado !== null) {
          socket.entregar({ t: "pair.rejected", pairId, reason: "full" })
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
        this.payloadsDePar.push(JSON.stringify(frame.payload))
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

  /**
   * The `Store.claimBundle` and the gateway's `#claimKeyPackage`, in miniature.
   *
   * The NEWEST first (`pop`), like the Store (`ORDER BY id DESC`): a relay
   * serving the oldest would pass through a server that does not exist, and a
   * test that put a bad package at the head of the pool would measure the
   * wrong order.
   */
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

interface Conta {
  session: Session
  address: string
  vault: Vault
  deviceKey: string
  avisos: string[]
}

let abertas: Session[] = []

async function ligar(vault: Vault): Promise<Conta> {
  const session = new Session(vault)
  abertas.push(session)
  session.loadIdentity()
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  await session.connect()
  await settle(40)
  return { session, address: session.identity.address, vault, deviceKey: toBase64(session.identity.deviceSigningPublicKey), avisos }
}

/** A new account, in a new vault, with a name: without a name there is no profile, and without a profile no one hears when you join. */
async function conta(nome = "alguém"): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  await vault.update((contents) => {
    contents.profile = { displayName: nome, donations: [], updatedAt: Date.now() }
  })
  abertas.push(session)
  const avisos: string[] = []
  session.on("status", (evento) => {
    if (evento.code) avisos.push(evento.code)
  })
  await session.connect()
  await settle(40)
  return { session, address: session.identity.address, vault, deviceKey: toBase64(session.identity.deviceSigningPublicKey), avisos }
}

/**
 * The second device of the same account: another vault, the same account key,
 * and NO device key, which `loadIdentity` mints on opening. It is what pairing
 * will produce, and what importing a vault exported before device keys existed
 * already produces today.
 */
async function segundoAparelho(primeiro: Conta): Promise<Conta> {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-passe")
  await vault.update((contents) => {
    contents.signingPrivateKey = primeiro.vault.contents.signingPrivateKey
    contents.homeserver = primeiro.vault.contents.homeserver
    const minuto = primeiro.vault.contents.identityCreatedAtMinute
    if (minuto !== undefined) contents.identityCreatedAtMinute = minuto
    contents.profile = { ...primeiro.vault.contents.profile }
  })
  const segundo = await ligar(vault)
  expect(segundo.address).toBe(primeiro.address)
  expect(segundo.deviceKey).not.toBe(primeiro.deviceKey)
  return segundo
}

const CANAL = moradaDeTeste("lagar")

/** The leaves of an address in the channel, seen from the vault of whoever asks, by device. */
async function folhasDe(quem: Conta, address: string): Promise<string[]> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[CANAL]
  if (!blob) throw new Error(`${quem.address} não tem grupo gravado para ${CANAL}`)
  const gravada = await importSession(CANAL, fromBase64(blob))
  const arvore = gravada.state.ratchetTree
  return leavesOf(arvore, address as never).map((folha) => toBase64(deviceKeyAtLeaf(arvore, folha) as Uint8Array))
}

async function pessoasEm(quem: Conta): Promise<number> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[CANAL]
  if (!blob) throw new Error("sem grupo")
  return memberAccounts((await importSession(CANAL, fromBase64(blob))).state.ratchetTree).size
}

/**
 * Until `who` hears `address` speak in the channel, in real time.
 *
 * `settle` yields the turn and returns; admission and the profile published
 * next are real cryptography, which takes the time it takes. The `seat` only
 * says `live` to those who have already heard, and a test that does not wait
 * for this measures a `reseated` that is just impatience.
 */
async function ateOuvir(quem: Conta, address: string, prazoMs = 15_000): Promise<void> {
  return ateOuvirEm(quem, CANAL, address, prazoMs)
}

async function ateOuvirEm(quem: Conta, canal: string, address: string, prazoMs = 15_000): Promise<void> {
  const fim = Date.now() + prazoMs
  while (Date.now() < fim) {
    if (hasTransmitted(quem.vault.contents, canal, address)) return
    await esperar(50)
  }
  throw new Error(`${quem.address} nunca ouviu ${address} em ${canal}`)
}

/** The leaves of an address in any channel, seen from `who`'s vault. */
async function folhasNoCanal(quem: Conta, canal: string, address: string): Promise<string[]> {
  await quem.session.flush()
  const blob = quem.vault.contents.groups[canal]
  if (!blob) return []
  const arvore = (await importSession(canal, fromBase64(blob))).state.ratchetTree
  return leavesOf(arvore, address as never).map((folha) => toBase64(deviceKeyAtLeaf(arvore, folha) as Uint8Array))
}

async function ateQue(condicao: () => Promise<boolean>, descricao: string, prazoMs = 20_000): Promise<void> {
  const fim = Date.now() + prazoMs
  while (Date.now() < fim) {
    if (await condicao()) return
    await esperar(50)
  }
  throw new Error(`nunca aconteceu: ${descricao}`)
}

/** The commits (handshakes) in the channel, which is what is counted for "on the same commit". */
function handshakes(): number {
  return (rele.eventos.get(CANAL) ?? []).filter((evento) => evento.kind === "handshake").length
}

beforeEach(() => {
  rele = new Rele()
  abertas = []
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const session of abertas) session.disconnect()
  abertas = []
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("uma conta com dois aparelhos", () => {
  it("o segundo aparelho vê-se fora do manifesto e acrescenta-se a ele, com a versão a subir", async () => {
    const ana = await conta()
    const v1 = rele.manifestos.get(ana.address)
    expect(v1?.version).toBe(1)
    expect(v1?.devices.map((d) => d.deviceKey)).toEqual([ana.deviceKey])

    const anaTelemovel = await segundoAparelho(ana)
    const v2 = rele.manifestos.get(ana.address)
    expect(v2?.version).toBe(2)
    expect(v2?.devices.map((d) => d.deviceKey)).toEqual([ana.deviceKey, anaTelemovel.deviceKey])
    const verificado = verifyDeviceManifest(v2)
    expect(verificado.ok).toBe(true)
    // The second device's vault remembers the version it published; reconnecting
    // does not republish it: it is already there.
    expect(anaTelemovel.vault.contents.deviceManifests[ana.address]).toBe(2)
    anaTelemovel.session.disconnect()
    const outraVez = await ligar(anaTelemovel.vault)
    expect(rele.manifestos.get(ana.address)?.version).toBe(2)
    expect(outraVez.deviceKey).toBe(anaTelemovel.deviceKey)

    // And each device has its own pool on the server.
    expect(rele.pool(ana.address, ana.deviceKey).length).toBeGreaterThan(0)
    expect(rele.pool(ana.address, anaTelemovel.deviceKey).length).toBeGreaterThan(0)
  }, 30_000)

  it("um terceiro convida a conta e os dois aparelhos entram no mesmo commit, um pacote de cada", async () => {
    const ana = await conta()
    const anaTelemovel = await segundoAparelho(ana)
    const carlos = await conta()
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)

    const piscinaA = rele.pool(ana.address, ana.deviceKey).length
    const piscinaB = rele.pool(ana.address, anaTelemovel.deviceKey).length
    const commitsAntes = handshakes()
    // The reads so far are from Ana's own devices when they connect.
    const leiturasAntes = rele.leituras.get(ana.address) ?? 0

    await carlos.session.seat(CANAL, ana.address)
    await settle(120)

    // Two leaves of Ana in Carlos's tree, one per device.
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, anaTelemovel.deviceKey].sort())
    expect(await pessoasEm(carlos)).toBe(2)
    // Single commit.
    expect(handshakes() - commitsAntes).toBe(1)
    // Both devices opened the same welcome screen, each with their half.
    expect(ana.session.channels).toContain(CANAL)
    expect(anaTelemovel.session.channels).toContain(CANAL)
    // The invite consumed exactly one packet from each, with a single claim.
    expect(rele.pool(ana.address, ana.deviceKey).length).toBe(piscinaA - 1)
    expect(rele.pool(ana.address, anaTelemovel.deviceKey).length).toBe(piscinaB - 1)
    expect(rele.claims.get(ana.address)).toBe(1)

    // Inviting again is rejected: no device is missing.
    await expect(carlos.session.invite(CANAL, ana.address)).rejects.toThrow("that person is already in this channel")
    expect(rele.claims.get(ana.address)).toBe(1)
    await ateOuvir(carlos, ana.address)
    expect(await carlos.session.seat(CANAL, ana.address)).toBe("live")
    // Ana's manifest was read ONCE by Carlos, not once per vault:
    // the three decisions above (invite, reject, `live`) fit in the minute
    // it takes to remember. The server bucket is 60 per minute, and reconciling
    // a connection runs through all accepted invites.
    expect((rele.leituras.get(ana.address) ?? 0) - leiturasAntes).toBe(1)

    // Two paths asking for the same address at the same time, with empty cache,
    // make ONE request: the second one catches what is in flight. Dora joins two
    // channels where Ana is already in, hears her in both, and makes two `seat`
    // calls at once: two "live", one `manifest.get`.
    const CANAL2 = moradaDeTeste("adega")
    await carlos.session.createSpaceChannel(CANAL2)
    await settle(20)
    await carlos.session.seat(CANAL2, ana.address)
    const dora = await conta("Dora")
    await carlos.session.seat(CANAL, dora.address)
    await carlos.session.seat(CANAL2, dora.address)
    await settle(120)
    expect(dora.session.channels).toEqual(expect.arrayContaining([CANAL, CANAL2]))
    await ateOuvir(dora, ana.address)
    await ateOuvirEm(dora, CANAL2, ana.address)
    const antes = rele.leituras.get(ana.address) ?? 0
    const [umLugar, outroLugar] = await Promise.all([dora.session.seat(CANAL, ana.address), dora.session.seat(CANAL2, ana.address)])
    expect([umLugar, outroLugar]).toEqual(["live", "live"])
    expect((rele.leituras.get(ana.address) ?? 0) - antes).toBe(1)
  }, 90_000)

  /**
   * Followed friend lists count in the feed, not per device: for a 0.5.x
   * client, the phone list is just another rejected payload, same as the
   * computer's (core revision I2). Received from the other device, it adds up.
   */
  it("uma lista do outro aparelho conta para as seguidas, e não as repõe", async () => {
    const ana = await conta("Ana")
    const telemovel = await segundoAparelho(ana)
    const feed = await ana.session.ensureFeed()
    await settle(40)
    await ana.session.seat(feed, ana.address)
    const fim = Date.now() + 15_000
    while (Date.now() < fim && !telemovel.session.channels.includes(feed)) await esperar(50)
    expect(telemovel.session.channels).toContain(feed)
    await settle(200)

    await ana.session.send(feed, { t: "friends.shown", shown: [], updatedAt: 1 })
    await ana.session.send(feed, { t: "friends.shown", shown: [], updatedAt: 2 })
    await telemovel.session.send(feed, { t: "friends.shown", shown: [], updatedAt: 3 })
    await settle(200)
    // 2 from the computer + 1 from the phone: the computer is at the cap.
    await expect(ana.session.send(feed, { t: "friends.shown", shown: [], updatedAt: 4 })).rejects.toThrow("too many friend lists in a row")
  }, 90_000)

  it("um aparelho sem pacotes: entra o outro, o lugar fica por reparar, e a reparação pede só o que falta", async () => {
    const ana = await conta()
    const anaTelemovel = await segundoAparelho(ana)
    const carlos = await conta()
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    // The phone ran out of pool (drained by invites from others).
    const guardada = rele.pool(ana.address, anaTelemovel.deviceKey).splice(0)

    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(ana.session.channels).toContain(CANAL)
    expect(anaTelemovel.session.channels).not.toContain(CANAL)

    // The seat stays unrepaired: the account is in the tree and connected, but
    // missing a device, and without packets from it the `seat` says there are no keys.
    await ateOuvir(carlos, ana.address)
    await expect(carlos.session.seat(CANAL, ana.address)).rejects.toThrow("that person has no invite keys")
    const piscinaA = rele.pool(ana.address, ana.deviceKey).length

    // With braked repair (the path of `syncFriendships` on each connection):
    // "device-unreachable", nothing spent, and the brake STAYS recorded. Without
    // it, this repeats per friend on each connection, with three retries and three
    // seconds of wait, forever. The second pass is "cooldown" without hitting the
    // server; `force` lifts the brake and retries. (Each retry is three claims:
    // the short race of `#invite`.)
    const claimsAntes = rele.claims.get(ana.address) ?? 0
    expect(await carlos.session.repairInvite(CANAL, ana.address)).toBe("device-unreachable")
    expect(rele.claims.get(ana.address)).toBe(claimsAntes + 3)
    expect(carlos.vault.contents.repairAttempts[`${ana.address}|${CANAL}`]).toBeTypeOf("number")
    expect(await carlos.session.repairInvite(CANAL, ana.address)).toBe("cooldown")
    expect(rele.claims.get(ana.address)).toBe(claimsAntes + 3)
    expect(await carlos.session.repairInvite(CANAL, ana.address, true)).toBe("device-unreachable")
    expect(rele.claims.get(ana.address)).toBe(claimsAntes + 6)

    // The phone restores the pool; repair asks ONLY for the missing device, and
    // the laptop's pool loses nothing.
    rele.pool(ana.address, anaTelemovel.deviceKey).push(...guardada)
    const publicar = vi.spyOn(ana.session, "publishProfile")
    expect(await carlos.session.seat(CANAL, ana.address)).toBe("invited")
    await settle(120)
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, anaTelemovel.deviceKey].sort())
    expect(anaTelemovel.session.channels).toContain(CANAL)
    expect(rele.pool(ana.address, ana.deviceKey).length).toBe(piscinaA)
    expect(rele.pool(ana.address, anaTelemovel.deviceKey).length).toBe(guardada.length - 1)

    // The cascade of `#noteMembership` fired on Ana's laptop when it saw the tree
    // grow from two leaves to three, despite staying two PEOPLE: the phone never
    // saw anyone's profile, and it counts by leaves.
    expect(publicar).toHaveBeenCalledWith([CANAL], true)
  }, 60_000)

  it("o pacote de reserva de outro aparelho não entra quando se pediu um aparelho só (M1)", async () => {
    const ana = await conta()
    const primeiro = await segundoAparelho(ana)
    const segundo = await segundoAparelho(ana)
    const fim = Date.now() + 15_000
    while (Date.now() < fim && (rele.manifestos.get(ana.address)?.devices.length ?? 0) < 3) await esperar(50)
    expect(rele.manifestos.get(ana.address)?.devices).toHaveLength(3)
    const carlos = await conta()
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    // The first one without a pool: Ana and the second one join.
    rele.pool(ana.address, primeiro.deviceKey).splice(0)
    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    await ateOuvir(carlos, ana.address)
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, segundo.deviceKey].sort())

    // Repair asks ONLY for the first one. It still has no packets, and the server
    // serves the backup (no device), which belongs to the second: already in the channel.
    const [doSegundo] = await generateKeyPackages(segundo.session.identity, 1)
    rele.pool(ana.address, null).push(toBase64(doSegundo?.wire as Uint8Array))
    await expect(carlos.session.seat(CANAL, ana.address)).rejects.toThrow("no invite key verifies")
    expect(carlos.avisos).toContain("keypackage-invalid")
    // No second leaf for the second one.
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, segundo.deviceKey].sort())
  }, 90_000)

  it("um pacote que não verifica no bundle é deitado fora, e o resto entra", async () => {
    const ana = await conta()
    const anaTelemovel = await segundoAparelho(ana)
    const carlos = await conta()
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)

    // In the phone's pool, three packets that don't work: one from ANOTHER account,
    // one from an Ana device that the manifest doesn't list, and garbage. The server
    // tags them all as from the phone, because that's where they are.
    const dora = generateIdentity(parseServerName("localhost:8448"))
    const [deDora] = await generateKeyPackages(dora, 1)
    const aparelhoFantasma = identityFromPrivateKey(fromBase64(ana.vault.contents.signingPrivateKey), parseServerName("localhost:8448"), ed25519.utils.randomSecretKey())
    const [doFantasma] = await generateKeyPackages(aparelhoFantasma, 1)
    const piscinaDoTelemovel = rele.pool(ana.address, anaTelemovel.deviceKey)
    piscinaDoTelemovel.splice(0)
    piscinaDoTelemovel.push(toBase64(new Uint8Array([1, 2, 3])))
    const piscinaA = rele.pool(ana.address, ana.deviceKey).length

    // 1. Garbage: the laptop joins, the phone doesn't, and the log says why.
    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    await ateOuvir(carlos, ana.address)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(rele.pool(ana.address, ana.deviceKey).length).toBe(piscinaA - 1)
    expect(carlos.avisos.filter((c) => c === "keypackage-invalid")).toHaveLength(1)

    // 2. From another account: rejected, and repair costs nothing from the laptop.
    piscinaDoTelemovel.push(toBase64((deDora as { wire: Uint8Array }).wire))
    await expect(carlos.session.seat(CANAL, ana.address)).rejects.toThrow("no invite key verifies")
    expect(carlos.avisos.filter((c) => c === "keypackage-invalid")).toHaveLength(2)
    expect(rele.pool(ana.address, ana.deviceKey).length).toBe(piscinaA - 1)

    // 3. From Ana, but from a device not in the manifest: rejected.
    piscinaDoTelemovel.push(toBase64((doFantasma as { wire: Uint8Array }).wire))
    await expect(carlos.session.seat(CANAL, ana.address)).rejects.toThrow("no invite key verifies")
    expect(carlos.avisos.filter((c) => c === "keypackage-invalid")).toHaveLength(3)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
  }, 60_000)

  it("dois convites em voo no mesmo socket não trocam respostas, e cada um gasta um pacote", async () => {
    const ana = await conta()
    const bento = await conta()
    const carlos = await conta()
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    const piscinaAna = rele.pool(ana.address, ana.deviceKey).length
    const piscinaBento = rele.pool(bento.address, bento.deviceKey).length

    // Ana's claim response is held back; Bento's, requested next on the same socket,
    // responds first. Without the label by address, Bento's response would go to
    // Ana's queue.
    rele.reterClaimsPara = ana.address
    const convidarAna = carlos.session.seat(CANAL, ana.address)
    await settle(10)
    const convidarBento = carlos.session.seat(CANAL, bento.address)
    await esperar(300)
    expect(rele.retidas).toHaveLength(1)
    await expect(convidarBento).resolves.toBe("invited")
    rele.libertarClaims()
    await expect(convidarAna).resolves.toBe("invited")
    await settle(120)

    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(await folhasDe(carlos, bento.address)).toEqual([bento.deviceKey])
    expect(ana.session.channels).toContain(CANAL)
    expect(bento.session.channels).toContain(CANAL)
    // One claim and one packet per person: no repeats per swapped response.
    expect(rele.claims.get(ana.address)).toBe(1)
    expect(rele.claims.get(bento.address)).toBe(1)
    expect(rele.pool(ana.address, ana.deviceKey).length).toBe(piscinaAna - 1)
    expect(rele.pool(bento.address, bento.deviceKey).length).toBe(piscinaBento - 1)
  }, 60_000)

  it("contra um servidor sem bundle, o convite gasta um pacote e verifica-lhe a cadeia na mesma", async () => {
    rele = new Rele(["devices"])
    const ana = await conta()
    const carlos = await conta()
    expect(carlos.session.suportaBundle).toBe(false)
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    // A packet from another account at the TOP of the pool (the newest, which gets
    // served first): the chain is validated in singular too, and rejected.
    const dora = generateIdentity(parseServerName("localhost:8448"))
    const [deDora] = await generateKeyPackages(dora, 1)
    rele.pool(ana.address, ana.deviceKey).push(toBase64((deDora as { wire: Uint8Array }).wire))
    await expect(carlos.session.seat(CANAL, ana.address)).rejects.toThrow("no invite key verifies")
    expect(carlos.avisos).toContain("keypackage-invalid")

    const piscina = rele.pool(ana.address, ana.deviceKey).length
    expect(await carlos.session.seat(CANAL, ana.address)).toBe("invited")
    await settle(120)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(rele.pool(ana.address, ana.deviceKey).length).toBe(piscina - 1)
    expect(ana.session.channels).toContain(CANAL)
  }, 60_000)
})

/**
 * Genuine pairing between two `Session`: the computer opens the vault, the
 * phone (an empty vault, no identity) joins via the link, the six words match
 * on both, the person confirms on both, and the phone gets a DEVICE vault:
 * certificate, account public key, never the private key.
 */
describe("emparelhamento: PC + telemóvel na mesma conta", () => {
  /** Wait for a phase of the `pair` event on a session, or fail with the reason. */
  function esperarFase<F extends PairEvento["fase"]>(
    session: Session,
    fase: F,
    prazoMs = 15_000,
  ): Promise<Extract<PairEvento, { fase: F }>> {
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

  async function emparelhar(pc: Conta, ordem: "pc-primeiro" | "telemovel-primeiro" = "telemovel-primeiro"): Promise<Conta> {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const telemovel = new Session(vault)
    abertas.push(telemovel)
    const avisos: string[] = []
    telemovel.on("status", (evento) => {
      if (evento.code) avisos.push(evento.code)
    })

    const sasPc = esperarFase(pc.session, "sas")
    const { link, pairId } = await pc.session.emparelharComoAnfitriao()
    expect(link).toContain("/app/emparelhar#")
    expect(rele.caixas.has(pairId)).toBe(true)
    // The secret never leaves the fragment and never reaches the server: the pairId
    // is its digest, and the relay only saw the pairId.
    const segredo = link.slice(link.indexOf("#") + 1)
    expect(segredo).toHaveLength(43)
    expect(pairId).not.toContain(segredo.slice(0, 10))

    const sasTelemovel = esperarFase(telemovel, "sas")
    telemovel.emparelharComoConvidado(link)
    const [pcPalavras, telPalavras] = await Promise.all([sasPc, sasTelemovel])
    expect(pcPalavras.palavras).toBe(telPalavras.palavras)
    expect(pcPalavras.palavras.split("-")).toHaveLength(6)

    const certificado = esperarFase(telemovel, "certificado")
    const concluidoPc = esperarFase(pc.session, "concluido", 30_000)
    if (ordem === "telemovel-primeiro") {
      await telemovel.confirmarSas()
      await pc.session.confirmarSas()
    } else {
      // The race case: the computer confirms and signs before the person touches the
      // phone. The certificate waits for yes from there.
      await pc.session.confirmarSas()
      await settle(60)
      expect(vault.contents.deviceCert).toBe("")
      await telemovel.confirmarSas()
    }
    const evento = await certificado
    expect(evento.address).toBe(pc.address)

    // The device vault: account public key and certificate, and NEVER the private key.
    expect(vault.contents.signingPrivateKey).toBe("")
    expect(vault.contents.accountPublicKey).toBe(toBase64(pc.session.identity.signingPublicKey))
    expect(vault.contents.deviceCert).not.toBe("")
    expect(vault.contents.deviceSigningPrivateKey).not.toBe("")
    expect(vault.contents.homeserver).toBe(pc.vault.contents.homeserver)

    const identidade = telemovel.loadIdentity()
    expect(identidade.address).toBe(pc.address)
    expect(identidade.signingPrivateKey).toBeUndefined()
    expect(telemovel.temChaveDeConta).toBe(false)
    expect(pc.session.temChaveDeConta).toBe(true)
    // The `#garantirManifesto` gate: a device without the account key publishes no
    // manifest and, before that, doesn't even ASK for it on connect. The read is
    // what you see on the server side; the publish, without the key, would die on
    // signature in silence, and this test didn't tell them apart.
    const leiturasAntes = rele.leituras.get(pc.address) ?? 0
    await telemovel.connect()
    await settle(40)
    expect(rele.leituras.get(pc.address) ?? 0).toBe(leiturasAntes)
    telemovel.concluirEmparelhamento()
    await concluidoPc

    return { session: telemovel, address: identidade.address, vault, deviceKey: toBase64(identidade.deviceSigningPublicKey), avisos }
  }

  it("as seis palavras batem, o telemóvel fica sem a privada, e o manifesto v2 é publicado pelo PC", async () => {
    const ana = await conta()
    expect(rele.manifestos.get(ana.address)?.version).toBe(1)
    const telemovel = await emparelhar(ana)

    const v2 = rele.manifestos.get(ana.address)
    expect(v2?.version).toBe(2)
    expect(v2?.devices.map((d) => d.deviceKey)).toEqual([ana.deviceKey, telemovel.deviceKey])
    expect(verifyDeviceManifest(v2 as DeviceManifestWire).ok).toBe(true)
    // The PC published: the phone connected, doesn't have the private key, and its
    // `#garantirManifesto` didn't publish any v3.
    await settle(60)
    expect(rele.manifestos.get(ana.address)?.version).toBe(2)
    // And the phone has its pool of key packages on the server.
    expect(rele.pool(ana.address, telemovel.deviceKey).length).toBeGreaterThan(0)
    // Nothing that passed through the vault is readable: neither the private nor the public in the clear.
    const privada = ana.vault.contents.signingPrivateKey
    for (const payload of rele.payloadsDePar) {
      expect(payload).not.toContain(privada)
      expect(payload).not.toContain(ana.address)
    }
    expect(rele.payloadsDePar.length).toBeGreaterThanOrEqual(4)
    // The vault was closed.
    expect(rele.caixas.size).toBe(0)
  }, 40_000)

  it("o PC assenta o telemóvel em cada canal onde a conta está, pelo próprio endereço", async () => {
    const ana = await conta()
    await ana.session.createSpaceChannel(CANAL)
    await settle(20)
    const commitsAntes = handshakes()
    const telemovel = await emparelhar(ana)

    // The `seat` of its own address: a new leaf from the phone's device, in one
    // commit, with no one's invite.
    const fim = Date.now() + 20_000
    while (Date.now() < fim && !telemovel.session.channels.includes(CANAL)) await esperar(100)
    expect(telemovel.session.channels).toContain(CANAL)
    expect((await folhasDe(ana, ana.address)).sort()).toEqual([ana.deviceKey, telemovel.deviceKey].sort())
    expect(handshakes()).toBe(commitsAntes + 1)
    expect(await pessoasEm(ana)).toBe(1)
    // And the phone writes and the PC reads.
    const lidas: string[] = []
    ana.session.on("message", (m) => {
      if (m.payload.t === "message") lidas.push(m.payload.body)
    })
    await telemovel.session.send(CANAL, {
      t: "message",
      id: crypto.randomUUID(),
      body: "olá do telemóvel",
      sentAt: Date.now(),
      attachments: [],
    } as never)
    await settle(80)
    expect(lidas).toContain("olá do telemóvel")
  }, 40_000)

  it("a corrida em que a pessoa confirma primeiro no PC: o certificado espera pelo sim do telemóvel", async () => {
    const ana = await conta()
    const telemovel = await emparelhar(ana, "pc-primeiro")
    expect(telemovel.address).toBe(ana.address)
    expect(rele.manifestos.get(ana.address)?.devices.map((d) => d.deviceKey)).toEqual([ana.deviceKey, telemovel.deviceKey])
  }, 40_000)

  it("um terceiro convida a conta depois do emparelhamento e os dois aparelhos entram no mesmo commit", async () => {
    const ana = await conta()
    const telemovel = await emparelhar(ana)
    const carlos = await conta()
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    const commitsAntes = handshakes()
    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    expect(handshakes()).toBe(commitsAntes + 1)
    const fim = Date.now() + 20_000
    while (Date.now() < fim && !(ana.session.channels.includes(CANAL) && telemovel.session.channels.includes(CANAL))) await esperar(100)
    expect(ana.session.channels).toContain(CANAL)
    expect(telemovel.session.channels).toContain(CANAL)
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, telemovel.deviceKey].sort())
  }, 40_000)

  /**
   * **A room created after pairing reaches the phone** (F6, 20/10/2026).
   *
   * `#assentarAparelho` only ran on pairing, on the rooms of that moment. A
   * direct opened afterwards was born with only the device that opened it, and
   * the phone never saw it.
   */
  it("o PC abre uma directa depois de emparelhar, e o telemóvel entra nela", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    const carlos = await conta("Carlos")
    const dm = await ana.session.openDirect(carlos.address)

    const fim = Date.now() + 20_000
    while (Date.now() < fim && !(telemovel.session.channels.includes(dm) && carlos.session.channels.includes(dm))) await esperar(100)
    expect(carlos.session.channels).toContain(dm)
    expect(telemovel.session.channels).toContain(dm)
    // And what the phone writes gets there to Carlos.
    const lidas: string[] = []
    carlos.session.on("message", (m) => {
      if (m.channel === dm && m.payload.t === "message") lidas.push(m.payload.body)
    })
    await telemovel.session.send(dm, { t: "message", id: crypto.randomUUID(), body: "do telemóvel", sentAt: Date.now(), attachments: [] } as never)
    const ate = Date.now() + 10_000
    while (Date.now() < ate && !lidas.includes("do telemóvel")) await esperar(50)
    expect(lidas).toContain("do telemóvel")
  }, 60_000)

  /**
   * I8 of the revision: a device with no packets on the server cannot cost three
   * claims per room on each pass. The brake is from repair, six hours per
   * (account, room), and counts the attempt that gave `AparelhoSemChaves`.
   */
  it("um telemóvel sem pacotes gasta uma tentativa por canal, e a passagem seguinte não volta a reclamar", async () => {
    const ana = await conta("Ana")
    const telemovel = await emparelhar(ana)
    rele.pool(ana.address, telemovel.deviceKey).length = 0
    const carlos = await conta("Carlos")
    await ana.session.openDirect(carlos.address)
    // The three claim retries, spaced 1.5 s apart.
    await esperar(5_000)
    const depoisDaPrimeira = rele.claims.get(ana.address) ?? 0
    expect(depoisDaPrimeira).toBeGreaterThan(0)
    await ana.session.sincronizarAgora()
    await esperar(500)
    expect(rele.claims.get(ana.address) ?? 0).toBe(depoisDaPrimeira)
  }, 60_000)

  it('"não são as mesmas" num dos lados pára os dois, sem certificado', async () => {
    const ana = await conta()
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const telemovel = new Session(vault)
    abertas.push(telemovel)
    const sasPc = esperarFase(ana.session, "sas")
    const { link } = await ana.session.emparelharComoAnfitriao()
    const sasTel = esperarFase(telemovel, "sas")
    telemovel.emparelharComoConvidado(link)
    await Promise.all([sasPc, sasTel])
    const falhouPc = new Promise<PairEvento>((resolve) => ana.session.on("pair", (e) => e.fase === "falhou" && resolve(e)))
    const falhouTel = new Promise<PairEvento>((resolve) => telemovel.on("pair", (e) => e.fase === "falhou" && resolve(e)))
    telemovel.recusarSas()
    expect(await falhouTel).toMatchObject({ fase: "falhou", razao: "palavras-diferentes" })
    expect(await falhouPc).toMatchObject({ fase: "falhou", razao: "palavras-diferentes" })
    expect(vault.contents.deviceCert).toBe("")
    expect(vault.contents.accountPublicKey).toBe("")
    expect(rele.manifestos.get(ana.address)?.version).toBe(1)
  }, 30_000)

  it("um cofre que já tem conta não se junta a outra", async () => {
    const ana = await conta()
    const bruno = await conta()
    const { link } = await ana.session.emparelharComoAnfitriao()
    expect(() => bruno.session.emparelharComoConvidado(link)).toThrow("this vault already holds an account")
    ana.session.cancelarEmparelhamento()
  }, 20_000)

  it("um aparelho emparelhado não pode acrescentar aparelhos", async () => {
    const ana = await conta()
    const telemovel = await emparelhar(ana)
    await expect(telemovel.session.emparelharComoAnfitriao()).rejects.toThrow("this device has no account key")
  }, 40_000)

  /**
   * The order of confirmations: the computer doesn't sign anything before the
   * phone says yes.
   *
   * Who defends the account is still the yes given HERE: the phone is no source
   * of trust. What this holds back is cleanup: without waiting, any pairing that
   * died after the computer's yes (different words on the other side, network,
   * separator closed) would leave a dead key in the manifest forever, and three
   * of those would fill the cap of four with no revocation to take them out.
   */
  it("o PC confirma e o telemóvel recusa: nada assinado, e o manifesto fica na v1", async () => {
    const ana = await conta()
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const telemovel = new Session(vault)
    abertas.push(telemovel)

    const sasPc = esperarFase(ana.session, "sas")
    const { link } = await ana.session.emparelharComoAnfitriao()
    const sasTel = esperarFase(telemovel, "sas")
    telemovel.emparelharComoConvidado(link)
    await Promise.all([sasPc, sasTel])

    const falhouPc = new Promise<PairEvento>((resolve) => ana.session.on("pair", (e) => e.fase === "falhou" && resolve(e)))
    const falhouTel = new Promise<PairEvento>((resolve) => telemovel.on("pair", (e) => e.fase === "falhou" && resolve(e)))
    // Two device keys have passed through the box so far, one from each side.
    const atravessaram = rele.payloadsDePar.length
    expect(atravessaram).toBe(2)
    await ana.session.confirmarSas()
    await settle(80)
    // The computer's yes, on its own, put nothing else in the box: the certificate
    // did not leave, and that is what holds it back. Without this measure the mutation
    // would be inert: a certificate arriving before the phone's yes is ignored by it, and
    // the result visible in the vault would be the same.
    expect(rele.payloadsDePar.length).toBe(atravessaram)
    expect(vault.contents.deviceCert).toBe("")
    expect(rele.manifestos.get(ana.address)?.version).toBe(1)

    telemovel.recusarSas()
    expect(await falhouTel).toMatchObject({ razao: "palavras-diferentes" })
    expect(await falhouPc).toMatchObject({ razao: "palavras-diferentes" })
    await settle(80)
    expect(vault.contents.deviceCert).toBe("")
    expect(vault.contents.accountPublicKey).toBe("")
    // The manifest stayed as it was: no dead key in it.
    const manifesto = rele.manifestos.get(ana.address)
    expect(manifesto?.version).toBe(1)
    expect(manifesto?.devices.map((d) => d.deviceKey)).toEqual([ana.deviceKey])
  }, 30_000)

  /**
   * The limit of four refuses; it does not expel.
   *
   * With the account full, the fifth pairing would remove from the manifest the oldest
   * device, the computer. Refusal happens BEFORE there is a certificate, which is the
   * only time when refusing costs nothing.
   */
  it("uma conta com quatro aparelhos recusa o quinto emparelhamento, sem assinar nada", async () => {
    const ana = await conta()
    // A full manifest, signed by the account itself: four devices, this session's and
    // three others. This is the state of an account that has already paired everything.
    const outros = [1, 2, 3].map((n) => ed25519.getPublicKey(sha256(Uint8Array.of(0xbb, n))))
    rele.manifestos.set(
      ana.address,
      signDeviceManifest(fromBase64(ana.vault.contents.signingPrivateKey), {
        address: ana.address as never,
        version: 2,
        devices: [
          { deviceKey: fromBase64(ana.deviceKey), addedAt: 1_790_000_000 },
          ...outros.map((deviceKey, indice) => ({ deviceKey, addedAt: 1_790_000_100 + indice })),
        ],
        signedAt: 1_790_000_200,
      }),
    )

    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const telemovel = new Session(vault)
    abertas.push(telemovel)

    const sasPc = esperarFase(ana.session, "sas")
    const { link } = await ana.session.emparelharComoAnfitriao()
    const sasTel = esperarFase(telemovel, "sas")
    telemovel.emparelharComoConvidado(link)
    await Promise.all([sasPc, sasTel])

    const falhouPc = new Promise<PairEvento>((resolve) => ana.session.on("pair", (e) => e.fase === "falhou" && resolve(e)))
    telemovel.confirmarSas()
    await ana.session.confirmarSas()
    expect(await falhouPc).toMatchObject({ razao: "manifesto-cheio" })

    await settle(80)
    // No certificate, and the manifest intact: the four that were there, with the
    // computer still among them.
    expect(vault.contents.deviceCert).toBe("")
    expect(vault.contents.accountPublicKey).toBe("")
    const manifesto = rele.manifestos.get(ana.address)
    expect(manifesto?.version).toBe(2)
    expect(manifesto?.devices).toHaveLength(4)
    expect(manifesto?.devices.map((d) => d.deviceKey)).toContain(ana.deviceKey)
  }, 30_000)
})

/**
 * **Two devices from the same account respond to the same request at the same time** (F2, 20/10/2026).
 *
 * Own sends entered the vault with `seq` -1, and the fold places them right after
 * the last known event. One device's accept and the other's refusal ended up in
 * different orders on each one: the PC read accept→refuse, the phone read
 * refuse→accept, and the same account said "friends" on one and "none" on the other.
 * With the `seq` of the echo, all three sides read the server's order.
 */
describe("o livro com dois aparelhos", () => {
  it("A1 aceita e A2 recusa no mesmo instante: as três dobras dão o mesmo", async () => {
    const ana = await conta("Ana")
    const telemovel = await segundoAparelho(ana)
    await settle(40)
    const bruno = await conta("Bruno")
    const dm = await bruno.session.openDirect(ana.address)
    const fim = Date.now() + 20_000
    while (Date.now() < fim && !(ana.session.channels.includes(dm) && telemovel.session.channels.includes(dm))) await esperar(100)
    expect(telemovel.session.channels).toContain(dm)

    await bruno.session.sendFriendRequest(dm)
    const ate = Date.now() + 10_000
    const recebido = (quem: Conta): boolean => quem.session.friendTies().get(bruno.address)?.link === "pedido-recebido"
    while (Date.now() < ate && !(recebido(ana) && recebido(telemovel))) await esperar(50)
    expect(recebido(ana) && recebido(telemovel)).toBe(true)
    // After resending the last act that the growing direct line schedules (F4).
    await esperar(Session.REENVIO_MS + 500)

    // The place in the feed is not what we measure here, and it is what would make accept slow.
    vi.spyOn(ana.session, "acceptFollower").mockResolvedValue()
    await Promise.allSettled([ana.session.acceptFriend(dm, bruno.address), telemovel.session.declineFriend(dm)])
    // Until all three agree, or the timeout runs out. Without the `seq` of the echo the
    // divergence is permanent: each device keeps its act in front of the other, forever,
    // and waiting does not resolve it.
    const links = async (): Promise<(string | undefined)[]> => {
      await Promise.all([ana, telemovel, bruno].map((quem) => quem.session.flush()))
      return [
        ana.session.friendTies().get(bruno.address)?.link,
        telemovel.session.friendTies().get(bruno.address)?.link,
        bruno.session.friendTies().get(ana.address)?.link,
      ]
    }
    const prazo = Date.now() + 8_000
    let vistos = await links()
    while (Date.now() < prazo && new Set(vistos).size !== 1) {
      await esperar(100)
      vistos = await links()
    }
    const [doPc, doTelemovel, doBruno] = vistos
    expect(doPc).toBeDefined()
    expect(doTelemovel).toBe(doPc)
    expect(doBruno).toBe(doPc)
  }, 60_000)
})

/**
 * **A member who leaves a direct conversation is not seated again by the other device** (I6 of the review).
 *
 * The exit (`member.left`) is honored each time: one device commits the removal, the
 * other sees the direct conversation left with only the account and, not knowing why,
 * invited back the person who had just left. The mark of the exit is now recorded on
 * all devices that heard it, and in the vault.
 */
describe("a saída de uma directa com dois aparelhos do outro lado", () => {
  it("o Carlos sai, e nem o PC nem o telemóvel da Ana o voltam a sentar", async () => {
    const ana = await conta("Ana")
    const telemovel = await segundoAparelho(ana)
    await settle(40)
    const carlos = await conta("Carlos")
    const dm = await carlos.session.openDirect(ana.address)
    const fim = Date.now() + 20_000
    while (Date.now() < fim && !(ana.session.channels.includes(dm) && telemovel.session.channels.includes(dm))) await esperar(100)
    expect(telemovel.session.channels).toContain(dm)
    await esperar(1_500)

    const claimsAntes = rele.claims.get(carlos.address) ?? 0
    // The phone is away when Carlos leaves: it is the PC that honors the exit, and the
    // phone only reads it on recovery. This was the device that, without the mark, saw
    // the direct conversation with only Ana and seated Carlos again when it came online.
    telemovel.session.disconnect()
    await carlos.session.leaveChannel(dm)
    const ate = Date.now() + 15_000
    while (Date.now() < ate && ana.session.membersOf(dm).map(String).includes(carlos.address)) await esperar(100)
    await telemovel.session.connect()
    // Recovery, connection reconciliation, and waiting for `#directaSozinha` (6 s).
    await esperar(9_000)
    for (const quem of [ana, telemovel]) {
      const membros = quem.session.membersOf(dm).map(String)
      expect(membros).not.toContain(carlos.address)
      expect(quem.vault.contents.saidasHonradas?.[`${dm}|${carlos.address}`]).toBeDefined()
    }
    expect(rele.claims.get(carlos.address) ?? 0).toBe(claimsAntes)
    expect(carlos.session.channels).not.toContain(dm)
  }, 60_000)
})

/**
 * End-to-end revocation, with two of Ana's devices and Carlos in the channel.
 *
 * The PC revokes the phone. What we measure: the manifest goes up without it; its
 * leaf leaves the tree of those in there and the PC's stays; the `device.revoke`
 * reaches Carlos and sits in his vault; and when the server serves the OLD manifest
 * again (the rollback it can do for those who did not see the new one), Carlos
 * refuses the phone's packet all the same, because the vault remembers.
 */
describe("revogar um aparelho", () => {
  it("o PC tira o telemóvel: manifesto, folha, aviso, e ninguém o readmite", async () => {
    rele = new Rele(["devices", "keypackage-bundle", "pairing", "device-revocation"])
    const ana = await conta("Ana")
    const anaTelemovel = await segundoAparelho(ana)
    const carlos = await conta("Carlos")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, anaTelemovel.deviceKey].sort())
    const v2 = rele.manifestos.get(ana.address)
    expect(v2?.version).toBe(2)

    // The account's channel, with both leaves: each device comes back online, announces
    // itself in the pool, and the one with the lower key creates it and invites the other.
    const proprio = ana.session.canalDaConta
    for (const quem of [anaTelemovel, ana]) {
      quem.session.disconnect()
      await quem.session.connect()
      await settle(60)
    }
    await ateQue(async () => (await folhasNoCanal(ana, proprio, ana.address)).length === 2, "o canal da conta com as duas folhas da Ana")
    expect((await folhasNoCanal(ana, proprio, ana.address)).sort()).toEqual([ana.deviceKey, anaTelemovel.deviceKey].sort())

    await ana.session.revokeDevice(anaTelemovel.deviceKey)
    await settle(120)

    // I1: the phone's leaf also left the account's channel, which is not in the interface
    // list (`channels`) but is in the groups.
    expect(await folhasNoCanal(ana, proprio, ana.address)).toEqual([ana.deviceKey])

    // The next manifest, without the phone.
    const v3 = rele.manifestos.get(ana.address)
    expect(v3?.version).toBe(3)
    expect(v3?.devices.map((d) => d.deviceKey)).toEqual([ana.deviceKey])
    // The phone's leaf left Carlos's tree; the PC's stayed.
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(await folhasDe(ana, ana.address)).toEqual([ana.deviceKey])
    // The notice arrived and verified: it is in Carlos's vault and in Ana's.
    const doCarlos = (carlos.vault.contents as { revokedDevices?: Record<string, string[]> }).revokedDevices
    expect(doCarlos?.[ana.address]).toEqual([anaTelemovel.deviceKey])
    const daAna = (ana.vault.contents as { revokedDevices?: Record<string, string[]> }).revokedDevices
    expect(daAna?.[ana.address]).toEqual([anaTelemovel.deviceKey])
    expect(carlos.avisos).not.toContain("device-revoke-invalid")

    // The server rolls back to v2 and puts a phone packet in the pool. Carlos, who
    // never saw v3, would accept v2; it is the vault that refuses.
    rele.manifestos.set(ana.address, v2 as DeviceManifestWire)
    const [pacote] = await generateKeyPackages(anaTelemovel.session.identity, 1)
    rele.pool(ana.address, anaTelemovel.deviceKey).push(toBase64(pacote?.wire as Uint8Array))
    // Seat repair sees the phone missing in v2 and requests it.
    await expect(carlos.session.seat(CANAL, ana.address)).rejects.toThrow("no invite key verifies")
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(carlos.avisos).toContain("keypackage-invalid")
  }, 90_000)

  it("a porta do link também recusa: um pedido de entrada do aparelho revogado não é admitido", async () => {
    rele = new Rele(["devices", "keypackage-bundle", "pairing", "device-revocation"])
    const ana = await conta("Ana")
    const anaTelemovel = await segundoAparelho(ana)
    const carlos = await conta("Carlos")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    await ana.session.revokeDevice(anaTelemovel.deviceKey)
    await settle(120)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])

    // An invite minted by Carlos, and the phone (which still has the account key and a
    // valid chain) requesting entry with it. The server for real would refuse it at
    // login already; here we prove the client gate.
    const codeHash = "Y29kaWdvLWRvLWNvbnZpdGU"
    await carlos.vault.update((contents) => {
      contents.mintedInvites[codeHash] = { channel: CANAL, createdAt: Date.now() }
    })
    const [pacote] = await generateKeyPackages(anaTelemovel.session.identity, 1)
    for (const ligacao of rele.ligacoes) {
      if (ligacao.address !== carlos.address) continue
      ligacao.entregar({
        t: "invite.request",
        channel: CANAL,
        address: ana.address,
        keyPackage: toBase64(pacote?.wire as Uint8Array),
        codeHash,
      })
    }
    await settle(120)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    expect(carlos.avisos).toContain("device-not-in-account")
  }, 90_000)

  it("um aparelho emparelhado há pouco entra pelo link, mesmo com o manifesto velho na memória curta (M3)", async () => {
    const ana = await conta("Ana")
    const carlos = await conta("Carlos")
    await carlos.session.createSpaceChannel(CANAL)
    await settle(20)
    // Carlos reads Ana's manifest (v1, PC only) when seating her, and remembers it.
    await carlos.session.seat(CANAL, ana.address)
    await settle(120)
    expect(await folhasDe(carlos, ana.address)).toEqual([ana.deviceKey])
    const leiturasAntes = rele.leituras.get(ana.address) ?? 0

    // Ana gets a device: the manifest on the server becomes v2.
    const novo = await segundoAparelho(ana)
    const fim = Date.now() + 15_000
    while (Date.now() < fim && (rele.manifestos.get(ana.address)?.devices.length ?? 0) < 2) await esperar(50)

    const codeHash = "Y29kaWdvLWRvLWNvbnZpdGUtbTM"
    await carlos.vault.update((contents) => {
      contents.mintedInvites[codeHash] = { channel: CANAL, createdAt: Date.now() }
    })
    const [pacote] = await generateKeyPackages(novo.session.identity, 1)
    for (const ligacao of rele.ligacoes) {
      if (ligacao.address !== carlos.address) continue
      ligacao.entregar({ t: "invite.request", channel: CANAL, address: ana.address, keyPackage: toBase64(pacote?.wire as Uint8Array), codeHash })
    }
    const prazo = Date.now() + 15_000
    while (Date.now() < prazo && (await folhasDe(carlos, ana.address)).length < 2) await esperar(50)
    expect((await folhasDe(carlos, ana.address)).sort()).toEqual([ana.deviceKey, novo.deviceKey].sort())
    expect(carlos.avisos).not.toContain("device-not-in-account")
    // Read the manifest again, instead of refusing by what was remembered.
    expect(rele.leituras.get(ana.address) ?? 0).toBeGreaterThan(leiturasAntes)
  }, 60_000)

  it("as recusas antes de qualquer escrita: o próprio, e um servidor sem a capacidade", async () => {
    const ana = await conta("Ana")
    const anaTelemovel = await segundoAparelho(ana)
    // The default relay does not announce `device-revocation`.
    await expect(ana.session.revokeDevice(anaTelemovel.deviceKey)).rejects.toThrow("device-revoke-unsupported")
    expect(rele.manifestos.get(ana.address)?.version).toBe(2)
    rele = new Rele(["devices", "keypackage-bundle", "pairing", "device-revocation"])
    const bento = await conta("Bento")
    await expect(bento.session.revokeDevice(bento.deviceKey)).rejects.toThrow("device-revoke-self")
  }, 60_000)

  it("o servidor diz device-revoked: a sessão desliga e não volta a tentar", async () => {
    const ana = await conta("Ana")
    const estados: string[] = []
    ana.session.on("connection", (evento) => estados.push(evento.state))
    for (const ligacao of rele.ligacoes) {
      if (ligacao.address === ana.address) {
        ligacao.entregar({ t: "error", code: "device-revoked", message: "this device was removed from the account", fatal: true })
      }
    }
    await settle(40)
    expect(ana.avisos).toContain("device-revoked")
    expect(estados.at(-1)).toBe("offline")
    await esperar(1_500)
    expect(estados).not.toContain("reconnecting")
  }, 30_000)
})
