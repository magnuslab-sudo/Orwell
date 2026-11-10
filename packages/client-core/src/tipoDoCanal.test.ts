import { describe, expect, it } from "vitest"
import * as modulo from "./tipoDoCanal.js"
import { fichaDoCanal, registarFicha, tipoDoCanal } from "./tipoDoCanal.js"

/**
 * The channel type comes from the vault, and only the vault (1.0 "Arca", slice 3).
 * What binds here: the vault record is what the channel is; a channel with no
 * record is a room, whatever shape it has (the old-form gate closed); the first
 * record stays.
 */

const EU = "@ana:orwell.pt"
const BENTO = "@bento:orwell.pt"
const OPACA = "!abcdefghijklmnopqrstuvwxyz234567abcdefgh:orwell.pt"

describe("tipoDoCanal", () => {
  it("a ficha do cofre vence a forma da morada", () => {
    const cofre = { fichasDosCanais: { "!dm-ana.bento:orwell.pt": { tipo: "sala" as const } } }
    expect(tipoDoCanal(cofre, "!dm-ana.bento:orwell.pt")).toBe("sala")
  })

  it("uma morada opaca sem ficha é uma sala; com ficha é o que a ficha diz", () => {
    expect(tipoDoCanal(null, OPACA)).toBe("sala")
    const cofre = { fichasDosCanais: { [OPACA]: { tipo: "directa" as const, par: BENTO } } }
    expect(fichaDoCanal(cofre, OPACA)).toEqual({ tipo: "directa", par: BENTO })
  })

  it("a forma antiga já não diz nada: sem ficha, um `!dm-`, um `!feed-` e um `!self-` são salas", () => {
    for (const canal of ["!dm-ana.bento:orwell.pt", "!feed-bento:orwell.pt", "!self-ana:orwell.pt"]) {
      expect(fichaDoCanal({}, canal)).toEqual({ tipo: "sala" })
    }
    // The gate and migration left the module.
    expect("fichaPelaFormaAntiga" in modulo).toBe(false)
    expect("migrarFichasDosCanais" in modulo).toBe(false)
    void EU
  })

  it("a primeira ficha fica: um canal não muda de tipo", () => {
    const cofre = {}
    expect(registarFicha(cofre, OPACA, { tipo: "directa", par: BENTO })).toBe(true)
    expect(registarFicha(cofre, OPACA, { tipo: "sala" })).toBe(false)
    expect(tipoDoCanal(cofre, OPACA)).toBe("directa")
  })

  it("uma ficha que chega do fio guarda só os campos que traz", () => {
    const cofre: { fichasDosCanais?: Record<string, unknown> } = {}
    registarFicha(cofre as never, OPACA, { tipo: "mural", dono: BENTO, par: undefined })
    expect(cofre.fichasDosCanais?.[OPACA]).toEqual({ tipo: "mural", dono: BENTO })
  })
})
