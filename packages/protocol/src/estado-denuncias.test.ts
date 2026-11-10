import { describe, expect, it } from "vitest"
import { DENUNCIAS_POR_PAYLOAD_MAX, DenunciaDaConta, PAYLOADS_DE_ESTADO } from "./estado.js"
import { Payload } from "./payload.js"

/**
 * Copies to the founder across the account's devices (report finishing, 11/4/2026).
 * The device holding the account key opens the copy and sends the report already
 * open to its siblings through the account channel, in an OPTIONAL field of `estado.fichas`,
 * like profiles: a 1.3.0 sibling knows the payload and discards the field.
 */

const CARLA = "@carla:orwell.pt"
const ANA = "@ana:orwell.pt"

const denuncia = (id = "a1b2"): DenunciaDaConta => ({
  id,
  canal: "!praca:orwell.pt",
  sala: "geral",
  dia: "2026-11-04",
  motivo: 3,
  nota: "Insultos.",
  denunciado: CARLA,
  alvo: { tipo: "mensagem", id: "m-2" },
  itens: [
    { autor: ANA, dia: "2026-11-04", hora: "09:58", texto: "bom dia", anexos: [], verificada: true, denunciada: false },
    {
      autor: CARLA,
      dia: "2026-11-04",
      hora: "10:01",
      texto: "a ofensa",
      anexos: [{ name: "porta.jpg", mediaType: "image/jpeg", byteLength: 2048 }],
      verificada: true,
      denunciada: true,
    },
  ],
})

/** The 1.3.0 schema, frozen in `testes/v1.3.0/estado.ts` (copy of 8861466d), outside `rootDir`. */
const { PAYLOADS_DE_ESTADO: PAYLOADS_DE_ESTADO_130 } = (await import(
  /* @vite-ignore */ new URL("../testes/v1.3.0/estado.ts", import.meta.url).href
)) as { PAYLOADS_DE_ESTADO: typeof PAYLOADS_DE_ESTADO }

const fichasDe = (esquemas: readonly { shape: { t: { value: string } } }[]) =>
  esquemas.find((e) => e.shape.t.value === "estado.fichas") as unknown as { parse: (v: unknown) => Record<string, unknown> }

describe("as denúncias no estado.fichas", () => {
  it("passam pelo esquema do payload, sem o `lida`", () => {
    const lido = Payload.parse({ t: "estado.fichas", fichas: {}, denuncias: [{ ...denuncia(), lida: true }] })
    expect(lido.t === "estado.fichas" && lido.denuncias).toEqual([denuncia()])
  })

  it("um mapa torto perde-se ele, e não leva as fichas consigo", () => {
    const fichas = { "!dm:orwell.pt": { tipo: "directa", par: CARLA } }
    const lido = fichasDe(PAYLOADS_DE_ESTADO).parse({ t: "estado.fichas", fichas, denuncias: [{ ...denuncia(), motivo: 9 }] })
    expect(lido["denuncias"]).toBeUndefined()
    expect(lido["fichas"]).toEqual(fichas)
  })

  it("tem tecto por payload", () => {
    const muitas = Array.from({ length: DENUNCIAS_POR_PAYLOAD_MAX + 1 }, (_, n) => denuncia(`d${n}`))
    expect(fichasDe(PAYLOADS_DE_ESTADO).parse({ t: "estado.fichas", fichas: {}, denuncias: muitas })["denuncias"]).toBeUndefined()
    expect(DenunciaDaConta.safeParse({ ...denuncia(), id: "Maiúsculas" }).success).toBe(false)
  })

  it("um cliente 1.3.0 lê o mesmo payload e deita fora só as denúncias", () => {
    const fichas = { "!dm:orwell.pt": { tipo: "directa", par: CARLA } }
    const lido = fichasDe(PAYLOADS_DE_ESTADO_130).parse({ t: "estado.fichas", fichas, denuncias: [denuncia()] })
    expect(lido).toEqual({ t: "estado.fichas", fichas })
  })
})
