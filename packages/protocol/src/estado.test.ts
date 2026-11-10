import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  CAPACIDADE_ESTADO_DA_CONTA,
  EstadoDeConta,
  FichasDeCanais,
  LIDAS_MAX,
  LIVRO_CANAIS_MAX,
  PERFIS_MAX,
  SegredoDoMural,
  TIPOS_DE_ESTADO,
} from "./estado.js"
import {
  ESTADO_PARTE_CARACTERES,
  ESTADO_PARTES_MAX,
  PAIR_PAYLOAD_MAX_CHARS,
  PairPayload,
  chaveDeEmparelhamento,
  cifrarPairPayload,
  cortarEstadoAteCaber,
  decifrarPairPayload,
  gerarSegredoDeEmparelhamento,
  juntarEstado,
  pairIdDe,
  partirEstado,
} from "./pair.js"
import { toBase64 } from "./canonical.js"
import { decodePayload, encodePayload } from "./payload.js"

const ANA = "@ana:localhost"
const CARLOS = "@carlos:localhost"

function estadoMinimo(): EstadoDeConta {
  return { v: 1, amizades: {}, bloqueio: {}, arquivo: {}, lidas: {}, preferencias: {} }
}

describe("o canal da conta", () => {
  it("a forma `!self-` saiu: o protocolo já não a constrói (1.0 «Arca», fatia 3)", async () => {
    // The address is `moradaDaConta` (ids.ts); recognizing it is the vault's job.
    const estado = await import("./estado.js")
    expect("canalDaContaDe" in estado).toBe(false)
  })

  it("as fichas e o segredo do mural passam no instantâneo e no estado.fichas", () => {
    const segredo = "A".repeat(43)
    const fichas = { "!abc:orwell.pt": { tipo: "directa" as const, par: "@ana:orwell.pt" } }
    expect(EstadoDeConta.parse({ ...estadoMinimo(), fichas, segredoDoMural: segredo, moradaDaConta: "!xyz:orwell.pt" })).toMatchObject({
      fichas,
      segredoDoMural: segredo,
    })
    expect(EstadoDeConta.safeParse({ ...estadoMinimo(), segredoDoMural: "curto" }).success).toBe(false)
  })

  it("os payloads estado.* passam no esquema e voltam iguais", () => {
    const payloads = [
      { t: "estado.lidas", lidas: { "!sala:x": 10 } },
      { t: "estado.arquivo", arquivo: { "!sala:x": { arquivado: true, at: 3 } } },
      { t: "estado.bloqueio", bloqueio: { [CARLOS]: { bloqueado: false, at: 4 } } },
      { t: "estado.amigos-mostrados", shown: [CARLOS], updatedAt: 5 },
      { t: "estado.preferencias", preferencias: { "som.ligacao": { valor: "nao", at: 6 } } },
    ] as const
    for (const payload of payloads) {
      expect(decodePayload(encodePayload(payload as never))).toEqual(payload)
      expect(TIPOS_DE_ESTADO.has(payload.t)).toBe(true)
    }
  })

  it("recusa chaves de preferência tortas e mapas acima do tecto", () => {
    expect(() => encodePayload({ t: "estado.preferencias", preferencias: { "Tema Escuro": { valor: "x", at: 1 } } } as never)).toThrow()
    const lidas: Record<string, number> = {}
    for (let i = 0; i <= LIDAS_MAX; i++) lidas[`!c${i}:x`] = i
    expect(() => encodePayload({ t: "estado.lidas", lidas } as never)).toThrow()
  })
})

describe("o sinal de aparelho e um cliente 0.5.7", () => {
  /** The `typing` as 0.5.7 reads it: without `capacidades`. Copied from that version's schema. */
  const TypingAntigo = z.object({ t: z.literal("typing"), room: z.string().max(64).optional(), until: z.number().int().nonnegative() })

  it("o typing com capacidades passa no esquema novo e no antigo, que deita o campo fora", () => {
    const sinal = { t: "typing" as const, until: 1, capacidades: [CAPACIDADE_ESTADO_DA_CONTA] }
    expect(decodePayload(encodePayload(sinal))).toEqual(sinal)
    const lido = TypingAntigo.safeParse(JSON.parse(new TextDecoder().decode(encodePayload(sinal))))
    expect(lido.success).toBe(true)
    expect(lido.data).toEqual({ t: "typing", until: 1 })
  })
})

describe("o instantâneo no emparelhamento", () => {
  /** The `PairPayload` from 0.5.7, copied: the certificate without `estado`, the `pronto` without capabilities, and no `estado`. */
  const Base64 = z.string().regex(/^[A-Za-z0-9_-]*$/)
  const PairPayloadAntigo = z.discriminatedUnion("t", [
    z.object({ t: z.literal("chave-do-aparelho"), deviceKey: Base64.length(43) }),
    z.object({ t: z.literal("certificado"), address: z.string().min(3).max(255), accountKey: Base64.length(43), deviceCert: Base64.length(86) }),
    z.object({ t: z.literal("confirmado") }),
    z.object({ t: z.literal("pronto") }),
    z.object({ t: z.literal("recusado") }),
  ])

  it("parte e junta um instantâneo grande, com acentos, e cada parte cifrada cabe no tecto da caixa", () => {
    const estado = estadoMinimo()
    for (let i = 0; i < 300; i++) {
      estado.amizades[`!dm-ana.p${i}:localhost`] = [
        { seq: i, sender: CARLOS, t: "friend.request", sentAt: i, note: "olá, és tu? «ção» ".repeat(10) },
        { seq: i + 1, sender: ANA, t: "friend.accept" },
      ]
      estado.lidas[`!c${i}:localhost`] = 1_000 + i
    }
    estado.preferencias["tema"] = { valor: "escuro", at: 3 }
    estado.amigosMostrados = { shown: [CARLOS], updatedAt: 9 }
    const partes = partirEstado(estado)
    expect(partes.length).toBeGreaterThan(1)
    expect(partes.length).toBeLessThanOrEqual(ESTADO_PARTES_MAX)

    const segredo = gerarSegredoDeEmparelhamento()
    const pairId = pairIdDe(segredo)
    const chave = chaveDeEmparelhamento(segredo, pairId)
    const recebidas: string[] = []
    partes.forEach((dados, parte) => {
      const wire = cifrarPairPayload(chave, pairId, { t: "estado", parte, dados })
      expect(wire.length).toBeLessThanOrEqual(PAIR_PAYLOAD_MAX_CHARS)
      const aberto = decifrarPairPayload(chave, pairId, wire)
      if (aberto?.t !== "estado") throw new Error("parte ilegível")
      recebidas[aberto.parte] = aberto.dados
    })
    expect(juntarEstado(recebidas)).toEqual(estado)
  })

  it("acima do tecto, corta o livro e as marcas mais antigas até caber, e o mais recente fica (M5)", () => {
    const estado = estadoMinimo()
    const nota = "uma nota comprida para encher o livro depressa ".repeat(5)
    for (let i = 0; i < LIVRO_CANAIS_MAX; i++) {
      estado.amizades[`!dm-ana.p${i}:localhost`] = Array.from({ length: 4 }, (_, j) => ({
        seq: j,
        sender: CARLOS,
        t: "friend.request" as const,
        sentAt: i * 10 + j,
        note: nota,
      }))
    }
    for (let i = 0; i < LIDAS_MAX; i++) estado.lidas[`!canal-com-um-nome-comprido-${i}:localhost`] = i
    estado.bloqueio[CARLOS] = { bloqueado: true, at: 1 }
    estado.preferencias["tema"] = { valor: "escuro", at: 3 }
    // Too large for the box, as it comes.
    const inteiro = toBase64(new TextEncoder().encode(JSON.stringify(estado))).length
    expect(inteiro).toBeGreaterThan(ESTADO_PARTES_MAX * ESTADO_PARTE_CARACTERES)

    const partes = partirEstado(estado)
    expect(partes.length).toBeLessThanOrEqual(ESTADO_PARTES_MAX)
    const junto = juntarEstado(partes)
    if (junto === null) throw new Error("o instantâneo cortado não se lê")
    // The newest stays, the oldest goes.
    expect(junto.amizades[`!dm-ana.p${LIVRO_CANAIS_MAX - 1}:localhost`]).toBeDefined()
    expect(junto.amizades["!dm-ana.p0:localhost"]).toBeUndefined()
    expect(junto.lidas[`!canal-com-um-nome-comprido-${LIDAS_MAX - 1}:localhost`]).toBe(LIDAS_MAX - 1)
    expect(junto.lidas["!canal-com-um-nome-comprido-0:localhost"]).toBeUndefined()
    // Lock and preferences are not cut.
    expect(junto.bloqueio[CARLOS]).toEqual({ bloqueado: true, at: 1 })
    expect(junto.preferencias["tema"]).toEqual({ valor: "escuro", at: 3 })
  })

  it("um instantâneo que cabe não é tocado", () => {
    const estado = { ...estadoMinimo(), lidas: { "!a:x": 1, "!b:x": 2 } }
    expect(cortarEstadoAteCaber(estado)).toEqual(estado)
  })

  it("falta uma parte, ou chega lixo: null, e nunca uma excepção", () => {
    const partes = partirEstado({ ...estadoMinimo(), lidas: { "!a:x": 1 } })
    expect(juntarEstado([...partes.slice(0, -1), undefined])).toBeNull()
    expect(juntarEstado(["@@@"])).toBeNull()
    expect(juntarEstado([btoa('{"v":2}').replace(/=+$/, "")])).toBeNull()
  })

  it("um convidado 0.5.7 lê o certificado novo (o campo cai) e não reconhece as partes", () => {
    const certificado = {
      t: "certificado",
      address: ANA,
      accountKey: "A".repeat(43),
      deviceCert: "B".repeat(86),
      estado: 2,
    }
    expect(PairPayload.parse(certificado)).toEqual(certificado)
    expect(PairPayloadAntigo.parse(certificado)).toEqual({ t: "certificado", address: ANA, accountKey: "A".repeat(43), deviceCert: "B".repeat(86) })
    // `decifrarPairPayload` from 0.5.7 returns `null` to what its schema rejects: "not my pair".
    expect(PairPayloadAntigo.safeParse({ t: "estado", parte: 0, dados: "abc" }).success).toBe(false)
    // And a 0.5.7 host reads the new `pronto` without the capabilities.
    expect(PairPayloadAntigo.parse({ t: "pronto", capacidades: [CAPACIDADE_ESTADO_DA_CONTA] })).toEqual({ t: "pronto" })
  })
})

describe("os perfis das outras pessoas no instantâneo", () => {
  it("passam no instantâneo, sem retrato; um mapa torto cai sozinho e o resto fica", () => {
    const perfis = { [CARLOS]: { displayName: "Carlos", statusText: "a ler", activity: "ocupado", updatedAt: 7 } }
    expect(EstadoDeConta.parse({ ...estadoMinimo(), perfis }).perfis).toEqual(perfis)
    // A name above the limit, or a broken address: the map goes out, the snapshot does not.
    const torto = EstadoDeConta.parse({ ...estadoMinimo(), lidas: { "!a:x": 1 }, perfis: { [CARLOS]: { displayName: "x".repeat(65), updatedAt: 1 } } })
    expect(torto.perfis).toBeUndefined()
    expect(torto.lidas).toEqual({ "!a:x": 1 })
    expect(EstadoDeConta.parse({ ...estadoMinimo(), perfis: { "carlos": { displayName: "C", updatedAt: 1 } } }).perfis).toBeUndefined()
    // The portrait is not a schema field: it gets thrown away.
    const comRetrato = EstadoDeConta.parse({ ...estadoMinimo(), perfis: { [CARLOS]: { displayName: "C", updatedAt: 1, avatarDataUrl: "data:x" } } })
    expect(comRetrato.perfis?.[CARLOS]).toEqual({ displayName: "C", updatedAt: 1 })
  })

  it("acima do tecto da caixa, ficam os perfis de versão mais recente", () => {
    const estado = estadoMinimo()
    const nota = "uma nota comprida para encher o livro depressa ".repeat(5)
    for (let i = 0; i < LIVRO_CANAIS_MAX; i++) {
      estado.amizades[`!dm-ana.p${i}:localhost`] = Array.from({ length: 4 }, (_, j) => ({
        seq: j,
        sender: CARLOS,
        t: "friend.request" as const,
        sentAt: i * 10 + j,
        note: nota,
      }))
    }
    estado.perfis = {}
    for (let i = 1; i <= PERFIS_MAX; i++) {
      estado.perfis[`@pessoa${i}:localhost`] = { displayName: `Pessoa ${i}`, statusText: "m".repeat(128), updatedAt: i }
    }
    const junto = juntarEstado(partirEstado(estado))
    if (junto === null) throw new Error("o instantâneo cortado não se lê")
    expect(junto.perfis?.[`@pessoa${PERFIS_MAX}:localhost`]?.displayName).toBe(`Pessoa ${PERFIS_MAX}`)
    expect(Object.keys(junto.perfis ?? {}).length).toBeLessThan(PERFIS_MAX)
    expect(junto.perfis?.["@pessoa1:localhost"]).toBeUndefined()
  })
})

describe("os perfis no canal da conta e um irmão de antes disto", () => {
  /** The `estado.fichas` as 1.0.4 reads it: without `perfis`. Copied from that version's schema. */
  const FichasAntigo = z.object({ t: z.literal("estado.fichas"), fichas: FichasDeCanais, segredoDoMural: SegredoDoMural.optional() })

  it("o delta dos perfis passa no esquema novo e no antigo, que deita o campo fora e lê fichas vazias", () => {
    const delta = {
      t: "estado.fichas" as const,
      fichas: {},
      perfis: { [CARLOS]: { displayName: "Carlos", statusText: "a ler", activity: "ocupado", updatedAt: 7 } },
    }
    expect(decodePayload(encodePayload(delta))).toEqual(delta)
    const lido = FichasAntigo.safeParse(JSON.parse(new TextDecoder().decode(encodePayload(delta))))
    expect(lido.success).toBe(true)
    expect(lido.data).toEqual({ t: "estado.fichas", fichas: {} })
  })

  it("um mapa de perfis torto perde-se sozinho, e as fichas do mesmo payload ficam", () => {
    const fichas = { "!abc:orwell.pt": { tipo: "directa" as const, par: ANA } }
    const torto = { t: "estado.fichas", fichas, perfis: { [CARLOS]: { displayName: "", updatedAt: 0 } } }
    expect(decodePayload(new TextEncoder().encode(JSON.stringify(torto)))).toEqual({ t: "estado.fichas", fichas })
  })
})
