import { BOOTSTRAP_PEERS, bootstrapPeersFor } from "./bootstrap.js"
import { CABECALHO_DO_COFRE, comCabecalho, semCabecalho } from "./cabecalhoDoCofre.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { derivacoesDoKdf, reporDerivacoesDoKdf } from "../testes/kdf-de-teste.js"
import {
  appendHistory,
  deviceManifestSeen,
  entryMediaBytes,
  hasTransmitted,
  hasTransmitterEvidence,
  noteTransmitter,
  HISTORY_MAX_PER_CHANNEL,
  HISTORY_MEDIA_BUDGET_BYTES,
  HISTORY_MEDIA_RECENT,
  mayRepair,
  MANIFESTOS_LEMBRADOS,
  mergeOlderHistory,
  noteDeviceManifest,
  REPAIR_COOLDOWN_MS,
  entradasDoCanal,
  faltaMediaDaEntrada,
  newVaultContents,
  upsertDirectory,
  Vault,
  VERSAO_DO_COFRE,
  type StoredChatMessage,
  type VaultBackend,
  type VaultContents,
} from "./vault.js"
import { moradaDeTeste } from "../testes/moradas.js"
import { chaveDoEvento } from "./dobras.js"

const MURAL_ANA = moradaDeTeste("mural ana", "s")
const MURAL_BRU = moradaDeTeste("mural bru", "s")
const MURAL_ME = moradaDeTeste("mural me", "s")
const MURAL_OUTRO = moradaDeTeste("mural outro", "orwell.pt")

/**
 * The history rules, exercised as the pure mutations they are.
 *
 * No socket, no ratchet, no React: `appendHistory` and friends are plain
 * functions over `VaultContents`, which is exactly what makes the cap, the
 * media window and the global budget testable at all.
 */

function message(seq: number, body = `mensagem ${seq}`): StoredChatMessage {
  return {
    seq,
    sender: "@abc:localhost",
    at: seq,
    payload: { t: "message", id: `id-${seq}`, sentAt: seq, body, attachments: [], mentions: [] },
  }
}

function imageMessage(seq: number, bytes: number, channelSender = "@abc:localhost", room?: string): StoredChatMessage {
  return {
    seq,
    sender: channelSender,
    at: seq,
    payload: {
      t: "message",
      id: `id-${seq}`,
      sentAt: seq,
      ...(room ? { room } : {}),
      body: `imagem ${seq}`,
      attachments: [
        {
          url: "",
          inline: "x".repeat(bytes),
          key: "",
          nonce: "",
          digest: "",
          kind: "image",
          name: `foto-${seq}.png`,
          mediaType: "image/png",
          byteLength: bytes,
        },
      ],
      mentions: [],
    },
  }
}

function attachmentsOf(entry: StoredChatMessage): Record<string, unknown>[] {
  return entry.payload.attachments as Record<string, unknown>[]
}

/**
 * A post with a link card, which is where bytes hide another way: the
 * thumbnail is a string inside the card, not an attachment with `inline` like
 * the others.
 */
function linkPostMessage(seq: number, bytes: number): StoredChatMessage {
  return {
    seq,
    sender: "@abc:localhost",
    at: seq,
    payload: {
      t: "post",
      id: `id-${seq}`,
      postedAt: seq,
      caption: `publicação ${seq}`,
      media: [],
      tags: [],
      links: [
        {
          url: `https://exemplo.pt/${seq}`,
          kind: "link",
          title: `título ${seq}`,
          siteName: "exemplo.pt",
          thumbnail: `data:image/png;base64,${"x".repeat(bytes)}`,
        },
      ],
    },
  }
}

/** A chat message with a video card, as the text box sends it. */
function linkMessage(seq: number, bytes: number, room?: string): StoredChatMessage {
  return {
    seq,
    sender: "@abc:localhost",
    at: seq,
    payload: {
      t: "message",
      id: `id-${seq}`,
      sentAt: seq,
      body: `vídeo ${seq}`,
      ...(room ? { room } : {}),
      attachments: [],
      mentions: [],
      links: [
        {
          url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
          kind: "video",
          title: "Big Buck Bunny",
          thumbnail: `data:image/jpeg;base64,${"x".repeat(bytes)}`,
        },
      ],
    },
  }
}

function linksOf(entry: StoredChatMessage): Record<string, unknown>[] {
  return entry.payload.links as Record<string, unknown>[]
}

/** A post, as `republishPosts` states it again: same `id`, same `postedAt`,
 * new sequence number. */
function publicacao(seq: number, id = "p1", postedAt = 100): StoredChatMessage {
  return {
    seq,
    sender: "@ana:localhost",
    at: postedAt,
    payload: { t: "post", id, postedAt, caption: "uma publicação", media: [], tags: [], links: [] },
  }
}

/** The tombstone of a post, stated by who wrote it. */
function lapide(seq: number, target = "p1"): StoredChatMessage {
  return {
    seq,
    sender: "@ana:localhost",
    at: 200,
    payload: { t: "redact", id: `r-${seq}`, target, redactedAt: 200 },
  }
}

describe("appendHistory", () => {
  it("caps a channel at the maximum, dropping the oldest", () => {
    const contents = newVaultContents()
    for (let seq = 0; seq < HISTORY_MAX_PER_CHANNEL + 25; seq++) {
      appendHistory(contents, "!sala:s", message(seq))
    }

    const list = entradasDoCanal(contents, "!sala:s")
    expect(list.length).toBe(HISTORY_MAX_PER_CHANNEL)
    expect(list[0]?.seq).toBe(25)
    expect(list.at(-1)?.seq).toBe(HISTORY_MAX_PER_CHANNEL + 24)
  })

  /**
   * The same post stated again is the same post, not a second entry in the
   * vault.
   *
   * `republishPosts` restates the entire wall for each new feed entry, because
   * newcomers cannot decrypt anything published before their position. Storing
   * each republication as a new entry has two costs, and the second is grave:
   * the screen shows the same post as many times as it was stated, and the
   * channel history, which has a cap, fills with copies of what is already
   * there, pushing out what does not repeat. A tombstone does not repeat.
   */
  it("uma republicação da mesma publicação não abre entrada nova", () => {
    const contents = newVaultContents()
    appendHistory(contents, MURAL_ANA, publicacao(3))
    appendHistory(contents, MURAL_ANA, publicacao(40))
    appendHistory(contents, MURAL_ANA, publicacao(90))

    expect(entradasDoCanal(contents, MURAL_ANA)).toHaveLength(1)
    // It stays where it was: republication does not move anything up the timeline.
    expect(entradasDoCanal(contents, MURAL_ANA)[0]?.seq).toBe(3)
  })

  it("duas publicações diferentes continuam a ser duas", () => {
    const contents = newVaultContents()
    appendHistory(contents, MURAL_ANA, publicacao(3, "p1"))
    appendHistory(contents, MURAL_ANA, publicacao(4, "p2"))

    expect(entradasDoCanal(contents, MURAL_ANA)).toHaveLength(2)
  })

  /**
   * The tombstone survives the flood of republications that it itself deletes.
   *
   * This is the second cost, and it breaks the promise made to who taps the
   * button. Deleting publishes a tombstone; the tombstone is a history entry
   * like any other; history has four hundred slots and dumps the oldest. With
   * each republication opening a new entry, four hundred was enough to push the
   * tombstone out of the vault, and the deleted post came back to the screen,
   * forever, with nothing to remove it again.
   */
  it("a lápide de uma publicação não é despejada pelas republicações dela", () => {
    const contents = newVaultContents()
    appendHistory(contents, MURAL_ANA, publicacao(1))
    appendHistory(contents, MURAL_ANA, lapide(2))
    for (let seq = 3; seq < HISTORY_MAX_PER_CHANNEL + 50; seq++) {
      appendHistory(contents, MURAL_ANA, publicacao(seq))
    }

    const guardadas = entradasDoCanal(contents, MURAL_ANA)
    expect(guardadas.some((entrada) => entrada.payload["t"] === "redact")).toBe(true)
  })

  it("keeps media only in the newest entries of a channel", () => {
    const contents = newVaultContents()
    const total = HISTORY_MEDIA_RECENT + 5
    for (let seq = 0; seq < total; seq++) appendHistory(contents, "!sala:s", imageMessage(seq, 100))

    const list = entradasDoCanal(contents, "!sala:s")
    for (let index = 0; index < 5; index++) {
      expect(attachmentsOf(list[index]!)[0]).toEqual({ evicted: true, name: `foto-${index}.png`, mediaType: "image/png" })
    }
    for (let index = 5; index < total; index++) {
      expect(attachmentsOf(list[index]!)[0]?.inline).toBe("x".repeat(100))
    }
  })

  /**
   * The window is per ROOM, not per entire channel (report from owner,
   * 3/11/2026: "YouTube thumbnails appear in direct messages, but not in
   * community rooms").
   *
   * Rooms in a community are labels (`room`) inside a single MLS channel. With
   * the window counted by channel, 41 messages in the "announcements" room
   * stripped the thumbnail from a video stated in the "chat" room. In a direct
   * this does not happen: a direct is one conversation, with its 40.
   */
  it("a janela dos media é por sala: a conversa de outra sala não despeja a miniatura desta", () => {
    const contents = newVaultContents()
    const video = linkMessage(0, 100, "sala-conversa")
    appendHistory(contents, "!comunidade:s", video)
    for (let seq = 1; seq <= HISTORY_MEDIA_RECENT + 1; seq++) {
      appendHistory(contents, "!comunidade:s", imageMessage(seq, 10, "@abc:localhost", "sala-anuncios"))
    }

    const guardado = entradasDoCanal(contents, "!comunidade:s").find((entrada) => entrada.seq === 0)!
    expect(linksOf(guardado)[0]?.thumbnail).toBe(`data:image/jpeg;base64,${"x".repeat(100)}`)
    // And in the full room the rule holds: the oldest loses its bytes.
    const primeiraDosAnuncios = entradasDoCanal(contents, "!comunidade:s").find((entrada) => entrada.seq === 1)!
    expect(attachmentsOf(primeiraDosAnuncios)[0]?.evicted).toBe(true)
  })

  it("a sala por omissão (sem etiqueta) é uma sala como as outras", () => {
    const contents = newVaultContents()
    appendHistory(contents, "!comunidade:s", linkMessage(0, 100))
    for (let seq = 1; seq <= HISTORY_MEDIA_RECENT + 1; seq++) appendHistory(contents, "!comunidade:s", message(seq))
    expect(linksOf(entradasDoCanal(contents, "!comunidade:s")[0]!)[0]?.thumbnail).toBeUndefined()

    const outra = newVaultContents()
    appendHistory(outra, "!comunidade:s", linkMessage(0, 100))
    for (let seq = 1; seq <= HISTORY_MEDIA_RECENT + 1; seq++) appendHistory(outra, "!comunidade:s", { ...message(seq), payload: { ...message(seq).payload, room: "sala-x" } })
    expect(linksOf(entradasDoCanal(outra, "!comunidade:s")[0]!)[0]?.thumbnail).toBe(`data:image/jpeg;base64,${"x".repeat(100)}`)
  })

  it("os bytes de um irmão pedem-se pela janela da sala, não pela do canal", () => {
    const contents = newVaultContents()
    const semMiniatura = linkMessage(0, 100, "sala-conversa")
    delete (semMiniatura.payload.links as Record<string, unknown>[])[0]!.thumbnail
    appendHistory(contents, "!comunidade:s", semMiniatura)
    for (let seq = 1; seq <= HISTORY_MEDIA_RECENT + 1; seq++) appendHistory(contents, "!comunidade:s", { ...message(seq), payload: { ...message(seq).payload, room: "sala-anuncios" } })
    const chave = chaveDoEvento(entradasDoCanal(contents, "!comunidade:s")[0]!)!
    expect(faltaMediaDaEntrada(contents, "!comunidade:s", chave, 100)).toBe(true)
  })

  it("evicts the oldest media across channels once over the global budget, keeping the text", () => {
    const contents = newVaultContents()
    const megabyte = 1_000_000
    // 6 MB across two channels against a 4 MB budget: the two oldest lose
    // their bytes, everything keeps its words.
    appendHistory(contents, "!a:s", imageMessage(1, megabyte))
    appendHistory(contents, "!a:s", imageMessage(2, megabyte))
    appendHistory(contents, "!a:s", imageMessage(3, megabyte))
    appendHistory(contents, "!b:s", imageMessage(4, megabyte))
    appendHistory(contents, "!b:s", imageMessage(5, megabyte))
    appendHistory(contents, "!b:s", imageMessage(6, megabyte))

    const all = [...entradasDoCanal(contents, "!a:s"), ...entradasDoCanal(contents, "!b:s")]
    const totalBytes = all.reduce((sum, entry) => sum + entryMediaBytes(entry), 0)
    expect(totalBytes).toBeLessThanOrEqual(HISTORY_MEDIA_BUDGET_BYTES)

    const evicted = all.filter((entry) => attachmentsOf(entry)[0]?.evicted === true).map((entry) => entry.seq)
    expect(evicted).toEqual([1, 2])
    for (const entry of all) expect(entry.payload.body).toBe(`imagem ${entry.seq}`)
  })

  it("conta as miniaturas dos cartões de link como os bytes que são", () => {
    // Not an attachment: the thumbnail is a `thumbnail` string inside the card,
    // and the `url` next to it is the page, never a `data:`. Who searches only
    // `inline`/`url` concludes that a 100 KB post weighs zero.
    expect(entryMediaBytes(linkPostMessage(1, 100_000))).toBeGreaterThanOrEqual(100_000)
  })

  it("despeja as miniaturas dos links fora da janela recente, e o cartão fica", () => {
    // The math that makes this urgent: 100 KB per thumbnail, up to 4 per post,
    // 400 posts per channel. Without eviction it grows on its own and never stops
    //, but what gets evicted is the image, not the card: the address and title
    // are words, and words survive.
    const contents = newVaultContents()
    const total = HISTORY_MEDIA_RECENT + 5
    for (let seq = 0; seq < total; seq++) appendHistory(contents, MURAL_ANA, linkPostMessage(seq, 100))

    const list = entradasDoCanal(contents, MURAL_ANA)
    for (let index = 0; index < 5; index++) {
      const card = linksOf(list[index]!)[0]
      expect(card?.thumbnail).toBeUndefined()
      expect(card?.url).toBe(`https://exemplo.pt/${index}`)
      expect(card?.title).toBe(`título ${index}`)
    }
    for (let index = 5; index < total; index++) {
      expect(linksOf(list[index]!)[0]?.thumbnail).toBe(`data:image/png;base64,${"x".repeat(100)}`)
    }
  })

  it("as miniaturas contam para o orçamento global e são despejadas por idade", () => {
    const contents = newVaultContents()
    const megabyte = 1_000_000
    appendHistory(contents, MURAL_ANA, linkPostMessage(1, megabyte))
    appendHistory(contents, MURAL_ANA, linkPostMessage(2, megabyte))
    appendHistory(contents, MURAL_BRU, imageMessage(3, megabyte))
    appendHistory(contents, MURAL_BRU, imageMessage(4, megabyte))
    appendHistory(contents, MURAL_BRU, imageMessage(5, megabyte))

    const all = [...entradasDoCanal(contents, MURAL_ANA), ...entradasDoCanal(contents, MURAL_BRU)]
    const totalBytes = all.reduce((sum, entry) => sum + entryMediaBytes(entry), 0)
    expect(totalBytes).toBeLessThanOrEqual(HISTORY_MEDIA_BUDGET_BYTES)
    // The two oldest are posts with links, and they pay the price.
    expect(linksOf(all[0]!)[0]?.thumbnail).toBeUndefined()
    expect(all[0]?.payload.caption).toBe("publicação 1")
  })

  it("clones what it stores, so the caller's payload is never mutated later", () => {
    const contents = newVaultContents()
    const original = imageMessage(1, 10)
    appendHistory(contents, "!sala:s", original)
    for (let seq = 2; seq < HISTORY_MEDIA_RECENT + 5; seq++) {
      appendHistory(contents, "!sala:s", imageMessage(seq, 10))
    }
    // The stored copy of seq 1 was evicted; the object handed in was not.
    expect(attachmentsOf(original)[0]?.inline).toBe("x".repeat(10))
    expect(attachmentsOf(entradasDoCanal(contents, "!sala:s")[0]!)[0]?.evicted).toBe(true)
  })
})

describe("mergeOlderHistory", () => {
  it("prepends recovered entries, deduplicated by seq and sorted", () => {
    const contents = newVaultContents()
    appendHistory(contents, "!sala:s", message(10))
    appendHistory(contents, "!sala:s", message(11))

    mergeOlderHistory(contents, "!sala:s", [message(9), message(10), message(7)])

    expect(entradasDoCanal(contents, "!sala:s").map((entry) => entry.seq)).toEqual([7, 9, 10, 11])
  })

  /**
   * The other gate to the same flood.
   *
   * Fetching old messages comes through here, not through `appendHistory`, and
   * deduplicates by sequence number. A post this device has from republication
   * (high sequence) and that the server returns in the original (low sequence)
   * are two numbers for the same post, and without this guard they would be
   * two cards again.
   */
  it("uma publicação que já está guardada não volta pela recuperação", () => {
    const contents = newVaultContents()
    appendHistory(contents, MURAL_ANA, publicacao(90))

    mergeOlderHistory(contents, MURAL_ANA, [publicacao(3)])

    expect(entradasDoCanal(contents, MURAL_ANA)).toHaveLength(1)
    expect(entradasDoCanal(contents, MURAL_ANA)[0]?.seq).toBe(90)
  })

  it("nem duas vezes dentro da mesma página recuperada", () => {
    const contents = newVaultContents()

    mergeOlderHistory(contents, MURAL_ANA, [publicacao(3), publicacao(40), publicacao(9, "p2")])

    expect(entradasDoCanal(contents, MURAL_ANA)).toHaveLength(2)
  })
})

describe("upsertDirectory", () => {
  it("keeps the freshest profile by timestamp, ignoring stale arrivals", () => {
    const contents = newVaultContents()
    upsertDirectory(contents, "@abc:s", { t: "profile", displayName: "Ana" }, 200)
    upsertDirectory(contents, "@abc:s", { t: "profile", displayName: "Antiga" }, 100)
    expect(contents.directory["@abc:s"]?.payload.displayName).toBe("Ana")

    upsertDirectory(contents, "@abc:s", { t: "profile", displayName: "Nova" }, 300)
    expect(contents.directory["@abc:s"]?.payload.displayName).toBe("Nova")
    expect(contents.directory["@abc:s"]?.at).toBe(300)
  })
})

class MemoryBackend implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection: boolean = false
  /** Toggled on, all writes fail, like IndexedDB out of space. */
  recusaEscritas = false
  escritas = 0
  /**
   * From which write number the disk starts refusing.
   *
   * Counted from the start of the backend's life, not by batch, because that is
   * how a full disk behaves: it fills mid-operation and refuses everything
   * after. It is used to place the refusal EXACTLY in the middle of a write,    * which is a state that does not exist today, and which splitting the file
   * into records would allow. See the guard further down.
   */
  falharDaEscritaNumero = Number.POSITIVE_INFINITY
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.escritas += 1
    if (this.recusaEscritas || this.escritas >= this.falharDaEscritaNumero) {
      throw new Error("vault storage is full")
    }
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
}

/**
 * The same vault, with the key stored by the system instead of derived from a
 * passphrase.
 *
 * It exists for a practical reason: without passphrase there is no Argon2id,
 * and Argon2id here costs 64 MiB and a fraction of a second per call, that is
 * why the tests above need thirty seconds each. What we measure here (versions,
 * refusals, write order) is not the cipher, and does not have to pay for it.
 */
class BackendComChaveDoSistema extends MemoryBackend {
  override readonly supportsOsProtection = true
  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    return key
  }
  async unwrapKey(wrapped: Uint8Array): Promise<Uint8Array> {
    return wrapped
  }
}

/** The file as it sits on disk, to edit its fields. */
function ficheiroDe(backend: MemoryBackend): Record<string, unknown> {
  return JSON.parse(semCabecalho(backend.bytes as Uint8Array) as string) as Record<string, unknown>
}

function escreverFicheiro(backend: MemoryBackend, file: Record<string, unknown>): void {
  backend.bytes = comCabecalho(JSON.stringify(file))
}

/**
 * The format version, which was written and never read.
 *
 * See `VERSAO_DO_COFRE` in `vault.ts`: the number always existed and decided
 * nothing, so a vault written by a future version was opened with today's rules
 * and rewritten on top. While the format was a single blob, that cost almost
 * nothing; the day the history leaves the blob, which is the proposal in
 * `docs/PENDENTES.md`, conversion costs everything.
 */
describe("a versão do cofre", () => {
  it("um cofre de uma versão futura não se abre, e fica intacto no disco", async () => {
    const backend = new BackendComChaveDoSistema()
    await new Vault(backend).create(null)

    const file = ficheiroDe(backend)
    escreverFicheiro(backend, { ...file, version: VERSAO_DO_COFRE + 1 })
    const noDisco = new TextDecoder().decode(backend.bytes as Uint8Array)

    const vault = new Vault(backend)
    await expect(vault.unlock()).rejects.toThrow("this vault was written by a newer version of the app")
    // Not opened, and, this is what matters, not rewritten with today's rules on
    // top of what a future version put there.
    expect(vault.unlocked).toBe(false)
    expect(new TextDecoder().decode(backend.bytes as Uint8Array)).toBe(noDisco)
  })

  it("a chave de sessão também não abre um cofre de uma versão futura", async () => {
    const backend = new MemoryBackend()
    const primeiro = new Vault(backend)
    await primeiro.create("frase-passe")
    const chave = primeiro.exportSessionKey()

    escreverFicheiro(backend, { ...ficheiroDe(backend), version: VERSAO_DO_COFRE + 1 })

    const vault = new Vault(backend)
    await expect(vault.unlockWithKey(chave)).rejects.toThrow("this vault was written by a newer version of the app")
    expect(vault.unlocked).toBe(false)
  }, 30_000)

  it("importar uma conta de uma versão futura não substitui a que cá está", async () => {
    const origem = new MemoryBackend()
    const vault = new Vault(origem)
    await vault.create("frase-de-viagem")
    const ficheiro = JSON.parse(semCabecalho(await vault.exportVault()) as string) as {
      vault: Record<string, unknown>
    }
    const doFuturo = comCabecalho(
      JSON.stringify({
        format: "enclave-vault",
        formatVersion: 1,
        vault: { ...ficheiro.vault, version: VERSAO_DO_COFRE + 1 },
      }),
    )

    const destino = new MemoryBackend()
    destino.bytes = new TextEncoder().encode("conta-local-preciosa")
    await expect(new Vault(destino).importVault(doFuturo, "frase-de-viagem")).rejects.toThrow(
      "this vault was written by a newer version of the app",
    )
    expect(new TextDecoder().decode(destino.bytes)).toBe("conta-local-preciosa")
  }, 60_000)

  it("o cofre desta versão abre como sempre abriu", async () => {
    const backend = new BackendComChaveDoSistema()
    const primeiro = new Vault(backend)
    await primeiro.create(null)
    await primeiro.update((contents) => {
      contents.profile.displayName = "Ana"
    })
    expect(ficheiroDe(backend).version).toBe(VERSAO_DO_COFRE)

    const vault = new Vault(backend)
    await vault.unlock()
    expect(vault.contents.profile.displayName).toBe("Ana")
  })

  /** A vault written before any field existed reads as the initial format. */
  it("um cofre sem o campo da versão continua a abrir", async () => {
    const backend = new BackendComChaveDoSistema()
    await new Vault(backend).create(null)

    const file = ficheiroDe(backend)
    delete file.version
    escreverFicheiro(backend, file)

    const vault = new Vault(backend)
    await vault.unlock()
    expect(vault.unlocked).toBe(true)
  })
})

/**
 * The plaintext header and vaults from the beta (1.0 "Arca", slice 2).
 *
 * 1.0 never reads a beta vault: it decides by the `orwv2` header, before the
 * password and before deriving anything. What ties here: a beta seal gives
 * `versao: "beta"` and its own refusal, never "wrong passphrase"; derivation
 * never runs with it; the account file from 0.9.x does not enter and does not
 * touch the vault here.
 */
describe("o cabeçalho do cofre e os cofres do beta", () => {
  /** A seal as 0.9.x wrote it: the JSON and nothing before it. */
  async function seloDoBeta(): Promise<MemoryBackend> {
    const backend = new MemoryBackend()
    await new Vault(backend).create("frase-do-beta")
    backend.bytes = new TextEncoder().encode(semCabecalho(backend.bytes as Uint8Array) as string)
    return backend
  }

  /** A vault with a derivation that counts how many times it is called. */
  function cofreQueConta(backend: VaultBackend): { vault: Vault; derivacoes: () => number } {
    let vezes = 0
    const vault = new Vault(backend, async (frase, sal) => {
      vezes += 1
      return new Uint8Array(32).fill(frase.length + (sal[0] ?? 0))
    })
    return { vault, derivacoes: () => vezes }
  }

  it("a 1.0 grava o cabeçalho orwv2 antes do selo, e o selo continua a ser JSON", async () => {
    const backend = new BackendComChaveDoSistema()
    await new Vault(backend).create(null)
    const texto = new TextDecoder().decode(backend.bytes as Uint8Array)
    expect(texto.startsWith(CABECALHO_DO_COFRE)).toBe(true)
    expect(ficheiroDe(backend).version).toBe(VERSAO_DO_COFRE)
    expect(await new Vault(backend).versaoNoDisco()).toBe("orwv2")
  })

  it("sem ficheiro não há versão", async () => {
    expect(await new Vault(new MemoryBackend()).versaoNoDisco()).toBeNull()
    expect(await new Vault(new MemoryBackend()).estado()).toEqual({ exists: false, supportsOsProtection: false })
  })

  it('um selo do beta dá versao beta e nunca "wrong passphrase", e a derivação não corre', async () => {
    const backend = await seloDoBeta()
    const antes = new TextDecoder().decode(backend.bytes as Uint8Array)
    const { vault, derivacoes } = cofreQueConta(backend)

    expect(await vault.versaoNoDisco()).toBe("beta")
    expect(await vault.estado()).toEqual({ exists: true, supportsOsProtection: false, versao: "beta" })
    await expect(vault.unlock("frase-do-beta")).rejects.toThrow("this vault is from the beta")
    await expect(vault.unlock("outra-qualquer")).rejects.not.toThrow("wrong passphrase")
    await expect(vault.unlockWithKey(new Uint8Array(32))).rejects.toThrow("this vault is from the beta")
    await expect(vault.exportVault()).rejects.toThrow("this vault is from the beta")

    expect(derivacoes()).toBe(0)
    expect(vault.unlocked).toBe(false)
    // And the beta file stays as it was: who deletes it is "Create new account".
    expect(new TextDecoder().decode(backend.bytes as Uint8Array)).toBe(antes)
  })

  it("um cofre do beta protegido pelo sistema também não chega ao porta-chaves", async () => {
    const backend = new BackendComChaveDoSistema()
    await new Vault(backend).create(null)
    backend.bytes = new TextEncoder().encode(semCabecalho(backend.bytes as Uint8Array) as string)
    let desembrulhos = 0
    backend.unwrapKey = async (embrulhada) => {
      desembrulhos += 1
      return embrulhada
    }
    await expect(new Vault(backend).unlock()).rejects.toThrow("this vault is from the beta")
    expect(desembrulhos).toBe(0)
  })

  it("apagar um cofre do beta não o lê", async () => {
    const backend = await seloDoBeta()
    const { vault, derivacoes } = cofreQueConta(backend)
    await vault.destroy()
    expect(backend.bytes).toBeNull()
    expect(derivacoes()).toBe(0)
  })

  it("o ficheiro de conta leva o cabeçalho e volta a entrar", async () => {
    const origem = new MemoryBackend()
    const vault = new Vault(origem)
    await vault.create("frase-de-viagem")
    const ficheiro = await vault.exportVault()
    expect(new TextDecoder().decode(ficheiro).startsWith(CABECALHO_DO_COFRE)).toBe(true)

    const destino = new MemoryBackend()
    await new Vault(destino).importVault(ficheiro, "frase-de-viagem")
    expect(await new Vault(destino).versaoNoDisco()).toBe("orwv2")
    const aberto = new Vault(destino)
    await aberto.unlock("frase-de-viagem")
    expect(aberto.unlocked).toBe(true)
  }, 30_000)

  it("um ficheiro exportado pela 0.9.x não entra, não deriva e não toca no cofre de cá", async () => {
    const origem = new MemoryBackend()
    const exportador = new Vault(origem)
    await exportador.create("frase-de-viagem")
    const daNove = new TextEncoder().encode(semCabecalho(await exportador.exportVault()) as string)

    const destino = new MemoryBackend()
    destino.bytes = new TextEncoder().encode("conta-local-preciosa")
    const { vault, derivacoes } = cofreQueConta(destino)
    await expect(vault.importVault(daNove, "frase-de-viagem")).rejects.toThrow("this account file is from the beta")
    expect(derivacoes()).toBe(0)
    expect(new TextDecoder().decode(destino.bytes)).toBe("conta-local-preciosa")

    // A file that is not even an account keeps saying what it said.
    await expect(vault.importVault(new TextEncoder().encode("fotografia"), "x")).rejects.toThrow(
      "this is not an enclave account file",
    )
  }, 30_000)
})

/**
 * The temporary vault for pairing (core 1j).
 *
 * "Sign in with another account" by pairing deleted the account on this device
 * BEFORE the link, because the core needed an empty vault. A pairing that
 * failed after left the device with no account. What ties here: the temporary
 * never touches disk; discarding it leaves the old account opening with its
 * phrase; confirming it puts the new one in place in a single write.
 */
describe("o cofre provisório do emparelhamento", () => {
  async function contaAntiga(): Promise<{ backend: MemoryBackend; vault: Vault }> {
    const backend = new MemoryBackend()
    const vault = new Vault(backend)
    await vault.create("frase da conta antiga")
    await vault.update((c) => {
      c.homeserver = "antigo.pt"
    })
    vault.lock()
    return { backend, vault }
  }

  it("a derivação da chave nova corre com o cofre antigo ainda aberto (juntar contas, fase 8.2)", async () => {
    // Derivation as in the browser: outside this thread, and here held until release.
    let soltar: () => void = () => {}
    let derivacoes = 0
    const vault = new Vault(new MemoryBackend(), async () => {
      derivacoes += 1
      if (derivacoes > 1) await new Promise<void>((resolve) => (soltar = resolve))
      return new Uint8Array(32).fill(derivacoes)
    })
    await vault.create("frase da conta antiga")
    await vault.update((c) => {
      c.homeserver = "antigo.pt"
    })

    const aCriar = vault.criarProvisorio("frase da conta nova")
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Deriving: the old vault stays open, and the session keeps reading from it.
    expect(vault.unlocked).toBe(true)
    expect(vault.provisorio).toBe(false)
    expect(vault.contents.homeserver).toBe("antigo.pt")

    soltar()
    await aCriar
    expect(vault.provisorio).toBe(true)
    expect(vault.contents.homeserver).not.toBe("antigo.pt")
  })

  it("um emparelhamento que falha a meio deixa a conta antiga intacta e a abrir", async () => {
    const { backend, vault } = await contaAntiga()
    const antes = backend.bytes
    const escritasAntes = backend.escritas

    await vault.criarProvisorio("frase da conta nova")
    expect(vault.provisorio).toBe(true)
    // What the core writes when it receives the certificate, and what the session saves when it signs in.
    await vault.update((c) => {
      c.homeserver = "novo.pt"
      c.accountPublicKey = "chave-publica"
    })
    expect(backend.escritas).toBe(escritasAntes)
    expect(backend.bytes).toBe(antes)
    await expect(vault.exportVault()).rejects.toThrow("vault is locked")

    vault.descartarProvisorio()
    expect(vault.unlocked).toBe(false)
    expect(vault.provisorio).toBe(false)
    await vault.unlock("frase da conta antiga")
    expect(vault.contents.homeserver).toBe("antigo.pt")
    expect(vault.contents.accountPublicKey).toBeFalsy()
  })

  it("confirmar grava a conta nova por cima da antiga, numa escrita, com a frase nova", async () => {
    const { backend, vault } = await contaAntiga()
    const escritasAntes = backend.escritas
    await vault.criarProvisorio("frase da conta nova")
    await vault.update((c) => {
      c.homeserver = "novo.pt"
    })
    await vault.confirmarProvisorio()
    expect(vault.provisorio).toBe(false)
    expect(backend.escritas).toBe(escritasAntes + 1)

    // From here on it is a vault like any other: `update` goes to disk.
    await vault.update((c) => {
      c.serverResetAtMinute = 7
    })
    expect(backend.escritas).toBe(escritasAntes + 2)

    vault.lock()
    await expect(vault.unlock("frase da conta antiga")).rejects.toThrow("wrong passphrase")
    await vault.unlock("frase da conta nova")
    expect(vault.contents.homeserver).toBe("novo.pt")
    expect(vault.contents.serverResetAtMinute).toBe(7)
  })

  it("uma confirmação que falha a gravar deixa o provisório aberto e a conta antiga no disco", async () => {
    const { backend, vault } = await contaAntiga()
    const antes = backend.bytes
    await vault.criarProvisorio("frase da conta nova")
    backend.recusaEscritas = true
    await expect(vault.confirmarProvisorio()).rejects.toThrow("vault storage is full")
    expect(vault.provisorio).toBe(true)
    expect(backend.bytes).toBe(antes)

    vault.descartarProvisorio()
    backend.recusaEscritas = false
    await vault.unlock("frase da conta antiga")
    expect(vault.contents.homeserver).toBe("antigo.pt")
  })

  it("com a chave do sistema, o provisório também só chega ao disco ao confirmar", async () => {
    const backend = new BackendComChaveDoSistema()
    const vault = new Vault(backend)
    await vault.criarProvisorio(null)
    await vault.update((c) => {
      c.homeserver = "novo.pt"
    })
    expect(await vault.exists()).toBe(false)
    await vault.confirmarProvisorio()
    expect(await vault.exists()).toBe(true)
    vault.lock()
    await vault.unlock()
    expect(vault.contents.homeserver).toBe("novo.pt")
  })

  it("descartar sem provisório não fecha um cofre normal", async () => {
    const backend = new BackendComChaveDoSistema()
    const vault = new Vault(backend)
    await vault.create(null)
    vault.descartarProvisorio()
    await vault.confirmarProvisorio()
    expect(vault.unlocked).toBe(true)
    expect(vault.provisorio).toBe(false)
  })
})

describe("criar um cofre que não chega ao disco", () => {
  /**
   * `unlocked` saying yes and `exists()` saying no, about the same vault: it
   * was the state a creation with a full disk left everything in. The identity
   * lived only in RAM, keys, groups, messages, and vanished with the window,
   * with nothing to tell.
   */
  it("uma criação que falha a gravar não deixa uma conta aberta só em memória", async () => {
    const backend = new BackendComChaveDoSistema()
    backend.recusaEscritas = true

    const vault = new Vault(backend)
    await expect(vault.create(null)).rejects.toThrow("vault storage is full")

    expect(vault.unlocked).toBe(false)
    expect(await vault.exists()).toBe(false)
    expect(() => vault.contents).toThrow("vault is locked")
  })

  it("com o disco a funcionar, criar continua a deixar o cofre aberto", async () => {
    const backend = new BackendComChaveDoSistema()
    const vault = new Vault(backend)
    await vault.create(null)
    expect(vault.unlocked).toBe(true)
    expect(await vault.exists()).toBe(true)
  })
})

/**
 * The order of `update`, which looks like a defect and is a decision.
 *
 * The audit asked to invert: write first, change memory after, or undo the
 * mutation if writing fails. Measured, and rejected, what goes through
 * `update` is already-advanced MLS state and the read anchor that goes with it,
 * and neither undoes. Restoring the prior anchor makes us ask for an event we
 * can no longer decrypt, and that is how a channel goes deaf and repair takes
 * its history.
 *
 * This test is the guard: whoever inverts the order breaks it, and learns why
 * before doing it. See `docs/PENDENTES.md`.
 */
describe("uma gravação falhada, e o que tem de sobreviver a ela", () => {
  it("a memória fica à frente do disco, e a gravação seguinte leva as duas alterações", async () => {
    const backend = new BackendComChaveDoSistema()
    const vault = new Vault(backend)
    await vault.create(null)
    await vault.update((contents) => {
      contents.lastSeq["!sala:s"] = 1
    })

    backend.recusaEscritas = true
    await expect(
      vault.update((contents) => {
        contents.lastSeq["!sala:s"] = 2
        contents.history["!sala:s"] = [{ seq: 2, sender: "@ana:s", at: 2, payload: { t: "message" } }]
      }),
    ).rejects.toThrow("vault storage is full")

    // Memory keeps what the ratchet has already consumed, even if disk refuses it.
    expect(vault.contents.lastSeq["!sala:s"]).toBe(2)
    expect(entradasDoCanal(vault.contents, "!sala:s")).toHaveLength(1)

    // And it is the next write, the one `Session.flush` retries, that brings
    // what hung pending to disk, without anyone having to repeat it.
    backend.recusaEscritas = false
    await vault.update((contents) => {
      contents.profile.displayName = "Ana"
    })

    const reaberto = new Vault(backend)
    await reaberto.unlock()
    expect(reaberto.contents.lastSeq["!sala:s"]).toBe(2)
    expect(entradasDoCanal(reaberto.contents, "!sala:s")).toHaveLength(1)
    expect(reaberto.contents.profile.displayName).toBe("Ana")
  })
})

/**
 * The atomicity that today is free, and that nobody chose.
 *
 * The vault is ONE record. `#persist` serializes everything, encrypts
 * everything, and writes everything in a single backend call. From that comes a
 * property that no line in this repository asks for and on which everything
 * depends: **a write either happened all or did not happen at all.** One record
 * has no middle ground. Many records do.
 *
 * That is why it is the kind of thing that gets lost without anyone noticing.
 * `docs/PENDENTES.md` proposes splitting the file into keyed records, identity
 * and groups in one, history per channel in others, metadata in their own, so
 * one conversation line no longer costs the entire vault. The day that happens,
 * nothing fails and nothing warns: the suite turns green, the app works, and the
 * property vanishes silently. You only discover it when someone's vault gets
 * half-written, with new history and old groups, which is worse than not
 * writing at all, because an old group encrypts again with a key already used.
 *
 * This guard does not solve atomicity. It cannot be solved before it is lost.
 * What it does is write, in executable code, what the split HAS to return: one
 * single commit point, and never a halfway state. Whoever splits the file splits
 * these two tests first, and learns what they are trading before they trade it.
 * Same role as the guard for the `update` order, up above.
 */
describe("o cofre é um registo só, e a atomicidade vem daí", () => {
  /** A batch that touches five unrelated locations. */
  function lote(contents: VaultContents): void {
    contents.groups["!sala:s"] = "grupo-na-epoch-seguinte"
    contents.lastSeq["!sala:s"] = 7
    contents.history["!sala:s"] = [{ seq: 7, sender: "@ana:s", at: 7, payload: { t: "message" } }]
    contents.directory["@ana:s"] = { at: 7, payload: { t: "profile", displayName: "Ana" } }
    contents.profile.displayName = "Eu"
  }

  /** How many of the five survived, read from a vault reopened from disk. */
  function quantosEntraram(contents: VaultContents): boolean[] {
    return [
      contents.groups["!sala:s"] === "grupo-na-epoch-seguinte",
      contents.lastSeq["!sala:s"] === 7,
      entradasDoCanal(contents, "!sala:s").length === 1,
      contents.directory["@ana:s"] !== undefined,
      contents.profile.displayName === "Eu",
    ]
  }

  it("uma alteração que toca em cinco sítios diferentes é UMA escrita", async () => {
    const backend = new BackendComChaveDoSistema()
    const vault = new Vault(backend)
    await vault.create(null)

    const antes = backend.escritas
    await vault.update(lote)

    // Not a measure of efficiency: it measures the commitment point. Two writes are
    // two moments where the process can crash, and the second one leaves the disk
    // describing a vault that never existed.
    expect(backend.escritas - antes).toBe(1)
  })

  it("com o disco a encher a meio, ou entram os cinco ou não entra nenhum", async () => {
    // Two races, with rejection at different points: in the first the disk refuses
    // to write the batch right away, in the second it lets one through and refuses
    // the next. Today the second does not exist, there is just one write, and the
    // rejection falls outside the batch. In a vault split into records it is that
    // rejection which tears it.
    for (const recusarNaEscritaDoLote of [1, 2]) {
      const backend = new BackendComChaveDoSistema()
      const vault = new Vault(backend)
      await vault.create(null)
      await vault.update((contents) => {
        contents.profile.displayName = "Antes"
      })

      backend.falharDaEscritaNumero = backend.escritas + recusarNaEscritaDoLote
      // Today it always throws when the batch's only write is the rejected one, and
      // does not throw when the rejection comes at the next write. Both are
      // acceptable; what is not acceptable is what stays on disk.
      await vault.update(lote).catch(() => {})

      const reaberto = new Vault(backend)
      // The first to open all the way. A half-written file is the half that went
      // through followed by nothing, and what comes out of that is not a vault with
      // fewer things: it is a vault that does not read.
      await expect(reaberto.unlock()).resolves.toBeUndefined()

      const entraram = quantosEntraram(reaberto.contents)
      expect(new Set(entraram).size).toBe(1)
    }
  })
})

describe("vault compatibility", () => {
  it("opens a vault written before history and directory existed", async () => {
    const backend = new MemoryBackend()

    // A pre-Phase-4 vault: the fields simply are not there.
    const legacy = {
      signingPrivateKey: "chave",
      homeserver: "localhost:8448",
      groups: {},
      pendingKeyPackages: [],
      profile: { displayName: "Ana", donations: [], updatedAt: 1 },
      mintedInvites: {},
      lastSeq: { "!sala:s": 7 },
    } as unknown as VaultContents
    await new Vault(backend).create("frase-passe", legacy)

    const vault = new Vault(backend)
    await vault.unlock("frase-passe")

    expect(vault.contents.history).toEqual({})
    expect(vault.contents.directory).toEqual({})
    expect(vault.contents.lastSeq).toEqual({ "!sala:s": 7 })
    expect(vault.contents.profile.displayName).toBe("Ana")
  }, 30_000)
})

/**
 * The password is what separates the vault from whoever has the file.
 *
 * The most obvious test of all was missing here, and the gap only showed when
 * we mutated the KDF in tests to ignore the password and salt: the whole suite
 * turned green except ONE test, and that one was about importing an account, not
 * opening the local one. In other words, nothing stopped the everyday case, the
 * vault on this device, opened with the wrong password. It stays caught here.
 */
describe("abrir com a frase errada", () => {
  it("não abre, não deixa o cofre meio-aberto, e não toca no ficheiro", async () => {
    const backend = new MemoryBackend()
    const criado = new Vault(backend)
    await criado.create("a-certa")
    await criado.update((contents) => {
      contents.profile.displayName = "Ana"
    })
    const noDisco = backend.bytes

    const outro = new Vault(backend)
    await expect(outro.unlock("a-errada")).rejects.toThrow("wrong passphrase, or the vault is damaged")
    expect(outro.unlocked).toBe(false)
    // Locked means locked: the contents do not read, not even by accident.
    expect(() => outro.contents).toThrow("vault is locked")
    // And a failed attempt rewrites nothing over what was already there.
    expect(backend.bytes).toBe(noDisco)

    // The correct one still opens, otherwise what we measured above was a broken
    // vault, not a refused password.
    const bom = new Vault(backend)
    await bom.unlock("a-certa")
    expect(bom.contents.profile.displayName).toBe("Ana")
  }, 30_000)

  it("dois cofres com a MESMA frase não partilham chave, porque o sal é por cofre", async () => {
    const um = new MemoryBackend()
    const outro = new MemoryBackend()
    await new Vault(um).create("a-mesma-frase")
    await new Vault(outro).create("a-mesma-frase")

    const salDeUm = (JSON.parse(semCabecalho(um.bytes!) as string) as { salt: string }).salt
    const salDoOutro = (JSON.parse(semCabecalho(outro.bytes!) as string) as { salt: string }).salt
    expect(salDeUm).not.toBe(salDoOutro)

    // And the consequence, which is what matters: one's session key does not open
    // the other's. Without a salt per vault, it would.
    const aberto = new Vault(um)
    await aberto.unlock("a-mesma-frase")
    const chaveDeUm = aberto.exportSessionKey()

    await expect(new Vault(outro).unlockWithKey(chaveDeUm)).rejects.toThrow(
      "wrong passphrase, or the vault is damaged",
    )
  }, 30_000)
})

describe("session key export", () => {
  it("a chave exportada abre o cofre sem passphrase e sem repetir o Argon2id", async () => {
    const backend = new MemoryBackend()
    const first = new Vault(backend)
    await first.create("frase-passe")
    await first.update((contents) => {
      contents.profile.displayName = "Ana"
    })
    const key = first.exportSessionKey()

    // "Without repeating Argon2id" was in the test name and nowhere else. The KDF
    // replacement counter counts derivations from a password; from here on they must
    // be ZERO, otherwise the session key is not saving anything and this test's name
    // is false.
    reporDerivacoesDoKdf()

    const reloaded = new Vault(backend)
    await reloaded.unlockWithKey(key)
    expect(reloaded.unlocked).toBe(true)
    expect(reloaded.contents.profile.displayName).toBe("Ana")
    expect(derivacoesDoKdf()).toBe(0)
  }, 30_000)

  it("uma chave errada falha e não deixa o cofre meio-aberto", async () => {
    const backend = new MemoryBackend()
    await new Vault(backend).create("frase-passe")

    const vault = new Vault(backend)
    await expect(vault.unlockWithKey(new Uint8Array(32))).rejects.toThrow(
      "wrong passphrase, or the vault is damaged",
    )
    expect(vault.unlocked).toBe(false)
  }, 30_000)

  it("exportar com o cofre trancado é recusado", () => {
    expect(() => new Vault(new MemoryBackend()).exportSessionKey()).toThrow("vault is locked")
  })
})

describe("exportar e importar a conta", () => {
  it("roundtrip: exporta cifrado, importa noutro dispositivo, abre com a mesma passphrase", async () => {
    const origin = new MemoryBackend()
    const vault = new Vault(origin)
    await vault.create("frase-de-viagem")
    await vault.update((contents) => {
      contents.profile.displayName = "Viajante"
    })
    const file = await vault.exportVault()

    // The file never carries plaintext.
    expect(new TextDecoder().decode(file)).not.toContain("Viajante")

    const destination = new MemoryBackend()
    const imported = new Vault(destination)
    await imported.importVault(file, "frase-de-viagem")
    await imported.unlock("frase-de-viagem")
    expect(imported.contents.profile.displayName).toBe("Viajante")
  }, 60_000)

  it("o cofre importado pede a posse do aparelho, e o de origem não", async () => {
    // Importing copies the device that exported it: the new copy must claim
    // ownership on first login (`assumirPosse`), otherwise the original keeps
    // speaking for the account (`scripts/e2e-exportar-importar.mjs`, 27/10/2026).
    const origin = new MemoryBackend()
    const vault = new Vault(origin)
    await vault.create("frase-de-viagem")
    await vault.update((contents) => {
      contents.posseDoAparelho = 3
    })
    const file = await vault.exportVault()

    const imported = new Vault(new MemoryBackend())
    await imported.importVault(file, "frase-de-viagem")
    await imported.unlock("frase-de-viagem")
    expect(imported.contents.assumirPosse).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(imported.contents.posseDoAparelho).toBe(3)
    expect(vault.contents.assumirPosse).toBeUndefined()
  }, 60_000)

  it("passphrase errada falha limpo e não toca no vault local", async () => {
    const origin = new MemoryBackend()
    await new Vault(origin).create("certa")
    const file = await new Vault(origin).exportVault()

    const destination = new MemoryBackend()
    destination.bytes = new TextEncoder().encode("conta-local-preciosa")
    await expect(new Vault(destination).importVault(file, "errada")).rejects.toThrow(
      "wrong passphrase, or the vault is damaged",
    )
    expect(new TextDecoder().decode(destination.bytes)).toBe("conta-local-preciosa")
  }, 60_000)

  it("envelope inválido é rejeitado com erro traduzível", async () => {
    const vault = new Vault(new MemoryBackend())
    await expect(vault.importVault(new TextEncoder().encode("{nem pensar"), "x")).rejects.toThrow(
      "this is not an enclave account file",
    )
    await expect(
      vault.importVault(new TextEncoder().encode(JSON.stringify({ format: "outra-coisa" })), "x"),
    ).rejects.toThrow("this is not an enclave account file")
  })
})

describe("travão da reparação", () => {
  it("um par novo pode sempre; repetir antes do arrefecimento não", () => {
    const now = 1_000_000_000
    expect(mayRepair({}, "@ana:s", MURAL_ME, now)).toBe(true)

    const attempts = { [`@ana:s|${MURAL_ME}`]: now - 60_000 }
    expect(mayRepair(attempts, "@ana:s", MURAL_ME, now)).toBe(false)
    // After cooldown passes, it can again, friendship does not stay locked.
    expect(mayRepair(attempts, "@ana:s", MURAL_ME, now + REPAIR_COOLDOWN_MS)).toBe(true)
    // One pair is not blocked by another.
    expect(mayRepair(attempts, "@rui:s", MURAL_ME, now)).toBe(true)
  })
})

describe("bootstrap pontual", () => {
  const fundadores = ["@ana:exemplo.pt", "@bruno:exemplo.pt", "@carla:exemplo.pt", "@duarte:exemplo.pt"]
  beforeEach(() => {
    BOOTSTRAP_PEERS["exemplo.pt"] = fundadores
  })
  afterEach(() => {
    delete BOOTSTRAP_PEERS["exemplo.pt"]
  })

  it("só as contas fundadoras têm pares, e nunca a si próprias", () => {
    const peers = bootstrapPeersFor("@ana:exemplo.pt")
    expect(peers).toHaveLength(3)
    expect(peers).not.toContain("@ana:exemplo.pt")
    expect(peers).toContain("@bruno:exemplo.pt")
  })

  it("qualquer outra conta ou servidor não recebe bootstrap nenhum", () => {
    expect(bootstrapPeersFor("@estranho:exemplo.pt")).toEqual([])
    expect(bootstrapPeersFor("@ana:outro.pt")).toEqual([])
  })
})

/**
 * Who is alive in a channel, the question that drives re-seating.
 *
 * A feed reader never publishes to that feed, only the owner does. Judging
 * vitality from the history always said "dead" for a perfectly healthy reader,
 * and re-seating a healthy member shifts the epoch and takes away all their
 * earlier posts. The right signal is cryptographic: has something signed by that
 * person already opened here?
 */
describe("prova de vida por canal", () => {
  const feed = moradaDeTeste("mural da ana", "orwell.pt")
  const bruno = "@bruno:orwell.pt"

  it("quem nunca foi ouvido não conta como vivo", () => {
    const contents = newVaultContents()
    expect(hasTransmitted(contents, feed, bruno)).toBe(false)
  })

  it("um perfil — a única coisa que um leitor silencioso envia — conta como vivo", () => {
    const contents = newVaultContents()
    // The profile goes to the directory, never to the history: it is exactly the
    // case that the old test, based on history, called dead.
    noteTransmitter(contents, feed, bruno)
    expect(hasTransmitted(contents, feed, bruno)).toBe(true)
    expect(contents.history[feed]).toBeUndefined()
  })

  it("a prova é por canal, nunca global", () => {
    const contents = newVaultContents()
    noteTransmitter(contents, feed, bruno)
    expect(hasTransmitted(contents, MURAL_OUTRO, bruno)).toBe(false)
  })

  it("repetir não duplica e um canal movimentado não cresce sem limite", () => {
    const contents = newVaultContents()
    noteTransmitter(contents, feed, bruno)
    noteTransmitter(contents, feed, bruno)
    expect(contents.transmitters[feed]).toEqual([bruno])

    for (let i = 0; i < 400; i++) noteTransmitter(contents, feed, `@pessoa${i}:orwell.pt`)
    expect(contents.transmitters[feed]?.length).toBe(256)
    // The most recent survives; whoever reaches the end of the queue is the oldest.
    expect(hasTransmitted(contents, feed, "@pessoa399:orwell.pt")).toBe(true)
    expect(hasTransmitted(contents, feed, "@pessoa0:orwell.pt")).toBe(false)
  })

  it("um cofre gravado antes deste campo abre à mesma", () => {
    const contents = { ...newVaultContents() } as Partial<VaultContents>
    delete contents.transmitters
    expect(hasTransmitted(contents as VaultContents, feed, bruno)).toBe(false)
  })

  /**
   * "I don't know" is not "dead".
   *
   * In a vault upgraded from an earlier version there is no record at all, and
   * reading that absence as proof of death would make the first repair after the
   * upgrade re-seat every healthy person at once, exactly the damage this record
   * exists to prevent.
   */
  it("sem registo nenhum no canal, não há prova de nada", () => {
    const contents = newVaultContents()
    expect(hasTransmitterEvidence(contents, feed)).toBe(false)
    // It takes hearing from someone, even ourselves, for the question to have an
    // answer, and only then does a member's silence mean something.
    noteTransmitter(contents, feed, "@eu:orwell.pt")
    expect(hasTransmitterEvidence(contents, feed)).toBe(true)
    expect(hasTransmitted(contents, feed, bruno)).toBe(false)
  })
})

/**
 * The anti-rollback anchor for device manifests.
 *
 * The server cannot forge a manifest (it does not sign it), but it can serve an
 * old one to someone who never saw the new. The only defense is local: the
 * highest version ever seen of each address, in the vault, and refusal of
 * anything below it.
 */
describe("a versão vista dos manifestos de aparelhos", () => {
  const ANA = "@ana:orwell.pt"

  it("a primeira versão vista entra, e a seguinte só se não recuar", () => {
    const contents = newVaultContents()
    expect(deviceManifestSeen(contents, ANA)).toBeUndefined()
    expect(noteDeviceManifest(contents, ANA, 3)).toBe(true)
    expect(noteDeviceManifest(contents, ANA, 5)).toBe(true)
    expect(noteDeviceManifest(contents, ANA, 4)).toBe(false)
    expect(deviceManifestSeen(contents, ANA)).toBe(5)
  })

  it("a mesma versão outra vez não é recuo", () => {
    const contents = newVaultContents()
    noteDeviceManifest(contents, ANA, 2)
    expect(noteDeviceManifest(contents, ANA, 2)).toBe(true)
    expect(deviceManifestSeen(contents, ANA)).toBe(2)
  })

  it("é por endereço", () => {
    const contents = newVaultContents()
    noteDeviceManifest(contents, ANA, 9)
    expect(noteDeviceManifest(contents, "@bento:orwell.pt", 1)).toBe(true)
    expect(deviceManifestSeen(contents, ANA)).toBe(9)
  })

  it("guarda as mais recentes, e sai a menos recente quando o tecto corta", () => {
    const contents = newVaultContents()
    expect(MANIFESTOS_LEMBRADOS).toBe(512)
    for (let i = 0; i < 600; i++) noteDeviceManifest(contents, `@pessoa${i}:orwell.pt`, 1)
    expect(Object.keys(contents.deviceManifests)).toHaveLength(512)
    expect(deviceManifestSeen(contents, "@pessoa0:orwell.pt")).toBeUndefined()
    expect(deviceManifestSeen(contents, "@pessoa599:orwell.pt")).toBe(1)
  })

  it("voltar a ver um endereço torna-o o mais recente, e ele sobrevive ao corte", () => {
    const contents = newVaultContents()
    noteDeviceManifest(contents, ANA, 1)
    for (let i = 0; i < 511; i++) noteDeviceManifest(contents, `@pessoa${i}:orwell.pt`, 1)
    // Ana is the oldest: seeing her again (same version) renews her.
    noteDeviceManifest(contents, ANA, 1)
    noteDeviceManifest(contents, "@nova:orwell.pt", 1)
    expect(deviceManifestSeen(contents, ANA)).toBe(1)
    expect(deviceManifestSeen(contents, "@pessoa0:orwell.pt")).toBeUndefined()
  })

  it("um cofre gravado antes deste campo abre à mesma, e o campo nasce vazio", async () => {
    const contents = { ...newVaultContents() } as Partial<VaultContents>
    delete contents.deviceManifests
    expect(deviceManifestSeen(contents as VaultContents, ANA)).toBeUndefined()
    expect(noteDeviceManifest(contents as VaultContents, ANA, 1)).toBe(true)

    // And along the disk path: a vault without the field opens with `{}`.
    const backend = new MemoryBackend()
    const semCampo = { ...newVaultContents() } as Partial<VaultContents>
    delete semCampo.deviceManifests
    await new Vault(backend).create("frase-passe", semCampo as VaultContents)
    const vault = new Vault(backend)
    await vault.unlock("frase-passe")
    expect(vault.contents.deviceManifests).toEqual({})
  }, 30_000)
})
