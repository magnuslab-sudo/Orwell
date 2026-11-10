import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render as baseRender } from "@testing-library/react"
import type { Profile } from "../../bridge.js"
import type { ChatMessage, MediaItem } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

/**
 * The conversation opens paused at the right place, and only auto-scrolls for
 * those at the bottom.
 *
 * The bug (owner report, 4/11/2026): "when we click a chat room, it scrolls
 * automatically". Measured live at 1920x1080 (`scripts/medir-scroll-da-sala.mjs`):
 *
 * - **The room was not the conversation.** `Timeline` only knew the CHANNEL;
 *   switching rooms in the same channel felt like "new messages arrived", and
 *   the list slid from 0 to bottom smoothly over 40 to 50 frames (half a second
 *   watching the entire conversation scroll by). With fewer messages in the
 *   destination room than the source, it did not scroll: stayed where the other
 *   left it. And the saved position was one per channel.
 * - **Images had no height before decoding.** Opened at bottom, image grew, and
 *   ended up 400 to 860 px above the end.
 *
 * jsdom has no layout. Content height is simulated here: one hundred pixels per
 * line, plus what each test adds, and the view is five hundred. `scrollTop` is
 * saved and clamped to limits as in the browser.
 */

const ALTURA_DA_LINHA = 100
const VISTA = 500
const extra = new WeakMap<Element, number>()
const topo = new WeakMap<Element, number>()
const rolagens: { behavior: ScrollBehavior | undefined; top: number | undefined }[] = []

function alturaDe(el: Element): number {
  return el.querySelectorAll(".message").length * ALTURA_DA_LINHA + (extra.get(el) ?? 0)
}

const originais: Record<string, PropertyDescriptor | undefined> = {}
const matchMediaOriginal = window.matchMedia
beforeAll(() => {
  // Movement NOT reduced: that is where the scroll was visible. Without `matchMedia`
  // the code reads "reduce" and the bug hid behind the instant jump.
  window.matchMedia = ((query: string) =>
    ({ matches: false, media: query, addEventListener: noop, removeEventListener: noop }) as unknown as MediaQueryList) as typeof window.matchMedia
  const proto = HTMLElement.prototype
  for (const nome of ["scrollHeight", "clientHeight", "scrollTop"]) {
    originais[nome] = Object.getOwnPropertyDescriptor(Element.prototype, nome) ?? Object.getOwnPropertyDescriptor(proto, nome)
  }
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("timeline") ? alturaDe(this) : 0
    },
  })
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("timeline") ? VISTA : 0
    },
  })
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      const maximo = Math.max(0, this.scrollHeight - this.clientHeight)
      return Math.min(topo.get(this) ?? 0, maximo)
    },
    set(this: HTMLElement, valor: number) {
      const maximo = Math.max(0, this.scrollHeight - this.clientHeight)
      topo.set(this, Math.max(0, Math.min(valor, maximo)))
    },
  })
  ;(proto as unknown as { scrollTo: (o: ScrollToOptions) => void }).scrollTo = function (this: HTMLElement, opcoes: ScrollToOptions) {
    rolagens.push({ behavior: opcoes.behavior, top: opcoes.top })
    if (opcoes.top !== undefined) this.scrollTop = opcoes.top
  }
})

afterAll(() => {
  window.matchMedia = matchMediaOriginal
  for (const [nome, descritor] of Object.entries(originais)) {
    if (descritor) Object.defineProperty(HTMLElement.prototype, nome, descritor)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[nome]
  }
  delete (HTMLElement.prototype as unknown as Record<string, unknown>)["scrollTo"]
})

afterEach(() => {
  cleanup()
  rolagens.length = 0
})

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> => baseRender(ui, { wrapper: ToastProvider })
const noop = (): void => {}

function mensagens(sala: string, quantas: number, desde = 1): ChatMessage[] {
  return Array.from({ length: quantas }, (_, i) => ({
    channel: "!canal:s",
    seq: desde + i,
    sender: "@abc:s",
    payload: { t: "message", id: `${sala}-${desde + i}`, sentAt: (desde + i) * 1000, body: `${sala} ${desde + i}`, room: sala },
  }))
}

function timeline(overrides: Partial<React.ComponentProps<typeof Timeline>>): React.JSX.Element {
  return (
    <Timeline
      channel="!canal:s"
      messages={[]}
      pending={[]}
      onRetry={noop}
      onDiscard={noop}
      me={null}
      nameFor={(sender) => sender}
      directory={new Map<string, Profile>()}
      {...overrides}
    />
  )
}

const scroller = (): HTMLElement => document.querySelector<HTMLElement>(".timeline")!
const distanciaAoFundo = (): number => scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight

/** What a person does with the wheel: moves `scrollTop` and the browser notifies. */
function rolarPara(top: number): void {
  scroller().scrollTop = top
  fireEvent.scroll(scroller())
}

describe("abrir uma sala", () => {
  it("trocar de sala no mesmo canal abre a nova no fundo, de uma vez, sem deslizar", () => {
    const { rerender } = render(timeline({ conversa: "!canal:s|geral", messages: mensagens("geral", 3) }))
    rerender(timeline({ conversa: "!canal:s|conversa", messages: mensagens("conversa", 40) }))
    expect(distanciaAoFundo()).toBe(0)
    expect(rolagens.filter((r) => r.behavior === "smooth")).toEqual([])
  })

  it("abre no fundo mesmo vindo de uma sala com mais mensagens", () => {
    // That was the case where it did not scroll at all: the count went down, and that looked like no news.
    const { rerender } = render(timeline({ conversa: "!canal:s|grande", messages: mensagens("grande", 60) }))
    rolarPara(1000)
    rerender(timeline({ conversa: "!canal:s|pequena", messages: mensagens("pequena", 20) }))
    expect(distanciaAoFundo()).toBe(0)
  })

  it("cada sala guarda o seu sítio, e quem saiu do fundo volta ao fundo", () => {
    const { rerender } = render(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 30) }))
    rolarPara(700)
    rerender(timeline({ conversa: "!canal:s|b", messages: mensagens("b", 30) }))
    expect(distanciaAoFundo()).toBe(0)
    rerender(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 30) }))
    expect(scroller().scrollTop).toBe(700)
    // On `b` we stayed at the bottom, and meanwhile three more arrived: back to the bottom.
    rerender(timeline({ conversa: "!canal:s|b", messages: mensagens("b", 33) }))
    expect(distanciaAoFundo()).toBe(0)
  })

  it("o histórico que chega depois de a sala abrir não a faz deslizar", () => {
    // The fetch brings messages in bursts after the click.
    const { rerender } = render(timeline({ conversa: "!canal:s|a", messages: [] }))
    rerender(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 15) }))
    rerender(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 40) }))
    expect(distanciaAoFundo()).toBe(0)
    expect(rolagens.filter((r) => r.behavior === "smooth")).toEqual([])
  })
})

describe("o que chega com a sala aberta", () => {
  it("quem está no fundo continua no fundo", () => {
    const { rerender } = render(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 20) }))
    rerender(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 21) }))
    expect(distanciaAoFundo()).toBe(0)
  })

  it("quem está a ler mais acima não é puxado para baixo", () => {
    const { rerender } = render(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 20) }))
    rolarPara(400)
    rerender(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 22) }))
    expect(scroller().scrollTop).toBe(400)
    expect(document.querySelector(".timeline-jump")).not.toBeNull()
  })

  it("uma imagem que acaba de carregar mantém no fundo quem lá estava", () => {
    render(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 20) }))
    expect(distanciaAoFundo()).toBe(0)
    // The image decoded and the row grew; the browser does not scroll on its own.
    const img = document.createElement("img")
    scroller().appendChild(img)
    extra.set(scroller(), 300)
    act(() => {
      fireEvent.load(img)
    })
    expect(distanciaAoFundo()).toBe(0)
  })

  it("e não mexe em quem está a ler acima", () => {
    render(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 20) }))
    rolarPara(300)
    const img = document.createElement("img")
    scroller().appendChild(img)
    extra.set(scroller(), 300)
    act(() => {
      fireEvent.load(img)
    })
    expect(scroller().scrollTop).toBe(300)
  })

  it("a correcção do browser por conteúdo que cresceu não conta como a pessoa a subir", () => {
    // Chrome's anchoring pushes `scrollTop` DOWN when something grows above: the
    // person did not do it, and whoever was stuck to the bottom stays stuck.
    const { rerender } = render(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 20) }))
    extra.set(scroller(), 600)
    rolarPara(scroller().scrollTop + 300)
    rerender(timeline({ conversa: "!canal:s|a", messages: mensagens("a", 21) }))
    expect(distanciaAoFundo()).toBe(0)
  })
})

describe("as imagens reservam a altura", () => {
  it("o <img> leva a largura e a altura lidas dos bytes, antes de descodificar", () => {
    // A 640x360 PNG: only the header counts.
    const ihdr = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0x80, 0, 0, 1, 0x68, 8, 6, 0, 0, 0,
    ])
    const imagem: MediaItem = { inline: `data:image/png;base64,${Buffer.from(ihdr).toString("base64")}`, mediaType: "image/png" }
    const com: ChatMessage = {
      channel: "!canal:s",
      seq: 1,
      sender: "@abc:s",
      payload: { t: "message", id: "x", sentAt: 1, body: "", attachments: [imagem] },
    }
    render(timeline({ messages: [com] }))
    const img = document.querySelector(".message-media img")!
    expect(img.getAttribute("width")).toBe("640")
    expect(img.getAttribute("height")).toBe("360")
  })
})
