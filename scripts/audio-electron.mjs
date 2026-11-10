/**
 * Does the audio pipeline run INSIDE the installed app?
 *
 *   npx tsc -b && node scripts/audio-electron.mjs
 *
 * `scripts/e2e-audio.mjs` proves the pipeline in all three engines, served by
 * http, under the policy from `apps/web/index.html`. The desktop app has two
 * conditions a tab does not, and this test rig measures both:
 *
 *  - the page is loaded by `file://` (`loadFile`, in `main/index.ts`): Chromium's
 *    `fetch` refuses that scheme, and the model must arrive by `XMLHttpRequest`
 *    (`lerBinario`, in `audio/cadeia.ts`); the worklet module must also load from
 *    `file://`;
 *  - the policy is from the `<meta>` in `apps/client/src/renderer/index.html`,
 *    read from there each run, because `file://` brings no headers.
 *
 * The page is the same as in `e2e-audio` (`scripts/e2e-audio/`), built with Vite
 * with relative paths, and runs in a hidden Electron window with the same
 * `sandbox` and `contextIsolation` as the app.
 *
 * And the counter-proof: with the policy missing `'wasm-unsafe-eval'` the model
 * DOES NOT compile and the pipeline runs without it. Without this half, a YES
 * only proved the script ran.
 *
 * Does not talk to any server and does not open the microphone (the live proof
 * uses an oscillator). Writes only to a temp folder, which it deletes at the end.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "vite"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

if (!existsSync(join(RAIZ, "packages/client-core/dist/audio/cadeia.js"))) {
  process.stderr.write("Falta o núcleo construído. Corre `npx tsc -b` primeiro.\n")
  process.exit(2)
}

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(Boolean(ok))
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` (${detalhe})` : ""}\n`)
}

// --- the policy, read from the renderer ----------------------------------------

const htmlDoRenderer = readFileSync(join(RAIZ, "apps/client/src/renderer/index.html"), "utf8")
const politica = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(htmlDoRenderer)?.[1]
if (!politica) {
  process.stderr.write("Não encontrei a política no apps/client/src/renderer/index.html.\n")
  process.exit(2)
}
check("a política do renderer deixa compilar WebAssembly", /script-src[^;]*'wasm-unsafe-eval'/.test(politica))
check("e continua sem 'unsafe-eval' nem 'unsafe-inline' em script-src", !/script-src[^;]*'unsafe-(eval|inline)'/.test(politica))
const cabecalho = readFileSync(join(RAIZ, "apps/client/src/main/index.ts"), "utf8")
check(
  "o cabeçalho do processo principal diz o mesmo, em produção e em desenvolvimento",
  /"script-src 'self' 'wasm-unsafe-eval'"/.test(cabecalho) && /"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'"/.test(cabecalho),
)
const politicaAntiga = politica.replace(" 'wasm-unsafe-eval'", "")

// --- the test page, with relative paths for file:// ---------------------------

const PASTA = mkdtempSync(join(tmpdir(), "orwell-audio-electron-"))
await build({
  root: join(RAIZ, "scripts/e2e-audio"),
  base: "./",
  logLevel: "warn",
  configFile: false,
  build: { outDir: PASTA, emptyOutDir: true, target: "es2023" },
})
const construida = readFileSync(join(PASTA, "index.html"), "utf8")
writeFileSync(join(PASTA, "index.html"), construida.replace("%POLITICA%", politica))
writeFileSync(join(PASTA, "antiga.html"), construida.replace("%POLITICA%", politicaAntiga))

/*
  The test rig's main process: the window with app preferences (`sandbox`,
  `contextIsolation`, no Node), the page via `loadFile`, and the same gesture
  `e2e-audio` does (click "run"), given by `sendInputEvent`.
*/
const PRINCIPAL = `
const { app, BrowserWindow } = require("electron")
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")
const pagina = process.argv[process.argv.length - 1]
app.on("ready", async () => {
  const janela = new BrowserWindow({
    show: false, width: 400, height: 300,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  const recusas = []
  janela.webContents.on("console-message", (...args) => {
    const mensagem = typeof args[1] === "string" ? args[1] : (args[0] && args[0].message) || ""
    // Só as recusas. O aviso de que frame-ancestors não vale num <meta> é da política de sempre, e não recusa nada.
    if (/Refused|violates/.test(String(mensagem))) recusas.push(String(mensagem).slice(0, 200))
  })
  await janela.loadFile(pagina)
  await janela.webContents.executeJavaScript("document.getElementById('correr').click()", true)
  let medicao = null
  try {
    medicao = await janela.webContents.executeJavaScript(
      "Promise.race([window.resultado(), new Promise((r) => setTimeout(() => r(null), 60000))]).then((r) => JSON.stringify(r))",
      true,
    )
  } catch (erro) {
    medicao = JSON.stringify({ erros: [String(erro)] })
  }
  console.log("MEDICAO " + medicao)
  console.log("RECUSAS " + JSON.stringify(recusas))
  console.log("VERSOES " + process.versions.electron + " " + process.versions.chrome)
  app.exit(0)
})
`
writeFileSync(join(PASTA, "principal.cjs"), PRINCIPAL)

function correr(pagina) {
  return new Promise((resolver) => {
    const filho = spawn(join(RAIZ, "node_modules", ".bin", "electron"), [join(PASTA, "principal.cjs"), pagina], { cwd: RAIZ })
    let saida = ""
    filho.stdout.on("data", (bloco) => (saida += bloco))
    filho.stderr.on("data", (bloco) => (saida += bloco))
    const relogio = setTimeout(() => {
      filho.kill("SIGKILL")
      resolver({ saida, prazo: true })
    }, 120_000)
    filho.on("close", () => {
      clearTimeout(relogio)
      resolver({ saida, prazo: false })
    })
  })
}

const ler = (saida, marca) => {
  const linha = saida.split("\n").find((cada) => cada.startsWith(marca + " "))
  return linha ? linha.slice(marca.length + 1) : null
}

async function medir(ficheiro) {
  const { saida, prazo } = await correr(join(PASTA, ficheiro))
  if (prazo) throw new Error(`${ficheiro}: o Electron não respondeu em 120 s\n${saida}`)
  const medicao = JSON.parse(ler(saida, "MEDICAO") ?? "null")
  if (!medicao) throw new Error(`${ficheiro}: a página não chegou a medir nada\n${saida}`)
  return { r: medicao, recusas: JSON.parse(ler(saida, "RECUSAS") ?? "[]"), versoes: ler(saida, "VERSOES") }
}

try {
  const { r, recusas, versoes } = await medir("index.html")
  process.stdout.write(`\nElectron e Chromium: ${versoes}\n`)
  check("sem violações da política", (r.violacoes ?? []).length === 0 && recusas.length === 0, [...(r.violacoes ?? []), ...recusas].join(" | "))
  check("sem erros na página", (r.erros ?? []).length === 0, (r.erros ?? []).join(" | "))
  check("o worklet carrega de file://, com hash no nome", /assets\/processador-de-voz-[\w-]+\.js$/.test(r.worklet ?? ""), r.worklet)
  check("o modelo chega por file:// (XMLHttpRequest)", r.erroDoWasm === null, r.erroDoWasm ?? "")
  check("offline, o modelo compila no worklet", r.offline?.motor === "pronto", r.offline?.motor)
  if (r.offline) {
    const reducao = r.offline.pausasAntesDb - r.offline.pausasDepoisDb
    check("offline, o ruído nas pausas desce 20 dB ou mais", reducao >= 20, `${reducao.toFixed(1)} dB`)
  }
  check("ao vivo, o contexto corre", r.aoVivo?.estadoDoContexto === "running", r.aoVivo?.estadoDoContexto)
  check("ao vivo, o modelo está pronto", r.aoVivo?.motor === "pronto", r.aoVivo?.motor)
  check("ao vivo, a faixa de saída está viva", r.aoVivo?.faixa === "live", r.aoVivo?.faixa)

  const contra = await medir("antiga.html")
  check(
    "contraprova: sem 'wasm-unsafe-eval' o modelo não compila e a cadeia segue",
    String(contra.r.offline?.motor ?? "").startsWith("falhou") && contra.r.offline?.finita === true,
    contra.r.offline?.motor,
  )
} finally {
  rmSync(PASTA, { recursive: true, force: true })
}

const falhas = resultados.filter((ok) => !ok).length
process.stdout.write(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.\n`)
process.exitCode = falhas === 0 ? 0 : 1
