import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { chromium, type Browser } from "playwright"
import type { Profile } from "../../bridge.js"
import type { ChatMessage } from "../../types.js"
import { ToastProvider } from "../../components/Toast.js"
import { Timeline } from "./Timeline.js"

/**
 * No conversation container scrolls sideways.
 *
 * The bug (owner report on Windows, 4/11/2026): "there is a slider above the
 * text send box". It was the HORIZONTAL scrollbar of the conversation itself:
 * the tooltip of the button at the end of each message's actions ("Copy text",
 * "More"), invisible but centered on the button, extended 53 px past the right
 * margin, and the `.timeline` (with `overflow-y: auto`, so also
 * `overflow-x: auto`) gained width to show it. On Mac scrollbars hide and nobody
 * saw it; on Windows they always show.
 *
 * jsdom has no layout, so this test opens Chromium for real (Playwright), with
 * the app's actual stylesheets, and renders the conversation at three widths.
 * It measures only elements that SCROLL (`overflow-x: auto | scroll`): a name
 * truncated with ellipsis intentionally hides text and shows no scrollbar.
 */

const aqui = (relativo: string): string => fileURLToPath(new URL(relativo, import.meta.url))

/** Stylesheets in the order of `styles.css`, joined into one. */
function folhas(): string {
  const entrada = readFileSync(aqui("../../styles.css"), "utf8")
  return [...entrada.matchAll(/@import "\.\/styles\/([A-Za-z]+)\.css"/g)]
    .map((m) => readFileSync(aqui(`../../styles/${m[1]}.css`), "utf8"))
    .join("\n")
}

/** A 1200x800 PNG, just the header: enough to reserve the box. */
const PNG = `data:image/png;base64,${Buffer.from(
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 3, 0x20, 8, 6, 0, 0, 0]),
).toString("base64")}`

const EU = "@eu:s"
const OUTRA = "@outra:s"

function mensagem(seq: number, sender: string, payload: Partial<ChatMessage["payload"]>): ChatMessage {
  return { channel: "!c:s", seq, sender, payload: { t: "message", id: `m${seq}`, sentAt: seq * 600_000, ...payload } }
}

/** A conversation with everything a line can hold, from both people. */
const conversa: ChatMessage[] = [
  mensagem(1, OUTRA, { body: "olá, isto é uma frase normal" }),
  mensagem(2, EU, { body: "resposta minha, com o menu e o copiar" }),
  mensagem(3, OUTRA, { body: `um endereço comprido sem espaços https://exemplo.pt/${"caminho-".repeat(40)}fim` }),
  mensagem(4, EU, { body: "palavraenormesemespacosnenhuns".repeat(12) }),
  mensagem(5, OUTRA, { body: "uma imagem", attachments: [{ inline: PNG, mediaType: "image/png", name: "foto.png" }] }),
  mensagem(6, EU, {
    body: "duas imagens",
    attachments: [
      { inline: PNG, mediaType: "image/png", name: "a.png" },
      { inline: PNG, mediaType: "image/png", name: "b.png" },
    ],
  }),
  mensagem(7, OUTRA, {
    body: "vê isto https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    links: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "video", title: "Um título de vídeo bastante comprido para ver se parte a linha", siteName: "YouTube", thumbnail: PNG }],
  }),
  mensagem(8, EU, {
    body: "e um site",
    links: [{ url: "https://exemplo.pt/artigo", kind: "link", title: "Título", description: "descrição ".repeat(30), siteName: "Exemplo", thumbnail: PNG }],
  }),
  mensagem(9, OUTRA, {
    body: "um ficheiro",
    attachments: [{ inline: "data:application/pdf;base64,JVBERi0=", mediaType: "application/pdf", name: `${"relatório-".repeat(12)}.pdf` }],
  }),
]

function desenho(): string {
  return renderToStaticMarkup(
    <ToastProvider>
      <div className="main" style={{ height: "100vh" }}>
        <Timeline
          channel="!c:s"
          messages={conversa}
          pending={[{ id: "p1", channel: "!c:s", body: "por enviar, falhou", at: 1, state: "failed" }]}
          onRetry={() => {}}
          onDiscard={() => {}}
          me={EU}
          onMessageMenu={() => {}}
          podeMenuAlheio
          nameFor={(quem) => (quem === EU ? "Eu" : "Outra Pessoa Com Um Nome Comprido")}
          directory={new Map<string, Profile>()}
          typists={["Outra Pessoa Com Um Nome Comprido", "Mais Alguém"]}
          fixadas={new Set(["m3"])}
        />
      </div>
    </ToastProvider>,
  )
}

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

describe("a conversa não transborda para o lado", () => {
  it.each([
    [1920, 1080],
    [1280, 800],
    [390, 844],
  ])("a %ipx de largura, nenhum contentor que desliza é mais largo do que a sua caixa", async (largura, altura) => {
    const page = await browser.newPage({ viewport: { width: largura, height: altura } })
    try {
      await page.setContent(`<!doctype html><html><head><style>${folhas()}</style></head><body>${desenho()}</body></html>`)
      const fora = await page.evaluate(() => {
        const lista: string[] = []
        const raiz = document.querySelector(".main")
        if (!raiz) return ["sem .main"]
        for (const el of [raiz, ...raiz.querySelectorAll("*")]) {
          const { overflowX } = getComputedStyle(el)
          const desliza = overflowX === "auto" || overflowX === "scroll"
          if ((desliza || el === raiz) && el.scrollWidth > el.clientWidth) {
            lista.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${el.scrollWidth} > ${el.clientWidth}`)
          }
        }
        const doc = document.scrollingElement
        if (doc && doc.scrollWidth > doc.clientWidth) lista.push(`documento ${doc.scrollWidth} > ${doc.clientWidth}`)
        return lista
      })
      expect(fora).toEqual([])
      // Proof that the render is what we think: actions and images are there.
      expect(await page.locator(".msg-actions button").count()).toBeGreaterThan(0)
      expect(await page.locator(".message-media img[width]").count()).toBe(3)
    } finally {
      await page.close()
    }
  }, 30_000)
})

describe("uma imagem por descodificar já ocupa a caixa final", () => {
  it("o PNG de 1200x800 que nunca descodifica tem a caixa de 390x260 que teria descodificado", async () => {
    // 260 max height, and the width that height leaves: 260 x 1.5. This is what
    // Chromium gives the same image when decoded (measured 4/11/2026). Without the
    // reservation it was 7x5, and the line grew 250 px when the image arrived.
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    try {
      await page.setContent(`<!doctype html><html><head><style>${folhas()}</style></head><body>${desenho()}</body></html>`)
      const caixa = await page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('[data-mensagem="m5"] .message-media img')
        const r = img?.getBoundingClientRect()
        return r ? { largura: Math.round(r.width), altura: Math.round(r.height), descodificou: img!.naturalWidth > 0 } : null
      })
      expect(caixa).toEqual({ largura: 390, altura: 260, descodificou: false })
    } finally {
      await page.close()
    }
  }, 30_000)

  it("a miniatura do YouTube por descodificar já tem a largura e a altura do cartão final", async () => {
    // Card at 480 width, and the 16:9 frame inside the 2 px border: 476x268.
    // Without fixed width the card was born at 119 px and grew 200 px when the
    // thumbnail arrived.
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    try {
      await page.setContent(`<!doctype html><html><head><style>${folhas()}</style></head><body>${desenho()}</body></html>`)
      const caixa = await page.evaluate(() => {
        const cartao = document.querySelector('[data-mensagem="m7"] .link-card')?.getBoundingClientRect()
        const moldura = document.querySelector('[data-mensagem="m7"] .facade-frame')?.getBoundingClientRect()
        return cartao && moldura ? { cartao: Math.round(cartao.width), moldura: `${Math.round(moldura.width)}x${Math.round(moldura.height)}` } : null
      })
      expect(caixa).toEqual({ cartao: 480, moldura: "476x268" })
    } finally {
      await page.close()
    }
  }, 30_000)
})
