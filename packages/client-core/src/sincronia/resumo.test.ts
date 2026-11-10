import { describe, expect, it } from "vitest"
import { newVaultContents, type StoredChatMessage, type VaultContents } from "../vault.js"
import {
  baldesDiferentes,
  bytesDoNivel0,
  instantaneoDoCanal,
  itensDoCanal,
  resumoDoCanal,
  resumoNivel1,
  resumoNivel2,
  tiposDiferentes,
  TIPOS_DO_RESUMO,
} from "./resumo.js"

const CANAL = "!lagar:localhost"
const ANA = "@ana:localhost"
const BRUNO = "@bruno:localhost"
const DIA = Date.UTC(2026, 9, 20, 12)

/** A fixed pseudo-random generator, so shuffling is repeatable. */
function gerador(semente: number): () => number {
  let s = semente >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function baralhar<T>(lista: readonly T[], semente: number): T[] {
  const aleatorio = gerador(semente)
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j]!, copia[i]!]
  }
  return copia
}

let contador = 0
function entrada(seq: number, sender: string, payload: StoredChatMessage["payload"], at = DIA): StoredChatMessage {
  return { seq, sender, at, payload }
}
const id = (): string => `id-${String(++contador).padStart(6, "0")}`

/** A channel with a bit of everything: conversation, wall, tickets, reactions, and state. */
function canalCheio(): VaultContents {
  const c = newVaultContents()
  const post = id()
  const historia: StoredChatMessage[] = []
  let seq = 10
  for (let i = 0; i < 12; i++) {
    historia.push(entrada(seq++, i % 2 ? ANA : BRUNO, { t: "message", id: id(), sentAt: DIA + i * 3_600_000, body: `olá ${i}` }))
  }
  historia.push(entrada(seq++, ANA, { t: "post", id: post, postedAt: DIA, caption: "mural", media: [{ inline: "AAAA".repeat(500) }] }))
  historia.push(entrada(seq++, BRUNO, { t: "post.comment", id: id(), target: post, postedAt: DIA, body: "bom" }))
  historia.push(entrada(seq++, BRUNO, { t: "post.reaction", id: id(), target: post, emoji: "👍", at: DIA, remove: false }))
  historia.push(entrada(seq++, ANA, { t: "post.reaction", id: id(), target: post, emoji: "", at: DIA, remove: false, vote: 1 }))
  historia.push(entrada(seq++, ANA, { t: "message", id: id(), sentAt: DIA, body: "abre", ticket: { id: "tk-1", subject: "x", at: DIA } }))
  historia.push(entrada(seq++, ANA, { t: "reaction", target: "m", emoji: "❤️", remove: false }))
  historia.push(entrada(seq++, ANA, { t: "reaction", target: "m", emoji: "❤️", remove: true }))
  historia.push(entrada(seq++, BRUNO, { t: "reaction", target: "m", emoji: "😀", remove: false }))
  historia.push(entrada(seq++, ANA, { t: "redact", id: id(), target: "m-outra", redactedAt: DIA }))
  historia.push(entrada(seq++, ANA, { t: "typing", until: 0 }))
  c.history[CANAL] = historia
  c.channelFounder[CANAL] = { address: ANA, seq: 1 }
  c.channelRoles[CANAL] = { porteiro: { at: DIA, payload: { t: "role.define", role: "porteiro", definedAt: DIA } } }
  c.channelMemberRoles[CANAL] = { [BRUNO]: ["porteiro"] }
  c.channelAdmins[CANAL] = [ANA, BRUNO]
  c.spaceMeta[CANAL] = { at: DIA, payload: { t: "space.meta", name: "Lagar", updatedAt: DIA } }
  c.channelRooms[CANAL] = {
    geral: { at: DIA, payload: { t: "channel.meta", room: "geral", name: "Geral", updatedAt: DIA, pinned: [{ id: "m2" }, { id: "m1" }] } },
  }
  c.directory[BRUNO] = { at: DIA, payload: { t: "profile", displayName: "Bruno", updatedAt: DIA } }
  c.profile = { displayName: "Ana", donations: [], updatedAt: DIA }
  return c
}

describe("resumo do canal (S0)", () => {
  it("tem todos os tipos no nível 0, mesmo os vazios, e cabe em menos de 240 bytes", () => {
    const resumo = resumoDoCanal(newVaultContents(), CANAL)
    expect(Object.keys(resumo)).toEqual([...TIPOS_DO_RESUMO])
    expect(resumo.mensagem.n).toBe(0)
    expect(bytesDoNivel0(resumo)).toBeLessThanOrEqual(240)
  })

  it("propriedade: baralhar o histórico não muda nenhum dos três níveis", () => {
    const c = canalCheio()
    const opcoes = { membros: [ANA, BRUNO], proprio: ANA }
    const base = resumoDoCanal(c, CANAL, opcoes)
    const itensBase = itensDoCanal(c, CANAL, opcoes)
    for (let semente = 1; semente <= 25; semente++) {
      const outro = canalCheio()
      // IDs change with each `canalCheio`: the history is copied from the database and shuffled.
      outro.history[CANAL] = baralhar(c.history[CANAL] ?? [], semente)
      expect(resumoDoCanal(outro, CANAL, opcoes)).toEqual(base)
      const itens = itensDoCanal(outro, CANAL, opcoes)
      for (const tipo of TIPOS_DO_RESUMO) {
        expect(resumoNivel1(itens, tipo)).toEqual(resumoNivel1(itensBase, tipo))
      }
      expect(resumoNivel2(itens, "mensagem", "2026-10-20")).toEqual(resumoNivel2(itensBase, "mensagem", "2026-10-20"))
    }
  })

  it("um item repetido conta uma vez (relatado e depois recuperado)", () => {
    const c = canalCheio()
    const antes = resumoDoCanal(c, CANAL)
    const historia = c.history[CANAL] ?? []
    c.history[CANAL] = [...historia, historia[0]!, historia[12]!]
    expect(resumoDoCanal(c, CANAL)).toEqual(antes)
  })

  it("classifica cada payload no seu tipo, e dobra as reacções sem id", () => {
    const r = resumoDoCanal(canalCheio(), CANAL, { membros: [ANA, BRUNO], proprio: ANA })
    expect(r.mensagem.n).toBe(12)
    expect(r.publicacao.n).toBe(1)
    expect(r.comentario.n).toBe(1)
    expect(r.gosto.n).toBe(1)
    expect(r.voto.n).toBe(1)
    expect(r.ticket.n).toBe(1)
    expect(r.apagamento.n).toBe(1)
    // Ana's ❤️ was removed; only Bruno's 😀 stays.
    expect(r.reaccao.n).toBe(1)
    expect(r.fundador.n).toBe(1)
    expect(r.cargo.n).toBe(1)
    // Bruno by the new list, Ana by the old admin list.
    expect(r.atribuicao.n).toBe(2)
    expect(r.letreiro.n).toBe(1)
    expect(r.sala.n).toBe(1)
    expect(r.fixadas.n).toBe(1)
    expect(r.perfil.n).toBe(2)
  })

  it("a janela corta só as mensagens anteriores ao lugar, e nunca o mural", () => {
    const c = canalCheio()
    const sem = resumoDoCanal(c, CANAL)
    const com = resumoDoCanal(c, CANAL, { desde: 16 })
    expect(com.mensagem.n).toBe(sem.mensagem.n - 6)
    expect(com.publicacao).toEqual(sem.publicacao)
    expect(com.ticket).toEqual(sem.ticket)
  })

  it("um envio nosso sem seq (-1) não entra na janela; com o seq do eco, entra se estiver dentro dela (S1)", () => {
    const c = canalCheio()
    const meu = entrada(-1, ANA, { t: "message", id: id(), sentAt: DIA, body: "meu" })
    c.history[CANAL]?.push(meu)
    // Without echo, there is no placement: the place rule does not give what it cannot place.
    expect(resumoDoCanal(c, CANAL, { desde: 1_000 }).mensagem.n).toBe(0)
    expect(instantaneoDoCanal(c, CANAL, { desde: 1_000 }).porParte["mensagens-da-janela"]?.n).toBe(0)
    // With the echo seq below the place: still out (this was the S0 finding).
    meu.seq = 999
    expect(resumoDoCanal(c, CANAL, { desde: 1_000 }).mensagem.n).toBe(0)
    expect(instantaneoDoCanal(c, CANAL, { desde: 1_000 }).porParte["mensagens-da-janela"]?.n).toBe(0)
    // Inside the window: it enters.
    meu.seq = 1_001
    expect(resumoDoCanal(c, CANAL, { desde: 1_000 }).mensagem.n).toBe(1)
  })

  it("um envio sem eco com a marca da ordem (apos) entra na janela por apos + 1 (revisão de S1+S2)", () => {
    const c = canalCheio()
    // An old send from a 0.6.0: -1 forever, but it came after seq 1.004.
    const antigo: StoredChatMessage = { ...entrada(-1, ANA, { t: "message", id: id(), sentAt: DIA, body: "antigo" }), apos: 1_004 }
    c.history[CANAL]?.push(antigo)
    // The real seq is at least 1.005: inside a window that starts at 1.005.
    expect(resumoDoCanal(c, CANAL, { desde: 1_005 }).mensagem.n).toBe(1)
    expect(instantaneoDoCanal(c, CANAL, { desde: 1_005 }).porParte["mensagens-da-janela"]?.n).toBe(1)
    // Outside a window that starts later: we cannot know if the real seq reaches it.
    expect(resumoDoCanal(c, CANAL, { desde: 1_006 }).mensagem.n).toBe(0)
    expect(instantaneoDoCanal(c, CANAL, { desde: 1_006 }).porParte["mensagens-da-janela"]?.n).toBe(0)
  })

  it("um item com lápide não conta, mesmo com a lápide fora da janela (S4)", () => {
    const c = newVaultContents()
    c.history[CANAL] = [
      entrada(5, ANA, { t: "post", id: "post-apagado", postedAt: DIA, caption: "some" }),
      entrada(6, ANA, { t: "post", id: "post-fica-00", postedAt: DIA, caption: "fica" }),
      entrada(7, ANA, { t: "redact", id: "lapide-00000", target: "post-apagado", redactedAt: DIA }),
    ]
    // Who joined after the tombstone (window 100) does not have the post and receives the tombstone by report: the wall has no window.
    const comLapide = resumoDoCanal(c, CANAL, { desde: 100 })
    expect(comLapide.publicacao.n).toBe(1)
    expect(comLapide.apagamento.n).toBe(1)
  })

  it("a lápide de um alvo do mural fica sem janela; a de uma mensagem fica com ela (revisão de S4, achado 2)", () => {
    const c = newVaultContents()
    c.history[CANAL] = [entrada(5, ANA, { t: "message", id: "msg-apagada0", sentAt: DIA, body: "x" })]
    c.estadoDoCanal = {
      [CANAL]: [
        entrada(6, ANA, { t: "post", id: "post-apagado", postedAt: DIA, caption: "some" }),
        entrada(7, ANA, { t: "redact", id: "lapide-post0", target: "post-apagado", redactedAt: DIA }),
        entrada(8, ANA, { t: "redact", id: "lapide-msg00", target: "msg-apagada0", redactedAt: DIA }),
        // Target not in the vault: with window, unless we know it is a wall post.
        entrada(9, ANA, { t: "redact", id: "lapide-sem00", target: "alvo-sumido", redactedAt: DIA }),
      ],
    }
    const chaves = (): string[] => itensDoCanal(c, CANAL, { desde: 100 }).filter((i) => i.tipo === "apagamento").map((i) => i.chave)
    expect(chaves()).toEqual([`apagamento|${ANA}|lapide-post0`])
    ;(c as { sincronia?: { alvosDoMural?: Record<string, string[]> } }).sincronia = { alvosDoMural: { [CANAL]: ["alvo-sumido"] } }
    expect(chaves().sort()).toEqual([`apagamento|${ANA}|lapide-post0`, `apagamento|${ANA}|lapide-sem00`])
  })

  it("só a lápide do autor do alvo tira o alvo do resumo, como na dobra (revisão de S4, achado 7)", () => {
    const c = newVaultContents()
    c.history[CANAL] = [
      entrada(5, ANA, { t: "post", id: "post-da-ana0", postedAt: DIA, caption: "da Ana" }),
      entrada(6, ANA, { t: "message", id: "msg-da-ana00", sentAt: DIA, body: "x" }),
      entrada(7, BRUNO, { t: "redact", id: "lapide-bru0", target: "post-da-ana0", redactedAt: DIA }),
      entrada(8, BRUNO, { t: "reaction", target: "msg-da-ana00", emoji: "👍", remove: false }),
      entrada(9, BRUNO, { t: "redact", id: "lapide-bru1", target: "msg-da-ana00", redactedAt: DIA }),
    ]
    const r = resumoDoCanal(c, CANAL)
    expect(r.publicacao.n).toBe(1)
    expect(r.mensagem.n).toBe(1)
    expect(r.reaccao.n).toBe(1)
    // Ana's own tombstone removes the message and Bruno's reaction to it.
    c.history[CANAL].push(entrada(10, ANA, { t: "redact", id: "lapide-ana0", target: "msg-da-ana00", redactedAt: DIA }))
    const depois = resumoDoCanal(c, CANAL)
    expect(depois.mensagem.n).toBe(0)
    expect(depois.reaccao.n).toBe(0)
    expect(depois.publicacao.n).toBe(1)
  })

  it("os níveis 1 e 2 apontam o balde e o item que faltam", () => {
    const a = canalCheio()
    const b = canalCheio()
    b.history[CANAL] = [...(a.history[CANAL] ?? [])]
    const perdida = b.history[CANAL].splice(3, 1)[0]!
    const ia = itensDoCanal(a, CANAL)
    const ib = itensDoCanal(b, CANAL)
    expect(tiposDiferentes(resumoDoCanal(a, CANAL), resumoDoCanal(b, CANAL))).toEqual(["mensagem"])
    const baldes = baldesDiferentes(resumoNivel1(ia, "mensagem"), resumoNivel1(ib, "mensagem"))
    expect(baldes).toEqual([new Date(perdida.payload["sentAt"] as number).toISOString().slice(0, 10)])
    const na = resumoNivel2(ia, "mensagem", baldes[0]!)
    const nb = resumoNivel2(ib, "mensagem", baldes[0]!)
    expect(na.filter((k) => !nb.includes(k))).toHaveLength(1)
    expect(na[0]).toMatch(/^[0-9a-f]{12}$/)
  })

  it("o instantâneo segue a ordem do §5.2 e não leva os bytes dos anexos", () => {
    const c = canalCheio()
    const inst = instantaneoDoCanal(c, CANAL, { membros: [ANA, BRUNO], proprio: ANA })
    expect(Object.keys(inst.porParte)[0]).toBe("fundador")
    expect(JSON.stringify(inst.payloads)).not.toContain("AAAA")
    expect(inst.porParte["publicacoes"]?.n).toBe(1)
    expect(inst.bytes).toBe(Object.values(inst.porParte).reduce((s, p) => s + p.bytes, 0))
  })
})
