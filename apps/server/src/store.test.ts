import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ed25519 } from "@noble/curves/ed25519.js"
import { sha256 } from "@noble/hashes/sha2.js"
import { deviceManifestMessage, generateIdentity, parseServerName, signDeviceManifest, toBase64, VERSAO_MAXIMA } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { openDatabase } from "./db.js"
import { Store } from "./store.js"

/**
 * The arbitration of who creates a channel, and the record that a channel had life.
 *
 * The two things the server keeps about the common room, and the two that nobody
 * can manually reset if they go wrong: the claim is the only thing that decides
 * who creates the group, and the activity mark is the only thing that tells a
 * silent private room from a brand new room.
 */

let dataDir: string
let store: Store
let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "enclave-store-"))
  db = openDatabase(join(dataDir, "test.sqlite"))
  store = new Store(db)
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const CANAL = "!orwell:localhost:8448"

describe("claimChannel", () => {
  it("o primeiro a pedir ganha, e quem chega a seguir recebe o nome dele", () => {
    expect(store.claimChannel(CANAL, "@ana:localhost")).toBe("@ana:localhost")
    expect(store.claimChannel(CANAL, "@bento:localhost")).toBe("@ana:localhost")
  })

  it("uma reclamação que ninguém honrou caduca, e a sala deixa de estar morta", () => {
    // The server cannot create the group or join it, so it has no way to know
    // whether the claim was honored. While it was final, it took only the winner
    // closing the app between the request and creation for the identifier to stay
    // claimed and empty: everyone who arrived next got `mine: false`, asked to join
    // a group that does not exist, and the server's common room became unreachable
    // forever, with no error anywhere.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T03:00:00Z"))
    expect(store.claimChannel(CANAL, "@ana:localhost")).toBe("@ana:localhost")

    vi.setSystemTime(new Date("2026-08-06T03:01:00Z"))
    expect(store.claimChannel(CANAL, "@bento:localhost")).toBe("@ana:localhost")

    vi.setSystemTime(new Date("2026-08-06T03:05:00Z"))
    expect(store.claimChannel(CANAL, "@bento:localhost")).toBe("@bento:localhost")
  })

  it("não caduca depois de a sala existir, por muito tempo que passe", () => {
    // Honored: there was a message inside. From here on, swapping the owner would
    // mean creating a SECOND group with the same identifier, which is the collision
    // this arbitration exists to prevent.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T03:00:00Z"))
    expect(store.claimChannel(CANAL, "@ana:localhost")).toBe("@ana:localhost")
    store.appendEvent({ channel: CANAL, kind: "application", ciphertext: new Uint8Array([1, 2, 3]) }, { refundavel: false })

    vi.setSystemTime(new Date("2026-08-07T03:00:00Z"))
    expect(store.claimChannel(CANAL, "@bento:localhost")).toBe("@ana:localhost")
  })
})

/**
 * Sweep claims that no longer decide anything.
 *
 * The table was never cleaned, and grew faster once the tolerance of an unstarted
 * channel consults claims: one row for each identifier someone has ever claimed,
 * forever.
 */
describe("expireChannelClaims", () => {
  it("apaga a reclamação abandonada, e não muda quem ganharia a seguir", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T03:00:00Z"))
    store.claimChannel(CANAL, "@ana:localhost")
    expect(store.claimantOf(CANAL)).toBe("@ana:localhost")

    // Within the grace period do not touch: Ana may still be creating the room.
    vi.setSystemTime(new Date("2026-08-06T03:01:00Z"))
    expect(store.expireChannelClaims()).toBe(0)
    expect(store.claimantOf(CANAL)).toBe("@ana:localhost")

    vi.setSystemTime(new Date("2026-08-06T03:05:00Z"))
    expect(store.expireChannelClaims()).toBe(1)
    expect(store.claimantOf(CANAL)).toBeUndefined()

    // Inert, and that makes it safe: without the row, the next to request wins
    //, exactly what they would win with it there, for having expired.
    expect(store.claimChannel(CANAL, "@bento:localhost")).toBe("@bento:localhost")
  })

  it("não toca na reclamação de um canal que já foi estreado", () => {
    // After the room exists, the claim stops expiring and is what prevents a
    // second MLS group with the same identifier. Sweeping it would reopen that
    // collision through the back door.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T03:00:00Z"))
    store.claimChannel(CANAL, "@ana:localhost")
    store.appendEvent({ channel: CANAL, kind: "application", ciphertext: new Uint8Array([1]) }, { refundavel: false })

    vi.setSystemTime(new Date("2026-09-06T03:00:00Z"))
    expect(store.expireChannelClaims()).toBe(0)
    expect(store.claimantOf(CANAL)).toBe("@ana:localhost")
  })

  it("também não a apaga quando a retenção já levou os eventos", () => {
    // The activity mark survives intentional retention, and it is what tells a
    // silent room from a room about to be born. The sweep must respect it, or it
    // sends a dormant channel the look of a brand new channel.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T03:00:00Z"))
    store.claimChannel(CANAL, "@ana:localhost")
    store.appendEvent({ channel: CANAL, kind: "application", ciphertext: new Uint8Array([1]) }, { refundavel: false })
    store.expireEvents(0)

    vi.setSystemTime(new Date("2026-09-06T03:00:00Z"))
    expect(store.expireChannelClaims()).toBe(0)
    expect(store.claimantOf(CANAL)).toBe("@ana:localhost")
  })
})

describe("channelNeverUsed", () => {
  it("é verdade para um canal que ninguém tocou, e falso assim que alguém fala", () => {
    expect(store.channelNeverUsed(CANAL)).toBe(true)
    store.appendEvent({ channel: CANAL, kind: "application", ciphertext: new Uint8Array([1]) }, { refundavel: false })
    expect(store.channelNeverUsed(CANAL)).toBe(false)
  })

  it("continua falso depois de a retenção apagar tudo o que lá estava", () => {
    // Thirty days of silence in a private room and the event table goes empty.
    // Just from being empty, the room would look brand new again and the gateway
    // would reopen it to any account in the world, a handful of junk frames for
    // each member to go deaf and the history to be lost to future secrecy.
    store.appendEvent({ channel: CANAL, kind: "application", ciphertext: new Uint8Array([1]) }, { refundavel: false })
    expect(store.expireEvents(0)).toBeGreaterThan(0)
    expect(store.channelNeverUsed(CANAL)).toBe(false)
  })
})

/**
 * A legitimate invite cannot be deleted by another one that arrives later.
 *
 * `pendingWelcomes` returned only the welcome with `MAX(seq)` per channel and
 * recipient. A second welcome to the same person, from a member trying to deny
 * entry, or from a client with a bug, buried the first, and the victim never
 * got an invite without anyone noticing: the invite was sent, the server accepted
 * it, and it never appeared again.
 */
describe("welcomes pendentes", () => {
  const CANAL = "!sala:teste"
  const QUEM = "@vitima:teste"

  it("um welcome posterior não enterra o anterior", () => {
    store.appendEvent({ channel: CANAL, kind: "welcome", ciphertext: new Uint8Array([1, 1, 1]), recipient: QUEM }, { refundavel: false })
    // The second is what a malicious member would send: to the same person, in the
    // same channel, and later.
    store.appendEvent({ channel: CANAL, kind: "welcome", ciphertext: new Uint8Array([2, 2, 2]), recipient: QUEM }, { refundavel: false })

    const pendentes = store.pendingWelcomes(QUEM, 200)
    // Both delivered: the client tries both and opens whichever is valid, which is
    // what it already does with welcomes that don't open.
    expect(pendentes).toHaveLength(2)
    // The legitimate one stays delivered, and the client decides which one to open.
    expect(pendentes.map((e) => e.ciphertext)).toContain("AQEB")
  })

  it("continua a não devolver welcomes de outras pessoas", () => {
    store.appendEvent({ channel: CANAL, kind: "welcome", ciphertext: new Uint8Array([9]), recipient: "@outro:teste" }, { refundavel: false })
    expect(store.pendingWelcomes(QUEM, 200)).toHaveLength(0)
  })
})

/**
 * The devices table.
 *
 * Up to four rows per account, and beyond that the oldest is removed. It was one
 * row per account until 22 September 2026, kept by a DELETE on each login: the
 * server enforced one device at a time, which is what multi-device removes. The
 * cap is set by the owner, and rotation is what makes the fifth fresh reinstall
 * keep logging in as it always has.
 *
 * The numbers here are literals on purpose: `4` and `5`, not the constant. The
 * test pins the owner's decision, and if someone raises the constant they need
 * to come here and say they did.
 */
describe("aparelhos", () => {
  const ANA = "@ana:localhost"
  const BENTO = "@bento:localhost"
  const chave = (n: number) => Uint8Array.from([n, n, n])
  const chaves = () => store.devicesOf(ANA).map((k) => Uint8Array.from(k))

  it("guarda o aparelho de uma conta", () => {
    store.registerDevice(ANA, new Uint8Array([1, 2, 3]))

    const aparelhos = store.devicesOf(ANA)
    expect(aparelhos).toHaveLength(1)
    expect(Uint8Array.from(aparelhos[0] as Uint8Array)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it("um aparelho novo soma-se ao anterior, e não o substitui", () => {
    store.registerDevice(ANA, chave(1))
    store.registerDevice(ANA, chave(2))

    expect(chaves()).toEqual([chave(1), chave(2)])
  })

  it("o tecto é quatro: o quinto entra e o mais antigo sai", () => {
    vi.useFakeTimers()
    for (let n = 1; n <= 5; n++) {
      vi.setSystemTime(new Date(`2026-09-22T10:0${n}:00Z`))
      store.registerDevice(ANA, chave(n))
    }

    const restantes = chaves()
    expect(restantes).toHaveLength(4)
    expect(restantes).toEqual([chave(2), chave(3), chave(4), chave(5)])
  })

  it("no mesmo minuto, sai o que foi escrito primeiro", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-22T10:00:00Z"))
    for (let n = 1; n <= 5; n++) store.registerDevice(ANA, chave(n))

    expect(chaves()).toEqual([chave(2), chave(3), chave(4), chave(5)])
  })

  it("voltar a entrar não rejuvenesce um aparelho: a antiguidade é de quando entrou", () => {
    vi.useFakeTimers()
    for (let n = 1; n <= 4; n++) {
      vi.setSystemTime(new Date(`2026-09-22T10:0${n}:00Z`))
      store.registerDevice(ANA, chave(n))
    }
    // The first logs back in much later: it's still the oldest.
    vi.setSystemTime(new Date("2026-09-23T10:00:00Z"))
    store.registerDevice(ANA, chave(1))
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"))
    store.registerDevice(ANA, chave(5))

    expect(chaves()).toEqual([chave(2), chave(3), chave(4), chave(5)])
  })

  it("o tecto é por conta: os aparelhos de outra não contam", () => {
    for (let n = 1; n <= 4; n++) store.registerDevice(ANA, chave(n))
    store.registerDevice(BENTO, chave(9))

    expect(store.devicesOf(ANA)).toHaveLength(4)
    expect(store.devicesOf(BENTO)).toHaveLength(1)
  })

  it("voltar a entrar do mesmo aparelho não duplica a linha", () => {
    store.registerDevice(ANA, new Uint8Array([7, 7, 7]))
    store.registerDevice(ANA, new Uint8Array([7, 7, 7]))

    expect(store.devicesOf(ANA)).toHaveLength(1)
  })

  it("os aparelhos de uma conta não são os de outra", () => {
    store.registerDevice(ANA, new Uint8Array([1]))
    store.registerDevice(BENTO, new Uint8Array([2]))

    expect(store.devicesOf(ANA)).toHaveLength(1)
    expect(Uint8Array.from(store.devicesOf(ANA)[0] as Uint8Array)).toEqual(new Uint8Array([1]))
    expect(Uint8Array.from(store.devicesOf(BENTO)[0] as Uint8Array)).toEqual(new Uint8Array([2]))
  })

  it("uma conta sem aparelho nenhum devolve lista vazia, e não estoira", () => {
    expect(store.devicesOf("@ninguem:localhost")).toEqual([])
  })
})

/**
 * The device manifest, and the two guards that live in the database.
 *
 * The server cannot write what the account did not sign, and it does not go
 * backwards. Both guards are HERE, in the same transaction that writes, not at
 * the gateway: it's the only place a manifest enters, and there's no path that
 * skips them.
 */
describe("manifestos de aparelhos", () => {
  const ANA = generateIdentity(parseServerName("localhost"))
  const BENTO = generateIdentity(parseServerName("localhost"))
  const aparelho = (n: number) => ed25519.getPublicKey(sha256(Uint8Array.from([n])))
  const manifesto = (quem: typeof ANA, version: number, chaves = [aparelho(1)]) =>
    signDeviceManifest(quem.signingPrivateKey, {
      address: quem.address,
      version,
      devices: chaves.map((deviceKey, i) => ({ deviceKey, addedAt: i })),
      signedAt: version,
    })

  it("guarda o primeiro, e devolve-o tal como veio", () => {
    const v1 = manifesto(ANA, 1)
    expect(store.putDeviceManifest(v1)).toEqual({ ok: true, version: 1, revogados: [] })
    expect(store.deviceManifestOf(ANA.address)).toEqual(v1)
  })

  it("uma conta sem manifesto devolve null", () => {
    expect(store.deviceManifestOf(ANA.address)).toBeNull()
  })

  it("a versão só sobe: a mesma é recusada, uma menor também, e a guardada fica", () => {
    const v2 = manifesto(ANA, 2)
    expect(store.putDeviceManifest(v2).ok).toBe(true)
    expect(store.putDeviceManifest(manifesto(ANA, 2, [aparelho(2)]))).toEqual({ ok: false, reason: "stale-version" })
    expect(store.putDeviceManifest(manifesto(ANA, 1))).toEqual({ ok: false, reason: "stale-version" })
    expect(store.deviceManifestOf(ANA.address)).toEqual(v2)
    expect(store.putDeviceManifest(manifesto(ANA, 3)).ok).toBe(true)
    expect(store.deviceManifestOf(ANA.address)?.version).toBe(3)
  })

  it("assinado por outra conta não entra, com a razão do verificador", () => {
    const forjado = signDeviceManifest(BENTO.signingPrivateKey, {
      address: ANA.address,
      version: 9,
      devices: [{ deviceKey: aparelho(1), addedAt: 0 }],
      signedAt: 0,
    })
    expect(store.putDeviceManifest(forjado)).toEqual({ ok: false, reason: "key-mismatch" })
    expect(store.deviceManifestOf(ANA.address)).toBeNull()
  })

  it("um manifesto mexido depois de assinado não entra", () => {
    const v1 = manifesto(ANA, 1)
    expect(store.putDeviceManifest({ ...v1, version: 2 })).toEqual({ ok: false, reason: "bad-signature" })
    expect(store.putDeviceManifest("lixo")).toEqual({ ok: false, reason: "bad-shape" })
    expect(store.deviceManifestOf(ANA.address)).toBeNull()
  })

  it("o manifesto de uma conta não é o de outra", () => {
    store.putDeviceManifest(manifesto(ANA, 1))
    store.putDeviceManifest(manifesto(BENTO, 5))
    expect(store.deviceManifestOf(ANA.address)?.version).toBe(1)
    expect(store.deviceManifestOf(BENTO.address)?.version).toBe(5)
  })

  it("uma versão acima do tecto não entra, mesmo bem assinada", () => {
    const unsigned = {
      address: ANA.address,
      version: VERSAO_MAXIMA + 1,
      devices: [{ deviceKey: toBase64(aparelho(1)), addedAt: 0 }],
      signedAt: 0,
    }
    const forjado = {
      ...unsigned,
      accountKey: toBase64(ANA.signingPublicKey),
      signature: toBase64(ed25519.sign(deviceManifestMessage(unsigned), ANA.signingPrivateKey)),
    }
    expect(store.putDeviceManifest(forjado)).toEqual({ ok: false, reason: "bad-shape" })
    expect(store.deviceManifestOf(ANA.address)).toBeNull()
    // And the max enters, so the cap is never lower than stated.
    expect(store.putDeviceManifest(manifesto(ANA, VERSAO_MAXIMA)).ok).toBe(true)
  })

  it("uma linha escrita à mão na base não sai daqui como manifesto", () => {
    db.prepare("INSERT INTO device_manifests (address, version, manifest, published_minute) VALUES (?, ?, ?, ?)").run(
      ANA.address,
      1,
      JSON.stringify({ address: ANA.address, version: 1 }),
      0,
    )
    expect(store.deviceManifestOf(ANA.address)).toBeNull()
  })
})

/**
 * Key packages per device, and the claim in bundle.
 *
 * What is asserted here is what the inviting client depends on: a claim without
 * bundle uses exactly one; the bundle uses one per device in the manifest (or in
 * the requests), and none for anyone not requested; `replace` removes those for
 * the same device and those without a device, and keeps those for others; and the
 * manifest decides, not the `devices` table.
 */
describe("key packages por aparelho", () => {
  const ANA = generateIdentity(parseServerName("localhost"))
  const A = ed25519.getPublicKey(sha256(Uint8Array.from([1])))
  const B = ed25519.getPublicKey(sha256(Uint8Array.from([2])))
  const C = ed25519.getPublicKey(sha256(Uint8Array.from([3])))
  const pacote = (n: number) => new Uint8Array([n])
  const bytes = (p: Uint8Array | undefined) => (p === undefined ? undefined : Uint8Array.from(p))
  const manifesto = (version: number, chaves: Uint8Array[]) =>
    signDeviceManifest(ANA.signingPrivateKey, {
      address: ANA.address,
      version,
      devices: chaves.map((deviceKey, i) => ({ deviceKey, addedAt: i })),
      signedAt: version,
    })
  const porReclamar = () =>
    (db.prepare("SELECT package FROM key_packages WHERE address = ? AND claimed = 0 ORDER BY id").all(ANA.address) as { package: Uint8Array }[]).map(
      (l) => l.package[0],
    )

  it("guarda o aparelho de cada pacote, e NULL quando não vem", () => {
    store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
    store.publishKeyPackages(ANA.address, [pacote(2)], false)
    const linhas = db.prepare("SELECT package, device FROM key_packages ORDER BY id").all() as { package: Uint8Array; device: Uint8Array | null }[]
    expect(linhas.map((l) => l.package[0])).toEqual([1, 2])
    expect(bytes(linhas[0]?.device ?? undefined)).toEqual(A)
    expect(linhas[1]?.device).toBeNull()
  })

  it("um claim sem aparelho é o de sempre: o mais recente, de quem for, e gasta UM", () => {
    store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
    store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
    store.publishKeyPackages(ANA.address, [pacote(3)], false)
    expect(bytes(store.claimKeyPackage(ANA.address))).toEqual(pacote(3))
    expect(porReclamar()).toEqual([1, 2])
  })

  it("um claim por aparelho só serve desse aparelho, e nunca os sem aparelho", () => {
    store.publishKeyPackages(ANA.address, [pacote(1), pacote(2)], false, A)
    store.publishKeyPackages(ANA.address, [pacote(3)], false, B)
    store.publishKeyPackages(ANA.address, [pacote(4)], false)
    expect(bytes(store.claimKeyPackage(ANA.address, A))).toEqual(pacote(2))
    expect(bytes(store.claimKeyPackage(ANA.address, A))).toEqual(pacote(1))
    expect(store.claimKeyPackage(ANA.address, A)).toBeUndefined()
    expect(store.claimKeyPackage(ANA.address, C)).toBeUndefined()
    expect(porReclamar()).toEqual([3, 4])
  })

  it("`replace` apaga os do próprio aparelho e os sem aparelho, e deixa os dos outros", () => {
    store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
    store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
    store.publishKeyPackages(ANA.address, [pacote(3)], false)
    store.publishKeyPackages(ANA.address, [pacote(4)], true, A)
    // B's remained (another machine, another pool) and A's new one. The one without
    // a device was removed: it could be from a vault that no longer opens it.
    expect(porReclamar()).toEqual([2, 4])
  })

  it("`replace` sem aparelho apaga só os sem aparelho", () => {
    store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
    store.publishKeyPackages(ANA.address, [pacote(2)], false)
    store.publishKeyPackages(ANA.address, [pacote(3)], true)
    expect(porReclamar()).toEqual([1, 3])
  })

  it("`replace` não toca nos já reclamados", () => {
    store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
    store.claimKeyPackage(ANA.address, A)
    store.publishKeyPackages(ANA.address, [pacote(2)], true, A)
    expect(db.prepare("SELECT count(*) AS n FROM key_packages WHERE claimed = 1").get()).toEqual({ n: 1 })
  })

  it("a contagem por aparelho inclui os sem aparelho; a da conta inclui tudo", () => {
    store.publishKeyPackages(ANA.address, [pacote(1), pacote(2)], false, A)
    store.publishKeyPackages(ANA.address, [pacote(3)], false, B)
    store.publishKeyPackages(ANA.address, [pacote(4)], false)
    expect(store.availableKeyPackages(ANA.address)).toBe(4)
    expect(store.availableKeyPackages(ANA.address, A)).toBe(3)
    expect(store.availableKeyPackages(ANA.address, B)).toBe(2)
    expect(store.availableKeyPackages(ANA.address, C)).toBe(1)
  })

  /**
   * Revocation, on the database side: the next manifest without the device is
   * the account revoking it, and the server reads the difference in the same
   * transaction.
   */
  describe("revogação", () => {
    it("o aparelho que sai do manifesto fica revogado, e os pacotes dele por reclamar apagam-se", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2), pacote(3)], false, B)
      store.publishKeyPackages(ANA.address, [pacote(4)], false)
      const resultado = store.putDeviceManifest(manifesto(2, [A]), [toBase64(B)])
      expect(resultado).toEqual({ ok: true, version: 2, revogados: [toBase64(B)] })
      expect(store.isDeviceRevoked(ANA.address, B)).toBe(true)
      expect(store.isDeviceRevoked(ANA.address, toBase64(B))).toBe(true)
      expect(store.isDeviceRevoked(ANA.address, A)).toBe(false)
      // B's are removed; A's and the one without a device remain.
      expect(porReclamar()).toEqual([1, 4])
    })

    it("os pacotes do revogado saem do bundle e do claim singular", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      store.putDeviceManifest(manifesto(2, [A]), [toBase64(B)])
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.packages.map((p) => p.deviceKey)).toEqual([toBase64(A)])
      // The singular serves the most recent of the account: without those from B, there is nothing else.
      expect(store.claimKeyPackage(ANA.address)).toBeUndefined()
    })

    it("um manifesto que volte a pôr o revogado é recusado, e o guardado fica", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.putDeviceManifest(manifesto(2, [A]), [toBase64(B)])
      expect(store.putDeviceManifest(manifesto(3, [A, B]))).toEqual({ ok: false, reason: "revoked-device" })
      expect(store.deviceManifestOf(ANA.address)?.version).toBe(2)
      // Without the revoked one, the next version enters.
      expect(store.putDeviceManifest(manifesto(3, [A, C])).ok).toBe(true)
    })

    it("um aparelho que nunca esteve num manifesto não está revogado (o emparelhado antes do pronto)", () => {
      store.putDeviceManifest(manifesto(1, [A]))
      expect(store.isDeviceRevoked(ANA.address, C)).toBe(false)
      // And adding does not revoke anyone.
      expect(store.putDeviceManifest(manifesto(2, [A, C]))).toEqual({ ok: true, version: 2, revogados: [] })
    })

    it("o primeiro manifesto não revoga nada, por muito que a tabela de logins tenha", () => {
      store.registerDevice(ANA.address, B)
      expect(store.putDeviceManifest(manifesto(1, [A]))).toEqual({ ok: true, version: 1, revogados: [] })
      expect(store.isDeviceRevoked(ANA.address, B)).toBe(false)
    })

    it("um manifesto recusado não revoga nada", () => {
      store.putDeviceManifest(manifesto(2, [A, B]))
      expect(store.putDeviceManifest(manifesto(1, [A]), [toBase64(B)]).ok).toBe(false)
      expect(store.isDeviceRevoked(ANA.address, B)).toBe(false)
    })

    it("um 0.5.7 corta pelo tecto sem `revoke`: o cortado sai, ninguém fica revogado, e pode voltar (I2)", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      // Without the list: it's what a 0.5.7 client sends.
      expect(store.putDeviceManifest(manifesto(2, [A]))).toEqual({ ok: true, version: 2, revogados: [] })
      expect(store.isDeviceRevoked(ANA.address, B)).toBe(false)
      // Its packages remain (the bundle now only serves those in the manifest).
      expect(porReclamar()).toEqual([2])
      // And it can return to the manifest: the auto-add from a 0.5.7 is this.
      expect(store.putDeviceManifest(manifesto(3, [A, B])).ok).toBe(true)
    })

    it("`revoke` só revoga o que sai: um pedido que o manifesto ainda lista não revoga (I2)", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      expect(store.putDeviceManifest(manifesto(2, [A, B, C]), [toBase64(B)])).toEqual({ ok: true, version: 2, revogados: [] })
      expect(store.isDeviceRevoked(ANA.address, B)).toBe(false)
    })
  })

  describe("claimBundle", () => {
    it("sem manifesto é o claim singular: um pacote, o mais recente, e mais nada", () => {
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.manifest).toBeNull()
      expect(bundle.packages).toEqual([])
      expect(bytes(bundle.fallback)).toEqual(pacote(2))
      expect(porReclamar()).toEqual([1])
    })

    it("com manifesto de dois aparelhos, um pacote de cada, e os dois gastos", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1), pacote(2)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(3), pacote(4)], false, B)
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.manifest?.version).toBe(1)
      expect(bundle.packages.map((p) => [p.deviceKey, p.keyPackage[0]])).toEqual([
        [toBase64(A), 2],
        [toBase64(B), 4],
      ])
      expect(bundle.fallback).toBeUndefined()
      expect(porReclamar()).toEqual([1, 3])
    })

    it("`devices` restringe aos pedidos, e um pedido fora do manifesto é ignorado", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      store.publishKeyPackages(ANA.address, [pacote(3)], false, C)
      const bundle = store.claimBundle(ANA.address, [toBase64(B), toBase64(C)])
      expect(bundle.packages.map((p) => [p.deviceKey, p.keyPackage[0]])).toEqual([[toBase64(B), 2]])
      // A's was not spent (not requested); C's was not either (not in the manifest).
      expect(porReclamar()).toEqual([1, 3])
    })

    it("um aparelho do manifesto sem pacote não é erro: entram os que há", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.packages.map((p) => p.deviceKey)).toEqual([toBase64(A)])
      expect(bundle.fallback).toBeUndefined()
    })

    it("quando nenhum aparelho pedido tem pacote, serve o mais recente SEM aparelho, e nunca o de outro aparelho", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, C)
      store.publishKeyPackages(ANA.address, [pacote(2), pacote(3)], false)
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.packages).toEqual([])
      expect(bytes(bundle.fallback)).toEqual(pacote(3))
      // C's remains: spending it would mean spending a package for a device the
      // client will discard because it's not in the manifest.
      expect(porReclamar()).toEqual([1, 2])
      // The next one takes the other one without a device; and with none, nothing.
      expect(bytes(store.claimBundle(ANA.address, [toBase64(B)]).fallback)).toEqual(pacote(2))
      expect(store.claimBundle(ANA.address, [toBase64(B)]).fallback).toBeUndefined()
      expect(porReclamar()).toEqual([1])
    })

    it("o manifesto decide, e a tabela devices não é consultada", () => {
      // Device B is in the manifest and never logged in (not in the table); C logged
      // in and is not in the manifest. B is served, not C.
      store.registerDevice(ANA.address, A)
      store.registerDevice(ANA.address, C)
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      store.publishKeyPackages(ANA.address, [pacote(3)], false, C)
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.packages.map((p) => p.deviceKey).sort()).toEqual([toBase64(A), toBase64(B)].sort())
      expect(porReclamar()).toEqual([3])
    })

    it("um pacote gasto não volta a sair: dois claims em sequência não servem o mesmo", () => {
      store.putDeviceManifest(manifesto(1, [A]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      const primeiro = store.claimBundle(ANA.address)
      const segundo = store.claimBundle(ANA.address)
      expect(primeiro.packages).toHaveLength(1)
      expect(segundo.packages).toHaveLength(0)
      expect(segundo.fallback).toBeUndefined()
    })

    it("é uma transacção: uma falha a meio do bundle deixa a base como estava", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      // The second `UPDATE ... claimed = 1` (B's) fails by a trigger: it's the way to
      // break the second mark without touching the code.
      const idDoB = (db.prepare("SELECT id FROM key_packages WHERE device = ?").get(B) as { id: number }).id
      db.exec(`CREATE TRIGGER falha_a_meio BEFORE UPDATE ON key_packages WHEN NEW.id = ${idDoB} BEGIN SELECT RAISE(ABORT, 'falha a meio'); END`)
      expect(() => store.claimBundle(ANA.address)).toThrow("falha a meio")
      // A's, marked before the failure, was NOT spent: the transaction rolled back.
      expect(porReclamar()).toEqual([1, 2])
      expect(db.prepare("SELECT count(*) AS n FROM key_packages WHERE claimed = 1").get()).toEqual({ n: 0 })
      db.exec("DROP TRIGGER falha_a_meio")
      // And without the trigger, the same claim serves both.
      expect(store.claimBundle(ANA.address).packages).toHaveLength(2)
    })

    /**
     * The core guarantee of `claimBundle`: the fallback without a device only
     * leaves when NO requested device has a package. With one package per device
     * in hand, the NULL row stays where it is. It was pinned by chance in
     * federation; it stays here, next to the code that guarantees it.
     */
    it("com pacotes por aparelho na mão, a linha sem aparelho NÃO é servida", () => {
      store.putDeviceManifest(manifesto(1, [A, B]))
      store.publishKeyPackages(ANA.address, [pacote(1)], false, A)
      store.publishKeyPackages(ANA.address, [pacote(2)], false, B)
      store.publishKeyPackages(ANA.address, [pacote(3)], false)
      const bundle = store.claimBundle(ANA.address)
      expect(bundle.packages).toHaveLength(2)
      expect(bundle.fallback).toBeUndefined()
      expect(porReclamar()).toEqual([3])
      // Also with just one device served: one package is enough.
      store.publishKeyPackages(ANA.address, [pacote(4)], false, A)
      const outro = store.claimBundle(ANA.address)
      expect(outro.packages.map((p) => p.keyPackage[0])).toEqual([4])
      expect(outro.fallback).toBeUndefined()
      expect(porReclamar()).toEqual([3])
    })
  })
})
