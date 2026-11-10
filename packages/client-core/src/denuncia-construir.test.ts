import { assinarAutoria, generateIdentity, parseServerName, signWithDevice, toBase64, verificarAutoria, type Identity } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import {
  CONTEXTO_ANTES,
  CONTEXTO_DEPOIS,
  construirDenuncia,
  seleccionarContexto,
  semAsMinhas,
  ULTIMAS_DA_PESSOA,
  type AlvoDaDenuncia,
} from "./denuncia-construir.js"
import { normalizar, type QuemRelata } from "./sincronia/relato.js"
import type { StoredChatMessage, StoredPayload } from "./vault.js"

/**
 * The report built from the vault (Report Task 3).
 *
 * Real identities and payloads signed by `assinarAutoria`, like the ones the
 * vault stores: no hand-built authorships.
 */

const SERVIDOR = parseServerName("orwell.test")
const CANAL = "!lagar:orwell.test"

function quem(identidade: Identity): QuemRelata {
  return {
    address: identidade.address,
    aparelho: identidade.deviceSigningPublicKey,
    assinar: (mensagem) => signWithDevice(identidade, mensagem),
  }
}

const ana = generateIdentity(SERVIDOR)
const bruno = generateIdentity(SERVIDOR)
const carla = generateIdentity(SERVIDOR)
const eu = quem(ana)

/** 2026-11-03T14:07:00Z plus `n` minutes. */
const BASE = Date.UTC(2026, 10, 3, 14, 7)

let contador = 0
function id(): string {
  return `msg-${String(++contador).padStart(8, "0")}`
}

/** A message signed by the author's device, as `send` persists it. */
function dita(
  autor: Identity,
  seq: number,
  corpo: string,
  extra: Record<string, unknown> = {},
  assinada = true,
): StoredChatMessage {
  const sentAt = BASE + seq * 60_000
  const cru: Record<string, unknown> = { t: "message", id: id(), sentAt, body: corpo, ...extra }
  let payload = cru
  if (assinada) {
    const normal = normalizar(cru)!
    const q = quem(autor)
    payload = { ...cru, autoria: assinarAutoria({ canal: CANAL, autor: autor.address, payload: normal, aparelho: q.aparelho, assinar: q.assinar }) }
  }
  return { seq, sender: autor.address, at: sentAt, payload: payload as unknown as StoredPayload }
}

function lapide(autor: Identity, seq: number, alvo: string): StoredChatMessage {
  return {
    seq,
    sender: autor.address,
    at: BASE + seq * 60_000,
    payload: { t: "redact", id: id(), target: alvo, redactedAt: BASE + seq * 60_000 } as unknown as StoredPayload,
  }
}

const idDe = (entrada: StoredChatMessage): string => (entrada.payload as unknown as { id: string }).id
const semCadeia = (): null => null

function construir(historico: StoredChatMessage[], alvo: AlvoDaDenuncia, extra: { modera?: (s: string) => boolean } = {}) {
  return construirDenuncia({ canal: CANAL, alvo, historico, eu, cadeiaDe: semCadeia, ...extra })
}

describe("seleccionar o contexto", () => {
  it("mensagem: leva a denunciada, até 10 antes e 5 depois, da mesma sala, por seq", () => {
    expect([CONTEXTO_ANTES, CONTEXTO_DEPOIS, ULTIMAS_DA_PESSOA]).toEqual([10, 5, 10])
    const historico: StoredChatMessage[] = []
    for (let seq = 1; seq <= 30; seq++) historico.push(dita(seq % 2 ? bruno : carla, seq, `m${seq}`))
    // Another room in between: does not count.
    historico.push(dita(bruno, 31, "noutra sala", { room: "sala-b" }))
    // Out of order in the vault: selection is by seq.
    const embaralhado = [...historico.slice(15), ...historico.slice(0, 15)]
    const alvo = historico[19]! // seq 20, from carla
    const escolhidas = seleccionarContexto(embaralhado, { canal: CANAL, pessoa: carla.address, mensagem: { id: idDe(alvo) } })
    expect(escolhidas.map((e) => e.seq)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])

    const preparada = construir(embaralhado, { canal: CANAL, pessoa: carla.address, mensagem: { id: idDe(alvo) } })!
    expect(preparada.itens.map((i) => i.item.s)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
    expect(preparada.denunciada).toBe(10)
    expect(preparada.itens[10]!.denunciada).toBe(true)
    expect(preparada.itens.filter((i) => i.denunciada)).toHaveLength(1)
    expect(preparada.alvo).toEqual({ tipo: "mensagem", id: idDe(alvo) })
    expect(preparada.denunciado).toBe(carla.address)
    expect(preparada.temCopia).toBe(false)
    // The author's `sentAt` date and time, in UTC.
    expect(preparada.itens[10]).toMatchObject({ autor: carla.address, dia: "2026-11-03", hora: "14:27", texto: "m20" })
  })

  it("a sala de outra conversa não entra, e o início do histórico corta o contexto", () => {
    const historico = [
      dita(bruno, 1, "na sala", { room: "sala-b" }),
      dita(carla, 2, "na geral"),
      dita(bruno, 3, "denunciada", { room: "sala-b" }),
      dita(bruno, 4, "depois", { room: "sala-b" }),
    ]
    const preparada = construir(historico, { canal: CANAL, sala: "sala-b", pessoa: bruno.address, mensagem: { id: idDe(historico[2]!) } })!
    expect(preparada.itens.map((i) => i.texto)).toEqual(["na sala", "denunciada", "depois"])
    expect(preparada.denunciada).toBe(1)
    expect(preparada.sala).toBe("sala-b")
  })

  it("pessoa sem mensagem: leva as últimas 10 dessa pessoa na conversa, e nada se não houver", () => {
    const historico: StoredChatMessage[] = []
    for (let seq = 1; seq <= 25; seq++) historico.push(dita(seq % 3 === 0 ? bruno : carla, seq, `m${seq}`))
    const preparada = construir(historico, { canal: CANAL, pessoa: carla.address })!
    expect(preparada.itens).toHaveLength(10)
    expect(preparada.itens.every((i) => i.autor === carla.address)).toBe(true)
    expect(preparada.itens.map((i) => i.item.s)).toEqual([11, 13, 14, 16, 17, 19, 20, 22, 23, 25])
    expect(preparada.denunciada).toBe(-1)
    expect(preparada.alvo).toEqual({ tipo: "pessoa" })
    expect(preparada.itens.some((i) => i.denunciada)).toBe(false)

    const vazia = construir([dita(bruno, 1, "só o bruno")], { canal: CANAL, pessoa: carla.address })!
    expect(vazia.itens).toEqual([])
    expect(vazia.itensDoFundador).toEqual([])
    expect(vazia.denunciada).toBe(-1)
  })

  it("os anexos saem com name, mediaType e byteLength: sem inline, url, key, nonce nem digest", () => {
    const anexos = [
      { name: "foto.png", mediaType: "image/png", inline: "data:image/png;base64,QUFBQUFB", byteLength: 6 },
      {
        name: "video.mp4",
        mediaType: "video/mp4",
        byteLength: 3000,
        url: "https://orwell.test/m/abc",
        key: "Q0hBVkVTRUNSRVRBQ0hBVkVTRUNSRVRBQ0hBVkVTRUM",
        nonce: "Tk9OQ0VOT05DRU5P",
        digest: "RElHRVNURElHRVNURElHRVNURElHRVNURElHRVNURA",
      },
    ]
    const historico = [dita(bruno, 1, "com anexos", { attachments: anexos })]
    const preparada = construir(historico, { canal: CANAL, pessoa: bruno.address, mensagem: { id: idDe(historico[0]!) } })!
    const [item] = preparada.itens
    expect(item!.anexos).toEqual([
      { name: "foto.png", mediaType: "image/png", byteLength: 6 },
      { name: "video.mp4", mediaType: "video/mp4", byteLength: 3000 },
    ])
    expect(item!.item.p["attachments"]).toEqual([
      { evicted: true, name: "foto.png", mediaType: "image/png", byteLength: 6 },
      { evicted: true, name: "video.mp4", mediaType: "video/mp4", byteLength: 3000 },
    ])
    for (const anexo of item!.item.p["attachments"] as Record<string, unknown>[]) {
      for (const chave of ["inline", "url", "key", "nonce", "digest"]) expect(anexo).not.toHaveProperty(chave)
    }
    const json = JSON.stringify(preparada)
    for (const segredo of ["QUFBQUFB", "orwell.test/m/abc", "Q0hBVkVTRUNSRVRB", "Tk9OQ0VOT05DRU5P", "RElHRVNURElHRVNU"]) {
      expect(json).not.toContain(segredo)
    }
    // The author's signature stays intact: it is the proof.
    expect(item!.item.p["autoria"]).toEqual((historico[0]!.payload as unknown as Record<string, unknown>)["autoria"])
    // It still verifies, without the bytes and with the size back, by the normal
    // form that the receiver uses (`receberItem`).
    const normal = normalizar(item!.item.p)!
    expect(verificarAutoria(CANAL, bruno.address, normal)).toEqual({ ok: true, aparelho: toBase64(bruno.deviceSigningPublicKey) })
    // A size that is not a finite non-negative number does not come back.
    const estranho = [dita(bruno, 2, "tamanho estranho", { attachments: [{ name: "a.bin", mediaType: "application/octet-stream", byteLength: -1 }] }, false)]
    const semTamanho = construir(estranho, { canal: CANAL, pessoa: bruno.address, mensagem: { id: idDe(estranho[0]!) } })
    // The schema won't let -1 be signed: this one goes without a signature (a corrupted vault or a tampered app).
    expect(semTamanho!.itens[0]!.anexos[0]).toEqual({ name: "a.bin", mediaType: "application/octet-stream" })
    expect((semTamanho!.itens[0]!.item.p["attachments"] as unknown[])[0]).not.toHaveProperty("byteLength")
  })

  it("a lista do fundador não tem as mensagens de quem denuncia e não deixa marca de lacuna", () => {
    const historico = [
      dita(bruno, 1, "um"),
      dita(ana, 2, "minha"),
      dita(carla, 3, "três"),
      dita(ana, 4, "outra minha"),
      dita(bruno, 5, "denunciada"),
      dita(ana, 6, "minha depois"),
    ]
    const preparada = construir(historico, { canal: CANAL, pessoa: bruno.address, mensagem: { id: idDe(historico[4]!) } })!
    // Our copy carries all of them.
    expect(preparada.itens).toHaveLength(6)
    expect(preparada.itens.filter((i) => i.autor === ana.address)).toHaveLength(3)
    // The founder's, without mine and without gaps.
    expect(preparada.itensDoFundador).toHaveLength(preparada.itens.length - 3)
    expect(preparada.itensDoFundador.some((i) => i.item.a === ana.address || i.autor === ana.address)).toBe(false)
    expect(preparada.itensDoFundador.map((i) => i.texto)).toEqual(["um", "três", "denunciada"])
    expect(JSON.stringify(preparada.itensDoFundador)).not.toContain("lacuna")
    expect(JSON.stringify(preparada.itensDoFundador)).not.toContain(ana.address)
    expect(preparada.itensDoFundador.filter((i) => i.denunciada)).toHaveLength(1)
    expect(semAsMinhas(preparada.itens, ana.address)).toEqual(preparada.itensDoFundador)
  })

  it("sem autoria de outra pessoa, o item vai na mesma e fica marcado para 'nao-verificada' (não se recusa)", () => {
    const historico = [dita(bruno, 1, "antes da autoria", {}, false), dita(ana, 2, "minha antiga", {}, false)]
    const preparada = construir(historico, { canal: CANAL, pessoa: bruno.address, mensagem: { id: idDe(historico[0]!) } })!
    expect(preparada.itens).toHaveLength(2)
    const [dele, minha] = preparada.itens
    expect(dele!.item.a).toBe(bruno.address)
    expect(dele!.item.p["autoria"]).toBeUndefined()
    expect(dele!.item.k).toBeUndefined()
    expect(dele!.denunciada).toBe(true)
    // Mine, without a signature, I sign it now (like in telemetry).
    expect(minha!.item.p["autoria"]).toBeDefined()
  })

  it("a cadeia vem do lambda, pelo aparelho que assinou", () => {
    const historico = [dita(bruno, 1, "olá")]
    const pedidos: [string, string][] = []
    const preparada = construirDenuncia({
      canal: CANAL,
      alvo: { canal: CANAL, pessoa: bruno.address, mensagem: { id: idDe(historico[0]!) } },
      historico,
      eu,
      cadeiaDe: (autor, aparelho) => {
        pedidos.push([autor, aparelho])
        return { k: "k".repeat(43), x: "x".repeat(86) }
      },
    })!
    expect(pedidos).toEqual([[bruno.address, toBase64(bruno.deviceSigningPublicKey)]])
    expect(preparada.itens[0]!.item).toMatchObject({ k: "k".repeat(43), x: "x".repeat(86) })
  })

  it("mensagem moderada ou minha dá null", () => {
    const daCarla = dita(carla, 1, "vai ser moderada")
    const minha = dita(ana, 2, "minha")
    const apagadaPeloAutor = dita(bruno, 3, "apagada pelo autor")
    const historico = [daCarla, minha, apagadaPeloAutor, lapide(bruno, 4, idDe(daCarla)), lapide(bruno, 5, idDe(apagadaPeloAutor))]
    const modera = (quemModera: string): boolean => quemModera === bruno.address
    expect(construir(historico, { canal: CANAL, pessoa: carla.address, mensagem: { id: idDe(daCarla) } }, { modera })).toBeNull()
    expect(construir(historico, { canal: CANAL, pessoa: ana.address, mensagem: { id: idDe(minha) } }, { modera })).toBeNull()
    expect(construir(historico, { canal: CANAL, pessoa: bruno.address, mensagem: { id: idDe(apagadaPeloAutor) } }, { modera })).toBeNull()
    expect(construir(historico, { canal: CANAL, pessoa: carla.address, mensagem: { id: "msg-nao-existe" } }, { modera })).toBeNull()
    // The named person must be the message author.
    expect(construir(historico, { canal: CANAL, pessoa: carla.address, mensagem: { id: idDe(minha) } }, { modera })).toBeNull()
    // The moderated one also does not enter another report's context.
    const outra = dita(carla, 6, "depois")
    const preparada = construir([...historico, outra], { canal: CANAL, pessoa: carla.address, mensagem: { id: idDe(outra) } }, { modera })!
    expect(preparada.itens.map((i) => i.texto)).toEqual(["minha", "depois"])
  })
})
