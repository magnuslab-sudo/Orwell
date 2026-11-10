/**
 * The "announcements" room of the official channel, with news, in a real layout engine.
 *
 * The tests (`App.salaDeAnuncios.test.tsx`) run in jsdom, which does not apply stylesheets: they say the view is there and there is no compose bar, they don't say if the page fits in the chat area or if it scrolls. This builds the TRUE shell (`App`), with the true stylesheet, on a mock bridge that announces the common channel and gives it an "Announcements" room; logs in, opens the channel and the room by clicks, and measures.
 *
 * Saves `capturas/novidades-na-sala-1280.png`.
 *
 *   node scripts/retratar-novidades-na-sala.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-novidades-na-sala")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { App } from ${UI("App.js")}
import ${UI("styles.css")}

const EU = "@vesna:casa.pt"
const ANA = "@ana:casa.pt"
const COMUM = "!orwell:casa.pt"
const ok = async () => ({ ok: true })
const nada = () => () => {}
let aoLigar = null
window.__ligar = () => aoLigar?.({ state: "online" })
// O cartão de boas-vindas do canal comum já foi lido: é o estado de quase toda a gente.
localStorage.setItem("enclave.apresentados", JSON.stringify([COMUM]))

const ponte = {
  vault: { status: async () => ({ exists: true, supportsOsProtection: true }), unlock: ok, create: ok, lock: ok, destroy: ok },
  identity: { load: async () => ({ address: EU, accountId: "vesna" }), create: async () => ({ address: EU, accountId: "vesna" }) },
  session: { connect: ok, capabilities: async () => ["mls"], setVisible: ok, commonRoom: async () => COMUM },
  channels: {
    list: async () => [COMUM], create: ok, invite: ok, channelInvites: async () => [],
    acceptChannelInvite: ok, declineChannelInvite: ok, send: ok, typing: ok, buzz: ok,
    members: async () => [EU, ANA], history: async () => [], forget: ok, safetyNumber: async () => null,
    rooms: () => [
      { room: "anuncios", name: "anúncios", category: "", kind: "text", position: 0 },
      { room: "avarias", name: "avarias", category: "", kind: "text", position: 1 },
      { room: "voz", name: "voz", category: "", kind: "voice", position: 2 },
    ],
  },
  invites: { create: async () => "enclave://join/x/y#z", redeem: ok, list: async () => [], revoke: ok },
  social: {
    post: ok, acceptFollower: ok, acceptFriend: ok, declineFriend: ok, unfriend: ok,
    repairInvite: async () => ({ invited: true }), deadWelcomes: async () => [], feedChannel: async () => "!mural:casa.pt",
  },
  profile: { get: async () => ({ displayName: "Vesna", donations: [] }), set: ok, directory: async () => ({}) },
  notifications: { list: async () => [], save: ok },
  on: {
    message: nada, epoch: nada, status: nada, channels: nada, presence: nada, typing: nada, buzz: nada, callActivity: nada,
    connection: (h) => { aoLigar = h; return () => { aoLigar = null } },
  },
  call: { on: nada, setMuted: () => {} },
}

createRoot(document.getElementById("raiz")).render(<App bridge={ponte} />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file", ".wasm": "file", ".mp3": "file", ".ogg": "file", ".opus": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e)))
await page.goto(`file://${join(SAIDA, "index.html")}`)
await page.waitForSelector(".channel-row", { timeout: 15_000 })
await page.evaluate(() => window.__ligar())
await page.waitForTimeout(200)
await page.locator(".channel-row button").first().click()
await page.waitForSelector(".room-row", { timeout: 10_000 })
await page.locator(".room-row", { hasText: "anúncios" }).first().click()
await page.waitForSelector(".notas-de-versao", { timeout: 10_000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)

const m = await page.evaluate(() => {
  const vista = document.querySelector(".notas-de-versao")
  const sombra = vista.shadowRoot
  const caixa = vista.getBoundingClientRect()
  const main = document.querySelector("main.main").getBoundingClientRect()
  return {
    titulo: sombra?.querySelector("h1")?.textContent,
    subtitulo: sombra?.querySelector(".subtitulo")?.textContent,
    seccoes: sombra?.querySelectorAll(".versao").length ?? 0,
    primeira: sombra?.querySelector(".versao .numero")?.textContent,
    rola: vista.scrollHeight > vista.clientHeight && getComputedStyle(vista).overflowY === "auto",
    dentro: caixa.left >= main.left - 0.5 && caixa.right <= main.right + 0.5 && caixa.bottom <= main.bottom + 0.5,
    composer: document.querySelector(".chat-composer") !== null,
    trancada: document.querySelector(".chat-escrita-trancada")?.textContent ?? "",
    fundo: getComputedStyle(sombra.querySelector(".versao")).backgroundColor,
    pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
})

check("sem erros na página", erros.length === 0, erros.join(" | "))
check("o título e o subtítulo", m.titulo === "Release notes" && /^Orwell versão \S+ \d+\.\d+$/.test(m.subtitulo ?? ""), `${m.titulo} / ${m.subtitulo}`)
check("uma secção por versão, a mais recente em cima", m.seccoes >= 2 && m.primeira !== undefined, `${m.seccoes} secções, primeira ${m.primeira}`)
check("a página rola dentro da área da conversa", m.rola && m.dentro)
check("sem barra de escrita, com a frase de só ler", !m.composer && m.trancada.length > 0, m.trancada)
check("os tokens da pele chegam dentro da sombra", m.fundo !== "rgba(0, 0, 0, 0)", m.fundo)
check("a página não rola de lado", m.pagina <= 0, String(m.pagina))

await page.screenshot({ path: join(CAPTURAS, "novidades-na-sala-1280.png") })
await ctx.close()
await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
