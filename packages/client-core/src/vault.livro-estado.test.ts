import { xchacha20poly1305 } from "@noble/ciphers/chacha.js"
import { fromBase64, toBase64 } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { comCabecalho, semCabecalho } from "./cabecalhoDoCofre.js"
import {
  aplicarAtribuicao,
  appendHistory,
  base64ParaBytes,
  bytesParaBase64,
  confirmarSeq,
  entradasDoCanal,
  HISTORY_MAX_PER_CHANNEL,
  mergeOlderHistory,
  newVaultContents,
  TECTOS_DO_ESTADO,
  tipoDoEstado,
  Vault,
  VERSAO_DO_COFRE,
  type StoredChatMessage,
  type VaultBackend,
} from "./vault.js"
import { moradaDeTeste } from "../testes/moradas.js"

const DM_A_B = moradaDeTeste("directa a b", "s")

/**
 * The state ledger (phase S2 of absolute sync, §6.2 of the plan).
 *
 * What decides state lives outside the message list cap: the feed, comments,
 * likes and votes, tickets, edits and tombstones, and the friends ledger. The
 * S0 measure ("vault on cap") lost all of this at 400 messages; here it stays.
 */

const SALA = "!sala:s"
const ANA = "@ana:s"
const BRUNO = "@bruno:s"

const entrada = (seq: number, sender: string, payload: StoredChatMessage["payload"], extra: Partial<StoredChatMessage> = {}): StoredChatMessage => ({
  seq,
  sender,
  at: seq,
  payload,
  ...extra,
})
const mensagem = (seq: number, sender = BRUNO): StoredChatMessage =>
  entrada(seq, sender, { t: "message", id: `m${seq}`, body: `mensagem ${seq}`, sentAt: seq })

describe("o livro de estado sobrevive ao tecto das mensagens", () => {
  it("publicação, comentário, gosto, lápide, edição e ticket ficam depois de 410 mensagens", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, mensagem(1))
    appendHistory(c, SALA, entrada(2, ANA, { t: "post", id: "p1", postedAt: 2, caption: "mural" }))
    appendHistory(c, SALA, entrada(3, BRUNO, { t: "post.comment", id: "c1", target: "p1", body: "boa", postedAt: 3 }))
    appendHistory(c, SALA, entrada(4, BRUNO, { t: "post.reaction", id: "r1", target: "p1", emoji: "👍", at: 4 }))
    appendHistory(c, SALA, entrada(5, BRUNO, { t: "redact", id: "x1", target: "m1", redactedAt: 5 }))
    appendHistory(c, SALA, entrada(6, ANA, { t: "edit", id: "e1", target: "p1", body: "mural!", editedAt: 6 }))
    appendHistory(c, SALA, entrada(7, ANA, { t: "message", id: "t1", body: "A porta", ticket: { id: "k1", subject: "A porta", at: 7 } }))
    for (let seq = 10; seq < 10 + HISTORY_MAX_PER_CHANNEL + 10; seq++) appendHistory(c, SALA, mensagem(seq))

    expect(c.history[SALA]).toHaveLength(HISTORY_MAX_PER_CHANNEL)
    expect(c.estadoDoCanal[SALA]?.map((e) => e.payload.t)).toEqual(["post", "post.comment", "post.reaction", "redact", "edit", "message"])
    // And message 1, which the tombstone deletes, left with the cap: the tombstone
    // stays, so the message does not come back from a retry.
    expect(entradasDoCanal(c, SALA).some((e) => e.payload["id"] === "m1")).toBe(false)
  })

  it("cada tipo tem tecto próprio, e acima dele sai o mais antigo desse tipo", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(0, ANA, { t: "post.comment", id: "c0", target: "p", body: "fica", postedAt: 0 }))
    for (let i = 1; i <= TECTOS_DO_ESTADO.publicacao + 5; i++) {
      appendHistory(c, SALA, entrada(i, ANA, { t: "post", id: `p${i}`, postedAt: i, caption: "x" }))
    }
    const lista = c.estadoDoCanal[SALA] ?? []
    expect(lista.filter((e) => e.payload.t === "post")).toHaveLength(TECTOS_DO_ESTADO.publicacao)
    expect(lista.find((e) => e.payload.t === "post")?.payload["id"]).toBe("p6")
    // The post cap does not include the comment.
    expect(lista.some((e) => e.payload["id"] === "c0")).toBe(true)
  })

  it("nas emendas saem primeiro as edições, e a lápide de um alvo ainda guardado nunca sai", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(1, ANA, { t: "post", id: "vivo", postedAt: 1, caption: "x" }))
    appendHistory(c, SALA, entrada(2, ANA, { t: "redact", id: "r-vivo", target: "vivo", redactedAt: 2 }))
    appendHistory(c, SALA, entrada(3, ANA, { t: "redact", id: "r-morto", target: "ja-nao-esta", redactedAt: 3 }))
    for (let i = 0; i < TECTOS_DO_ESTADO.emenda; i++) {
      appendHistory(c, SALA, entrada(10 + i, ANA, { t: "edit", id: `e${i}`, target: "vivo", body: "b", editedAt: i }))
    }
    const lista = c.estadoDoCanal[SALA] ?? []
    expect(lista.filter((e) => tipoDoEstado(e) === "emenda")).toHaveLength(TECTOS_DO_ESTADO.emenda)
    // Two more: the two oldest edits left, and the tombstones stayed.
    expect(lista.some((e) => e.payload["id"] === "r-vivo")).toBe(true)
    expect(lista.some((e) => e.payload["id"] === "r-morto")).toBe(true)
    expect(lista.some((e) => e.payload["id"] === "e0")).toBe(false)
    expect(lista.some((e) => e.payload["id"] === "e1")).toBe(false)
    expect(lista.some((e) => e.payload["id"] === "e2")).toBe(true)
  })
  it("só com lápides acima do tecto, sai a mais antiga de um alvo que já não está, e nunca a de um alvo guardado", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(1, ANA, { t: "post", id: "vivo", postedAt: 1, caption: "x" }))
    appendHistory(c, SALA, entrada(2, ANA, { t: "redact", id: "r-vivo", target: "vivo", redactedAt: 2 }))
    for (let i = 0; i < TECTOS_DO_ESTADO.emenda; i++) {
      appendHistory(c, SALA, entrada(10 + i, ANA, { t: "redact", id: `r${i}`, target: `morto${i}`, redactedAt: i }))
    }
    const lista = c.estadoDoCanal[SALA] ?? []
    expect(lista.filter((e) => tipoDoEstado(e) === "emenda")).toHaveLength(TECTOS_DO_ESTADO.emenda)
    expect(lista.some((e) => e.payload["id"] === "r-vivo")).toBe(true)
    expect(lista.some((e) => e.payload["id"] === "r0")).toBe(false)
  })
})

describe("deduplicação por chave de evento (S1, §7.4)", () => {
  it("o mesmo seq entra uma vez, mesmo por caminhos diferentes", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, mensagem(5))
    appendHistory(c, SALA, mensagem(5))
    mergeOlderHistory(c, SALA, [mensagem(5), mensagem(4)])
    expect(entradasDoCanal(c, SALA).map((e) => e.seq)).toEqual([4, 5])
  })

  it("um comentário, um voto e um ticket reenviados com seq novo são o mesmo evento", () => {
    const c = newVaultContents()
    const comentario = { t: "post.comment", id: "c1", target: "p", body: "olá", postedAt: 1 }
    const voto = { t: "post.reaction", id: "v1", target: "p", emoji: "", vote: 1, at: 1 }
    const ticket = { t: "message", id: "t1", body: "porta", ticket: { id: "k", subject: "porta", at: 1 } }
    for (const [i, payload] of [comentario, voto, ticket].entries()) {
      appendHistory(c, SALA, entrada(10 + i, BRUNO, payload))
      appendHistory(c, SALA, entrada(100 + i, BRUNO, payload))
      mergeOlderHistory(c, SALA, [entrada(1 + i, BRUNO, payload)])
    }
    expect(entradasDoCanal(c, SALA).map((e) => e.seq)).toEqual([10, 11, 12])
  })

  it("o mesmo id de outra pessoa é outro evento: ninguém esconde a mensagem de outro", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(1, ANA, { t: "message", id: "igual", body: "da Ana" }))
    appendHistory(c, SALA, entrada(2, BRUNO, { t: "message", id: "igual", body: "do Bruno" }))
    expect(entradasDoCanal(c, SALA)).toHaveLength(2)
  })

  it("a caixa de saída que reenvia a mesma mensagem nossa não a duplica", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(-1, ANA, { t: "message", id: "minha", body: "olá" }, { apos: 3 }))
    appendHistory(c, SALA, entrada(-1, ANA, { t: "message", id: "minha", body: "olá" }, { apos: 3 }))
    expect(entradasDoCanal(c, SALA)).toHaveLength(1)
  })
})

describe("o seq do eco (S1, §7.2)", () => {
  it("o envio nosso guardado com -1 passa a ter o seq do servidor, e perde a marca apos", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, entrada(-1, ANA, { t: "post.comment", id: "c1", target: "p", body: "x", postedAt: 1 }, { apos: 7 }))
    expect(confirmarSeq(c, SALA, `post.comment|${ANA}|c1`, 9)).toBe(true)
    expect(c.estadoDoCanal[SALA]?.[0]).toMatchObject({ seq: 9 })
    expect(c.estadoDoCanal[SALA]?.[0]?.apos).toBeUndefined()
    // The same echo from another path changes nothing.
    expect(confirmarSeq(c, SALA, `post.comment|${ANA}|c1`, 9)).toBe(false)
  })
})

describe("F11: atribuição de cargos pelo carimbo original", () => {
  it("vence o carimbo maior, seja qual for a ordem de chegada; o seq desempata", () => {
    const ordens = [
      [{ roles: ["porteiro"], at: 10, seq: 5 }, { roles: [], at: 20, seq: 3 }, { roles: ["velho"], at: 20, seq: 2 }],
      [{ roles: ["velho"], at: 20, seq: 2 }, { roles: ["porteiro"], at: 10, seq: 5 }, { roles: [], at: 20, seq: 3 }],
      [{ roles: [], at: 20, seq: 3 }, { roles: ["velho"], at: 20, seq: 2 }, { roles: ["porteiro"], at: 10, seq: 5 }],
    ]
    for (const ordem of ordens) {
      const c = newVaultContents()
      for (const { roles, at, seq } of ordem) aplicarAtribuicao(c, SALA, BRUNO, roles, { at, seq, por: ANA })
      // Timestamp 20 beats 10; between the two with timestamp 20, seq 3 beats 2.
      expect(c.channelMemberRoles[SALA]?.[BRUNO]).toEqual([])
      expect(c.channelMemberRolesAt?.[SALA]?.[BRUNO]).toEqual({ at: 20, seq: 3, por: ANA })
    }
  })

  it("um reenvio com o carimbo original não desfaz uma mudança mais nova", () => {
    const c = newVaultContents()
    aplicarAtribuicao(c, SALA, BRUNO, [], { at: 30, seq: 9, por: ANA })
    expect(aplicarAtribuicao(c, SALA, BRUNO, ["porteiro"], { at: 10, seq: 50, por: ANA })).toBe(false)
    expect(c.channelMemberRoles[SALA]?.[BRUNO]).toEqual([])
  })
})

describe("entradasDoCanal", () => {
  it("junta as duas listas pela ordem do servidor, sem mudar a ordem de cada uma", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, mensagem(1))
    appendHistory(c, SALA, entrada(2, ANA, { t: "post", id: "p", postedAt: 2, caption: "x" }))
    appendHistory(c, SALA, mensagem(3))
    appendHistory(c, SALA, entrada(-1, ANA, { t: "post.comment", id: "c", target: "p", body: "x", postedAt: 4 }, { apos: 3 }))
    appendHistory(c, SALA, mensagem(5))
    expect(entradasDoCanal(c, SALA).map((e) => e.payload["id"])).toEqual(["m1", "p", "m3", "c", "m5"])
  })
})

// ------------------------------------------------------------------ migration

class Disco implements VaultBackend {
  bytes: Uint8Array | null = null
  readonly supportsOsProtection = true
  async read(): Promise<Uint8Array | null> {
    return this.bytes
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes
  }
  async clear(): Promise<void> {
    this.bytes = null
  }
  async wrapKey(key: Uint8Array): Promise<Uint8Array> {
    return key
  }
  async unwrapKey(wrapped: Uint8Array): Promise<Uint8Array> {
    return wrapped
  }
}

/** Write to disk a version 1 vault with the given content, encrypted with the vault key. */
function gravarVersao1(disco: Disco, conteudo: Record<string, unknown>): void {
  const ficheiro = JSON.parse(semCabecalho(disco.bytes as Uint8Array) as string) as Record<string, string>
  const chave = fromBase64(ficheiro["wrappedKey"] as string)
  const nonce = crypto.getRandomValues(new Uint8Array(24))
  const cifra = xchacha20poly1305(chave, nonce).encrypt(new TextEncoder().encode(JSON.stringify(conteudo)))
  disco.bytes = comCabecalho(
    JSON.stringify({ ...ficheiro, version: 1, nonce: toBase64(nonce), ciphertext: toBase64(cifra) }),
  )
}

describe("o tecto dos tickets corta por ticket inteiro (achado 10 da revisão da 0.7.0)", () => {
  const acto = (seq: number, ticket: string, marca: Record<string, unknown> = {}, sender = ANA): StoredChatMessage =>
    entrada(seq, sender, { t: "message", id: `t${seq}`, body: `ticket ${seq}`, sentAt: seq, ticket: { id: ticket, at: seq, ...marca } })
  const doTicket = (c: ReturnType<typeof newVaultContents>, ticket: string) =>
    (c.estadoDoCanal[SALA] ?? []).filter((e) => (e.payload["ticket"] as { id?: unknown } | undefined)?.id === ticket)

  it("uma abertura antiga de um ticket aberto fica, e saem primeiro os fechados e as respostas", () => {
    const c = newVaultContents()
    // The oldest ticket, open: the open is the oldest entry in the ledger.
    appendHistory(c, SALA, acto(1, "velho", { subject: "A porta não fecha" }))
    // A closed ticket with three messages.
    appendHistory(c, SALA, acto(2, "fechado", { subject: "Resolvido" }))
    appendHistory(c, SALA, acto(3, "fechado"))
    appendHistory(c, SALA, acto(4, "fechado", { state: "closed" }, BRUNO))
    // Replies that fill the ledger to the cap and spill over.
    for (let i = 0; i < TECTOS_DO_ESTADO.ticket; i++) appendHistory(c, SALA, acto(10 + i, "velho", {}, BRUNO))

    const lista = c.estadoDoCanal[SALA] ?? []
    expect(lista.filter((e) => tipoDoEstado(e) === "ticket").length).toBeLessThanOrEqual(TECTOS_DO_ESTADO.ticket)
    // The open ticket's opening stays: the frame still knows the subject and owner.
    expect(doTicket(c, "velho").some((e) => (e.payload["ticket"] as { subject?: unknown }).subject === "A porta não fecha")).toBe(true)
    // The closed one left entirely, not just the opening.
    expect(doTicket(c, "fechado")).toHaveLength(0)
  })

  it("só com tickets abertos, saem as respostas mais antigas e nenhuma abertura nem decisão", () => {
    const c = newVaultContents()
    appendHistory(c, SALA, acto(1, "a", { subject: "Primeiro" }))
    appendHistory(c, SALA, acto(2, "a", { state: "working" }, BRUNO))
    appendHistory(c, SALA, acto(3, "b", { subject: "Segundo" }))
    for (let i = 0; i < TECTOS_DO_ESTADO.ticket; i++) appendHistory(c, SALA, acto(10 + i, i % 2 === 0 ? "a" : "b", {}, BRUNO))

    const lista = c.estadoDoCanal[SALA] ?? []
    expect(lista.filter((e) => tipoDoEstado(e) === "ticket")).toHaveLength(TECTOS_DO_ESTADO.ticket)
    const ids = new Set(lista.map((e) => e.payload["id"]))
    for (const id of ["t1", "t2", "t3"]) expect(ids.has(id)).toBe(true)
    // The three oldest replies left.
    for (const id of ["t10", "t11", "t12"]) expect(ids.has(id)).toBe(false)
    expect(ids.has("t13")).toBe(true)
  })
})

describe("migração do cofre da versão 1 para a 2", () => {
  it("uma entrada estragada num canal não impede o cofre de abrir, e os outros canais migram (achado 15)", async () => {
    const disco = new Disco()
    await new Vault(disco).create(null)
    const antigo = newVaultContents() as unknown as Record<string, unknown>
    delete antigo["estadoDoCanal"]
    antigo["history"] = {
      "!estragado:s": [mensagem(1), null, entrada(3, ANA, { t: "post", id: "p", postedAt: 3, caption: "x" })],
      [SALA]: [mensagem(1), entrada(2, ANA, { t: "post", id: "p", postedAt: 2, caption: "mural" })],
    }
    gravarVersao1(disco, antigo)

    const vault = new Vault(disco)
    await vault.unlock()
    expect(vault.contents.history[SALA]?.map((e) => e.payload["id"])).toEqual(["m1"])
    expect(vault.contents.estadoDoCanal[SALA]?.map((e) => e.payload["id"])).toEqual(["p"])
    // The broken channel stays as it was: nothing is lost, nothing breaks mid-way.
    expect(vault.contents.history["!estragado:s"]).toHaveLength(3)
    expect(vault.contents.estadoDoCanal["!estragado:s"]).toBeUndefined()
  })

  it("lê um cofre antigo sem perder nada: o estado passa para o livro, a conversa fica, e grava-se como 2", async () => {
    expect(VERSAO_DO_COFRE).toBe(2)
    const disco = new Disco()
    await new Vault(disco).create(null)

    const antigo = newVaultContents() as unknown as Record<string, unknown>
    delete antigo["estadoDoCanal"]
    antigo["history"] = {
      [SALA]: [
        mensagem(1),
        entrada(2, ANA, { t: "post", id: "p", postedAt: 2, caption: "mural" }),
        // An old send of ours with no seq: its sort key is the highest seq before it IN THE WHOLE LIST (2), and migration writes it.
        entrada(-1, ANA, { t: "post.comment", id: "c", target: "p", body: "meu", postedAt: 3 }),
        mensagem(4),
        entrada(5, BRUNO, { t: "friend.request", sentAt: 5 }),
      ],
    }
    antigo["livroHerdado"] = {
      [DM_A_B]: [{ seq: 9, sender: BRUNO, t: "friend.accept", sentAt: 9 }],
    }
    gravarVersao1(disco, antigo)

    const vault = new Vault(disco)
    await vault.unlock()
    const c = vault.contents
    expect(c.history[SALA]?.map((e) => e.payload["id"])).toEqual(["m1", "m4"])
    expect(c.estadoDoCanal[SALA]?.map((e) => e.payload.t)).toEqual(["post", "post.comment", "friend.request"])
    expect(c.estadoDoCanal[SALA]?.[1]?.apos).toBe(2)
    expect(c.estadoDoCanal[DM_A_B]).toEqual([
      { seq: 9, sender: BRUNO, at: 9, herdado: true, payload: { t: "friend.accept", sentAt: 9 } },
    ])
    expect(c.livroHerdado).toBeUndefined()
    // The order read by folds is the same as before migration.
    expect(entradasDoCanal(c, SALA).map((e) => e.payload["id"] ?? e.payload.t)).toEqual(["m1", "p", "c", "m4", "friend.request"])

    // The next write saves version 2, and reopening gives the same thing.
    await vault.update(() => {})
    const ficheiro = JSON.parse(semCabecalho(disco.bytes as Uint8Array) as string) as { version: number }
    expect(ficheiro.version).toBe(2)
    const reaberto = new Vault(disco)
    await reaberto.unlock()
    expect(reaberto.contents.estadoDoCanal).toEqual(c.estadoDoCanal)
    expect(reaberto.contents.history).toEqual(c.history)
  })

  it("um cofre sem o campo `version` conta como versão 1, e migra", async () => {
    const disco = new Disco()
    await new Vault(disco).create(null)
    const antigo = newVaultContents() as unknown as Record<string, unknown>
    delete antigo["estadoDoCanal"]
    antigo["history"] = { [SALA]: [entrada(1, ANA, { t: "post", id: "p", postedAt: 1, caption: "x" })] }
    gravarVersao1(disco, antigo)
    const ficheiro = JSON.parse(semCabecalho(disco.bytes as Uint8Array) as string) as Record<string, unknown>
    delete ficheiro["version"]
    disco.bytes = comCabecalho(JSON.stringify(ficheiro))

    const vault = new Vault(disco)
    await vault.unlock()
    expect(vault.contents.history[SALA]).toEqual([])
    expect(vault.contents.estadoDoCanal[SALA]).toHaveLength(1)
  })
})

describe("a base64 da cifra do cofre", () => {
  it("é igual à do protocolo, nos dois sentidos, em todos os tamanhos de resto", () => {
    for (let n = 0; n < 70; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n))
      const texto = toBase64(bytes)
      expect(bytesParaBase64(bytes)).toBe(texto)
      expect([...base64ParaBytes(texto)]).toEqual([...bytes])
      expect([...base64ParaBytes(texto)]).toEqual([...fromBase64(texto)])
    }
    const grande = crypto.getRandomValues(new Uint8Array(60_000))
    expect(bytesParaBase64(grande)).toBe(toBase64(grande))
    // The classic alphabet and padding, which the protocol one also accepts.
    expect([...base64ParaBytes("+/8=")]).toEqual([...fromBase64("+/8=")])
    expect(() => base64ParaBytes("a$b")).toThrow("the vault file is damaged")
  })
})
