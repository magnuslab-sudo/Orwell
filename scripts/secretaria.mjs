/**
 * The desktop app FOR REAL, opened by a script: the built `apps/client/out`,
 * with the real main process, preload, and renderer.
 *
 * The bench (`ipc-canais-electron.mjs`) tests IPC with a mock main process.
 * Here the real app main process (`out/main/index.cjs`) runs, wrapped by a
 * startup file with five differences, each with a reason:
 *
 *  1. **Another data folder** (`app.setPath("userData")`), temporary and
 *     deleted after. Without this the script would open the vault the owner
 *     has installed, in the same `Application Support` folder.
 *  2. **Another app name** (`OrwellE2E`, in the wrapper's `package.json`).
 *     macOS Keychain stores the vault key in an item named after the app
 *     ("Orwell Safe Storage"). With the real name, an unsigned Electron would
 *     ask permission for the installed app's item and macOS would prompt the
 *     owner. Scripts create the vault with a password and never reach Keychain;
 *     the name is the second lock.
 *  3. **Mock microphone and camera** (the same switches Chromium scripts use),
 *     so calls have audio without touching the real hardware.
 *  4. **The requested language**: scripts search for text in Portuguese. In the
 *     browser it is in the URL (`?lingua=pt`, see `ambiente.mjs`); here the
 *     page opens via `loadFile` with no URL, and language comes from system
 *     settings (`app.getPreferredSystemLanguages`, see `renderer/main.tsx`).
 *     The wrapper answers "pt-PT" for them.
 *  5. **No requests to orwell.pt.** The main process checks the published
 *     version on startup (`actualizacao.ts`). A script never talks to production:
 *     the global `fetch` refuses that host.
 *
 * And the window is not visible, yet stays a visible window to Chromium. Hidden
 * (`show: false`) Chromium stops painting and running `requestAnimationFrame`,
 * and Playwright waits for it before each click. So the window opens at zero
 * opacity, without stealing focus, and lets mouse clicks pass: it is "visible"
 * to Chromium and invisible to the user.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _electron } from "playwright"
import { RAIZ } from "./servidor-descartavel.mjs"

const PRINCIPAL = join(RAIZ, "apps/client/out/main/index.cjs")
const VERSAO = JSON.parse(readFileSync(join(RAIZ, "apps/client/package.json"), "utf8")).version

const ARRANQUE = `
const electron = require("electron")
const { app, BrowserWindow } = electron
app.setPath("userData", process.env.ORWELL_E2E_DADOS)
app.commandLine.appendSwitch("use-fake-device-for-media-stream")
// O \`getDisplayMedia\` com este interruptor escolhe sozinho um ecrã e SALTA o
// \`setDisplayMediaRequestHandler\`: um guião que mede o selector da app desliga-o.
if (process.env.ORWELL_E2E_SELECTOR_REAL !== "1") app.commandLine.appendSwitch("use-fake-ui-for-media-stream")
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
app.getPreferredSystemLanguages = () => [process.env.ORWELL_E2E_LINGUA || "pt-PT"]
const fetchOriginal = globalThis.fetch
globalThis.fetch = (alvo, ...resto) => {
  const endereco = typeof alvo === "string" ? alvo : (alvo && alvo.url) || String(alvo)
  if (/^https?:\\/\\/([^/]*\\.)?orwell\\.pt(\\/|:|$)/.test(endereco)) return Promise.reject(new Error("guião: produção recusada"))
  return fetchOriginal(alvo, ...resto)
}
if (process.env.ORWELL_E2E_VISIVEL !== "1") {
  BrowserWindow.prototype.show = function () {
    this.setOpacity(0)
    this.setIgnoreMouseEvents(true)
    this.showInactive()
  }
}
require(process.env.ORWELL_E2E_PRINCIPAL)
`

/**
 * @param {{ rotulo: string, dados?: string, selectorReal?: boolean, escala?: number }} opcoes `dados` reuses a
 *   data folder (reopen the same app); without it a new one is created. `selectorReal`:
 *   the `getDisplayMedia\` goes through the main process handler and the app
 *   selector, instead of Chromium choosing on its own (`use-fake-ui-for-media-stream\`).
 *   `principal`: the `out/main/index.cjs` from another build (the login measure
 *   compares against the 1.1.0 built from an earlier commit). `escala`: the
 *   `devicePixelRatio` of the window (`force-device-scale-factor`), like Windows at 125 %.
 */
export async function abrirSecretaria({ rotulo, dados, selectorReal = false, principal = PRINCIPAL, escala } = {}) {
  const pastaDaApp = mkdtempSync(join(tmpdir(), "orwell-e2e-app-"))
  const pastaDeDados = dados ?? mkdtempSync(join(tmpdir(), "orwell-e2e-dados-"))
  writeFileSync(join(pastaDaApp, "package.json"), JSON.stringify({ name: "orwell-e2e", productName: "OrwellE2E", version: VERSAO, main: "arranque.cjs" }))
  writeFileSync(join(pastaDaApp, "arranque.cjs"), ARRANQUE)
  const executavel = (await import("electron")).default
  const registo = []
  const app = await _electron.launch({
    executablePath: executavel,
    // Scale goes on the command line: the screen is read before startup runs, and
    // an `appendSwitch` inside it arrives too late.
    args: [...(escala ? [`--force-device-scale-factor=${escala}`] : []), pastaDaApp],
    cwd: RAIZ,
    env: { ...process.env, ORWELL_E2E_DADOS: pastaDeDados, ORWELL_E2E_PRINCIPAL: principal, ENCLAVE_TRACE: "", ORWELL_E2E_SELECTOR_REAL: selectorReal ? "1" : "" },
    timeout: 60_000,
  })
  app.process().stdout?.on("data", (b) => registo.push(`PRINCIPAL ${String(b).trim()}`))
  app.process().stderr?.on("data", (b) => registo.push(`PRINCIPAL! ${String(b).trim()}`))
  const page = await app.firstWindow({ timeout: 60_000 })
  page.on("console", (m) => registo.push(`CONSOLA[${rotulo}] ${m.type()} ${m.text()}`))
  page.on("pageerror", (e) => registo.push(`PAGEERROR[${rotulo}] ${e.message}`))
  return {
    app,
    page,
    registo,
    dados: pastaDeDados,
    async fechar({ guardarDados = false } = {}) {
      await app.close().catch(() => {})
      try {
        app.process().kill("SIGKILL")
      } catch {}
      rmSync(pastaDaApp, { recursive: true, force: true })
      if (!guardarDados) rmSync(pastaDeDados, { recursive: true, force: true })
    },
  }
}
