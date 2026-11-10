import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { EnclaveBridge, LinkCard } from "../../bridge.js"
import { BridgeContext } from "../../App.js"
import { strings } from "../../strings.js"
import { LinkDraft } from "./LinkDraft.js"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  hostPreview.mockReset()
  hostPreview.mockRejectedValue(new Error("o hospedeiro também não conseguiu"))
})

/**
 * The host: on Electron the main process, on the web the homeserver. Refuses
 * by default, so each test can say explicitly what it wants it to answer.
 */
const hostPreview = vi.fn<(url: string) => Promise<{ title?: string; image?: string }>>()
hostPreview.mockRejectedValue(new Error("o hospedeiro também não conseguiu"))
const bridge = { social: { linkPreview: hostPreview } } as unknown as EnclaveBridge

/** The card is controlled by the composer; the support takes that role. */
function Harness({ inicial }: { inicial: LinkCard }): React.JSX.Element {
  const [link, setLink] = useState(inicial)
  return (
    <BridgeContext.Provider value={bridge}>
      <LinkDraft link={link} onChange={setLink} onRemove={() => {}} />
    </BridgeContext.Provider>
  )
}

/**
 * The card comes from here already with the bytes inside it, and that is what
 * these tests keep: whoever READS the post does not fetch anything elsewhere.
 *
 * Who brings them is the host, the main process on Electron, the homeserver on
 * the web. This module does not fetch them on its own, and it is not a choice:
 * the app's content policy has `connect-src 'self'`, and the browser refuses the
 * request before the site even knows someone asked.
 */
describe("LinkDraft — a pré-visualização entra sozinha", () => {
  it("o título entra sem ninguém carregar em nada", async () => {
    // The request: "the title and thumbnail should be automatically filled in".
    hostPreview.mockResolvedValue({ title: "Entrou sozinho" })

    render(<Harness inicial={{ url: "https://exemplo.pt/artigo", kind: "link" }} />)

    expect(await screen.findByDisplayValue("Entrou sozinho", {}, { timeout: 3000 })).toBeTruthy()
    expect(hostPreview).toHaveBeenCalledWith("https://exemplo.pt/artigo")
  })

  it("a miniatura chega em bytes e é encolhida antes de entrar no cartão", async () => {
    // A 1×1 PNG, like what the host returns. It arrives here without going over the
    // network: a `fetch` of a `data:` is refused by the same content policy, and
    // that is how the thumbnail disappeared silently the first time.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    hostPreview.mockResolvedValue({ title: "Com imagem", image: png })

    render(<Harness inicial={{ url: "https://exemplo.pt/artigo", kind: "link" }} />)

    await screen.findByDisplayValue("Com imagem", {}, { timeout: 3000 })
    expect(await screen.findByRole("button", { name: strings.linkCard.dropThumb }, { timeout: 3000 })).toBeTruthy()
    const fonte = document.querySelector(".link-draft-thumb img")?.getAttribute("src") ?? ""
    expect(fonte.startsWith("data:image/")).toBe(true)
  })

  it("busca uma vez por endereço, e não a cada tecla", async () => {
    // Without this throttle, a hand-typed address came out letter by letter:
    // "https://e", "https://ex", "https://exe", dozens of requests for the same link.
    const user = userEvent.setup()
    hostPreview.mockResolvedValue({ title: "Uma vez só" })

    render(<Harness inicial={{ url: "", kind: "link" }} />)
    await user.type(screen.getByPlaceholderText(strings.linkCard.urlPlaceholder), "https://exemplo.pt/artigo")
    await screen.findByDisplayValue("Uma vez só", {}, { timeout: 3000 })
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(hostPreview).toHaveBeenCalledOnce()
  })

  it("uma busca automática que falha não interrompe quem está a escrever", async () => {
    // The warning is for whoever asked. Whoever did not ask sees empty fields and writes.
    render(<Harness inicial={{ url: "https://exemplo.pt/artigo", kind: "link" }} />)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    expect(screen.queryByText(strings.linkCard.fetchFailed)).toBeNull()
    expect(screen.getByPlaceholderText(strings.linkCard.titlePlaceholder)).toBeTruthy()
  })

  it("o botão continua a existir, para uma segunda tentativa", async () => {
    const user = userEvent.setup()
    render(<Harness inicial={{ url: "https://exemplo.pt/artigo", kind: "link" }} />)
    await new Promise((resolve) => setTimeout(resolve, 1200))
    hostPreview.mockResolvedValue({ title: "À segunda" })

    await user.click(screen.getByRole("button", { name: strings.linkCard.fetchPreview }))

    expect(await screen.findByDisplayValue("À segunda", {}, { timeout: 3000 })).toBeTruthy()
  })

  it("quem pediu à mão e falhou é avisado, e tem por onde seguir", async () => {
    const user = userEvent.setup()
    render(<Harness inicial={{ url: "https://exemplo.pt", kind: "link" }} />)
    await user.click(screen.getByRole("button", { name: strings.linkCard.fetchPreview }))

    expect(await screen.findByText(strings.linkCard.fetchFailed)).toBeTruthy()
    expect(screen.getByPlaceholderText(strings.linkCard.titlePlaceholder)).toBeTruthy()
  })

  it("o título já escrito não é desfeito pelo que a página diz", async () => {
    hostPreview.mockResolvedValue({ title: "O que o site quer" })

    render(<Harness inicial={{ url: "https://exemplo.pt", kind: "link", title: "O que eu escrevi" }} />)
    await new Promise((resolve) => setTimeout(resolve, 1200))

    expect(screen.getByDisplayValue("O que eu escrevi")).toBeTruthy()
  })

  it("sem endereço não há nada a buscar, e o botão não convida a tentar", () => {
    render(<Harness inicial={{ url: "", kind: "link" }} />)
    expect(screen.getByRole("button", { name: strings.linkCard.fetchPreview }).hasAttribute("disabled")).toBe(true)
    expect(hostPreview).not.toHaveBeenCalled()
  })

  it("a miniatura escolhida à mão fica no cartão e pode sair de lá", async () => {
    const user = userEvent.setup()
    render(<Harness inicial={{ url: "https://exemplo.pt", kind: "link" }} />)

    const escolha = screen.getByLabelText(strings.linkCard.pickThumb) as HTMLInputElement
    await user.upload(escolha, new File(["uns bytes"], "capa.png", { type: "image/png" }))

    const miniatura = await screen.findByRole("button", { name: strings.linkCard.dropThumb })
    expect(document.querySelector(".link-draft-thumb img")).toBeTruthy()

    await user.click(miniatura)
    expect(screen.queryByRole("button", { name: strings.linkCard.dropThumb })).toBeNull()
  })
})
