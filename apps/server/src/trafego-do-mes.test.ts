import { describe, expect, it } from "vitest"
// @ts-expect-error: JavaScript script, no type declarations.
import { avaliar, frase, mesCorrente } from "../../../scripts/trafego-do-mes.mjs"

/**
 * The monthly quota script (`scripts/trafego-do-mes.mjs`), no SSH: account only.
 *
 * What matters to keep is the arithmetic that decides the alert. A factor of 1024
 * swapped between the two versions of `vnstat` JSON gave an alert a thousand times
 * late, and a late alert is a VPS cut off mid-month.
 */
const AGORA = new Date(Date.UTC(2026, 10, 16)) // November 16, mid-month
const vnstat = (rx: number, tx: number, jsonversion = "2") => ({
  jsonversion,
  interfaces: [
    {
      name: "eth0",
      traffic: {
        month: [
          { date: { year: 2026, month: 10 }, rx: 9e12, tx: 9e12 },
          { date: { year: 2026, month: 11 }, rx, tx },
        ],
      },
    },
  ],
})

describe("o tráfego do mês contra a quota", () => {
  it("lê o mês corrente, e não o anterior", () => {
    expect(mesCorrente(vnstat(1e12, 2e12), { agora: AGORA })).toEqual({ interface: "eth0", rx: 1e12, tx: 2e12 })
  })

  it("o JSON da versão 1 do vnstat vem em KiB", () => {
    const mes = mesCorrente(vnstat(1000, 0, "1"), { agora: AGORA })
    expect(mes.rx).toBe(1024 * 1000)
  })

  it("abaixo de 70 % não avisa", () => {
    expect(avaliar({ rx: 2e12, tx: 3e12 }, { agora: AGORA }).nivel).toBe("ok")
  })

  it("a partir de 70 % de 8 TB avisa, e diz a projecção", () => {
    const r = avaliar({ rx: 2.6e12, tx: 3e12 }, { agora: AGORA })
    expect(r.nivel).toBe("aviso")
    // 70% mid-month ends close to 140%.
    expect(r.projeccao).toBeGreaterThan(1.3)
    expect(frase(r)).toMatch(/^AVISO: .*70 %/)
  })

  it("a partir de 90 % alerta", () => {
    const r = avaliar({ rx: 3.3e12, tx: 4e12 }, { agora: AGORA })
    expect(r.nivel).toBe("alerta")
    expect(frase(r)).toMatch(/^ALERTA:/)
  })

  it("com `--conta=tx` só a saída conta", () => {
    expect(avaliar({ rx: 7e12, tx: 1e12 }, { agora: AGORA, conta: "tx" }).nivel).toBe("ok")
    expect(avaliar({ rx: 7e12, tx: 1e12 }, { agora: AGORA }).nivel).toBe("alerta")
  })

  it("a quota configura-se", () => {
    expect(avaliar({ rx: 0, tx: 7.5e12 }, { agora: AGORA, quotaTB: 10 }).nivel).toBe("aviso")
  })
})
