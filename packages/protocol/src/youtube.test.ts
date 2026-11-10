import { describe, expect, it } from "vitest"
import {
  youtubeIdOf,
  youtubeOembedUrl,
  youtubeThumbnailUrls,
  youtubeWatchUrl,
} from "./youtube.js"

describe("youtubeIdOf — as formas que um endereço do YouTube toma", () => {
  it("reconhece o endereço normal", () => {
    expect(youtubeIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
  })

  it("reconhece o endereço curto", () => {
    expect(youtubeIdOf("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("https://youtu.be/dQw4w9WgXcQ?t=42")).toBe("dQw4w9WgXcQ")
  })

  it("reconhece shorts e embed", () => {
    expect(youtubeIdOf("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ")
  })

  it("não se perde com os parâmetros que vêm agarrados", () => {
    expect(youtubeIdOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2&t=90s")).toBe("dQw4w9WgXcQ")
    expect(youtubeIdOf("https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share")).toBe("dQw4w9WgXcQ")
  })

  it("recusa o que não é o YouTube, por muito que se lhe pareça", () => {
    // What this prevents: a domain chosen by the publisher passing through YouTube and carrying
    // away whatever it wanted.
    expect(youtubeIdOf("https://youtube.com.exemplo.pt/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(youtubeIdOf("https://naoyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull()
    expect(youtubeIdOf("https://vimeo.com/123456")).toBeNull()
    expect(youtubeIdOf("https://exemplo.pt/artigo")).toBeNull()
  })

  it("recusa um identificador que não tem a forma de um identificador", () => {
    // Never put text from outside straight into a URL: eleven characters from a known alphabet,
    // or it is nothing.
    expect(youtubeIdOf("https://www.youtube.com/watch?v=curto")).toBeNull()
    expect(youtubeIdOf("https://www.youtube.com/watch?v=demasiado-comprido-mesmo")).toBeNull()
    expect(youtubeIdOf('https://www.youtube.com/watch?v="onclick=1')).toBeNull()
    expect(youtubeIdOf("https://youtu.be/../../etc")).toBeNull()
    expect(youtubeIdOf("https://www.youtube.com/watch?v=")).toBeNull()
  })

  it("aceita os caracteres que um identificador verdadeiro tem", () => {
    expect(youtubeIdOf("https://youtu.be/_-aBcDeF123")).toBe("_-aBcDeF123")
  })

  it("não rebenta com lixo", () => {
    expect(youtubeIdOf("")).toBeNull()
    expect(youtubeIdOf("nem por sombras")).toBeNull()
    expect(youtubeIdOf("javascript:alert(1)")).toBeNull()
  })
})

describe("youtubeWatchUrl", () => {
  it("constrói o endereço a partir do identificador já validado", () => {
    expect(youtubeWatchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
  })
})

describe("sem leitor embebido", () => {
  it("o protocolo já não monta endereços de leitor embebido", async () => {
    // The video opens outside (owner's request on November 2, 2026). An embed address left here
    // is an invitation to put the iframe back.
    const modulo: Record<string, unknown> = await import("./youtube.js")
    expect(modulo.youtubeEmbedUrl).toBeUndefined()
    expect(modulo.YOUTUBE_EMBED_ORIGIN).toBeUndefined()
  })
})

describe("os endereços que o hospedeiro vai buscar", () => {
  it("o oEmbed traz o título sem descarregar a página inteira", () => {
    // The YouTube page declares Open Graph, but at byte 691,000, far beyond any sensible
    // download cap. The oEmbed is the same, in 300 bytes.
    const url = youtubeOembedUrl("dQw4w9WgXcQ")
    expect(url.startsWith("https://www.youtube.com/oembed?")).toBe(true)
    expect(url).toContain("format=json")
    // The identifier is encoded, and never pasted raw inside another URL.
    expect(url).toContain(encodeURIComponent("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
  })

  it("as miniaturas vêm por ordem de qualidade, com alternativas", () => {
    // `maxresdefault` does not exist for all videos and responds 404. The caller tries the next
    // one instead of ending up with no thumbnail at all.
    const urls = youtubeThumbnailUrls("dQw4w9WgXcQ")
    expect(urls.length).toBeGreaterThan(1)
    for (const url of urls) {
      expect(url.startsWith("https://i.ytimg.com/vi/dQw4w9WgXcQ/")).toBe(true)
    }
  })
})
