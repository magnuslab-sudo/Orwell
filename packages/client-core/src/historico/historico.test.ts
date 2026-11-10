import { generateDeviceKey, generateIdentity, parseServerName, signWithDevice, toBase64, type Identity } from "@enclave/protocol"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AntiEntropia, type PortaDaAntiEntropia } from "../sincronia/pedido.js"
import { dobrarConversa } from "../dobras.js"
import {
  entradasDoCanal,
  fundirEntradasDoIrmao,
  HISTORY_MAX_PER_CHANNEL,
  juntarMediaDoIrmao,
  newVaultContents,
  semMediaPesada,
  type StoredChatMessage,
  type VaultContents,
} from "../vault.js"
import { inventarioDe, paginaDe, resumoDoHistorico, TECTOS_DO_HISTORICO } from "./conteudo.js"
import { HistoricoEntreAparelhos, TECTOS_DO_FIO_DO_HISTORICO, type EventoDoHistorico, type PortaDoHistorico } from "./historico.js"

/**
 * The history between devices of the same account, without a server: the vault
 * rules, the pages, and the wire between two devices connected by an in-memory
 * relay that can lose signals. The proof with the server and real sessions is
 * in `session.historico-entre-aparelhos.rede.test.ts`.
 */

const CASA = parseServerName("localhost")

function mensagem(seq: number, sender: string, corpo: string, extra: Record<string, unknown> = {}): StoredChatMessage {
  return {
    seq,
    sender,
    at: 1_000 + seq,
    payload: { t: "message", id: `m${seq}`, sentAt: 1_000 + seq, body: corpo, attachments: [], mentions: [], ...extra },
  }
}

function imagem(nome: string, caracteres: number): Record<string, unknown> {
  return { name: nome, mediaType: "image/png", byteLength: caracteres, inline: `data:image/png;base64,${"B".repeat(caracteres)}` }
}

describe("fundirEntradasDoIrmao", () => {
  it("põe cada entrada no sítio pela ordem do servidor, sem duplicar por seq nem por chave", () => {
    const c = newVaultContents()
    c.history["!c"] = [mensagem(10, "@b:x", "dez"), mensagem(12, "@b:x", "doze")]
    const entraram = fundirEntradasDoIrmao(c, "!c", [mensagem(11, "@a:x", "onze"), mensagem(10, "@b:x", "dez"), mensagem(9, "@a:x", "nove")])
    expect(entraram).toBe(2)
    expect(c.history["!c"]!.map((e) => e.seq)).toEqual([9, 10, 11, 12])
    // The same page again changes nothing.
    expect(fundirEntradasDoIrmao(c, "!c", [mensagem(11, "@a:x", "onze"), mensagem(9, "@a:x", "nove")])).toBe(0)
    expect(c.history["!c"]).toHaveLength(4)
  })

  it("um envio da conta sem eco aqui ganha o seq que o irmão viu", () => {
    const c = newVaultContents()
    const semEco = { ...mensagem(-1, "@a:x", "minha"), apos: 4 }
    c.history["!c"] = [mensagem(4, "@b:x", "quatro"), semEco]
    fundirEntradasDoIrmao(c, "!c", [{ ...mensagem(5, "@a:x", "minha"), payload: { ...semEco.payload } }])
    expect(c.history["!c"]!.map((e) => e.seq)).toEqual([4, 5])
  })

  it("a lápide fica, e o original que o irmão manda continua escondido", () => {
    const c = newVaultContents()
    c.estadoDoCanal["!c"] = [{ seq: 8, sender: "@a:x", at: 8, payload: { t: "redact", id: "r1", target: "m5", redactedAt: 8 } }]
    fundirEntradasDoIrmao(c, "!c", [mensagem(5, "@a:x", "apagada"), mensagem(6, "@a:x", "fica")])
    const vistas = dobrarConversa(entradasDoCanal(c, "!c")).filter((e) => e.payload.t === "message")
    expect(vistas.map((e) => e.payload["body"])).toEqual(["fica"])
  })

  it("o tecto do cofre manda: nunca mais do que 400 mensagens de conversa", () => {
    const c = newVaultContents()
    c.history["!c"] = Array.from({ length: 300 }, (_, i) => mensagem(1_000 + i, "@b:x", `nova ${i}`))
    fundirEntradasDoIrmao(c, "!c", Array.from({ length: 300 }, (_, i) => mensagem(i, "@a:x", `velha ${i}`)))
    expect(c.history["!c"]).toHaveLength(HISTORY_MAX_PER_CHANNEL)
    // The oldest ones are removed.
    expect(c.history["!c"]![0]!.seq).toBe(200)
  })

  it("um acto herdado do emparelhamento dá lugar ao evento inteiro", () => {
    const c = newVaultContents()
    c.estadoDoCanal["!dm"] = [{ seq: 3, sender: "@b:x", at: 0, herdado: true, payload: { t: "friend.request" } }]
    fundirEntradasDoIrmao(c, "!dm", [{ seq: 3, sender: "@b:x", at: 3, payload: { t: "friend.request", note: "olá", sentAt: 3 } }])
    expect(c.estadoDoCanal["!dm"]).toEqual([{ seq: 3, sender: "@b:x", at: 3, payload: { t: "friend.request", note: "olá", sentAt: 3 } }])
  })
})

describe("os media pesados", () => {
  it("semMediaPesada tira só o que passa do limite, e juntarMediaDoIrmao devolve-o", () => {
    const entrada = mensagem(1, "@a:x", "duas", { attachments: [imagem("grande.png", 60_000), imagem("pequena.png", 100)] })
    const { payload, tirou } = semMediaPesada(entrada.payload, 48 * 1024)
    expect(tirou).toBe(true)
    const anexos = payload["attachments"] as Record<string, unknown>[]
    expect(anexos[0]).toEqual({ evicted: true, name: "grande.png", mediaType: "image/png" })
    expect(anexos[1]?.["inline"]).toBeTypeOf("string")
    // The original does not change.
    expect((entrada.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")

    const c = newVaultContents()
    c.history["!c"] = [{ ...entrada, payload }]
    expect(juntarMediaDoIrmao(c, "!c", "message|@a:x|m1", entrada.payload)).toBe(true)
    expect((c.history["!c"]![0]!.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBe(
      (entrada.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"],
    )
    // Again changes nothing.
    expect(juntarMediaDoIrmao(c, "!c", "message|@a:x|m1", entrada.payload)).toBe(false)
  })
})

describe("as páginas", () => {
  it("as páginas cobrem o canal inteiro, por ordem, mesmo com a lista fora de ordem", () => {
    const tectos = { ...TECTOS_DO_HISTORICO }
    try {
      Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 3 })
      const c = newVaultContents()
      // A telemetry entry arrived at the end with an old sequence: the list is out of order.
      c.history["!c"] = [mensagem(1, "@a:x", "1"), mensagem(2, "@a:x", "2"), mensagem(5, "@a:x", "5"), mensagem(6, "@a:x", "6"), mensagem(3, "@a:x", "3")]
      c.estadoDoCanal["!c"] = [{ seq: 4, sender: "@a:x", at: 4, payload: { t: "post", id: "p4", caption: "", media: [], links: [], tags: [] } }]
      const vistas: number[] = []
      let desde: number | null = null
      for (let volta = 0; volta < 10; volta++) {
        const pagina = paginaDe(c, "!c", desde)
        vistas.push(...pagina.e.map((e) => e.seq))
        if (pagina.fim) break
        desde = pagina.ate
      }
      expect(vistas).toEqual([1, 2, 3, 4, 5, 6])
    } finally {
      Object.assign(TECTOS_DO_HISTORICO, tectos)
    }
  })

  it("o inventário deixa o canal da conta de fora, e o resumo não depende da ordem", () => {
    const c = newVaultContents()
    c.history["!conta"] = [mensagem(1, "@a:x", "x")]
    c.history["!c"] = [mensagem(1, "@a:x", "1"), mensagem(2, "@a:x", "2")]
    const outro = newVaultContents()
    outro.history["!c"] = [mensagem(2, "@a:x", "2"), mensagem(1, "@a:x", "1")]
    const inventario = inventarioDe(c, { canalDaConta: "!conta", temGrupo: () => true, lugar: () => undefined })
    expect(inventario.canais.map((canal) => canal.c)).toEqual(["!c"])
    expect(resumoDoHistorico(c, "!c")).toBe(resumoDoHistorico(outro, "!c"))
  })
})

// ------------------------------------------------- two devices, one relay

interface Aparelho {
  contents: VaultContents
  historico: HistoricoEntreAparelhos
  eventos: EventoDoHistorico[]
  ligado: boolean
  aparelho: string
}

const CANAL_DA_CONTA = "!conta:localhost"
const CHAVE = { epoca: 1n, chave: new Uint8Array(32).fill(3) }

/**
 * Two devices of the same account, connected by an in-memory relay. `perder`
 * decides, per signal, whether the relay drops it (a bad connection).
 */
function doisAparelhos(perder: (n: number) => boolean = () => false): { a: Aparelho; b: Aparelho } {
  const conta: Identity = generateIdentity(CASA)
  const chaveDoB = generateDeviceKey()
  const contaB = { ...conta, deviceSigningPrivateKey: chaveDoB.privateKey, deviceSigningPublicKey: chaveDoB.publicKey } as Identity
  const aparelhos: Aparelho[] = []
  let n = 0
  const criar = (identidade: Identity): Aparelho => {
    const contents = newVaultContents()
    const eu: Aparelho = { contents, historico: null as unknown as HistoricoEntreAparelhos, eventos: [], ligado: true, aparelho: toBase64(identidade.deviceSigningPublicKey) }
    const porta: PortaDoHistorico = {
      eu: () => ({ address: conta.address, aparelho: identidade.deviceSigningPublicKey, assinar: (m) => signWithDevice(identidade, m) }),
      conteudo: () => contents,
      canalDaConta: () => CANAL_DA_CONTA,
      contaPronta: async () => true,
      folhasDaConta: () => aparelhos.map((x) => x.aparelho),
      derivarChave: async () => CHAVE,
      podeSinalizar: () => eu.ligado,
      enviarSinal: (sinal) => {
        n += 1
        if (perder(n)) return
        for (const outro of aparelhos) {
          if (outro !== eu && outro.ligado) void outro.historico.aoSinal({ channel: CANAL_DA_CONTA, from: conta.address, sinal })
        }
      },
      gravar: (mudar) => mudar(contents),
      temGrupo: (canal) => canal in contents.history || canal in contents.estadoDoCanal,
      bloqueado: () => false,
      lugar: () => undefined,
      emitir: (evento) => eu.eventos.push(evento),
      agora: () => Date.now(),
    }
    eu.historico = new HistoricoEntreAparelhos(porta)
    aparelhos.push(eu)
    return eu
  }
  return { a: criar(conta), b: criar(contaB) }
}

async function ate(predicado: () => boolean, rotulo: string, prazoMs = 10_000): Promise<void> {
  const inicio = Date.now()
  while (Date.now() - inicio < prazoMs) {
    if (predicado()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`esgotou-se o prazo à espera de: ${rotulo}`)
}

describe("o fio entre dois aparelhos", () => {
  const fio = { ...TECTOS_DO_FIO_DO_HISTORICO }
  const conteudo = { ...TECTOS_DO_HISTORICO }
  beforeEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, {
      sinaisPorMinuto: 100_000,
      passoMs: 20,
      esperaDaRespostaMs: 300,
      esperaDoInventarioMs: 300,
      primeiraReposicaoMs: 50,
      intervaloDaReposicaoMs: 50,
      bytesPorParte: 1_024,
    })
    Object.assign(TECTOS_DO_HISTORICO, { entradasPorPagina: 5, mediaComOTexto: 1_000 })
  })
  afterEach(() => {
    Object.assign(TECTOS_DO_FIO_DO_HISTORICO, fio)
    Object.assign(TECTOS_DO_HISTORICO, conteudo)
  })

  function encher(contents: VaultContents): void {
    contents.history["!dm"] = Array.from({ length: 23 }, (_, i) => mensagem(i + 1, i % 2 ? "@b:x" : "@a:x", `mensagem ${i + 1}`))
    contents.history["!dm"]!.push(mensagem(30, "@a:x", "com imagem", { attachments: [imagem("foto.png", 20_000)] }))
    contents.estadoDoCanal["!mural"] = [{ seq: 1, sender: "@a:x", at: 1, payload: { t: "post", id: "p1", caption: "Olá", media: [], links: [], tags: [] } }]
  }

  it("o aparelho novo traz tudo, com o progresso, e a imagem no fim", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico chega")
      expect(entradasDoCanal(b.contents, "!dm").map((e) => e.seq)).toEqual(entradasDoCanal(a.contents, "!dm").map((e) => e.seq))
      expect(entradasDoCanal(b.contents, "!mural")).toHaveLength(1)
      const foto = entradasDoCanal(b.contents, "!dm").find((e) => e.payload["body"] === "com imagem")
      expect((foto?.payload["attachments"] as Record<string, unknown>[])[0]?.["inline"]).toBeTypeOf("string")
      // Progress reached the total and finished.
      const comTotal = b.eventos.filter((e) => e.aTrazer && e.total > 0)
      expect(comTotal.at(-1)?.feitas).toBe(comTotal.at(-1)?.total)
      expect(comTotal.some((e) => e.media !== null)).toBe(true)
      expect(b.eventos.at(-1)?.aTrazer).toBe(false)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("um relé que perde um sinal em cada sete: as partes que faltam pedem-se outra vez", async () => {
    const { a, b } = doisAparelhos((n) => n % 7 === 0)
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => b.contents.historico?.plano === undefined && b.contents.historico?.inicial === undefined, "o histórico chega", 20_000)
      expect(entradasDoCanal(b.contents, "!dm")).toHaveLength(entradasDoCanal(a.contents, "!dm").length)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("a ligação cai a meio: o plano fica no cofre, e a seguinte acaba-o", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    b.contents.historico = { inicial: { desde: Date.now() } }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => Object.values(b.contents.historico?.plano?.canais ?? {}).some((canal) => canal.cursor !== null && !canal.fim), "a meio")
      b.ligado = false
      b.historico.aoDesligar()
      const plano = structuredClone(b.contents.historico?.plano)
      expect(plano).toBeDefined()
      await new Promise((resolve) => setTimeout(resolve, 100))
      b.ligado = true
      b.historico.aoLigar()
      await ate(() => b.contents.historico?.plano === undefined, "o histórico acaba")
      const seqs = entradasDoCanal(b.contents, "!dm").map((e) => e.seq)
      expect(new Set(seqs).size).toBe(seqs.length)
      expect(seqs).toEqual(entradasDoCanal(a.contents, "!dm").map((e) => e.seq))
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })

  it("entre irmãos já emparelhados, só os canais que mudaram, e nunca um que este aparelho não tem", async () => {
    const { a, b } = doisAparelhos()
    encher(a.contents)
    a.contents.history["!esquecido"] = [mensagem(1, "@a:x", "não volta")]
    b.contents.history["!dm"] = entradasDoCanal(a.contents, "!dm").slice(0, 10)
    b.contents.estadoDoCanal["!mural"] = structuredClone(a.contents.estadoDoCanal["!mural"]!)
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => (b.contents.history["!dm"]?.length ?? 0) === a.contents.history["!dm"]!.length, "o que faltava chega")
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(b.contents.history["!esquecido"]).toBeUndefined()
      expect(b.contents.historico?.trazidos?.["!dm"]).toBe(resumoDoHistorico(a.contents, "!dm"))
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })
})

describe("convivência com um irmão de antes disto (1.0.4)", () => {
  it("a anti-entropia de um irmão antigo deita fora os sinais do canal da conta sem contar nada", async () => {
    // The gate for 1.0.4: `elegivel` says no to the account channel (`session.ts`, `#portaDaAntiEntropia`).
    const antiga = new AntiEntropia({ elegivel: (canal: string) => canal !== CANAL_DA_CONTA } as unknown as PortaDaAntiEntropia)
    const sinais: string[] = []
    const { a, b } = doisAparelhos()
    // The signals that the new device sends also go to the old sibling.
    b.contents.historico = { inicial: { desde: Date.now() } }
    const original = a.historico.aoSinal.bind(a.historico)
    a.historico.aoSinal = (frame) => {
      sinais.push(frame.sinal)
      return original(frame)
    }
    a.historico.aoLigar()
    b.historico.aoLigar()
    try {
      await ate(() => sinais.length > 0, "o aparelho novo pede")
      for (const sinal of sinais) await antiga.aoSinal({ channel: CANAL_DA_CONTA, from: "@a:localhost", sinal })
      expect(antiga.estatisticas.sinaisRecebidos).toBe(0)
      expect(antiga.estatisticas.sinaisIlegiveis).toBe(0)
    } finally {
      a.historico.aoDesligar()
      b.historico.aoDesligar()
    }
  })
})
