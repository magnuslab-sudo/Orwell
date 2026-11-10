import { DENUNCIAS_POR_PAYLOAD_MAX, Payload } from "@enclave/protocol"
import { describe, expect, it } from "vitest"
import { denunciasParaOsIrmaos, fundirDenuncias, payloadsDasDenuncias } from "./denuncia-recebida.js"
import type { DenunciaRecebida, VaultContents } from "./vault.js"

const CANAL = "!praca:orwell.pt"
const denuncia = (id: string, dia = "2026-11-04", lida = false): DenunciaRecebida => ({
  id,
  canal: CANAL,
  dia,
  motivo: 5,
  nota: "",
  denunciado: "@carla:orwell.pt",
  alvo: { tipo: "pessoa" },
  itens: [{ autor: "@carla:orwell.pt", dia, hora: "21:14", texto: "promo", anexos: [], verificada: true, denunciada: false }],
  lida,
})
const cofre = (extra: Partial<VaultContents> = {}): VaultContents => extra as VaultContents

describe("as denúncias entre os aparelhos da conta", () => {
  it("vão em estado.fichas de fichas vazias, sem o lida, até ao tecto por payload", () => {
    const muitas = Array.from({ length: DENUNCIAS_POR_PAYLOAD_MAX + 3 }, (_, n) => denuncia(`d${n}`, "2026-11-04", n % 2 === 0))
    const payloads = payloadsDasDenuncias(muitas)
    expect(payloads.length).toBe(2)
    for (const payload of payloads) expect(Payload.safeParse(payload).success).toBe(true)
    const primeiro = payloads[0] as Extract<Payload, { t: "estado.fichas" }>
    expect(primeiro.fichas).toEqual({})
    expect(primeiro.denuncias?.length).toBe(DENUNCIAS_POR_PAYLOAD_MAX)
    expect(JSON.stringify(payloads)).not.toContain("lida")
    expect(payloadsDasDenuncias([])).toEqual([])
  })

  it("uma denúncia torta do cofre fica de fora sozinha", () => {
    const torta = { ...denuncia("x"), id: "Não Serve" }
    const [payload] = payloadsDasDenuncias([torta, denuncia("ok")]) as Extract<Payload, { t: "estado.fichas" }>[]
    expect(payload!.denuncias!.map((d) => d.id)).toEqual(["ok"])
  })

  it("o estado inteiro leva as mais recentes pelo dia, até ao tecto", () => {
    const c = cofre({ denuncias: { [CANAL]: [denuncia("velha", "2026-08-01"), denuncia("nova", "2026-11-04"), denuncia("meio", "2026-10-01")] } })
    expect(denunciasParaOsIrmaos(c, 2).map((d) => d.id)).toEqual(["nova", "meio"])
    expect(denunciasParaOsIrmaos(cofre()).length).toBe(0)
  })

  it("fundir entra uma vez por id, por ler, e tira a cópia da espera", () => {
    const c = cofre({ denuncias: { [CANAL]: [denuncia("a", "2026-11-04", true)] }, copiasPorAbrir: { b: CANAL, z: "!outro:orwell.pt" } })
    const [, b] = payloadsDasDenuncias([denuncia("a"), { ...denuncia("b"), lida: true }]).flatMap(
      (p) => (p as Extract<Payload, { t: "estado.fichas" }>).denuncias!,
    )
    expect(fundirDenuncias(c, [b!, b!])).toEqual([CANAL])
    expect(c.denuncias![CANAL]!.map((d) => [d.id, d.lida])).toEqual([
      ["a", true],
      ["b", false],
    ])
    expect(c.copiasPorAbrir).toEqual({ z: "!outro:orwell.pt" })
    expect(fundirDenuncias(c, [b!])).toEqual([])
  })
})
