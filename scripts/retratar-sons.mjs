#!/usr/bin/env node
/**
 * Screenshot of Settings › Notifications, with the "Sounds" section.
 *
 *   node scripts/retratar-sons.mjs
 *
 * Renders the Settings screen standalone (no server, no account), with the real
 * stylesheet, in a headless Chromium, at 1280 and 390 px. Also verifies that
 * at 390 px the page does not scroll horizontally.
 *
 * Output: `capturas/sons-configuracoes-1280.png` and `-390.png`.
 */
import { build } from "esbuild"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const ui = join(raiz, "packages/ui/src")
const pasta = await mkdtemp(join(tmpdir(), "retratar-sons-"))

const entrada = join(ui, "__retratar_sons.tsx")
await writeFile(
  entrada,
  `import { createRoot } from "react-dom/client"
import { BridgeContext } from "./App.js"
import { ToastProvider } from "./components/Toast.js"
import { SettingsScreen } from "./screens/settings/SettingsScreen.js"
import { applyPrefs, readPrefs } from "./hooks/usePrefs.js"
import "./styles.css"
applyPrefs(readPrefs())
const bridge = { applyMediaPrefs() {} }
createRoot(document.getElementById("app")).render(
  <BridgeContext.Provider value={bridge}>
    <ToastProvider>
      <SettingsScreen address="@vera:casa.pt" connection="online" connectionDetail={null} onLock={() => {}}
        micMuted={false} soundOff={false} onToggleMic={() => {}} onToggleSound={() => {}} seccao="avisos" />
    </ToastProvider>
  </BridgeContext.Provider>,
)
`,
)

try {
  await build({
    entryPoints: [entrada],
    bundle: true,
    format: "iife",
    outdir: pasta,
    jsx: "automatic",
    loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl", ".png": "dataurl", ".svg": "dataurl", ".wasm": "file", ".onnx": "file" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "error",
  })
} finally {
  await rm(entrada, { force: true })
}
await writeFile(
  join(pasta, "index.html"),
  `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="__retratar_sons.css"></head><body><div id="app"></div><script src="__retratar_sons.js"></script></body></html>`,
)

const destino = join(raiz, "capturas")
await mkdir(destino, { recursive: true })
const browser = await chromium.launch()
let falhas = 0
try {
  for (const largura of [1280, 390]) {
    const pagina = await browser.newPage({ viewport: { width: largura, height: 1100 }, colorScheme: "dark" })
    const erros = []
    pagina.on("pageerror", (erro) => erros.push(String(erro)))
    pagina.on("console", (m) => { if (m.type() === "error") console.log("consola:", m.text()) })
    await pagina.goto(`file://${join(pasta, "index.html")}`)
    await pagina.getByText("Um som por acontecimento").waitFor()
    const ficheiro = join(destino, `sons-configuracoes-${largura}.png`)
    await pagina.screenshot({ path: ficheiro, fullPage: true })
    const rolagem = await pagina.evaluate(() => document.documentElement.scrollWidth)
    const ok = rolagem <= largura && erros.length === 0
    if (!ok) falhas += 1
    console.log(`${ok ? "ok  " : "FALHA"} ${largura} px  rolagem=${rolagem}  erros=${erros.length}  ${ficheiro}`)
    await pagina.close()
  }
} finally {
  await browser.close()
  await rm(pasta, { recursive: true, force: true })
}
process.exit(falhas === 0 ? 0 : 1)
