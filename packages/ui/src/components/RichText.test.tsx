import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { strings } from "../strings.js"
import { primeiroEndereco, RichText } from "./RichText.js"

afterEach(cleanup)

/**
 * Clickable addresses, without opening the gate the rest of the product keeps
 * closed.
 *
 * The text is cut into pieces and the pieces become elements: there is never
 * a markup string to be interpreted. The three-line alternative, inject HTML
 *, would let another person's message run whatever it wants inside this.
 */
describe("RichText", () => {
  it("transforma um endereço em hiperligação que abre fora", () => {
    render(<RichText>{"vê isto: https://exemplo.pt/artigo"}</RichText>)
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe("https://exemplo.pt/artigo")
    expect(link.getAttribute("target")).toBe("_blank")
    // `noopener` stops the destination page from manipulating this window;
    // `noreferrer` stops it from knowing where the person came from.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("aceita www sem esquema e completa-o", () => {
    render(<RichText>{"www.exemplo.pt"}</RichText>)
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://www.exemplo.pt")
  })

  it("não engole a pontuação da frase", () => {
    render(<RichText>{"foi a https://exemplo.pt."}</RichText>)
    expect(screen.getByRole("link").textContent).toBe("https://exemplo.pt")
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://exemplo.pt")
  })

  it("texto sem endereços não ganha ligações", () => {
    render(<RichText>{"só palavras, e um ponto."}</RichText>)
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("marcação escrita por alguém fica texto", () => {
    // The case that justifies not using HTML: this must appear exactly as is.
    render(<RichText>{'<img src=x onerror="alert(1)">'}</RichText>)
    expect(screen.queryByRole("img")).toBeNull()
    expect(document.body.textContent).toContain("<img src=x")
  })

  it("dois endereços na mesma frase dão duas ligações", () => {
    render(<RichText>{"https://um.pt e https://dois.pt"}</RichText>)
    expect(screen.getAllByRole("link")).toHaveLength(2)
  })
})

/**
 * The compose box and the conversation must recognize the SAME address.
 *
 * Two separate patterns would end up disagreeing, and the symptom would be a
 * link that can be previewed but not opened, or the opposite, which is worse:
 * a preview of an address that is not what the person will click.
 */
describe("primeiroEndereco", () => {
  it("encontra o primeiro endereço de uma frase", () => {
    expect(primeiroEndereco("vê https://exemplo.pt/artigo antes de responder")).toBe("https://exemplo.pt/artigo")
  })

  it("completa um www. como o texto clicável faz", () => {
    expect(primeiroEndereco("vai a www.exemplo.pt")).toBe("https://www.exemplo.pt")
  })

  it("a pontuação final não faz parte do endereço", () => {
    expect(primeiroEndereco("vê https://exemplo.pt.")).toBe("https://exemplo.pt")
  })

  it("texto sem endereço nenhum não inventa um", () => {
    expect(primeiroEndereco("só palavras")).toBeNull()
    expect(primeiroEndereco("")).toBeNull()
  })

  it("chamadas seguidas dão o mesmo resultado", () => {
    // The pattern is global and keeps `lastIndex` between calls: without resetting
    // it, the second call would skip the start of the text and return something else.
    const texto = "https://um.pt e https://dois.pt"
    expect(primeiroEndereco(texto)).toBe("https://um.pt")
    expect(primeiroEndereco(texto)).toBe("https://um.pt")
  })
})

/**
 * The rendered mention.
 *
 * The text stores the address and the screen shows the current name, that
 * separation is what makes a person who changes their name appear with the
 * new name in everything already said to them, instead of being stuck with the
 * name they had that day.
 */
describe("RichText — menções", () => {
  const ANA = "@milsinda-odreto-viddyvox-pofletum:orwell.pt"
  const nomes = (endereco: string): string => (endereco === ANA ? "Ana" : "alguém")

  it("mostra o nome de agora, e não o endereço que está no texto", () => {
    render(
      <RichText nameFor={nomes} onMention={() => {}}>
        {`bom dia ${ANA}`}
      </RichText>,
    )
    expect(screen.getByRole("button", { name: "@Ana" })).toBeTruthy()
    expect(screen.queryByText(ANA)).toBeNull()
  })

  it("clicar entrega o ENDEREÇO, que é o que identifica a pessoa", () => {
    // The name is the label and changes; the address is the identity and does not
    // change. Opening the profile by name would open the profile of whoever
    // happens to have that name.
    const abertos: string[] = []
    render(
      <RichText nameFor={nomes} onMention={(a) => abertos.push(a)}>
        {`olá ${ANA}`}
      </RichText>,
    )
    screen.getByRole("button", { name: "@Ana" }).click()
    expect(abertos).toEqual([ANA])
  })

  it("sem ninguém para abrir o perfil, a menção desenha-se mas não é um botão", () => {
    render(<RichText nameFor={nomes}>{`olá ${ANA}`}</RichText>)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("@Ana")).toBeTruthy()
  })

  it("uma menção e um link na mesma frase não se comem um ao outro", () => {
    render(
      <RichText nameFor={nomes} onMention={() => {}}>
        {`${ANA} vê https://exemplo.pt`}
      </RichText>,
    )
    expect(screen.getByRole("button", { name: "@Ana" })).toBeTruthy()
    expect(screen.getByRole("link")).toHaveProperty("href", "https://exemplo.pt/")
  })

  it("um email continua a ser texto, e não uma menção", () => {
    render(
      <RichText nameFor={nomes} onMention={() => {}}>
        {"escreve a ana@exemplo.pt"}
      </RichText>,
    )
    expect(screen.queryByRole("button")).toBeNull()
  })
})

/**
 * Bold, italic, and code, rendered, never interpreted.
 *
 * The grammar is proven in `lib/formatacao.test.ts`. What matters here is
 * that it reaches the screen as ELEMENTS, and there is still no markup
 * anywhere in between.
 */
describe("RichText — formatação", () => {
  const html = (): string => document.body.innerHTML
  const ANA_AQUI = "@tectytus-xilvemor-tascoris-volpilo:localhost"
  const nomesAqui = (endereco: string): string => (endereco === ANA_AQUI ? "Ana" : "?")

  it("desenha negrito, itálico e código com os elementos certos", () => {
    const { container } = render(<RichText>{"isto é **forte**, isto *leve*, e isto `código`"}</RichText>)
    expect(container.querySelector("strong")?.textContent).toBe("forte")
    expect(container.querySelector("em")?.textContent).toBe("leve")
    expect(container.querySelector("code")?.textContent).toBe("código")
  })

  it("os marcadores não ficam no ecrã depois de usados", () => {
    render(<RichText>{"**forte**"}</RichText>)
    expect(screen.getByText("forte")).toBeTruthy()
    expect(document.body.textContent).toBe("forte")
  })

  it("NUNCA interpreta marcação, por mais que a mensagem tente", () => {
    // The gate the rest of the product spends time closing. Text comes in as text
    // and goes out as text, with or without asterisks around it.
    const veneno = '<img src=x onerror="alert(1)"> **<script>alert(2)</script>**'
    render(<RichText>{veneno}</RichText>)
    expect(document.querySelector("img")).toBeNull()
    expect(document.querySelector("script")).toBeNull()
    // Escaped in HTML, and readable on screen: both things at once.
    expect(html()).toContain("&lt;script&gt;")
    expect(document.body.textContent).toContain("<script>alert(2)</script>")
  })

  it("um endereço com asteriscos continua inteiro e clicável", () => {
    // The case that decided the protected zones: without them, the middle of the
    // address would be in italics and the link would go broken to the other side.
    render(<RichText>{"https://exemplo.pt/a*b*c"}</RichText>)
    expect(document.querySelector("em")).toBeNull()
    expect(screen.getByRole("link")).toHaveProperty("href", "https://exemplo.pt/a*b*c")
  })

  it("um endereço DENTRO de negrito continua clicável", () => {
    const { container } = render(<RichText>{"**vê https://exemplo.pt hoje**"}</RichText>)
    expect(container.querySelector("strong")).toBeTruthy()
    expect(container.querySelector("strong a")).toBeTruthy()
    expect(screen.getByRole("link")).toHaveProperty("href", "https://exemplo.pt/")
  })

  it("um endereço dentro de código NÃO é clicável", () => {
    // Code is literal: an address there is to be read, not clicked.
    render(<RichText>{"`curl https://exemplo.pt`"}</RichText>)
    expect(screen.queryByRole("link")).toBeNull()
    expect(document.querySelector("code")?.textContent).toBe("curl https://exemplo.pt")
  })

  it("uma menção dentro de negrito continua a ser um botão", () => {
    render(
      <RichText nameFor={nomesAqui} onMention={() => {}}>
        {`**${ANA_AQUI} vê isto**`}
      </RichText>,
    )
    expect(screen.getByRole("button", { name: "@Ana" })).toBeTruthy()
    expect(document.querySelector("strong button.mention")).toBeTruthy()
  })

  it("uma multiplicação não vira itálico", () => {
    render(<RichText>{"5 * 4 * 3 = 60"}</RichText>)
    expect(document.querySelector("em")).toBeNull()
    expect(document.body.textContent).toBe("5 * 4 * 3 = 60")
  })

  it("o sublinhado não é sintaxe nenhuma", () => {
    render(<RichText>{"o ficheiro relatorio_final_v2.pdf"}</RichText>)
    expect(document.querySelector("em")).toBeNull()
    expect(document.body.textContent).toBe("o ficheiro relatorio_final_v2.pdf")
  })
})

/**
 * Strikethrough and concealed text, from the reader's side.
 *
 * The grammar is proven in `lib/formatacao.test.ts`. What matters here is
 * what the person finds on screen: a line through the text, and text that is
 * there but unreadable until someone decides to read it.
 *
 * **What this file CANNOT prove:** that the concealed text stays concealed.
 * jsdom does not apply stylesheets, to it, `visibility: hidden` is a line of
 * CSS nobody read. What we measure here is the contract (the classes, the
 * roles, what the click does); that the text disappears from the screen and
 * selection is measured in a real layout engine, in `scripts/verificar-formatacao.mjs`.
 */
describe("RichText — rasurado e coberto", () => {
  it("dois tis desenham um risco por cima do texto", () => {
    const { container } = render(<RichText>{"isto está ~~errado~~"}</RichText>)
    expect(container.querySelector("s")?.textContent).toBe("errado")
    expect(document.body.textContent).toBe("isto está errado")
  })

  it("o coberto começa por ser um botão, e não texto para ler", () => {
    render(<RichText>{"o assassino é ||o mordomo||"}</RichText>)
    const tapado = screen.getByRole("button", { name: strings.common.spoilerShow })
    expect(tapado.className).toBe("spoiler")
    // The text is in the document, but outside the tree a screen reader reads:
    // someone hearing the message hears "show hidden text", not the content.
    expect(tapado.querySelector(".spoiler-texto")?.getAttribute("aria-hidden")).toBe("true")
  })

  it("carregar destapa, e o que estava tapado passa a ser texto normal", () => {
    render(<RichText>{"||o mordomo||"}</RichText>)
    fireEvent.click(screen.getByRole("button", { name: strings.common.spoilerShow }))
    expect(screen.queryByRole("button")).toBeNull()
    const destapado = document.querySelector(".spoiler")
    expect(destapado?.className).toBe("spoiler aberto")
    expect(destapado?.querySelector(".spoiler-texto")?.getAttribute("aria-hidden")).toBeNull()
    expect(document.body.textContent).toBe("o mordomo")
  })

  it("destapa-se com o teclado, e não só com o rato", () => {
    render(<RichText>{"||o mordomo||"}</RichText>)
    const tapado = screen.getByRole("button", { name: strings.common.spoilerShow })
    expect(tapado.getAttribute("tabindex")).toBe("0")
    fireEvent.keyDown(tapado, { key: "Enter" })
    expect(document.querySelector(".spoiler")?.className).toBe("spoiler aberto")
  })

  it("dois cobertos na mesma frase destapam-se um de cada vez", () => {
    // A single state to reveal the entire conversation with one click.
    render(<RichText>{"||um|| e ||dois||"}</RichText>)
    const tapados = screen.getAllByRole("button", { name: strings.common.spoilerShow })
    expect(tapados.length).toBe(2)
    fireEvent.click(tapados[0]!)
    expect(screen.getAllByRole("button", { name: strings.common.spoilerShow }).length).toBe(1)
  })

  it("o que estava tapado mantém a formatação depois de destapado", () => {
    render(<RichText>{"||o **fim**||"}</RichText>)
    fireEvent.click(screen.getByRole("button", { name: strings.common.spoilerShow }))
    expect(document.querySelector(".spoiler strong")?.textContent).toBe("fim")
  })

  it("um endereço tapado não é clicável enquanto estiver tapado", () => {
    // A link inside a spoiler is still a link, and a link you load without seeing
    // where it goes is a trap. While it is hidden, all that exists there is the
    // reveal button and nothing else.
    render(<RichText>{"||vê https://exemplo.pt||"}</RichText>)
    expect(screen.queryByRole("link")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.common.spoilerShow }))
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://exemplo.pt")
  })

  it("NUNCA interpreta marcação, tapada ou riscada", () => {
    const veneno = '~~<img src=x onerror="alert(1)">~~ ||<script>alert(2)</script>||'
    render(<RichText>{veneno}</RichText>)
    expect(document.querySelector("img")).toBeNull()
    expect(document.querySelector("script")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: strings.common.spoilerShow }))
    expect(document.querySelector("img")).toBeNull()
    expect(document.querySelector("script")).toBeNull()
    expect(document.body.innerHTML).toContain("&lt;script&gt;")
    expect(document.body.textContent).toContain("<script>alert(2)</script>")
  })
})
