import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { versaoMudou, watchForNewVersion } from "./version-watch.js"

/**
 * The old version stops writing: the half that decides here.
 *
 * `main.tsx` wires the warning to `posse.largar()`, which stops the write
 * (tested in `posse-do-separador.test.ts` and `bridge.parar.test.ts`). What
 * this file holds is the question: only a KNOWN "yes" blocks, and doubt never
 * does.
 */

const fontes = (meu: string | null, servidor: string | null) => ({
  meu: () => meu,
  doServidor: () => Promise.resolve(servidor),
})

describe("versaoMudou", () => {
  it("bundle diferente no servidor: mudou", async () => {
    expect(await versaoMudou(fontes("index-aaa.js", "index-bbb.js"))).toBe(true)
  })

  it("o mesmo bundle: não mudou", async () => {
    expect(await versaoMudou(fontes("index-aaa.js", "index-aaa.js"))).toBe(false)
  })

  it("sem resposta do servidor (offline): não bloqueia", async () => {
    expect(await versaoMudou(fontes("index-aaa.js", null))).toBe(false)
  })

  it("em desenvolvimento (sem hash): não bloqueia", async () => {
    expect(await versaoMudou(fontes(null, "index-bbb.js"))).toBe(false)
  })
})

describe("watchForNewVersion", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("avisa uma única vez, quando a versão do servidor muda", async () => {
    let servidor = "index-aaa.js"
    const aoDetectar = vi.fn()
    const parar = watchForNewVersion(aoDetectar, { meu: () => "index-aaa.js", doServidor: async () => servidor })
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(aoDetectar).not.toHaveBeenCalled()
    servidor = "index-bbb.js"
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(aoDetectar).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event("focus"))
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(aoDetectar).toHaveBeenCalledTimes(1)
    parar()
  })

  it("ao voltar ao separador verifica logo", async () => {
    const aoDetectar = vi.fn()
    const parar = watchForNewVersion(aoDetectar, fontes("index-aaa.js", "index-bbb.js"))
    window.dispatchEvent(new Event("focus"))
    await vi.advanceTimersByTimeAsync(0)
    expect(aoDetectar).toHaveBeenCalledTimes(1)
    parar()
  })
})
