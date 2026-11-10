import { describe, expect, it, vi } from "vitest"
import {
  fetchLinkPreview,
  normaliseUrl,
  parsePreviewHtml,
  shrinkToThumbnail,
  THUMBNAIL_MAX_CHARS,
} from "./fetchPreview.js"

describe("parsePreviewHtml", () => {
  it("lê o Open Graph, seja qual for a ordem dos atributos", () => {
    // Half the web writes `content` before `property`. A pattern that
    // caught only one order would fail on half of sites with no explanation why.
    const html = `
      <meta property="og:title" content="O título">
      <meta content="Uma descrição" property="og:description">
      <meta name='og:site_name' content='Exemplo'>
      <meta property="og:image" content="/imagens/capa.jpg">
    `
    expect(parsePreviewHtml(html, "https://exemplo.pt/artigo")).toEqual({
      title: "O título",
      description: "Uma descrição",
      siteName: "Exemplo",
      image: "https://exemplo.pt/imagens/capa.jpg",
    })
  })

  it("sem Open Graph, serve-se do <title> e da meta description", () => {
    const html = "<title>Só um título</title><meta name=description content=abreviada>"
    expect(parsePreviewHtml(html, "https://exemplo.pt")).toMatchObject({
      title: "Só um título",
      description: "abreviada",
    })
  })

  it("desfaz as entidades, porque um título com &amp; não se lê", () => {
    const html = '<meta property="og:title" content="Fados &amp; Guitarras &#8212; ao vivo">'
    expect(parsePreviewHtml(html, "https://exemplo.pt").title).toBe("Fados & Guitarras — ao vivo")
  })

  it("uma imagem que não é http(s) não é uma imagem para ir buscar", () => {
    // A giant `data:` on someone else's page, or some scheme, is not
    // something you bring inside a message.
    const html = '<meta property="og:image" content="data:image/png;base64,AAAA">'
    expect(parsePreviewHtml(html, "https://exemplo.pt")).not.toHaveProperty("image")
  })

  it("o primeiro og:image ganha, que é o que o autor pôs à frente", () => {
    const html =
      '<meta property="og:image" content="https://exemplo.pt/a.jpg">' +
      '<meta property="og:image" content="https://exemplo.pt/b.jpg">'
    expect(parsePreviewHtml(html, "https://exemplo.pt").image).toBe("https://exemplo.pt/a.jpg")
  })

  it("uma página sem nada declarado devolve nada, e não campos vazios", () => {
    expect(parsePreviewHtml("<html><body>texto</body></html>", "https://exemplo.pt")).toEqual({})
  })
})

describe("shrinkToThumbnail", () => {
  it("uma imagem pequena passa tal e qual, sem redesenho nenhum", async () => {
    const thumbnail = await shrinkToThumbnail(new Blob(["uns bytes"], { type: "image/png" }))
    expect(thumbnail?.startsWith("data:image/png;base64,")).toBe(true)
  })

  it("uma imagem grande de mais desiste em vez de estourar a mensagem", async () => {
    // Without canvas, and in a test environment there is none, there is no way
    // to shrink. A post without a thumbnail is better than one that does not fit
    // in the feed and breaks on send, where nobody can do anything about it anymore.
    const enorme = new Blob([new Uint8Array(THUMBNAIL_MAX_CHARS)], { type: "image/png" })
    await expect(shrinkToThumbnail(enorme)).resolves.toBeUndefined()
  })
})

describe("normaliseUrl", () => {
  it("um endereço escrito à pressa continua a ser um endereço", () => {
    expect(normaliseUrl("exemplo.pt/artigo")).toBe("https://exemplo.pt/artigo")
    expect(normaliseUrl(" http://exemplo.pt ")).toBe("http://exemplo.pt")
  })
})

describe("fetchLinkPreview", () => {
  const pagina = '<meta property="og:title" content="Artigo"><meta property="og:image" content="/capa.jpg">'

  function respostaHtml(html: string, url = "https://exemplo.pt/artigo"): Response {
    // The same object serves as both page and image: the image call only
    // asks it for `blob()`, and the page call only asks it for `text()`.
    return { ok: true, url, text: async () => html, blob: async () => new Blob(["bytes"]) } as unknown as Response
  }

  it("é este dispositivo que fala com o site, uma vez, e sem cookies", async () => {
    // The entire product rule: the reader never makes this request. Here we verify
    // that the publisher makes it without taking their session to the site or
    // saying where they come from.
    const fetchImpl = vi.fn().mockResolvedValue(respostaHtml(pagina))
    await fetchLinkPreview("exemplo.pt/artigo", { fetchImpl, shrink: async () => undefined })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://exemplo.pt/artigo")
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer" })
    // The image is fetched by the absolute path, resolved against the page.
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://exemplo.pt/capa.jpg")
  })

  it("devolve a miniatura já em bytes, para viajar dentro da mensagem", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respostaHtml(pagina))
    const preview = await fetchLinkPreview("https://exemplo.pt/artigo", {
      fetchImpl,
      shrink: async () => "data:image/jpeg;base64,AAAA",
    })
    expect(preview).toEqual({ title: "Artigo", thumbnail: "data:image/jpeg;base64,AAAA" })
  })

  it("uma imagem que não vem não estraga o título que já veio", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respostaHtml(pagina))
      .mockRejectedValueOnce(new Error("recusado"))
    await expect(fetchLinkPreview("https://exemplo.pt/artigo", { fetchImpl })).resolves.toEqual({ title: "Artigo" })
  })

  it("uma página que recusa rebenta, para o ecrã poder dizer que recusou", async () => {
    // Failing silently left the person staring at a button that does nothing.
    // You need to know so you can write the title by hand.
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(fetchLinkPreview("https://exemplo.pt", { fetchImpl })).rejects.toThrow()
  })

  it("uma resposta de erro do site também é uma recusa", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 403 } as unknown as Response)
    await expect(fetchLinkPreview("https://exemplo.pt", { fetchImpl })).rejects.toThrow("403")
  })
})
