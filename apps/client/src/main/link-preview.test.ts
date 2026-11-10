import { describe, expect, it, vi } from "vitest"
import { preVisualizarLink } from "./link-preview.js"

/** A 1×1 PNG, which is what a thumbnail server returns. */
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

/** A fake `fetch` that responds based on the address and logs everything. */
function fetchFalso(respostas: Record<string, Response>): {
  impl: typeof fetch
  pedidos: string[]
} {
  const pedidos: string[] = []
  const impl = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada)
    pedidos.push(url)
    const resposta = respostas[url]
    if (!resposta) return new Response("não existe", { status: 404 })
    return resposta.clone()
  }) as unknown as typeof fetch
  return { impl, pedidos }
}

describe("preVisualizarLink — um vídeo do YouTube", () => {
  const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"

  it("vai ao oEmbed e à miniatura, e nunca à página do vídeo", async () => {
    // The YouTube page declares Open Graph at byte 691,000, way beyond the download
    // limit: through the generic path this process would pull 256 KB from Google's
    // cookie domain, from the IP address of whoever is writing, and end up without
    // title and without thumbnail anyway. Since video preview is automatic, that
    // cost is now paid just by writing a link, and that's why this path exists.
    const { impl, pedidos } = fetchFalso({
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Daqz-KE-bpKQ&format=json":
        new Response(JSON.stringify({ title: "Big Buck Bunny", author_name: "Blender" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      "https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg": new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    })

    const lida = await preVisualizarLink(VIDEO, { fetchImpl: impl })

    expect(lida.title).toBe("Big Buck Bunny")
    expect(lida.siteName).toBe("Blender")
    expect(lida.image?.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(pedidos.some((p) => p.includes("/watch?v="))).toBe(false)
  })

  it("desce na qualidade da miniatura em vez de ficar sem nenhuma", async () => {
    // `maxresdefault` doesn't exist for all videos and responds 404.
    const { impl, pedidos } = fetchFalso({
      "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg": new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    })

    const lida = await preVisualizarLink(VIDEO, { fetchImpl: impl })

    expect(lida.image?.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(pedidos).toContain("https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg")
  })

  it("um oEmbed que não responde não leva a miniatura consigo", async () => {
    const { impl } = fetchFalso({
      "https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg": new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    })

    const lida = await preVisualizarLink(VIDEO, { fetchImpl: impl })

    expect(lida.title).toBeUndefined()
    expect(lida.image?.startsWith("data:image/")).toBe(true)
  })
})

describe("preVisualizarLink — o resto da Internet", () => {
  it("continua a ler a página e a etiqueta que ela declara", async () => {
    const pagina = `<html><head>
      <meta property="og:title" content="Um artigo">
      <meta property="og:image" content="https://exemplo.pt/capa.png">
    </head><body></body></html>`
    const { impl, pedidos } = fetchFalso({
      "https://exemplo.pt/artigo": new Response(pagina, { status: 200, headers: { "content-type": "text/html" } }),
      "https://exemplo.pt/capa.png": new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }),
    })

    const lida = await preVisualizarLink("https://exemplo.pt/artigo", { fetchImpl: impl })

    expect(lida.title).toBe("Um artigo")
    expect(lida.image?.startsWith("data:image/png;base64,")).toBe(true)
    expect(pedidos[0]).toBe("https://exemplo.pt/artigo")
  })

  it("um domínio que só se parece com o YouTube segue o caminho normal", async () => {
    // Compared by equality, never by "contains": otherwise a URL chosen by the
    // writer would send this process to an oEmbed that isn't Google's.
    const { impl, pedidos } = fetchFalso({
      "https://youtube.com.exemplo.pt/watch?v=aqz-KE-bpKQ": new Response("<html><head></head></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    })

    await preVisualizarLink("https://youtube.com.exemplo.pt/watch?v=aqz-KE-bpKQ", { fetchImpl: impl })

    expect(pedidos).toEqual(["https://youtube.com.exemplo.pt/watch?v=aqz-KE-bpKQ"])
  })

  it("não vai buscar cookies nem diz de onde veio", async () => {
    // This is not a visit: the page that matters is the one anyone would see, and
    // the site has nothing to do with the product the request came from.
    const opcoes: RequestInit[] = []
    const impl = vi.fn(async (_entrada: RequestInfo | URL, init?: RequestInit) => {
      opcoes.push(init ?? {})
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })
    }) as unknown as typeof fetch

    await preVisualizarLink("https://exemplo.pt/artigo", { fetchImpl: impl })

    expect(opcoes[0]?.credentials).toBe("omit")
    expect(opcoes[0]?.referrerPolicy).toBe("no-referrer")
  })
})
