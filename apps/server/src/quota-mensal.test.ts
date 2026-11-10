import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { TECTO_DO_ECRA } from "@enclave/protocol"
import { OrcamentoDeSaida } from "./orcamento-de-saida.js"
import { VigiaDaQuota, avaliarQuota, mesDe } from "./quota-mensal.js"

/**
 * The video cutoff near the monthly quota (`quota-mensal.ts`), and the host script
 * that writes the file (`infra/quota-vnstat.sh`).
 */
const QUOTA = 8e12
const AGORA = new Date("2026-11-16T12:00:00Z")
const ficheiro = (saidaBytes: number, { mes = "2026-11", lidoEm = "2026-11-16T11:55:00Z" } = {}) =>
  JSON.stringify({ mes, saidaBytes, lidoEm })

describe("avaliarQuota", () => {
  it("abaixo de 80 % é o orçamento normal", () => {
    expect(avaliarQuota(ficheiro(0.79 * QUOTA), QUOTA, AGORA)).toEqual({ estado: "normal", fracao: 0.79 })
  })

  it("a partir de 80 % é o reduzido", () => {
    expect(avaliarQuota(ficheiro(0.8 * QUOTA), QUOTA, AGORA)).toEqual({ estado: "reduzido", fracao: 0.8 })
    expect(avaliarQuota(ficheiro(1.2 * QUOTA), QUOTA, AGORA).estado).toBe("reduzido")
  })

  it("ficheiro em falta ou ilegível é ignorado", () => {
    expect(avaliarQuota(null, QUOTA, AGORA).estado).toBe("ignorado")
    expect(avaliarQuota("{não é json", QUOTA, AGORA).estado).toBe("ignorado")
    expect(avaliarQuota(JSON.stringify({ mes: "2026-11", saidaBytes: "muito" , lidoEm: "2026-11-16T11:55:00Z" }), QUOTA, AGORA).estado).toBe("ignorado")
    expect(avaliarQuota("null", QUOTA, AGORA).estado).toBe("ignorado")
  })

  it("ficheiro com mais de 2 h é ignorado, mesmo acima de 80 %", () => {
    const velho = avaliarQuota(ficheiro(0.95 * QUOTA, { lidoEm: "2026-11-16T09:59:00Z" }), QUOTA, AGORA)
    expect(velho).toMatchObject({ estado: "ignorado" })
    expect(avaliarQuota(ficheiro(0.95 * QUOTA, { lidoEm: "2026-11-16T10:01:00Z" }), QUOTA, AGORA).estado).toBe("reduzido")
  })

  it("mês novo volta ao normal, mesmo com o mês anterior acima de 80 %", () => {
    const primeiroDoMes = new Date("2026-12-01T00:20:00Z")
    const doMesQueAcabou = ficheiro(0.99 * QUOTA, { mes: "2026-11", lidoEm: "2026-11-30T23:55:00Z" })
    expect(avaliarQuota(doMesQueAcabou, QUOTA, primeiroDoMes)).toEqual({ estado: "normal", fracao: 0 })
    expect(mesDe(primeiroDoMes)).toBe("2026-12")
  })
})

describe("VigiaDaQuota", () => {
  const montar = (conteudo: { valor: string | null }, agora: { valor: Date }) => {
    const aplicados: number[] = []
    const linhas: string[] = []
    const vigia = new VigiaDaQuota({
      ficheiro: "/quota/saida-do-mes.json",
      quotaBytes: QUOTA,
      videoNormalBps: 300_000_000,
      videoReduzidoBps: 50_000_000,
      aplicar: (bits) => aplicados.push(bits),
      registar: (linha) => linhas.push(linha),
      ler: async () => conteudo.valor,
      agora: () => agora.valor,
    })
    return { vigia, aplicados, linhas }
  }

  it("corta acima de 80 %, volta no mês novo, e diz cada mudança uma vez", async () => {
    const conteudo = { valor: ficheiro(0.5 * QUOTA) as string | null }
    const agora = { valor: AGORA }
    const { vigia, aplicados, linhas } = montar(conteudo, agora)

    await vigia.verificar()
    expect(aplicados.at(-1)).toBe(300_000_000)
    expect(linhas).toHaveLength(0)

    conteudo.valor = ficheiro(0.85 * QUOTA)
    await vigia.verificar()
    await vigia.verificar()
    expect(aplicados.at(-1)).toBe(50_000_000)
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toMatch(/85 %.*50 Mbit\/s/)

    agora.valor = new Date("2026-12-01T00:20:00Z")
    conteudo.valor = ficheiro(0.85 * QUOTA, { lidoEm: "2026-11-30T23:55:00Z" })
    await vigia.verificar()
    expect(aplicados.at(-1)).toBe(300_000_000)
    expect(linhas).toHaveLength(2)
    expect(linhas[1]).toMatch(/volta a 300 Mbit\/s/)
  })

  it("ficheiro em falta ou velho: orçamento normal e um aviso no registo", async () => {
    const conteudo = { valor: ficheiro(0.9 * QUOTA) as string | null }
    const agora = { valor: AGORA }
    const { vigia, aplicados, linhas } = montar(conteudo, agora)
    await vigia.verificar()
    expect(aplicados.at(-1)).toBe(50_000_000)

    conteudo.valor = null
    await vigia.verificar()
    await vigia.verificar()
    expect(aplicados.at(-1)).toBe(300_000_000)
    expect(linhas.filter((linha) => linha.includes("aviso"))).toHaveLength(1)

    conteudo.valor = ficheiro(0.9 * QUOTA, { lidoEm: "2026-11-16T08:00:00Z" })
    await vigia.verificar()
    expect(aplicados.at(-1)).toBe(300_000_000)
    expect(linhas.at(-1)).toMatch(/aviso: .*mais de 2 h/)
  })

  it("o corte não tira nada a quem já reservou, e a voz não muda", () => {
    const orcamento = new OrcamentoDeSaida(300_000_000, 40_000_000)
    for (let i = 0; i < 40; i++) orcamento.reservar(`ecra${i}`, "video", TECTO_DO_ECRA)
    orcamento.definirTectoDoVideo(50_000_000)
    expect(orcamento.ler().video).toMatchObject({ uso: 100_000_000, tecto: 50_000_000, fluxos: 40 })
    expect(orcamento.reservar("novo", "video", TECTO_DO_ECRA)).toBe(false)
    expect(orcamento.reservar("voz", "voz", 35_000)).toBe(true)
    expect(orcamento.ler().voz.tecto).toBe(40_000_000)
    // Below the reduced cap, admissions resume.
    for (let i = 0; i < 21; i++) orcamento.libertar(`ecra${i}`)
    expect(orcamento.reservar("novo", "video", TECTO_DO_ECRA)).toBe(true)
  })
})

describe("infra/quota-vnstat.sh", () => {
  const pasta = mkdtempSync(join(tmpdir(), "quota-vnstat-"))
  afterAll(() => rmSync(pasta, { recursive: true, force: true }))
  const guiao = resolve(__dirname, "../../../infra/quota-vnstat.sh")

  /** A `vnstat --json m` response like vnstat 2.x, with two interfaces and two months. */
  const vnstat = (jsonversion: string) => ({
    vnstatversion: jsonversion === "1" ? "1.18" : "2.9",
    jsonversion,
    interfaces: [
      { name: "docker0", traffic: { month: [{ id: 1, date: { year: 2026, month: 11 }, rx: 1, tx: 999 }] } },
      {
        name: "eth0",
        traffic: {
          month: [
            { id: 1, date: { year: 2026, month: 10 }, rx: 9e12, tx: 7e12 },
            { id: 2, date: { year: 2026, month: 11 }, rx: 1_500_000_000_000, tx: 6_400_000_000_000 },
          ],
        },
      },
    ],
  })

  const correr = (jsonversion: string) => {
    const entrada = join(pasta, `vnstat-${jsonversion}.json`)
    const saida = join(pasta, `saida-${jsonversion}.json`)
    writeFileSync(entrada, JSON.stringify(vnstat(jsonversion)))
    execFileSync("bash", [guiao], {
      env: { PATH: process.env.PATH ?? "", QUOTA_VNSTAT_JSON: entrada, QUOTA_SAIDA: saida, QUOTA_INTERFACE: "eth0", QUOTA_AGORA: "2026-11-16T12:00:00Z" },
    })
    return readFileSync(saida, "utf8")
  }

  it("escreve a saída do mês corrente na interface pública", () => {
    const escrito = correr("2")
    expect(JSON.parse(escrito)).toEqual({ mes: "2026-11", saidaBytes: 6_400_000_000_000, lidoEm: "2026-11-16T12:00:00Z" })
    // And that is what the server reads: 6.4 of 8 TB is 80 %, the cutoff.
    expect(avaliarQuota(escrito, QUOTA, AGORA)).toEqual({ estado: "reduzido", fracao: 0.8 })
  })

  it("o jsonversion 1 vem em KiB", () => {
    expect(JSON.parse(correr("1")).saidaBytes).toBe(6_400_000_000_000 * 1024)
  })
})
