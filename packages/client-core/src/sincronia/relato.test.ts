import { ed25519 } from "@noble/curves/ed25519.js"
import { toBase64, type ItemRelatado } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import type { StoredPayload } from "../vault.js"
import { comAutoria } from "./pedido.js"
import { aparelhoPeloManifesto, lerQ, normalizar, partirRelatos, prepararItem, receberItem, type ContextoDaRecepcao, type QuemRelata } from "./relato.js"
import { itemApagado, itemDoPayload, lapidesDoCanal } from "./resumo.js"
import { appendHistory, newVaultContents } from "../vault.js"
import { TECTOS_DA_SINCRONIA } from "./eleicao.js"

const CANAL = "!lagar:orwell.test"
const ANA = "@ana:orwell.test"
const BRUNO = "@bruno:orwell.test"

function aparelho(semente: number): QuemRelata & { chave: string } {
  const privada = new Uint8Array(32).fill(semente)
  const publica = ed25519.getPublicKey(privada)
  return { address: semente === 1 ? ANA : BRUNO, aparelho: publica, assinar: (m) => ed25519.sign(m, privada), chave: toBase64(publica) }
}
const ana = aparelho(1)
const bruno = aparelho(2)

const ANEXO = { name: "foto.png", mediaType: "image/png", inline: "data:image/png;base64,QUFB", byteLength: 3 }

function mensagemDaAna(corpo = "olá", extra: Record<string, unknown> = {}): StoredPayload {
  return comAutoria(CANAL, { t: "message", id: `id-${corpo.padEnd(10, "x")}`, sentAt: 1, body: corpo, ...extra } as never, ana) as unknown as StoredPayload
}

function contexto(sobre: Partial<ContextoDaRecepcao> = {}): ContextoDaRecepcao {
  return {
    canal: CANAL,
    seqDaTrama: 100,
    lugar: 10,
    jaTemos: () => false,
    apagado: () => false,
    itemDe: (autor, payload) => itemDoPayload(autor, payload, CANAL),
    aparelhoConfiavel: async (autor, chave) => (autor === ANA && chave === ana.chave) || (autor === BRUNO && chave === bruno.chave),
    bloqueado: () => false,
    ...sobre,
  }
}

describe("preparar um relato", () => {
  it("leva o payload com a autoria e sem os bytes dos anexos", () => {
    const payload = mensagemDaAna("com foto", { attachments: [ANEXO] })
    const item = prepararItem(CANAL, { autor: ANA, seq: 42, payload }, bruno, null)!
    expect(item.s).toBe(42)
    expect(item.a).toBe(ANA)
    expect(JSON.stringify(item)).not.toContain("QUFB")
    expect(item.p["attachments"]).toEqual([{ evicted: true, name: "foto.png", mediaType: "image/png" }])
    expect(item.p["autoria"]).toEqual((payload as Record<string, unknown>)["autoria"])
  })

  it("sem autoria: o próprio autor assina agora; de outra pessoa não se relata", () => {
    const semAutoria = { t: "message", id: "id-antiga-000", sentAt: 1, body: "antiga" } as StoredPayload
    expect(prepararItem(CANAL, { autor: ANA, seq: 5, payload: semAutoria }, bruno, null)).toBeNull()
    const proprio = prepararItem(CANAL, { autor: ANA, seq: 5, payload: semAutoria }, ana, null)
    expect(proprio?.p["autoria"]).toBeDefined()
  })

  it("sem autoria e com o anexo já despejado: nem o próprio a pode assinar", () => {
    const despejada = { t: "message", id: "id-antiga-000", sentAt: 1, body: "x", attachments: [{ evicted: true, name: "a", mediaType: "b" }] }
    expect(prepararItem(CANAL, { autor: ANA, seq: 5, payload: despejada as StoredPayload }, ana, null)).toBeNull()
  })

  it("o perfil e o efémero não se relatam", () => {
    expect(prepararItem(CANAL, { autor: ANA, seq: 5, payload: { t: "profile", displayName: "Ana" } }, ana, null)).toBeNull()
    expect(prepararItem(CANAL, { autor: ANA, seq: 5, payload: { t: "typing", until: 0 } }, ana, null)).toBeNull()
  })
})

describe("receber um relato (as regras do §4.5, §5.3, §7)", () => {
  const relato = (payload: StoredPayload, s = 50, a = ANA): ItemRelatado => prepararItem(CANAL, { autor: a, seq: s, payload }, bruno, null)!

  it("um relato honesto passa, com o autor e o seq de origem", async () => {
    const veredicto = await receberItem(relato(mensagemDaAna()), contexto())
    expect(veredicto).toMatchObject({ ok: true, autor: ANA, seq: 50 })
  })

  it("um anexo despejado continua a verificar e grava-se como marcador", async () => {
    const veredicto = await receberItem(relato(mensagemDaAna("foto", { attachments: [ANEXO] })), contexto())
    expect(veredicto.ok).toBe(true)
    if (veredicto.ok) expect(veredicto.payload["attachments"]).toEqual([{ evicted: true, name: "foto.png", mediaType: "image/png" }])
  })

  it("relator mentiroso: o payload alterado com a autoria de outro é recusado", async () => {
    const item = relato(mensagemDaAna())
    const mentira = { ...item, p: { ...item.p, body: "a Ana nunca disse isto" } }
    expect(await receberItem(mentira, contexto())).toEqual({ ok: false, razao: "autoria" })
    // And putting someone else's name on the same signature does not pass either.
    expect(await receberItem({ ...item, a: BRUNO }, contexto())).toEqual({ ok: false, razao: "autoria" })
  })

  it("um aparelho revogado ou fora do manifesto é recusado", async () => {
    const veredicto = await receberItem(relato(mensagemDaAna()), contexto({ aparelhoConfiavel: async () => false }))
    expect(veredicto).toEqual({ ok: false, razao: "aparelho" })
  })

  it("a regra do lugar: conversa anterior ao lugar, ou com seq -1, não entra", async () => {
    expect(await receberItem(relato(mensagemDaAna(), 9), contexto())).toEqual({ ok: false, razao: "lugar" })
    expect(await receberItem(relato(mensagemDaAna(), -1), contexto())).toEqual({ ok: false, razao: "lugar" })
    expect((await receberItem(relato(mensagemDaAna(), 10), contexto())).ok).toBe(true)
  })

  it("o mural não tem janela: uma publicação de antes do lugar entra", async () => {
    const post = comAutoria(CANAL, { t: "post", id: "post-0000001", postedAt: 1, caption: "mural" } as never, ana) as unknown as StoredPayload
    expect((await receberItem(relato(post, 3), contexto())).ok).toBe(true)
  })

  it("nada relatado passa à frente do que o servidor ainda serve", async () => {
    expect(await receberItem(relato(mensagemDaAna(), 100), contexto())).toEqual({ ok: false, razao: "servidor-serve" })
  })

  it("o que já temos ganha, e o bloqueio filtra como ao vivo", async () => {
    expect(await receberItem(relato(mensagemDaAna()), contexto({ jaTemos: () => true }))).toEqual({ ok: false, razao: "ja-temos" })
    expect(await receberItem(relato(mensagemDaAna()), contexto({ bloqueado: () => true }))).toEqual({ ok: false, razao: "bloqueado" })
  })

  it("a lápide é absorvente: o que o cofre tem apagado pelo autor não volta por relato (revisão de S4, achado 2)", async () => {
    const cofre = newVaultContents()
    const post = comAutoria(CANAL, { t: "post", id: "post-apagado", postedAt: 1, caption: "apagada" } as never, ana) as unknown as StoredPayload
    const editada = mensagemDaAna("editada")
    const edicao = comAutoria(CANAL, { t: "edit", id: "edicao-00000", target: editada["id"], editedAt: 2, body: "y" } as never, ana) as unknown as StoredPayload
    appendHistory(cofre, CANAL, { seq: 3, sender: ANA, at: 3, payload: { t: "redact", id: "lapide-00000", target: "post-apagado", redactedAt: 3 } })
    appendHistory(cofre, CANAL, { seq: 4, sender: ANA, at: 4, payload: { t: "redact", id: "lapide-00001", target: editada["id"] as string, redactedAt: 4 } })
    const apagado: ContextoDaRecepcao["apagado"] = (item, autor, payload) => itemApagado(lapidesDoCanal(cofre, CANAL), item.tipo, autor, payload)
    expect(await receberItem(relato(post, 20), contexto({ apagado }))).toEqual({ ok: false, razao: "lapide" })
    expect(await receberItem(relato(editada, 20), contexto({ apagado }))).toEqual({ ok: false, razao: "lapide" })
    expect(await receberItem(relato(edicao, 20), contexto({ apagado }))).toEqual({ ok: false, razao: "lapide" })
    // Someone else's tombstone does not count (the fold rule): Bruno's post with the same id goes through.
    const doBruno = comAutoria(CANAL, { t: "post", id: "post-apagado", postedAt: 1, caption: "do Bruno" } as never, bruno) as unknown as StoredPayload
    expect((await receberItem(relato(doBruno, 20, BRUNO), contexto({ apagado }))).ok).toBe(true)
  })

  it("a lápide passa abaixo do lugar; abaixo da janela fica lembrada como do mural", async () => {
    const lapide = comAutoria(CANAL, { t: "redact", id: "lapide-00000", target: "post-sumido", redactedAt: 1 } as never, ana) as unknown as StoredPayload
    const marcados: string[] = []
    const veredicto = await receberItem(relato(lapide, 3), contexto({ janela: 40, alvoDoMural: (alvo) => marcados.push(alvo) }))
    expect(veredicto.ok).toBe(true)
    expect(marcados).toEqual(["post-sumido"])
    // Within the window it is a tombstone like any other: nothing to note.
    marcados.length = 0
    await receberItem(relato(lapide, 50), contexto({ janela: 40, alvoDoMural: (alvo) => marcados.push(alvo) }))
    expect(marcados).toEqual([])
  })

  it("um payload que o esquema recusa é lixo", async () => {
    const item = relato(mensagemDaAna())
    expect(await receberItem({ ...item, p: { ...item.p, sentAt: "ontem" } }, contexto())).toEqual({ ok: false, razao: "esquema" })
  })
})

describe("partir e numerar", () => {
  it("parte por bytes, e o q diz a parte e o total", () => {
    const grande = "x".repeat(15_000)
    const itens = Array.from({ length: 40 }, (_, i) => relatoCru(i, grande))
    const tramas = partirRelatos(itens, "pedido")
    expect(tramas.length).toBeGreaterThan(1)
    for (const trama of tramas) {
      expect(JSON.stringify(trama.itens).length).toBeLessThanOrEqual(TECTOS_DA_SINCRONIA.bytesPorTramaDeRelato + 16_000)
    }
    expect(tramas.flatMap((t) => t.itens)).toHaveLength(40)
    expect(lerQ(tramas[0]!.q)).toEqual({ id: "pedido", parte: 1, de: tramas.length })
    expect(lerQ("sem-forma")).toBeNull()
  })

  function relatoCru(i: number, corpo: string): ItemRelatado {
    return { s: i, a: ANA, p: { t: "message", id: `id-${i}-0000000`, sentAt: 1, body: corpo } }
  }
})

describe("normalizar", () => {
  it("preenche os valores por omissão, e um marcador de anexo volta a ser marcador", () => {
    const normal = normalizar({ t: "message", id: "id-00000000", sentAt: 1, body: "x", attachments: [{ evicted: true, name: "a", mediaType: "b" }] })
    expect(normal?.["mentions"]).toEqual([])
    expect(normal?.["attachments"]).toEqual([{ evicted: true, name: "a", mediaType: "b" }])
  })
})

describe("o aparelho fora da árvore, pela cadeia e pelo manifesto (revisão de S4, achado 4)", () => {
  const manifesto = { devices: [{ deviceKey: ana.aparelho }] }
  it("com o manifesto lido, só o aparelho que ele lista", () => {
    expect(aparelhoPeloManifesto({ lido: true, manifesto }, ana.chave)).toBe(true)
    expect(aparelhoPeloManifesto({ lido: true, manifesto }, bruno.chave)).toBe(false)
  })
  it("sem manifesto (a conta não tem), vale a cadeia", () => {
    expect(aparelhoPeloManifesto({ lido: true, manifesto: null }, bruno.chave)).toBe(true)
  })
  it('um manifesto que o relé calou não é "não há": recusa-se, e pergunta-se na passagem seguinte', () => {
    expect(aparelhoPeloManifesto({ lido: false, manifesto: null }, bruno.chave)).toBe(false)
    expect(aparelhoPeloManifesto({ lido: false, manifesto: null }, ana.chave)).toBe(false)
  })
})

describe("os anexos de um relato conferem com o `m` da autoria (revisão do vídeo, achado 1)", () => {
  const VIDEO = {
    url: "",
    key: "",
    nonce: "",
    digest: "",
    kind: "video",
    name: "praia.mp4",
    mediaType: "video/mp4",
    duration: 4,
    byteLength: 10,
    poster: "data:image/webp;base64,UklGRg==",
    partes: { n: 1, sha256: "A".repeat(43), bytes: 1024 * 1024 },
  }
  const MARCADOR_DO_VIDEO = { evicted: true, name: "praia.mp4", mediaType: "video/mp4" }

  function publicacao(media: unknown[]): StoredPayload {
    return comAutoria(CANAL, { t: "post", id: "post-0000001", postedAt: 1, caption: "praia", media } as never, ana) as unknown as StoredPayload
  }
  /** The report as written, with the full attachment (honest reporters remove the bytes). */
  const relatoInteiro = (payload: StoredPayload): ItemRelatado => ({ s: 50, a: ANA, p: payload as unknown as Record<string, unknown> })

  it("o anexo de vídeo honesto passa inteiro, com as partes e a miniatura", async () => {
    const veredicto = await receberItem(relatoInteiro(publicacao([VIDEO])), contexto())
    if (!veredicto.ok) expect.unreachable()
    expect((veredicto.payload["media"] as unknown[])[0]).toMatchObject({ partes: VIDEO.partes, poster: VIDEO.poster })
  })

  it("um relator que só troca `partes.sha256` (a autoria continua válida) grava o anexo sem partes", async () => {
    const payload = publicacao([VIDEO])
    const trocado = { ...payload, media: [{ ...VIDEO, partes: { ...VIDEO.partes, sha256: "B".repeat(43) } }] }
    const veredicto = await receberItem(relatoInteiro(trocado), contexto())
    if (!veredicto.ok) expect.unreachable()
    expect((veredicto.payload["media"] as unknown[])[0]).toEqual(MARCADOR_DO_VIDEO)
  })

  it("a miniatura trocada também não passa", async () => {
    const payload = publicacao([VIDEO])
    const trocado = { ...payload, media: [{ ...VIDEO, poster: "data:image/webp;base64,AAAA" }] }
    const veredicto = await receberItem(relatoInteiro(trocado), contexto())
    if (!veredicto.ok) expect.unreachable()
    expect((veredicto.payload["media"] as unknown[])[0]).toEqual(MARCADOR_DO_VIDEO)
  })

  it("uma fotografia `inline` trocada grava-se como marcador; a outra, honesta, fica", async () => {
    const outra = { name: "outra.png", mediaType: "image/png", inline: "data:image/png;base64,QkJC", byteLength: 3 }
    const payload = publicacao([ANEXO, outra])
    const trocado = { ...payload, media: [{ ...ANEXO, inline: "data:image/png;base64,WFhY" }, outra] }
    const veredicto = await receberItem(relatoInteiro(trocado), contexto())
    if (!veredicto.ok) expect.unreachable()
    const media = veredicto.payload["media"] as Record<string, unknown>[]
    expect(media[0]).toEqual({ evicted: true, name: "foto.png", mediaType: "image/png" })
    expect(media[1]).toMatchObject({ inline: outra.inline })
  })
})
