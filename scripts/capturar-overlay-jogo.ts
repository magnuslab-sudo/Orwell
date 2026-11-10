/**
 * The game overlay drawn for real, over the image from proposal 4's game.
 *
 *   npm run build -w @enclave/client
 *   npx tsx scripts/capturar-overlay-jogo.ts [caminho/da/imagem/do/jogo.png]
 *
 * The page is the built one (`apps/client/out/renderer/overlay.html`), with
 * its CSP. The `preload` bridge is swapped for a double before the page runs
 * (`addInitScript`); the main one is swapped for `janelaDaOverlay`, which does
 * the same calculation to put the window on screen. The iframe has the size and
 * position of the real window, and is transparent like it.
 *
 * Output in `capturas/overlay-jogo-*.png`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { chromium, type Frame } from "playwright"
import { janelaDaOverlay, type Posicao } from "../apps/client/src/main/overlay.js"

const raiz = resolve(import.meta.dirname, "..")
const pagina = join(raiz, "apps/client/out/renderer/overlay.html")
const fundo = process.argv[2] ?? join(homedir(), "Downloads/Orwell-overlays-jogo/jogo-4.png")
const ecra = { x: 0, y: 0, width: 1344, height: 760 }

const pasta = mkdtempSync(join(tmpdir(), "orwell-overlay-"))
const moldura = join(pasta, "moldura.html")

const textos = { entrou: "entrou na sala", saiu: "saiu da sala" }
const pessoas = [
  { id: "eu", nome: "Duarte", aFalar: false, micCalado: false, somDesligado: false },
  { id: "kaori", nome: "Kaori", aFalar: true, micCalado: false, somDesligado: false },
  { id: "rui", nome: "Rui", aFalar: false, micCalado: true, somDesligado: false },
  { id: "ines", nome: "Inês", aFalar: false, micCalado: false, somDesligado: false },
  { id: "tome", nome: "Tomé", aFalar: false, micCalado: false, somDesligado: false },
]
const CORES: Record<string, [string, string]> = {
  eu: ["#3b4a7a", "#141a33"],
  kaori: ["#f0a0c8", "#7a2a5a"],
  rui: ["#6fd1c4", "#1d4f4a"],
  ines: ["#f5c84c", "#6b4a12"],
}

async function caras(frame: Frame): Promise<void> {
  // Test faces drawn into the iframe itself (CSP allows `data:`). Tomé stays without
  // a face, so you see the initials.
  await frame.evaluate(`(() => {
    const cores = ${JSON.stringify(CORES)}
    const lote = {}
    for (const [id, [a, b]] of Object.entries(cores)) {
      const tela = document.createElement("canvas")
      tela.width = tela.height = 64
      const ctx = tela.getContext("2d")
      const grad = ctx.createRadialGradient(28, 22, 4, 32, 32, 40)
      grad.addColorStop(0, a)
      grad.addColorStop(1, b)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 64, 64)
      ctx.fillStyle = "rgba(255,255,255,0.85)"
      ctx.beginPath()
      ctx.arc(32, 26, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(32, 60, 20, 16, 0, 0, Math.PI * 2)
      ctx.fill()
      lote[id] = tela.toDataURL("image/png")
    }
    window.__caras(lote)
  })()`)
}

async function cena(opcoes: { nome: string; posicao: Posicao; opacidade: number; entrouKaori: boolean }): Promise<void> {
  // Electron treats `file://` as a privileged origin, and Chrome does not: without this
  // option, the page's module script would not load from disk.
  const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] })
  try {
    const contexto = await browser.newContext({ viewport: { width: ecra.width, height: ecra.height }, deviceScaleFactor: 2 })
    // As text, not as a function: `tsx` adds helpers (`__name`) to functions it writes,
    // and the browser does not know them.
    await contexto.addInitScript(`
      if (window !== window.top) {
        const ganchos = {}
        window.orwellOverlay = {
          aoDesenhar: (f) => ((ganchos.desenhar = f), () => {}),
          aoReceberCaras: (f) => ((ganchos.caras = f), () => {}),
          rato: () => {},
          arrastar: () => {},
          largura: (l) => { window.__largura = l },
          repor: () => {},
        }
        window.__desenhar = (v) => ganchos.desenhar && ganchos.desenhar(v)
        window.__caras = (v) => ganchos.caras && ganchos.caras(v)
      }
    `)
    const page = await contexto.newPage()
    page.on("console", (m) => console.log("[página]", m.text()))
    page.on("pageerror", (e) => console.log("[erro]", e.message))
    writeFileSync(
      moldura,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000 url("${pathToFileURL(fundo).href}") center/cover no-repeat}iframe{position:absolute;border:0;background:transparent}</style><iframe id="o" src="${pathToFileURL(pagina).href}" allowtransparency="true"></iframe>`,
    )
    await page.goto(pathToFileURL(moldura).href)
    await page.waitForLoadState("load")
    const frame = page.frames().find((f) => f.url().endsWith("overlay.html"))
    if (!frame) throw new Error(`sem iframe: ${page.frames().map((f) => f.url()).join(", ")}`)
    await frame.waitForFunction('document.querySelector(".pilula") !== null', undefined, { timeout: 10_000 })

    const desenhar = async (lista: typeof pessoas, lado: "abaixo" | "acima"): Promise<void> => {
      const desenho = { resumo: { sala: "Sala de jogo", entrada: 1, pessoas: lista }, opacidade: opcoes.opacidade, lado, textos }
      await frame.evaluate(`window.__desenhar(${JSON.stringify(desenho)})`)
    }
    await caras(frame)
    const semKaori = pessoas.filter((p) => p.id !== "kaori")
    await desenhar(opcoes.entrouKaori ? semKaori : pessoas, "abaixo")
    // Kaori enters: the banner is born here.
    await desenhar(pessoas, "abaixo")
    await page.waitForTimeout(50)
    const largura = (await frame.evaluate("window.__largura")) as number
    const janela = janelaDaOverlay(opcoes.posicao, largura, ecra)
    await page.evaluate(
      `Object.assign(document.getElementById("o").style, { left: "${janela.x}px", top: "${janela.y}px", width: "${janela.width}px", height: "${janela.height}px" })`,
    )
    // The side of the banner is the main one's: it only knows it after drawing the window.
    await desenhar(pessoas, janela.lado)
    // The banner enters with animation; we wait for it to finish, then light up the ring.
    await page.waitForTimeout(900)
    await page.screenshot({ path: join(raiz, `capturas/overlay-jogo-${opcoes.nome}.png`) })
    console.log(`capturas/overlay-jogo-${opcoes.nome}.png`, janela)
  } finally {
    await browser.close()
  }
}

try {
  await cena({ nome: "centro", posicao: { cx: ecra.width / 2, y: 16 }, opacidade: 0.6, entrouKaori: true })
  await cena({ nome: "movida-em-baixo", posicao: { cx: 260, y: 9999 }, opacidade: 0.6, entrouKaori: true })
  await cena({ nome: "opacidade-30", posicao: { cx: ecra.width / 2, y: 16 }, opacidade: 0.3, entrouKaori: false })
} finally {
  rmSync(pasta, { recursive: true, force: true })
}
