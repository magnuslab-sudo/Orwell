import { describe, expect, it } from "vitest"
import { strings } from "../../strings.js"
import { postTitleOf } from "./postTitle.js"

describe("postTitleOf", () => {
  it("o título dado ganha sempre à legenda", () => {
    expect(postTitleOf({ t: "post", title: "Serra de São Mamede", caption: "fomos lá acima" })).toBe(
      "Serra de São Mamede",
    )
  })

  it("um título só com espaços é a ausência de título", () => {
    // Otherwise the line stayed blank and the post looked like it did not exist.
    expect(postTitleOf({ t: "post", title: "   ", caption: "as palavras que lá estão" })).toBe(
      "as palavras que lá estão",
    )
  })

  it("sem título, corta a legenda no fim de uma palavra", () => {
    const caption = "primeira segunda terceira quarta quinta sexta sétima oitava nona décima"
    const nome = postTitleOf({ t: "post", caption }, 30)
    expect(nome.endsWith("…")).toBe(true)
    // Never break mid-word: cut at the last space.
    expect(caption.startsWith(nome.slice(0, -1))).toBe(true)
    expect(nome.slice(0, -1).endsWith(" ")).toBe(false)
  })

  it("uma legenda curta cabe inteira e não leva reticências", () => {
    expect(postTitleOf({ t: "post", caption: "olá" }, 30)).toBe("olá")
  })

  it("num texto sem espaços corta a meio em vez de deixar três letras", () => {
    // The last space might be near the start; using it would produce a line
    // that says nothing.
    const nome = postTitleOf({ t: "post", caption: `um ${"a".repeat(60)}` }, 30)
    expect(nome).toHaveLength(31)
  })

  it("as quebras de linha viram espaços, para a linha ser uma linha", () => {
    expect(postTitleOf({ t: "post", caption: "duas\nlinhas" }, 30)).toBe("duas linhas")
  })

  it("sem palavra nenhuma, chama-se pelo que é", () => {
    expect(postTitleOf({ t: "post", media: [{ inline: "data:image/png;base64,AA" }] })).toBe(
      strings.social.untitledPhoto,
    )
    expect(postTitleOf({ t: "post", links: [{ url: "https://x.pt", kind: "link" }] })).toBe(
      strings.social.untitledLink,
    )
    expect(postTitleOf({ t: "post" })).toBe(strings.social.untitled)
  })
})
