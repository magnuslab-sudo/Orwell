import { describe, expect, it } from "vitest"
import { fromBase64, toBase64 } from "./canonical.js"
import {
  SELO_DO_CONVITE_BYTES,
  SELO_DO_CONVITE_MAX_CARACTERES,
  abrirSeloDoConvite,
  selarNomeDoConvite,
} from "./selo-do-convite.js"
import { ClientFrame, ServerFrame } from "./wire.js"

const CODIGO = "0123456789abcdef"
const OUTRO = "fedcba9876543210"

describe("o selo do convite (fatia 5c)", () => {
  it("abre com o código e dá o nome do canal e o de quem convida", () => {
    const selo = selarNomeDoConvite(CODIGO, { canal: "Clube de Leitura", quem: "Ana" })
    expect(abrirSeloDoConvite(CODIGO, selo)).toEqual({ canal: "Clube de Leitura", quem: "Ana" })
  })

  it("sem nome de quem convida, só o canal", () => {
    const selo = selarNomeDoConvite(CODIGO, { canal: "Geral" })
    expect(abrirSeloDoConvite(CODIGO, selo)).toEqual({ canal: "Geral" })
  })

  it("não abre com outro código", () => {
    const selo = selarNomeDoConvite(CODIGO, { canal: "Geral" })
    expect(abrirSeloDoConvite(OUTRO, selo)).toBeNull()
  })

  it("não abre mexido, cortado, vazio ou que não é base64", () => {
    const selo = selarNomeDoConvite(CODIGO, { canal: "Geral" })
    const bytes = fromBase64(selo)
    bytes[40] = (bytes[40] as number) ^ 1
    expect(abrirSeloDoConvite(CODIGO, toBase64(bytes))).toBeNull()
    expect(abrirSeloDoConvite(CODIGO, selo.slice(0, -4))).toBeNull()
    expect(abrirSeloDoConvite(CODIGO, "")).toBeNull()
    expect(abrirSeloDoConvite(CODIGO, "não é base64!")).toBeNull()
  })

  it("tem sempre o mesmo tamanho: o servidor não conta as letras do nome", () => {
    const curto = selarNomeDoConvite(CODIGO, { canal: "a" })
    const longo = selarNomeDoConvite(CODIGO, { canal: "x".repeat(100), quem: "y".repeat(64) })
    expect(fromBase64(curto).length).toBe(SELO_DO_CONVITE_BYTES)
    expect(longo.length).toBe(curto.length)
    expect(curto.length).toBeLessThanOrEqual(SELO_DO_CONVITE_MAX_CARACTERES)
  })

  it("dois selos do mesmo nome são diferentes (nonce aleatório)", () => {
    expect(selarNomeDoConvite(CODIGO, { canal: "Geral" })).not.toBe(selarNomeDoConvite(CODIGO, { canal: "Geral" }))
  })

  it("um nome grande demais corta-se sem partir um carácter", () => {
    const aberto = abrirSeloDoConvite(CODIGO, selarNomeDoConvite(CODIGO, { canal: "😀".repeat(100) }))
    expect(aberto?.canal).toBe("😀".repeat(75))
  })

  it("o nome com acentos, aspas e emoji volta igual", () => {
    const canal = "«Café» do João 🎉"
    expect(abrirSeloDoConvite(CODIGO, selarNomeDoConvite(CODIGO, { canal, quem: "Bia ç" }))).toEqual({ canal, quem: "Bia ç" })
  })

  it("o fio: o selo vai no invite.create, volta no invite.resolved e no invite.selo.result, com tecto", () => {
    const selo = selarNomeDoConvite(CODIGO, { canal: "Geral" })
    const criar = { t: "invite.create", channel: "!x:orwell.pt", codeHash: "aa", expiresAt: null, maxUses: null, selo }
    expect(ClientFrame.parse(criar)).toMatchObject({ selo })
    expect(ClientFrame.safeParse({ ...criar, selo: "a".repeat(SELO_DO_CONVITE_MAX_CARACTERES + 1) }).success).toBe(false)
    expect(ClientFrame.parse({ t: "invite.selo", codeHash: "aa" })).toEqual({ t: "invite.selo", codeHash: "aa" })
    expect(ServerFrame.parse({ t: "invite.resolved", codigo: "ab2cd3ef", channel: "!x:orwell.pt", codeHash: "aa", selo })).toMatchObject({ selo })
    expect(ServerFrame.parse({ t: "invite.selo.result", codeHash: "aa" })).toEqual({ t: "invite.selo.result", codeHash: "aa" })
    expect(ServerFrame.safeParse({ t: "invite.selo.result", codeHash: "aa", selo: "a".repeat(SELO_DO_CONVITE_MAX_CARACTERES + 1) }).success).toBe(false)
  })
})
