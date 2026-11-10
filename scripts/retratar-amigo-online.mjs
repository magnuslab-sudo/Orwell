/**
 * The "Ana is online" toast (item 6, 2 November 2026) inside the app,
 * in a real layout engine.
 *
 * The shell tests (`packages/ui/src/App.amigoOnline.test.tsx`) run in
 * jsdom, without stylesheets: they say the toast appears and the button opens
 * the chat, they do not say how it looks. This sets up the real `ToastProvider`
 * and the real Settings › Notifications screen, with the real stylesheet,
 * and pushes the toast the way the shell does (`avisarAmigoOnline`,
 * in `App.tsx`): the text, the "Open chat" button, and the "info" level.
 *
 * The system notification (with the avatar) is drawn by the operating system
 * and cannot be captured from here. The toast is what appears when there is no
 * system notification.
 *
 * Checks that there are no errors, that the toast has the text and button, that
 * the button opens the chat, and that the toggle in Notifications is on.
 * Captures `capturas/amigo-online-1280.png` and `-390.png`.
 *
 *   node scripts/retratar-amigo-online.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-amigo-online")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { ToastProvider, useToast } from ${UI("components/Toast.js")}
import { SettingsScreen } from ${UI("screens/settings/SettingsScreen.js")}
import { strings } from ${UI("strings.js")}
import ${UI("styles.css")}

window.__abriu = 0

function Aviso() {
  const push = useToast()
  useEffect(() => {
    push(strings.notifications.amigoOnline("Ana"), "info", {
      rotulo: strings.notifications.abrirConversa,
      fazer: () => { window.__abriu += 1 },
    })
  }, [push])
  return null
}

const ponte = { applyMediaPrefs: () => {} }

function Demo() {
  return (
    <BridgeContext.Provider value={ponte}>
      <ToastProvider>
        <div className="app">
          <nav className="rail" />
          <main className="main">
            <SettingsScreen
              address="@vesna:casa.test"
              connection="online"
              connectionDetail={null}
              onLock={() => {}}
              micMuted={false}
              soundOff={false}
              onToggleMic={() => {}}
              onToggleSound={() => {}}
              seccao="avisos"
            />
          </main>
        </div>
        <Aviso />
      </ToastProvider>
    </BridgeContext.Provider>
  )
}

createRoot(document.getElementById("raiz")).render(<Demo />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
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

for (const [largura, altura] of [
  [1280, 800],
  [390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".toast", { timeout: 10_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)

  const id = String(largura)
  const m = await page.evaluate(() => {
    const balao = document.querySelector(".toast")
    const caixa = balao.getBoundingClientRect()
    const interruptor = [...document.querySelectorAll('[role="switch"]')].find((el) =>
      (el.getAttribute("aria-label") ?? el.textContent ?? "").includes("amigo fica online"),
    )
    return {
      texto: balao.textContent,
      botao: balao.querySelector("button")?.textContent ?? "",
      dentro: caixa.left >= 0 && caixa.right <= window.innerWidth && caixa.bottom <= window.innerHeight,
      interruptor: interruptor?.getAttribute("aria-checked") ?? null,
      pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))
  check(`${id}: o balão diz "Ana está online"`, m.texto.includes("Ana está online"), m.texto)
  check(`${id}: o balão tem "Abrir a conversa"`, m.botao.includes("Abrir a conversa"), m.botao)
  check(`${id}: o balão cabe no ecrã, e a página não rola de lado`, m.dentro && m.pagina <= 0, `página ${m.pagina}`)
  check(`${id}: o interruptor das Notificações vem ligado`, m.interruptor === "true", String(m.interruptor))
  await page.screenshot({ path: join(CAPTURAS, `amigo-online-${id}.png`) })
  await page.click(".toast button:has-text('Abrir a conversa')")
  check(`${id}: o botão abre a conversa`, (await page.evaluate(() => window.__abriu)) === 1)
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
