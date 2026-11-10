import { ed25519 } from "@noble/curves/ed25519.js"
import { abrirSinal, selarSinal } from "@enclave/crypto"
import { fromBase64, toBase64, type Payload, type RelatosNoFio } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appendHistory, entradasDoCanal, newVaultContents, type StoredPayload, type VaultContents } from "../vault.js"
import { TECTOS_DA_SINCRONIA, type Folha } from "./eleicao.js"
import {
  anexoConfere,
  anexoEm,
  comAnexo,
  posicaoDoAnexo,
  progressoDoInstantaneo,
  resumoDoAnexo,
  TECTOS_DOS_ANEXOS,
  TIPOS_DO_INSTANTANEO,
} from "./instantaneo.js"
import { _paraTestes, AntiEntropia, comAutoria, type PortaDaAntiEntropia } from "./pedido.js"
import type { QuemRelata } from "./relato.js"
import { chaveCurta, itemDoPayload, resumoDoCanal, resumoNivel0, TIPOS_COM_JANELA, TIPOS_DO_RESUMO, type TipoDoResumo } from "./resumo.js"

/**
 * The snapshot for late arrivals and attachments on demand (S5), on an in-memory
 * network like in `pedido.test.ts`: no MLS and no server (that is in
 * `apps/server/src/sincronia-s5.test.ts`). This measures the protocol: a request
 * of full type instead of descent, the order from §5.2, the position rule, the
 * state that the interface reads, and bytes verified against authorship.
 */

const CANAL = "!lagar:orwell.test"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(7) }

interface No {
  nome: string
  eu: QuemRelata
  folha: Folha
  contents: VaultContents
  anti: AntiEntropia
  lugar: number
  /** The types of reported items that this node recorded, in order. */
  gravados: TipoDoResumo[]
  /** The attachments recorded on demand. */
  anexos: { alvo: string; indice: number; anexo: Record<string, unknown> }[]
  /** How many times the session was notified of a state change. */
  mudancas: number
  /** This node's clock advanced by this amount (to make a per-minute cap pass without waiting). */
  desvio: number
}

class Rede {
  nos: No[] = []
  seq = 1_000
  emVoo = 0
  /** Alter the reports that a node sends, before they arrive (a lying reporter). `null` drops them. */
  adulterar: ((de: No, relatos: RelatosNoFio) => RelatosNoFio | null) | null = null
  /** Swap a signal that a node sends, before it arrives. */
  reescrever: ((de: No, sinal: string) => string) | null = null

  criar(nome: string, indice: number): No {
    const privada = new Uint8Array(32).fill(indice + 1)
    const eu: QuemRelata = {
      address: `@${nome}:orwell.test`,
      aparelho: ed25519.getPublicKey(privada),
      assinar: (m) => ed25519.sign(m, privada),
    }
    const contents = newVaultContents()
    const folha: Folha = { indice, address: eu.address, aparelho: toBase64(eu.aparelho) }
    const rede = this
    const porta: PortaDaAntiEntropia = {
      eu,
      conteudo: () => contents,
      podeSinalizar: () => true,
      elegivel: () => true,
      ehDirecta: () => false,
      membros: () => rede.nos.map((n) => n.eu.address),
      folhas: () => rede.nos.map((n) => n.folha),
      epocaAtual: () => 1n,
      derivarChave: async () => CHAVE,
      lugar: () => no.lugar,
      ancora: () => rede.seq,
      enviarSinal: (_canal, sinal) => {
        const saida = rede.reescrever ? rede.reescrever(no, sinal) : sinal
        rede.#entregar(no, (outro) => outro.anti.aoSinal({ channel: CANAL, from: eu.address, sinal: saida }))
      },
      enviarRelatos: async (_canal, relatos: RelatosNoFio) => {
        const seq = ++rede.seq
        const saida = rede.adulterar ? rede.adulterar(no, structuredClone(relatos)) : relatos
        if (!saida) return
        rede.#entregar(no, (outro) => outro.anti.aoRelatos(CANAL, seq, saida, folha.aparelho))
      },
      gravarRelatado: (_canal, seq, autor, payload: Payload) => {
        const item = itemDoPayload(autor, payload as unknown as StoredPayload, CANAL)
        if (item) no.gravados.push(item.tipo)
        // Own records, like `#recordPayload` in the session: the summary reads them from there.
        const p = payload as unknown as StoredPayload
        if (p.t === "room.created") {
          contents.channelFounder[CANAL] = { address: autor, seq, payload: p } as never
          return
        }
        if (p.t === "channel.meta") {
          contents.channelRooms[CANAL] = { ...contents.channelRooms[CANAL], [String(p["room"])]: { at: 0, payload: p, por: autor, seq } } as never
          return
        }
        appendHistory(contents, CANAL, { seq, sender: autor, at: 0, payload: payload as unknown as StoredPayload })
      },
      escoar: async () => {},
      marcarParaGravar: () => {},
      aparelhoConfiavel: async (_canal, autor, aparelho) => rede.nos.some((n) => n.eu.address === autor && n.folha.aparelho === aparelho),
      cadeiaDe: () => null,
      bloqueado: () => false,
      online: () => true,
      agora: () => Date.now() + no.desvio,
      gravarAnexo: async (_canal, _autor, alvo, indice, anexo) => {
        no.anexos.push({ alvo, indice, anexo })
      },
      aoMudar: () => {
        no.mudancas += 1
      },
    }
    const no: No = { nome, eu, folha, contents, anti: new AntiEntropia(porta), lugar: -1, gravados: [], anexos: [], mudancas: 0, desvio: 0 }
    this.nos.push(no)
    return no
  }

  #entregar(de: No, fazer: (outro: No) => Promise<void>): void {
    for (const outro of this.nos) {
      if (outro === de) continue
      this.emVoo += 1
      setTimeout(() => {
        void fazer(outro).finally(() => {
          this.emVoo -= 1
        })
      }, 1)
    }
  }
}

async function ateSilencio(rede: Rede, ms = 8_000): Promise<void> {
  const inicio = Date.now()
  let calmo = 0
  while (Date.now() - inicio < ms) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    calmo = rede.emVoo === 0 ? calmo + 1 : 0
    if (calmo >= 25) return
  }
}

function guardar(no: No, seq: number, autor: No, payload: unknown): void {
  appendHistory(no.contents, CANAL, { seq, sender: autor.eu.address, at: seq, payload: payload as StoredPayload })
}

const assinado = (autor: No, payload: Record<string, unknown>): Record<string, unknown> =>
  comAutoria(CANAL, payload as never, autor.eu) as unknown as Record<string, unknown>

const IMAGEM = `data:image/png;base64,${"iVBORw0KGgo".repeat(40)}`

/** The types of the snapshot in which two vaults differ. */
function diferemNoInstantaneo(a: No, b: No): TipoDoResumo[] {
  const ra = resumoDoCanal(a.contents, CANAL)
  const rb = resumoDoCanal(b.contents, CANAL)
  return TIPOS_DO_INSTANTANEO.filter((tipo) => ra[tipo].h !== rb[tipo].h)
}

/** A hand-crafted signal, signed by `de`: a pair talking without going through its logic. */
function sinalDe(de: No, corpo: Record<string, unknown>): string {
  const assinatura = de.eu.assinar(_paraTestes.mensagemDoSinal(CANAL, de.eu.address, CHAVE.epoca, corpo as never))
  const envelope = { ap: de.folha.aparelho, as: toBase64(assinatura), c: corpo }
  return toBase64(selarSinal(CHAVE, CANAL, new TextEncoder().encode(JSON.stringify(envelope))))
}

/** The body of a signal, opened. */
function corpoDe(sinal: string): Record<string, unknown> {
  const aberto = abrirSinal(CHAVE, CANAL, fromBase64(sinal))!
  return (JSON.parse(new TextDecoder().decode(aberto)) as { c: Record<string, unknown> }).c
}

const TECTOS_ORIGINAIS = { sincronia: { ...TECTOS_DA_SINCRONIA }, anexos: { ...TECTOS_DOS_ANEXOS } }
beforeEach(() => {
  TECTOS_DA_SINCRONIA.passoDaSupressaoMs = 150
})
afterEach(() => {
  Object.assign(TECTOS_DA_SINCRONIA, TECTOS_ORIGINAIS.sincronia)
  Object.assign(TECTOS_DOS_ANEXOS, TECTOS_ORIGINAIS.anexos)
})

/** Ana and Bruno with a full channel; Carla joins at `seq` 500. */
function canalCheio(): { rede: Rede; ana: No; bruno: No; carla: No; posts: Record<string, unknown>[] } {
  const rede = new Rede()
  const ana = rede.criar("ana", 0)
  const bruno = rede.criar("bruno", 1)
  const carla = rede.criar("carla", 2)
  carla.lugar = 500
  const dois = [ana, bruno]
  const posts: Record<string, unknown>[] = []
  for (let i = 0; i < 6; i++) {
    const post = assinado(ana, {
      t: "post",
      id: `post-${i}-000000`,
      postedAt: 100 + i,
      caption: `mural ${i}`,
      media: i === 0 ? [{ name: "foto.png", mediaType: "image/png", byteLength: 300, inline: IMAGEM }] : [],
    })
    posts.push(post)
    for (const no of dois) guardar(no, 100 + i, ana, post)
  }
  for (let i = 0; i < 9; i++) {
    const comentario = assinado(bruno, { t: "post.comment", id: `com-${i}-0000000`, target: `post-${i % 6}-000000`, body: `comentário ${i}`, postedAt: 200 + i })
    for (const no of dois) guardar(no, 200 + i, bruno, comentario)
  }
  const sala = assinado(ana, { t: "channel.meta", room: "geral", name: "Geral", updatedAt: 50 })
  const fundacao = assinado(ana, { t: "room.created", name: "Lagar", createdAt: 1 })
  for (const no of dois) {
    no.contents.channelFounder[CANAL] = { address: ana.eu.address, seq: 1, payload: fundacao as StoredPayload } as never
    no.contents.channelRooms[CANAL] = { geral: { at: 50, payload: sala as StoredPayload, por: ana.eu.address, seq: 2 } } as never
  }
  // Chat before Carla's position, and after it.
  for (let i = 0; i < 4; i++) {
    const antesDoLugar = assinado(bruno, { t: "message", id: `msg-a${i}-000000`, body: `antes ${i}`, sentAt: 300 + i })
    for (const no of dois) guardar(no, 300 + i, bruno, antesDoLugar)
  }
  for (let i = 0; i < 3; i++) {
    const depois = assinado(bruno, { t: "message", id: `msg-d${i}-000000`, body: `depois ${i}`, sentAt: 600 + i })
    for (const no of dois) guardar(no, 600 + i, bruno, depois)
  }
  for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
  return { rede, ana, bruno, carla, posts }
}

describe("o instantâneo a quem entra tarde (§5.1, §5.2)", () => {
  it("pede os tipos inteiros num pedido só, sem descer, e fica igual no estado e no mural", async () => {
    const { rede, ana, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    expect(diferemNoInstantaneo(ana, carla)).toEqual([])
    expect(carla.anti.estatisticas.instantaneosPedidos).toBe(1)
    expect(carla.anti.instantaneoPorPedir(CANAL)).toBe(false)
    // Six posts, nine comments, the foundation and the room.
    expect(entradasDoCanal(carla.contents, CANAL).filter((e) => e.payload.t === "post")).toHaveLength(6)
    expect(entradasDoCanal(carla.contents, CANAL).filter((e) => e.payload.t === "post.comment")).toHaveLength(9)
  })

  it("os relatos chegam pela ordem do §5.2: a fundação, a sala, as publicações, os comentários", async () => {
    const { rede, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    const ordem: TipoDoResumo[] = ["fundador", "cargo", "atribuicao", "categoria", "sala", "apagamento", "publicacao", "comentario", "gosto", "voto", "ticket"]
    const doInstantaneo = carla.gravados.filter((tipo) => ordem.includes(tipo))
    expect(doInstantaneo.length).toBeGreaterThanOrEqual(17)
    const posicoes = doInstantaneo.map((tipo) => ordem.indexOf(tipo))
    expect(posicoes).toEqual([...posicoes].sort((a, b) => a - b))
    expect(doInstantaneo[0]).toBe("fundador")
  })

  it("a conversa anterior ao lugar nunca chega; a da janela chega pela descida a seguir", async () => {
    const { rede, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    const corpos = entradasDoCanal(carla.contents, CANAL)
      .filter((e) => e.payload.t === "message")
      .map((e) => String(e.payload["body"]))
    expect(corpos.filter((c) => c.startsWith("antes"))).toEqual([])
    expect(corpos.filter((c) => c.startsWith("depois")).sort()).toEqual(["depois 0", "depois 1", "depois 2"])
  })

  it("um relato de conversa anterior ao lugar, enviado à mão, é recusado por quem entrou", async () => {
    const { rede, bruno, carla } = canalCheio()
    const antiga = entradasDoCanal(bruno.contents, CANAL).find((e) => e.payload["body"] === "antes 0")!
    const relatos: RelatosNoFio = { v: 1, itens: [{ s: antiga.seq, a: bruno.eu.address, p: antiga.payload as Record<string, unknown> }] }
    await carla.anti.aoRelatos(CANAL, 2_000, relatos, bruno.folha.aparelho)
    await ateSilencio(rede)
    expect(carla.anti.estatisticas.relatosRecusados.lugar).toBe(1)
    expect(entradasDoCanal(carla.contents, CANAL).some((e) => e.payload["body"] === "antes 0")).toBe(false)
  })

  it("o estado que a interface lê: a receber com progresso por tipo, e depois igual", async () => {
    const { rede, carla } = canalCheio()
    expect(carla.anti.estadoDoCanal(CANAL).estado).toBe("por-comparar")
    const durante: { aReceber: boolean; progresso: number }[] = []
    const vigia = setInterval(() => {
      const estado = carla.anti.estadoDoCanal(CANAL)
      durante.push({ aReceber: estado.aReceber, progresso: estado.progresso.length })
    }, 5)
    await carla.anti.aoWelcome(CANAL)
    expect(carla.anti.estadoDoCanal(CANAL).aReceber).toBe(true)
    await ateSilencio(rede)
    clearInterval(vigia)
    expect(durante.some((d) => d.aReceber && d.progresso > 0)).toBe(true)
    const fim = carla.anti.estadoDoCanal(CANAL)
    expect(fim).toMatchObject({ estado: "igual", aReceber: false, progresso: [] })
    expect(fim.ultimaComparacao).toBeTypeOf("number")
    expect(carla.mudancas).toBeGreaterThan(2)
  })

  it("duas folhas no mesmo commit: o resumo vazio de uma não acaba o instantâneo da outra", async () => {
    const { rede, ana, carla } = canalCheio()
    // Dora joins on the same commit as Carla: they hear each other before an older member.
    const dora = rede.criar("dora", 3)
    dora.lugar = 500
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    await Promise.all([carla.anti.aoWelcome(CANAL), dora.anti.aoWelcome(CANAL)])
    await ateSilencio(rede)
    for (const nova of [carla, dora]) {
      expect(nova.anti.estatisticas.instantaneosPedidos).toBeGreaterThanOrEqual(1)
      expect(diferemNoInstantaneo(ana, nova)).toEqual([])
      expect(nova.anti.instantaneoPorPedir(CANAL)).toBe(false)
    }
  })

  it("uma queda de ligação a meio do instantâneo cortado pelo tecto tira a barra, e o instantâneo volta a ficar por pedir", async () => {
    // Small frames and a tight per-minute cap: the first pass takes only part, and Ana says `ri.r`.
    TECTOS_DA_SINCRONIA.bytesPorTramaDeRelato = 600
    TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorMinuto = 1_500
    const { rede, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    expect(carla.anti.estadoDoCanal(CANAL).aReceber).toBe(true)
    carla.anti.aoDesligar()
    expect(carla.anti.estadoDoCanal(CANAL).aReceber).toBe(false)
    expect(carla.anti.instantaneoPorPedir(CANAL)).toBe(true)
  })

  describe("as voltas por `ri.r`", () => {
    /** Caps on requests and large signals: only the passes count here. */
    function semTectosDePedidos(): void {
      TECTOS_DA_SINCRONIA.pedidosPorCanalPorMinuto = 100_000
      TECTOS_DA_SINCRONIA.pedidosPorMinuto = 100_000
      TECTOS_DA_SINCRONIA.sinaisPorMinuto = 100_000
      TECTOS_DA_SINCRONIA.bytesDeSinalPorCanalPorMinuto = 1024 ** 3
    }

    /** The `ri` with `r` that `de` sends, swapped for `r: 20`, counting. */
    function voltasRapidas(rede: Rede, de: No, depois?: (corpo: Record<string, unknown>) => Record<string, unknown>): { ris: number } {
      const conta = { ris: 0 }
      rede.reescrever = (quem, sinal) => {
        if (quem !== de) return sinal
        const corpo = corpoDe(sinal)
        if (corpo["k"] !== "ri" || corpo["r"] === undefined) return sinal
        conta.ris += 1
        // The minute cap passes to the responder: the next loop takes longer.
        de.desvio += 61_000
        return sinalDe(de, (depois ?? ((c) => c))({ ...corpo, r: 20 }))
      }
      return conta
    }

    it("um respondedor que diz `r` sem dar nada não põe quem pede a pedir em roda", async () => {
      semTectosDePedidos()
      TECTOS_DA_SINCRONIA.bytesPorTramaDeRelato = 600
      TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorMinuto = 1_500
      const { rede, ana, carla } = canalCheio()
      // Ana responds to everything with "nothing now, try again in 20 ms", and her reports don't go out.
      rede.adulterar = (de, relatos) => (de === ana ? null : relatos)
      const conta = voltasRapidas(rede, ana, (corpo) => ({ ...corpo, de: 0 }))
      await carla.anti.aoWelcome(CANAL)
      await ateSilencio(rede, 4_000)
      // The `pt`, and at most one descent for each of the three consecutive ones.
      expect(conta.ris).toBeLessThanOrEqual(1 + TECTOS_DA_SINCRONIA.tentativasPorPedido)
      expect(carla.anti.estadoDoCanal(CANAL).aReceber).toBe(false)
    })

    it("no máximo dez voltas por pedido, mesmo com cada volta a trazer alguma coisa", async () => {
      semTectosDePedidos()
      // One item per frame, and one cap per minute of few frames: many loops.
      TECTOS_DA_SINCRONIA.bytesPorTramaDeRelato = 1
      TECTOS_DA_SINCRONIA.bytesDeRelatoPorCanalPorMinuto = 2_000
      const { rede, ana, bruno, carla } = canalCheio()
      for (let i = 0; i < 150; i++) {
        const mais = assinado(bruno, { t: "post.comment", id: `mais-${String(i).padStart(3, "0")}-00000`, target: "post-1-000000", body: `mais ${i}`, postedAt: 400 + i })
        for (const no of [ana, bruno]) guardar(no, 400 + i, bruno, mais)
      }
      const conta = voltasRapidas(rede, ana)
      await carla.anti.aoWelcome(CANAL)
      await ateSilencio(rede, 15_000)
      // Ten loops, then the consecutive descents, which have their own cap.
      expect(conta.ris).toBeGreaterThan(5)
      expect(conta.ris).toBeLessThanOrEqual(1 + 10 + TECTOS_DA_SINCRONIA.tentativasPorPedido)
    }, 30_000)
  })

  it("só folhas de S4 (calam-se ao `pt`): depois do `pt` sem resposta, desce-se como em S4", async () => {
    TECTOS_DA_SINCRONIA.esperaDoPedidoMs = 100
    const { rede, ana, bruno, carla } = canalCheio()
    for (const s4 of [ana, bruno]) {
      const original = s4.anti.aoSinal.bind(s4.anti)
      s4.anti.aoSinal = (frame) => (corpoDe(frame.sinal)["k"] === "pt" ? Promise.resolve() : original(frame))
    }
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    expect(carla.anti.estatisticas.instantaneosPedidos).toBeGreaterThanOrEqual(1)
    expect(diferemNoInstantaneo(ana, carla)).toEqual([])
    expect(carla.anti.instantaneoPorPedir(CANAL)).toBe(false)
    expect(carla.anti.estadoDoCanal(CANAL)).toMatchObject({ estado: "igual", aReceber: false })
  })

  it('sem ninguém para responder: a barra desiste e o canal fica "sem resposta"', async () => {
    TECTOS_DA_SINCRONIA.esperaDoPedidoMs = 40
    const rede = new Rede()
    const sozinha = rede.criar("carla", 2)
    sozinha.lugar = 10
    await sozinha.anti.aoWelcome(CANAL)
    expect(sozinha.anti.estadoDoCanal(CANAL).aReceber).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(sozinha.anti.estadoDoCanal(CANAL)).toMatchObject({ estado: "sem-resposta", aReceber: false })
    // Pending send: when someone shows up, the request goes out.
    expect(sozinha.anti.instantaneoPorPedir(CANAL)).toBe(true)
  })
})

describe("os anexos a pedido (§5.4)", () => {
  it("o instantâneo leva o anexo sem os bytes; a pedido, chegam e conferem com a autoria", async () => {
    const { rede, carla, posts } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    const daCarla = entradasDoCanal(carla.contents, CANAL).find((e) => e.payload["id"] === "post-0-000000")!
    expect((daCarla.payload["media"] as Record<string, unknown>[])[0]).toMatchObject({ evicted: true, name: "foto.png" })
    const desfecho = await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    expect(desfecho.ok).toBe(true)
    if (!desfecho.ok) return
    expect(desfecho.anexo["inline"]).toBe(IMAGEM)
    expect(carla.anexos).toHaveLength(1)
    const m = (posts[0]!["autoria"] as { m: string[] }).m[0]
    expect(resumoDoAnexo(desfecho.anexo)).toBe(m)
    expect(carla.anti.estatisticas.anexosRecebidos).toBe(1)
  })

  it("bytes trocados pelo caminho (o `m` não confere) são recusados, e pede-se à folha seguinte", async () => {
    const { rede, ana, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    // Ana (the first elected) swaps the photo bytes; Bruno doesn't.
    rede.adulterar = (de, relatos) => {
      if (de !== ana || !relatos.q?.startsWith("anx.")) return relatos
      const p = relatos.itens[0]!.p
      const media = p["media"] as Record<string, unknown>[]
      media[0] = { ...media[0], inline: `data:image/png;base64,${"AAAA".repeat(40)}` }
      return relatos
    }
    const desfecho = await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    expect(carla.anti.estatisticas.anexosRecusados).toBe(1)
    expect(desfecho.ok).toBe(true)
    if (desfecho.ok) expect(desfecho.anexo["inline"]).toBe(IMAGEM)
  })

  it('todos a mentir: o pedido acaba "recusado" e nada se grava', async () => {
    const { rede, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    rede.adulterar = (_de, relatos) => {
      if (!relatos.q?.startsWith("anx.")) return relatos
      const media = relatos.itens[0]!.p["media"] as Record<string, unknown>[]
      media[0] = { ...media[0], inline: `data:image/png;base64,${"BBBB".repeat(40)}` }
      return relatos
    }
    const desfecho = await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    expect(desfecho).toEqual({ ok: false, motivo: "recusado" })
    expect(carla.anexos).toHaveLength(0)
  })

  it("o anexo de uma mensagem anterior ao piso chega a um membro antigo (a Ana entrou no 100, a Carla no 500, a mensagem é do 300)", async () => {
    const rede = new Rede()
    const ana = rede.criar("ana", 0)
    const bruno = rede.criar("bruno", 1)
    const carla = rede.criar("carla", 2)
    ana.lugar = 100
    carla.lugar = 500
    for (const no of rede.nos) for (const outro of rede.nos) no.anti.notarCapacidades(CANAL, outro.folha.aparelho, ["sincronia-v1"])
    const ficheiro = { name: "foto.png", mediaType: "image/png", byteLength: 300, inline: IMAGEM }
    const mensagem = assinado(bruno, { t: "message", id: "msg-300-0000000", body: "com foto", sentAt: 300, attachments: [ficheiro] })
    guardar(bruno, 300, bruno, mensagem)
    // Ana has the message, but the dump removed her bytes.
    guardar(ana, 300, bruno, { ...mensagem, attachments: [{ evicted: true, name: "foto.png", mediaType: "image/png" }] })
    // Carla entered the 500: Bruno's floor moves above it.
    bruno.anti.aoCrescer(CANAL, 500)
    expect(bruno.anti.piso(CANAL)).toBe(500)
    const desfecho = await ana.anti.pedirAnexo(CANAL, "msg-300-0000000", 0)
    expect(desfecho.ok).toBe(true)
    if (desfecho.ok) expect(desfecho.anexo["inline"]).toBe(IMAGEM)
    expect(bruno.anti.estatisticas.anexosEnviados).toBe(1)
  })

  it("quem responde não envia o mesmo anexo ao mesmo canal outra vez durante `repeticaoMs`", async () => {
    const { rede, ana, carla, posts } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    const c = chaveCurta(itemDoPayload(ana.eu.address, posts[0] as StoredPayload, CANAL)!.chave)
    const m = (posts[0]!["autoria"] as { m: string[] }).m[0]
    // Carla, acting in bad faith, requests the same attachment from Ana five times with new IDs.
    for (let vez = 0; vez < 5; vez++) {
      const corpo = { k: "pa", id: `anx.repete${vez}`, para: ana.folha.aparelho, l: 500, c, i: 0, m }
      await ana.anti.aoSinal({ channel: CANAL, from: carla.eu.address, sinal: sinalDe(carla, corpo) })
    }
    await ateSilencio(rede)
    expect(ana.anti.estatisticas.anexosEnviados).toBe(1)
  })

  it("quem pede aceita os bytes de qualquer trama com o item, a posição e o `m` do seu pedido", async () => {
    const { rede, ana, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    TECTOS_DOS_ANEXOS.tentativas = 1
    TECTOS_DOS_ANEXOS.esperaMs = 300
    // Ana's frame arrives with the `q` from another request (the reply to another member who asked for the same).
    rede.adulterar = (de, relatos) => (de === ana && relatos.q?.startsWith("anx.") ? { ...relatos, q: "anx.deOutro:1/1" } : relatos)
    const desfecho = await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    expect(desfecho.ok).toBe(true)
    if (desfecho.ok) expect(desfecho.anexo["inline"]).toBe(IMAGEM)
  })

  it("um anexo recebido fica em memória: abrir outra vez, depois do despejo, não o pede outra vez", async () => {
    const { rede, ana, bruno, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    expect((await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)).ok).toBe(true)
    // Carla's vault still has the marker (the dump removed the bytes again).
    const segunda = await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    expect(segunda.ok).toBe(true)
    if (segunda.ok) expect(segunda.anexo["inline"]).toBe(IMAGEM)
    expect(ana.anti.estatisticas.anexosEnviados + bruno.anti.estatisticas.anexosEnviados).toBe(1)
  })

  it("um pedido recusado pelo tecto do dia não gasta o tecto do minuto", async () => {
    // How many bytes the frame of this attachment uses: measured on a separate network.
    const medida = canalCheio()
    await medida.carla.anti.aoWelcome(CANAL)
    await ateSilencio(medida.rede)
    expect((await medida.carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)).ok).toBe(true)
    const bytesDaTrama = medida.ana.anti.estatisticas.bytesDeAnexos
    expect(bytesDaTrama).toBeGreaterThan(0)

    const { rede, ana, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    // The minute lets one and a half attachments through; the day, none.
    TECTOS_DOS_ANEXOS.bytesPorMinuto = Math.floor(bytesDaTrama * 1.5)
    TECTOS_DOS_ANEXOS.bytesPorCanalPorDia = 0
    expect(await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)).toEqual({ ok: false, motivo: "ninguem" })
    // The next day: the minute must still have room.
    TECTOS_DOS_ANEXOS.bytesPorCanalPorDia = 16 * 1024 * 1024
    const desfecho = await carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    expect(desfecho.ok).toBe(true)
    expect(ana.anti.estatisticas.anexosEnviados).toBe(1)
  })

  it('a fila de anexos tem tecto: acima dele, "por pedir"; e cada pedido pode cancelar-se', async () => {
    const { rede, ana, bruno, carla } = canalCheio()
    await carla.anti.aoWelcome(CANAL)
    await ateSilencio(rede)
    // Nobody answers attachment requests: the first one keeps running, the rest wait in line.
    for (const calado of [ana, bruno]) {
      const original = calado.anti.aoSinal.bind(calado.anti)
      calado.anti.aoSinal = (frame) => (corpoDe(frame.sinal)["k"] === "pa" ? Promise.resolve() : original(frame))
    }
    const pedir = (): Promise<unknown> => carla.anti.pedirAnexo(CANAL, "post-0-000000", 0)
    const primeiro = pedir()
    const naFila = [pedir(), pedir(), pedir(), pedir(), pedir()]
    expect(await pedir()).toEqual({ ok: false, motivo: "por-pedir" })
    // Cancel removes pending ones first, then the running one.
    for (const vez of naFila) {
      expect(carla.anti.cancelarAnexo(CANAL, "post-0-000000", 0)).toBe(true)
      expect(await vez).toEqual({ ok: false, motivo: "cancelado" })
    }
    expect(carla.anti.cancelarAnexo(CANAL, "post-0-000000", 0)).toBe(true)
    expect(await primeiro).toEqual({ ok: false, motivo: "cancelado" })
    expect(carla.anti.cancelarAnexo(CANAL, "post-0-000000", 0)).toBe(false)
  })

  it("sem autoria com resumo, não se pede: não haveria como conferir", async () => {
    const { carla } = canalCheio()
    guardar(carla, 700, carla, { t: "post", id: "post-sem-0000", postedAt: 1, caption: "", media: [{ evicted: true, name: "x.png", mediaType: "image/png" }] })
    expect(await carla.anti.pedirAnexo(CANAL, "post-sem-0000", 0)).toEqual({ ok: false, motivo: "sem-prova" })
  })
})

describe("as peças puras", () => {
  it("a posição de um anexo segue a ordem da autoria: `attachments`, depois `media`", () => {
    const payload = { attachments: [{ a: 1 }], media: [{ b: 2 }, { c: 3 }] }
    expect(posicaoDoAnexo(payload, 0)).toEqual({ chave: "attachments", indice: 0 })
    expect(posicaoDoAnexo(payload, 2)).toEqual({ chave: "media", indice: 1 })
    expect(posicaoDoAnexo(payload, 3)).toBeNull()
    expect(posicaoDoAnexo(payload, -1)).toBeNull()
    expect(anexoEm(comAnexo(payload, 1, { z: 9 })!, 1)).toEqual({ z: 9 })
    expect(payload.media[0]).toEqual({ b: 2 })
  })

  it("um marcador nunca confere, e um byte a mais muda o resumo", () => {
    const anexo = { name: "a.png", mediaType: "image/png", byteLength: 3, inline: IMAGEM }
    const m = resumoDoAnexo(anexo)
    expect(anexoConfere(anexo, m)).toBe(true)
    expect(anexoConfere({ ...anexo, inline: `${IMAGEM}A` }, m)).toBe(false)
    expect(anexoConfere({ evicted: true, name: "a.png", mediaType: "image/png" }, m)).toBe(false)
    expect(anexoConfere(anexo, undefined)).toBe(false)
  })

  it("o progresso só conta os tipos pedidos com alguma coisa, pela ordem do §5.2", () => {
    const vazio = resumoNivel0([])
    const deles = { ...vazio, publicacao: { n: 4, h: "x" }, comentario: { n: 2, h: "y" }, mensagem: { n: 9, h: "z" } }
    const meu = { ...vazio, publicacao: { n: 1, h: "w" } }
    expect(progressoDoInstantaneo(meu, deles, ["comentario", "publicacao", "mensagem"])).toEqual([
      { tipo: "publicacao", recebidos: 1, esperados: 4 },
      { tipo: "comentario", recebidos: 0, esperados: 2 },
    ])
  })

  it("o instantâneo nunca pede um tipo com janela (a conversa)", () => {
    expect(TIPOS_DO_INSTANTANEO.filter((tipo) => TIPOS_COM_JANELA.has(tipo) && tipo !== "apagamento")).toEqual([])
    expect(TIPOS_DO_INSTANTANEO.every((tipo) => (TIPOS_DO_RESUMO as readonly string[]).includes(tipo))).toBe(true)
  })

  it("o corpo de um pedido de tipo inteiro e de um pedido de anexo lê-se; um torto não", () => {
    const { lerCorpo } = _paraTestes
    expect(lerCorpo({ k: "pt", id: "a", para: "b", d: 1, l: 1, tipos: ["publicacao"] })).not.toBeNull()
    expect(lerCorpo({ k: "pt", id: "a", para: "b", d: 1, l: 1, tipos: new Array(40).fill("x") })).toBeNull()
    expect(lerCorpo({ k: "pa", id: "a", para: "b", l: 1, c: "0123456789ab", i: 0, m: "x".repeat(43) })).not.toBeNull()
    expect(lerCorpo({ k: "pa", id: "a", para: "b", l: 1, c: "curta", i: 0, m: "x" })).toBeNull()
    expect(lerCorpo({ k: "pa", id: "a", para: "b", l: 1, c: "0123456789ab", i: -1, m: "x" })).toBeNull()
  })
})
