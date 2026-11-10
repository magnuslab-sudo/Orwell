import {
  deviceManifestMessage,
  generateIdentity,
  parseServerName,
  signDeviceManifest,
  temChaveDeConta,
  toBase64,
  verifyDeviceManifest,
  VERSAO_MAXIMA,
  type DeviceManifestWire,
  type Identity,
} from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Session } from "./session.js"
import { deviceManifestSeen, Vault, type VaultBackend } from "./vault.js"

/** The vault the session carries inside. `vault` is private in production; the test peers at it on purpose. */
const cofreDe = (session: Session): Vault => (session as unknown as { vault: Vault }).vault

/** The account key of a freshly created identity. Fails hard if it doesn't have one. */
function chaveDeConta(identity: Identity): Uint8Array {
  if (!temChaveDeConta(identity)) throw new Error("esta identidade não tem a chave de conta")
  return identity.signingPrivateKey
}

/**
 * The device manifest, client side.
 *
 * Two things, and neither admits anyone yet: when connecting to a server that
 * announces `devices`, an account without a manifest publishes v1 with its own
 * device, signed by the account key; and when reading someone's manifest, one that
 * drops below the version already seen is rejected. The second is the only defense
 * against what the server CAN do, which is serve an old manifest, and that's why
 * it's here with the fake server doing it on purpose.
 */

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = false
  /** How many times the vault was written: each write reencrypts the whole vault. */
  writes = 0
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.writes += 1
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

interface Sent {
  t: string
  [key: string]: unknown
}

type Reply = (frame: Sent) => unknown[] | undefined

class FakeSocket {
  static last: FakeSocket | null = null
  static reply: Reply = () => undefined

  readyState = 0
  readonly sent: Sent[] = []
  readonly #listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.last = this
    setTimeout(() => {
      this.readyState = 1
      this.fire("open", {})
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
    const frame = JSON.parse(raw) as Sent
    this.sent.push(frame)
    const replies = FakeSocket.reply(frame)
    for (const reply of replies ?? []) {
      setTimeout(() => this.fire("message", { data: JSON.stringify(reply) }), 0)
    }
  }

  close(): void {
    this.readyState = 3
    this.fire("close", {})
  }

  fire(kind: string, event: unknown): void {
    for (const handler of [...(this.#listeners.get(kind) ?? [])]) handler(event)
  }
}

/**
 * A fake server with a real manifest table: it stores what they publish if the
 * version goes up, and serves what it has. That's enough for the client to not
 * tell it apart from the real one.
 */
class ServidorFalso {
  readonly manifestos = new Map<string, DeviceManifestWire>()
  readonly retentionDays: number | undefined
  constructor(readonly capabilities: string[], retentionDays?: number | undefined) {
    // `undefined` explicitly means "a server that doesn't say", not the default value.
    this.retentionDays = arguments.length >= 2 ? retentionDays : 30
  }

  responder: Reply = (frame) => {
    if (frame.t === "hello") {
      return [{ t: "hello.ok", version: 1, capabilities: this.capabilities, ...(this.retentionDays !== undefined ? { retentionDays: this.retentionDays } : {}) }]
    }
    if (frame.t === "auth.begin") return [{ t: "auth.challenge", nonce: "AAAA" }]
    if (frame.t === "auth.finish") return [{ t: "auth.ok", address: "@x:localhost" }]
    if (frame.t === "manifest.get") {
      const address = frame.address as string
      return [{ t: "manifest.result", address, manifest: this.manifestos.get(address) ?? null }]
    }
    if (frame.t === "manifest.publish") {
      const manifesto = frame.manifest as DeviceManifestWire
      const atual = this.manifestos.get(manifesto.address)
      if (atual !== undefined && manifesto.version <= atual.version) {
        return [{ t: "manifest.published", address: manifesto.address, version: manifesto.version, ok: false, reason: "stale-version" }]
      }
      this.manifestos.set(manifesto.address, manifesto)
      return [{ t: "manifest.published", address: manifesto.address, version: manifesto.version, ok: true }]
    }
    return undefined
  }
}

const abertas: Session[] = []

async function sessaoLigada(servidor: ServidorFalso, backend = new MemoryBackend()): Promise<Session> {
  const vault = new Vault(backend)
  await vault.create("frase-passe")
  const session = new Session(vault)
  await session.createIdentity("localhost:8448")
  FakeSocket.reply = servidor.responder
  await session.connect()
  await settle()
  abertas.push(session)
  return session
}

/**
 * What is ON DISK, not in the live object.
 *
 * All tests of the first version asserted on `cofreDe(session).contents`, and
 * passed with an anchor that never hit disk: it wrote to memory and `flush()`
 * returned without saving because no channel was dirty. Reopening the vault from
 * the bytes is the only assertion that counts.
 */
async function reaberto(backend: MemoryBackend): Promise<Vault> {
  const vault = new Vault(backend)
  await vault.unlock("frase-passe")
  return vault
}

async function settle(times = 60): Promise<void> {
  for (let index = 0; index < times; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function enviados(kind: string): Sent[] {
  return (FakeSocket.last?.sent ?? []).filter((frame) => frame.t === kind)
}

beforeEach(() => {
  FakeSocket.last = null
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket
})

afterEach(() => {
  for (const sessao of abertas.splice(0)) {
    try {
      sessao.disconnect()
    } catch {
      // A session that never connected has nothing to disconnect.
    }
  }
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket
})

describe("ao ligar", () => {
  it("contra um servidor que anuncia devices e não tem manifesto, publica o v1 com o próprio aparelho", async () => {
    const servidor = new ServidorFalso(["devices"])
    const session = await sessaoLigada(servidor)

    expect(enviados("manifest.get").map((f) => f.address)).toEqual([session.identity.address])
    const publicados = enviados("manifest.publish")
    expect(publicados).toHaveLength(1)

    const wire = publicados[0]?.manifest as DeviceManifestWire
    const verificado = verifyDeviceManifest(wire)
    expect(verificado.ok).toBe(true)
    if (!verificado.ok) return
    expect(verificado.manifest.address).toBe(session.identity.address)
    expect(verificado.manifest.version).toBe(1)
    expect(verificado.manifest.accountKey).toEqual(session.identity.signingPublicKey)
    expect(verificado.manifest.devices.map((d) => d.deviceKey)).toEqual([session.identity.deviceSigningPublicKey])

    // The server stored it, and the vault remembers the published version.
    expect(servidor.manifestos.get(session.identity.address)).toEqual(wire)
    expect(cofreDe(session).contents.deviceManifests[session.identity.address]).toBe(1)
  })

  it("contra um servidor que não anuncia devices, não manda manifest.get nem manifest.publish", async () => {
    const session = await sessaoLigada(new ServidorFalso(["presence", "commit-per-epoch"]))
    expect(enviados("manifest.get")).toHaveLength(0)
    expect(enviados("manifest.publish")).toHaveLength(0)
    expect(session.suportaAparelhos).toBe(false)
    expect(cofreDe(session).contents.deviceManifests).toEqual({})
  })

  it("quem já tem manifesto não republica, e guarda a versão vista", async () => {
    const servidor = new ServidorFalso(["devices"])
    // A v3 manifest published by "another device" of this account, earlier.
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    servidor.manifestos.set(
      identity.address,
      signDeviceManifest(chaveDeConta(identity), {
        address: identity.address,
        version: 3,
        devices: [{ deviceKey: identity.deviceSigningPublicKey, addedAt: 1 }],
        signedAt: 1,
      }),
    )
    FakeSocket.reply = servidor.responder
    await session.connect()
    await settle()
    abertas.push(session)

    expect(enviados("manifest.publish")).toHaveLength(0)
    expect(cofreDe(session).contents.deviceManifests[identity.address]).toBe(3)
  })

  /**
   * The account manifest exists and doesn't list this device: add it.
   *
   * Since bundle claims exist, the manifest decides who joins; a device outside
   * it is uninvitable. Publish what was there plus this one, not this one alone,
   * so two vaults of the same account don't wipe each other at each connect. See
   * `#garantirManifesto`.
   */
  it("quem tem manifesto e não está nele acrescenta-se, com a versão a subir e os outros a ficar", async () => {
    const servidor = new ServidorFalso(["devices"])
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    const outroAparelho = ed25519.getPublicKey(ed25519.utils.randomSecretKey())
    servidor.manifestos.set(
      identity.address,
      signDeviceManifest(chaveDeConta(identity), {
        address: identity.address,
        version: 3,
        devices: [{ deviceKey: outroAparelho, addedAt: 1 }],
        signedAt: 1,
      }),
    )
    FakeSocket.reply = servidor.responder
    await session.connect()
    await settle()
    abertas.push(session)

    const publicados = enviados("manifest.publish")
    expect(publicados).toHaveLength(1)
    const verificado = verifyDeviceManifest(publicados[0]?.manifest)
    expect(verificado.ok).toBe(true)
    if (!verificado.ok) return
    expect(verificado.manifest.version).toBe(4)
    expect(verificado.manifest.devices.map((d) => toBase64(d.deviceKey))).toEqual([
      toBase64(outroAparelho),
      toBase64(identity.deviceSigningPublicKey),
    ])
    expect(servidor.manifestos.get(identity.address)?.version).toBe(4)
    expect(cofreDe(session).contents.deviceManifests[identity.address]).toBe(4)
  })

  /**
   * Until revocation, adding to a full manifest would drop the oldest. Since
   * revocation, the server treats what leaves the manifest as revoked and locks it
   * out of the account forever: automatic removal became a revocation nobody asked
   * for. On a full account, don't add; making room means revoking one, on purpose.
   */
  it("num manifesto cheio, não se acrescenta: nada publicado, e o diário diz manifest-full", async () => {
    const servidor = new ServidorFalso(["devices"])
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    const antigos = [40, 10, 30, 20].map((addedAt) => ({ deviceKey: ed25519.getPublicKey(ed25519.utils.randomSecretKey()), addedAt }))
    servidor.manifestos.set(
      identity.address,
      signDeviceManifest(chaveDeConta(identity), { address: identity.address, version: 7, devices: antigos, signedAt: 1 }),
    )
    const codigos: string[] = []
    session.on("status", (evento) => {
      if (evento.code) codigos.push(evento.code)
    })
    FakeSocket.reply = servidor.responder
    await session.connect()
    await settle()
    abertas.push(session)

    expect(enviados("manifest.publish")).toHaveLength(0)
    expect(servidor.manifestos.get(identity.address)?.version).toBe(7)
    expect(codigos).toContain("manifest-full")
  })

  it("um aparelho que o cofre sabe revogado não se volta a pôr no manifesto", async () => {
    const servidor = new ServidorFalso(["devices"])
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    const outro = ed25519.getPublicKey(ed25519.utils.randomSecretKey())
    servidor.manifestos.set(
      identity.address,
      signDeviceManifest(chaveDeConta(identity), {
        address: identity.address,
        version: 3,
        devices: [{ deviceKey: outro, addedAt: 1 }],
        signedAt: 1,
      }),
    )
    await vault.update((contents) => {
      ;(contents as { revokedDevices?: Record<string, string[]> }).revokedDevices = {
        [identity.address]: [toBase64(identity.deviceSigningPublicKey)],
      }
    })
    FakeSocket.reply = servidor.responder
    await session.connect()
    await settle()
    abertas.push(session)

    expect(enviados("manifest.publish")).toHaveLength(0)
    expect(servidor.manifestos.get(identity.address)?.version).toBe(3)
  })

  /**
   * "Didn't read" is not "doesn't exist". `#garantirManifesto` publishes the next
   * version signed by the account, and the server accepts it for being higher: if
   * silence or a crossed reply counted as "no manifest", this device would publish
   * ALONE over a manifest with others, and the others would fall out of all
   * following invites. Without a read, nothing publishes.
   */
  it("com o servidor calado no manifest.get da própria conta, NÃO publica nada", async () => {
    const servidor = new ServidorFalso(["devices"])
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    // There's a manifest with ANOTHER device on the server; the server goes quiet when
    // asked (the bucket overflowed).
    const outroAparelho = ed25519.getPublicKey(ed25519.utils.randomSecretKey())
    servidor.manifestos.set(
      identity.address,
      signDeviceManifest(chaveDeConta(identity), { address: identity.address, version: 2, devices: [{ deviceKey: outroAparelho, addedAt: 1 }], signedAt: 1 }),
    )
    const responder = servidor.responder
    FakeSocket.reply = (frame) => (frame.t === "manifest.get" ? [] : responder(frame))
    await session.connect()
    await new Promise((resolve) => setTimeout(resolve, 10_500))
    abertas.push(session)

    expect(enviados("manifest.get")).toHaveLength(1)
    expect(enviados("manifest.publish")).toHaveLength(0)
    expect(servidor.manifestos.get(identity.address)?.version).toBe(2)
  }, 20_000)

  it("com a resposta trocada (outro endereço), NÃO publica nada", async () => {
    const servidor = new ServidorFalso(["devices"])
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    const outroAparelho = ed25519.getPublicKey(ed25519.utils.randomSecretKey())
    servidor.manifestos.set(
      identity.address,
      signDeviceManifest(chaveDeConta(identity), { address: identity.address, version: 2, devices: [{ deviceKey: outroAparelho, addedAt: 1 }], signedAt: 1 }),
    )
    const responder = servidor.responder
    // Responds to manifest.get with the result from a DIFFERENT account, without a manifest.
    FakeSocket.reply = (frame) => (frame.t === "manifest.get" ? [{ t: "manifest.result", address: "@outra:localhost:8448", manifest: null }] : responder(frame))
    await session.connect()
    await new Promise((resolve) => setTimeout(resolve, 10_500))
    abertas.push(session)

    expect(enviados("manifest.publish")).toHaveLength(0)
    expect(servidor.manifestos.get(identity.address)?.version).toBe(2)
  }, 20_000)

  it("com um manifesto que não presta na resposta (assinatura partida), NÃO publica nada", async () => {
    const servidor = new ServidorFalso(["devices"])
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    const outroAparelho = ed25519.getPublicKey(ed25519.utils.randomSecretKey())
    const bom = signDeviceManifest(chaveDeConta(identity), { address: identity.address, version: 2, devices: [{ deviceKey: outroAparelho, addedAt: 1 }], signedAt: 1 })
    servidor.manifestos.set(identity.address, { ...bom, version: 3 })
    FakeSocket.reply = servidor.responder
    await session.connect()
    await settle()
    abertas.push(session)

    expect(enviados("manifest.publish")).toHaveLength(0)
  })

  it("com `manifest: null` de verdade, publica o v1 (a leitura foi feita)", async () => {
    // The twin of the first test in this file, told from the other side: the
    // difference between this and the server staying silent is one response.
    const servidor = new ServidorFalso(["devices"])
    const session = await sessaoLigada(servidor)
    expect(enviados("manifest.publish")).toHaveLength(1)
    expect(servidor.manifestos.get(session.identity.address)?.version).toBe(1)
  })

  it("lê os dias de retenção do hello.ok, e a ausência é undefined", async () => {
    const com = await sessaoLigada(new ServidorFalso(["devices"], 7))
    expect(com.serverRetentionDays).toBe(7)
    const sem = await sessaoLigada(new ServidorFalso([], undefined))
    expect(sem.serverRetentionDays).toBeUndefined()
  })
})

describe("ler o manifesto de alguém", () => {
  const OUTRA = generateIdentity(parseServerName("localhost:8448"))
  const manifestoDaOutra = (version: number) =>
    signDeviceManifest(OUTRA.signingPrivateKey, {
      address: OUTRA.address,
      version,
      devices: [{ deviceKey: OUTRA.deviceSigningPublicKey, addedAt: 0 }],
      signedAt: version,
    })

  it("devolve-o verificado, e guarda a versão vista", async () => {
    const servidor = new ServidorFalso(["devices"])
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(2))
    const session = await sessaoLigada(servidor)

    const lido = await session.deviceManifestOf(OUTRA.address)
    expect(lido?.version).toBe(2)
    expect(lido?.accountKey).toEqual(OUTRA.signingPublicKey)
    expect(cofreDe(session).contents.deviceManifests[OUTRA.address]).toBe(2)
  })

  it("null para quem nunca publicou, e nada fica no cofre", async () => {
    const session = await sessaoLigada(new ServidorFalso(["devices"]))
    expect(await session.deviceManifestOf(OUTRA.address)).toBeNull()
    expect(cofreDe(session).contents.deviceManifests[OUTRA.address]).toBeUndefined()
  })

  it("um manifesto que recua é recusado, e a versão vista fica onde estava", async () => {
    const servidor = new ServidorFalso(["devices"])
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(5))
    const session = await sessaoLigada(servidor)
    const avisos: string[] = []
    session.on("status", (e) => {
      if (e.code) avisos.push(e.code)
    })
    expect((await session.deviceManifestOf(OUTRA.address))?.version).toBe(5)

    // The server "forgets" v5 and serves v4: properly signed, but stale.
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(4))
    expect(await session.deviceManifestOf(OUTRA.address)).toBeNull()
    expect(avisos).toContain("manifest-rollback")
    expect(cofreDe(session).contents.deviceManifests[OUTRA.address]).toBe(5)

    // The same version again is not a rollback: it is the same manifest.
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(5))
    expect((await session.deviceManifestOf(OUTRA.address))?.version).toBe(5)
  })

  it("um manifesto que o servidor forjou é recusado", async () => {
    const servidor = new ServidorFalso(["devices"])
    const bom = manifestoDaOutra(1)
    servidor.manifestos.set(OUTRA.address, { ...bom, version: 2 })
    const session = await sessaoLigada(servidor)
    const avisos: string[] = []
    session.on("status", (e) => {
      if (e.code) avisos.push(e.code)
    })

    expect(await session.deviceManifestOf(OUTRA.address)).toBeNull()
    expect(avisos).toContain("manifest-invalid")
    expect(cofreDe(session).contents.deviceManifests[OUTRA.address]).toBeUndefined()
  })

  it("um manifesto de outra conta servido para este endereço é recusado", async () => {
    const servidor = new ServidorFalso(["devices"])
    const terceira = generateIdentity(parseServerName("localhost:8448"))
    servidor.manifestos.set(
      OUTRA.address,
      signDeviceManifest(terceira.signingPrivateKey, {
        address: terceira.address,
        version: 1,
        devices: [{ deviceKey: terceira.deviceSigningPublicKey, addedAt: 0 }],
        signedAt: 0,
      }),
    )
    const session = await sessaoLigada(servidor)
    expect(await session.deviceManifestOf(OUTRA.address)).toBeNull()
  })

  /**
   * Two reads in flight, one discarded by the bucket: the response that comes is from
   * the OTHER, and matches by address. Without the tag, the response from the second
   * would wait for the first, which would see it from a different address and return
   * null, and the second would time out with the right response already in hand.
   */
  it("duas leituras concorrentes com uma descartada pelo balde não trocam respostas", async () => {
    const servidor = new ServidorFalso(["devices"])
    const TERCEIRA = generateIdentity(parseServerName("localhost:8448"))
    servidor.manifestos.set(TERCEIRA.address, signDeviceManifest(TERCEIRA.signingPrivateKey, { address: TERCEIRA.address, version: 4, devices: [{ deviceKey: TERCEIRA.deviceSigningPublicKey, addedAt: 0 }], signedAt: 4 }))
    const session = await sessaoLigada(servidor)
    // AFTER connecting: `sessaoLigada` restores `FakeSocket.reply`. The bucket
    // "discards" the question about OTHER; it answers the one about THIRD.
    const responder = servidor.responder
    FakeSocket.reply = (frame) => (frame.t === "manifest.get" && frame.address === OUTRA.address ? [] : responder(frame))

    const primeira = session.deviceManifestOf(OUTRA.address)
    const segunda = session.deviceManifestOf(TERCEIRA.address)
    expect((await segunda)?.version).toBe(4)
    expect(cofreDe(session).contents.deviceManifests[TERCEIRA.address]).toBe(4)
    expect(cofreDe(session).contents.deviceManifests[OUTRA.address]).toBeUndefined()
    await expect(primeira).resolves.toBeNull()
  }, 20_000)

  it("contra um servidor sem a capacidade, devolve null sem perguntar", async () => {
    const session = await sessaoLigada(new ServidorFalso([]))
    expect(await session.deviceManifestOf(OUTRA.address)).toBeNull()
    expect(enviados("manifest.get")).toHaveLength(0)
  })
})

describe("a âncora chega ao disco", () => {
  const OUTRA = generateIdentity(parseServerName("localhost:8448"))
  const manifestoDaOutra = (version: number) =>
    signDeviceManifest(OUTRA.signingPrivateKey, {
      address: OUTRA.address,
      version,
      devices: [{ deviceKey: OUTRA.deviceSigningPublicKey, addedAt: 0 }],
      signedAt: version,
    })

  it("a versão publicada da própria conta sobrevive a reabrir o cofre", async () => {
    const backend = new MemoryBackend()
    const session = await sessaoLigada(new ServidorFalso(["devices"]), backend)
    expect(deviceManifestSeen((await reaberto(backend)).contents, session.identity.address)).toBe(1)
  }, 30_000)

  it("a versão vista de outra conta sobrevive a reabrir o cofre, e o recuo continua recusado depois", async () => {
    const backend = new MemoryBackend()
    const servidor = new ServidorFalso(["devices"])
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(4))
    const session = await sessaoLigada(servidor, backend)
    expect((await session.deviceManifestOf(OUTRA.address))?.version).toBe(4)
    expect(deviceManifestSeen((await reaberto(backend)).contents, OUTRA.address)).toBe(4)

    // A NEW session on the same vault, against a server serving v3.
    session.disconnect()
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(3))
    const cofre = await reaberto(backend)
    const outra = new Session(cofre)
    outra.loadIdentity()
    FakeSocket.reply = servidor.responder
    await outra.connect()
    await settle()
    abertas.push(outra)
    expect(await outra.deviceManifestOf(OUTRA.address)).toBeNull()
  }, 30_000)

  it("a mesma versão outra vez não reescreve o cofre", async () => {
    const backend = new MemoryBackend()
    const servidor = new ServidorFalso(["devices"])
    servidor.manifestos.set(OUTRA.address, manifestoDaOutra(2))
    const session = await sessaoLigada(servidor, backend)
    await session.deviceManifestOf(OUTRA.address)
    const escritas = backend.writes
    await session.deviceManifestOf(OUTRA.address)
    await session.deviceManifestOf(OUTRA.address)
    expect(backend.writes).toBe(escritas)
  })
})

describe("a versão que se publica", () => {
  it("com âncora própria em 2 e o servidor sem linha, publica a v3, e o servidor aceita", async () => {
    const backend = new MemoryBackend()
    const vault = new Vault(backend)
    await vault.create("frase-passe")
    const session = new Session(vault)
    const identity = await session.createIdentity("localhost:8448")
    // The server lost the line (or another device published v2 and this one saw it).
    await vault.update((c) => {
      c.deviceManifests[identity.address] = 2
    })
    const servidor = new ServidorFalso(["devices"])
    FakeSocket.reply = servidor.responder
    await session.connect()
    await settle()
    abertas.push(session)

    const publicados = enviados("manifest.publish")
    expect(publicados).toHaveLength(1)
    expect((publicados[0]?.manifest as DeviceManifestWire).version).toBe(3)
    expect(servidor.manifestos.get(identity.address)?.version).toBe(3)
    expect(deviceManifestSeen((await reaberto(backend)).contents, identity.address)).toBe(3)
  }, 30_000)
})

describe("o que o servidor não pode servir", () => {
  const OUTRA = generateIdentity(parseServerName("localhost:8448"))

  it("um manifesto com versão acima do tecto é recusado pela forma, e não fica no cofre", async () => {
    // Signed by hand, because `signDeviceManifest` refuses to produce it.
    const unsigned = {
      address: OUTRA.address,
      version: VERSAO_MAXIMA + 1,
      devices: [{ deviceKey: toBase64(OUTRA.deviceSigningPublicKey), addedAt: 0 }],
      signedAt: 0,
    }
    const forjado = {
      ...unsigned,
      accountKey: toBase64(OUTRA.signingPublicKey),
      signature: toBase64(ed25519.sign(deviceManifestMessage(unsigned), OUTRA.signingPrivateKey)),
    }
    const servidor = new ServidorFalso(["devices"])
    servidor.manifestos.set(OUTRA.address, forjado as DeviceManifestWire)
    const session = await sessaoLigada(servidor)
    const avisos: string[] = []
    session.on("status", (e) => {
      if (e.code) avisos.push(e.code)
    })
    expect(await session.deviceManifestOf(OUTRA.address)).toBeNull()
    expect(avisos).toContain("manifest-invalid")
    expect(deviceManifestSeen(cofreDe(session).contents, OUTRA.address)).toBeUndefined()
  })

  it("um servidor que se cala (o balde estourou) dá null em vez de uma excepção", async () => {
    const servidor = new ServidorFalso(["devices"])
    const mudo = servidor.responder
    servidor.responder = (frame) => (frame.t === "manifest.get" && frame.address === OUTRA.address ? [] : mudo(frame))
    const session = await sessaoLigada(servidor)
    await expect(session.deviceManifestOf(OUTRA.address)).resolves.toBeNull()
  }, 20_000)
})
