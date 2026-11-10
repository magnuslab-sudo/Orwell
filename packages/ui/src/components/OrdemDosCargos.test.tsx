/**
 * The rule that orders the positions, and the line sheet that seats it.
 *
 * The gesture itself (arrows, drag, the warning, the wait) is tested in the two
 * editors that use it: `RoleEditor.test.tsx` and `CargosEPermissoes.test.tsx`.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import type { EnclaveBridge } from "../bridge.js"
import { podeOrdenarCargos } from "./OrdemDosCargos.js"

const CANAL = "!lagar:casa.pt"
const ANA = "@ana:casa.pt" // fundadora
const DARIO = "@dario:casa.pt" // admin
const BRUNO = "@bruno:casa.pt" // leader, with managepermissions (delegation)
const CARLA = "@carla:casa.pt" // no role

function ponte(comOrdem = true): EnclaveBridge {
  const cargos: Record<string, string[]> = { [DARIO]: ["admin"], [BRUNO]: ["chefe"] }
  return {
    channels: {
      founder: () => ANA,
      rolesFor: (_canal: string, quem: string) => cargos[quem] ?? [],
      ...(comOrdem ? { reorderRoles: async () => ({ ok: true }) } : {}),
    },
  } as unknown as EnclaveBridge
}

describe("quem ordena os cargos: a regra de reorderRoles", () => {
  it("o fundador e quem tem admin ordenam", () => {
    expect(podeOrdenarCargos(ponte(), CANAL, ANA)).toBe(true)
    expect(podeOrdenarCargos(ponte(), CANAL, DARIO)).toBe(true)
  })

  it("sem escalada: quem gere cargos por delegação não ordena, e quem não tem cargo também não", () => {
    expect(podeOrdenarCargos(ponte(), CANAL, BRUNO)).toBe(false)
    expect(podeOrdenarCargos(ponte(), CANAL, CARLA)).toBe(false)
    expect(podeOrdenarCargos(ponte(), CANAL, null)).toBe(false)
  })

  it("um anfitrião que não sabe ordenar não oferece o gesto, nem ao fundador", () => {
    expect(podeOrdenarCargos(ponte(false), CANAL, ANA)).toBe(false)
  })
})

describe("a linha que assenta: a folha", () => {
  const folha = (): string => {
    const meu = expect.getState().testPath
    if (!meu) throw new Error("sem caminho do teste")
    return readFileSync(join(dirname(meu), "..", "styles", "cargosEPermissoes.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  }

  it("com movimento reduzido continua a mexer, mais devagar, por cima da regra universal", () => {
    const normal = Number(/\.cep-assenta \{\s*animation:\s*cargo-assenta\s+(\d+)ms/.exec(folha())?.[1])
    const bloco = folha().match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cep-assenta \{([^}]*)\}/)?.[1]
    expect(bloco, "o bloco de movimento reduzido da linha").toBeDefined()
    expect(bloco).not.toContain("animation: none")
    expect(bloco).toMatch(/animation-duration:\s*\d+ms\s*!important/)
    const devagar = Number(/animation-duration:\s*(\d+)ms/.exec(bloco ?? "")?.[1])
    expect(normal).toBeGreaterThan(0)
    expect(devagar).toBeGreaterThan(normal)
  })
})
