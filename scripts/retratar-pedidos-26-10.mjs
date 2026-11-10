/**
 * Two requests from the owner on October 26, 2026, captured in a real layout engine: the common channel header without the "Open" lock (request 2), and the people panel with "Invite..." in primary and no note below (request 3).
 *
 * Builds the TRUE shell (`App`) with the true stylesheet, on a mock bridge that announces the common channel and lets you invite, like `retratar-novidades-na-sala.mjs`. Opens the common channel by clicks, opens the people panel, measures and saves:
 *
 *   capturas/pedidos-26-10-<label>-1280.png   the common channel, with the panel
 *   capturas/pedidos-26-10-<label>-painel.png the people panel only
 *
 *   node scripts/retratar-pedidos-26-10.mjs                 (this code, "after")
 *   ORWELL_UI_SRC=<folder>/packages/ui/src ORWELL_ETIQUETA=antes \
 *     node scripts/retratar-pedidos-26-10.mjs               (another tree, unchecked)
 *
 * With `ORWELL_UI_SRC` pointing to an old copy of `packages/ui/src` (for example `git archive f70d64a4^ packages/ui`), it gives the before screenshot. The tree also brings sources from `protocol`, `crypto` and `client-core` alongside (`git archive f70d64a4^ packages/ui packages/protocol/src …`); other modules resolve from this repo's `node_modules`.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const ETIQUETA = process.env.ORWELL_ETIQUETA ?? "depois"
const FONTE = process.env.ORWELL_UI_SRC ?? join(RAIZ, "packages/ui/src")
/** Only the code from this tree gets checked: the "before" capture shows what was there. */
const VERIFICAR = process.env.ORWELL_UI_SRC === undefined
const SAIDA = join(AQUI, `.saida-pedidos-26-10-${ETIQUETA}`)
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(FONTE, caminho))
/**
 * In an old tree, workspace packages come from its sources, not from the current `dist`: the old interface calls old exports.
 */
const PACOTES = VERIFICAR
  ? {}
  : Object.fromEntries(
      ["protocol", "crypto", "client-core"].map((p) => [`@enclave/${p}`, join(FONTE, "../../", p, "src/index.ts")]),
    )

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
const RUI = "@rui:casa.pt"
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
    members: async () => [EU, ANA, RUI], history: async () => [], forget: ok, safetyNumber: async () => null,
    mayInvite: () => true,
    rooms: () => [
      { room: "geral", name: "geral", category: "", kind: "text", position: 0 },
      { room: "voz", name: "voz", category: "", kind: "voice", position: 1 },
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
  nodePaths: [join(RAIZ, "node_modules")],
  alias: PACOTES,
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e)))
await page.goto(`file://${join(SAIDA, "index.html")}`)
await page.waitForSelector(".channel-row", { timeout: 15_000 })
await page.evaluate(() => window.__ligar())
await page.waitForTimeout(200)
await page.locator(".channel-row button").first().click()
await page.waitForSelector(".topbar h1", { timeout: 10_000 })
// The people panel: open by default on wide screen, otherwise by button.
if ((await page.locator(".members-footer").count()) === 0) {
  await page.locator(".topbar button[aria-label='Pessoas'], .topbar button[title='Pessoas']").first().click()
}
await page.waitForSelector(".members-footer", { timeout: 10_000 })
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(400)

const m = await page.evaluate(() => {
  const rodape = document.querySelector(".members-footer")
  const botao = rodape?.querySelector("button")
  const caixa = botao?.getBoundingClientRect()
  return {
    cadeado: document.querySelector(".topbar .sealed") !== null,
    aberto: /Aberto/.test(document.querySelector(".topbar")?.textContent ?? ""),
    classes: botao?.className ?? "",
    texto: botao?.textContent?.trim() ?? "",
    fundo: botao ? getComputedStyle(botao).backgroundImage : "",
    nota: rodape?.querySelector(".field-note")?.textContent ?? null,
    lado: caixa ? Math.round(caixa.width) : 0,
    largura: rodape ? Math.round(rodape.getBoundingClientRect().width) : 0,
  }
})

console.log(`[${ETIQUETA}] cadeado no cabeçalho: ${m.cadeado}; «Aberto»: ${m.aberto}; botão: "${m.texto}" (${m.classes}); nota: ${m.nota === null ? "nenhuma" : `"${m.nota}"`}`)
if (VERIFICAR) {
  check("sem erros na página", erros.length === 0, erros.join(" | "))
  check("o cabeçalho do canal comum não tem cadeado nem «Aberto»", !m.cadeado && !m.aberto)
  check("«Convidar…» é o primário, com o degradé", /\bprimary\b/.test(m.classes) && m.fundo.includes("gradient"), m.fundo.slice(0, 60))
  check("e ocupa a largura do rodapé", m.lado > 0 && m.largura - m.lado < 48, `${m.lado} de ${m.largura} px`)
  check("sem a nota por baixo", m.nota === null)
}

await page.screenshot({ path: join(CAPTURAS, `pedidos-26-10-${ETIQUETA}-1280.png`) })
const painel = page.locator(".members-footer").locator("xpath=ancestor::aside[1]")
await painel.screenshot({ path: join(CAPTURAS, `pedidos-26-10-${ETIQUETA}-painel.png`) })
await ctx.close()
await browser.close()
const falhas = resultados.filter((ok) => !ok).length
if (VERIFICAR) console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
