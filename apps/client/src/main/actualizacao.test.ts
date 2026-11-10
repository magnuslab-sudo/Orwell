import { describe, expect, it, vi } from "vitest"
import {
  ENDERECO_DA_VERSAO,
  maisRecente,
  verificarActualizacao,
  type PortasDaActualizacao,
} from "./actualizacao.js"

/**
 * The update warning, tested without network.
 *
 * What matters to prove is not that a `fetch` works: it's that this thing **does
 * nothing dangerous and bothers nobody**. Without code signing there can be
 * no updater (see the header of `actualizacao.ts`), and a warning that
 * breaks startup or shouts on every open is worse than no warning at all: it's
 * what makes someone turn it off and never see any again.
 */

/** A manifest as `scripts/publicar-instaladores.mjs` writes it. */
function manifesto(versao: string, extras: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      versao,
      nome: "Statio",
      descargas: "https://orwell.pt/transferencias/",
      ficheiros: [
        { sistema: "macOS", nome: `Orwell-${versao}-macos-universal.dmg`, bytes: 310_000_000, soma: "a".repeat(64) },
        { sistema: "Windows", nome: `Orwell-${versao}-windows-x64.exe`, bytes: 96_000_000, soma: "b".repeat(64) },
      ],
      ...extras,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function portas(resposta: Response | Error, sobre: Partial<PortasDaActualizacao> = {}): PortasDaActualizacao & {
  pedidos: string[]
} {
  const pedidos: string[] = []
  const buscar = vi.fn(async (entrada: RequestInfo | URL) => {
    pedidos.push(String(entrada))
    if (resposta instanceof Error) throw resposta
    return resposta.clone()
  }) as unknown as typeof fetch
  return {
    instalada: "0.1.0",
    sistema: "darwin",
    dispensada: null,
    buscar,
    pedidos,
    ...sobre,
  }
}

describe("comparar versões", () => {
  it("é numérica e não alfabética, senão a 0.10 nunca chegava a ninguém", () => {
    // As text, "0.10.0" < "0.9.0". The day the minor version hit 10 was the
    // day everyone stopped getting warned, silently.
    expect(maisRecente("0.10.0", "0.9.0")).toBe(true)
    expect(maisRecente("0.9.0", "0.10.0")).toBe(false)
  })

  it("igual não é mais recente", () => {
    expect(maisRecente("0.2.0", "0.2.0")).toBe(false)
  })

  it("e o patch conta", () => {
    expect(maisRecente("0.2.1", "0.2.0")).toBe(true)
  })
})

describe("verificar", () => {
  it("avisa quando há versão nova, com a soma do sistema certo", async () => {
    // The case of August 21, 2026 from the user's side: 0.1.0 installed, 0.2.0 published,
    // and nobody saying anything.
    const p = portas(manifesto("0.2.0"))
    const aviso = await verificarActualizacao(p)

    expect(aviso).toEqual({
      instalada: "0.1.0",
      disponivel: "0.2.0",
      nome: "Statio",
      // The one for macOS, because `sistema` is "darwin". The checksum goes on screen because it's the
      // only defense that exists without signing.
      soma: "a".repeat(64),
    })
  })

  it("e o Windows leva a soma do Windows", async () => {
    const aviso = await verificarActualizacao(portas(manifesto("0.2.0"), { sistema: "win32" }))
    expect(aviso?.soma).toBe("b".repeat(64))
  })

  it("vai ao endereço escrito no código, e a mais nenhum", async () => {
    /*
      The entire anchor of this thing. The response can change a number and a checksum
      shown to someone; it cannot change where the next read comes from or
      where the user is sent next. Nothing here accepts an outside address.
      */
    const p = portas(manifesto("0.2.0"))
    await verificarActualizacao(p)
    expect(p.pedidos).toEqual([ENDERECO_DA_VERSAO])
    expect(ENDERECO_DA_VERSAO.startsWith("https://orwell.pt/")).toBe(true)
  })

  it("cala-se quando já está em dia", async () => {
    expect(await verificarActualizacao(portas(manifesto("0.2.0"), { instalada: "0.2.0" }))).toBeNull()
  })

  it("cala-se quando o servidor anuncia uma versão MAIS ANTIGA", async () => {
    // A server serving an old manifest, or lying, cannot make
    // anyone "update" backwards.
    expect(await verificarActualizacao(portas(manifesto("0.1.0"), { instalada: "0.2.0" }))).toBeNull()
  })

  it("cala-se sobre a versão que já foi dispensada", async () => {
    // This is what makes the warning once per version instead of an alarm on every
    // startup. A warning that doesn't silence itself is a warning you learn to ignore.
    expect(await verificarActualizacao(portas(manifesto("0.2.0"), { dispensada: "0.2.0" }))).toBeNull()
  })

  it("mas volta a avisar quando sai uma versão a seguir à dispensada", async () => {
    const aviso = await verificarActualizacao(portas(manifesto("0.3.0"), { dispensada: "0.2.0" }))
    expect(aviso?.disponivel).toBe("0.3.0")
  })
})

describe("o que vem do servidor não é de confiança", () => {
  it("uma versão com forma errada é recusada", async () => {
    // What comes through here must have version format. Any string
    // would reach the screen next to the app's version number.
    expect(await verificarActualizacao(portas(manifesto("0.2.0", { versao: "amanhã" })))).toBeNull()
    expect(await verificarActualizacao(portas(manifesto("0.2.0", { versao: 3 })))).toBeNull()
  })

  it("uma soma com forma errada cai, e o aviso sobrevive sem ela", async () => {
    /*
      Losing the checksum loses verification, not the warning: whoever has the app
      still deserves to know there's a new version. What can't happen is having
      something on screen, under the word SHA-256, that isn't one.
    */
    const aviso = await verificarActualizacao(
      portas(manifesto("0.2.0", { ficheiros: [{ sistema: "macOS", soma: "não é uma soma" }] })),
    )
    expect(aviso?.disponivel).toBe("0.2.0")
    expect(aviso?.soma).toBeUndefined()
  })

  it("um manifesto enorme não pendura o arranque", async () => {
    // Without a cap, a server would hang the app's startup with an endless response.
    // The timeout would catch that; the cap catches it sooner.
    const gigante = new Response(JSON.stringify({ versao: "0.2.0", lixo: "x".repeat(64_000) }), { status: 200 })
    expect(await verificarActualizacao(portas(gigante))).toBeNull()
  })

  it("um 404 não é um erro para mostrar a ninguém", async () => {
    expect(await verificarActualizacao(portas(new Response("", { status: 404 })))).toBeNull()
  })

  it("e sem rede também não", async () => {
    /*
      This runs on startup, and a chat app must start offline. Without
      network the response is the same as everything being up to date: nothing to say.
    */
    expect(await verificarActualizacao(portas(new TypeError("fetch failed")))).toBeNull()
  })

  it("JSON estragado também não", async () => {
    expect(await verificarActualizacao(portas(new Response("<html>não sou um manifesto", { status: 200 })))).toBeNull()
  })

  it("um prazo esgotado não deixa nada pendurado", async () => {
    const lento = vi.fn(
      async (_entrada: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolver, rejeitar) => {
          init?.signal?.addEventListener("abort", () => rejeitar(new Error("abortado")))
        }),
    ) as unknown as typeof fetch
    const aviso = await verificarActualizacao({
      instalada: "0.1.0",
      sistema: "darwin",
      dispensada: null,
      buscar: lento,
      timeoutMs: 5,
    })
    expect(aviso).toBeNull()
  })
})
