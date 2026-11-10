/**
 * Does the cipher worker EXIST inside the installed application?
 *
 *   node scripts/cifra-worker-electron.mjs
 *
 * The desktop bridge now delivers `criarWorkerDeCifra`, as the browser bridge
 * always did. The question that raises is not whether the code is there, that's
 * measured by `apps/client/src/renderer/bridge.paridade.test.ts`, but whether
 * the worker actually exists UNDER PACKAGED APPLICATION CONDITIONS, which are
 * not those of a tab:
 *
 *  - the page is loaded by `file://` (`loadFile`, in `main/index.ts`), and a
 *    `file://` document has opaque origin;
 *  - the security policy is that of the renderer's `index.html`, `script-src
 *    'self'` and `worker-src 'self' blob:`, because `file://` brings no headers
 *    and the header the main process sets doesn't govern anything there.
 *
 * **And the answer matters both ways.** A `criarWorkerDeCifra` that throws on
 * creation is WORSE than not existing: `cifraDeMediaEmFalta` then says this host
 * can cipher, the call enters via SFU, and cipher discovers mid-assembly that it
 * has nowhere to run. It's the bug from August 17, 2026 all over, the gate
 * promising what assembly doesn't deliver.
 *
 * What we measure, and why there are four things and not one:
 *
 *   engine          `createEncodedStreams` and `RTCRtpScriptTransform`, in both
 *                   prototypes. It's what `caminhoDaCifra` reads to choose, and
 *                   it's what says whether the worker is today's path or just the
 *                   safety net for when Chromium removes the API that never was
 *                   standard.
 *   worker by URL   the form that `vite` packages, and the form the bridge uses.
 *   worker from     the EMBEDDED form that `docs/PLANO_MOVEL.md` recommends for
 *   blob            mobile. Measured here to know if it would work here too,  *                   and the answer depends on the policy, which is the next thing.
 *   with and        two runs. Without policy, everything starts and the
 *   without CSP     measurement says nothing about the real application; with
 *                   the policy from `index.html`, it is the application. The
 *                   difference between the two columns is the entire value of
 *                   this script.
 *
 * And then that, the third run, which is the one that matters: **the worker that
 * the APPLICATION PACKAGES**, not a three-liner written for the bench. Loads the
 * `out/renderer/assets/cifra-worker-*.js` that `electron-vite` produced, from
 * where the application has it, and gives it a real-protocol command, install a
 * sender key, waiting for `pronto`. This proves what a synthetic worker can't: that
 * file loads as a module inside the sandbox, that its dependency tree (noble,
 * ts-mls, zod) evaluates in a worker scope under this policy, and that it responds
 * to what `CifraDeMedia` tells it.
 *
 * **Proven by mutation, not just green.** With the `cifra-worker-*.js` from `out/`
 * swapped for a file that loads and never responds, this bench says "no answer in
 * 4s" and exits 1. Without that half, a YES verdict would only prove the script ran.
 *
 * **What remains unproven, and is stated so it's not taken for proven:** whether
 * `RTCRtpScriptTransform` moves encrypted frames INSIDE Electron. That's measured
 * by `scripts/sfu-script-transform-por-motor.mjs`, which measured it on Chromium 151
 * (300 encrypted → 300 decrypted), the same engine this Electron is built from, but
 * measured in the browser, not here.
 *
 * Doesn't talk to any server, doesn't open any media, doesn't touch production, and
 * writes only to a temp folder and a file in the client's `out/`, which is build
 * output and deleted at the end.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const SAIDA_DO_RENDERER = join(RAIZ, "apps", "client", "out", "renderer")

/**
 * The renderer policy, copied from `apps/client/src/renderer/index.html`.
 *
 * Copied and not read from the file on purpose: if someone loosens it there, this
 * script keeps measuring against the policy we believe is being applied, and the
 * drift shows up as a measurement that stopped matching the application. A bench
 * that follows the thing it measures stops measuring it.
 */
const POLITICA = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
].join("; ")

const PASTA = mkdtempSync(join(tmpdir(), "enclave-cifra-worker-"))

/** The worker measured: responds to whatever is sent to it, and nothing else. */
const WORKER = "self.onmessage = (e) => { self.postMessage({ eco: e.data.eco, vivo: true }) }\n"

const PAGINA = (comPolitica) => `<!doctype html>
<html lang="pt"><head><meta charset="utf-8" />
${comPolitica ? `<meta http-equiv="Content-Security-Policy" content="${POLITICA}" />` : "<!-- sem politica -->"}
</head><body><script type="module" src="./pagina.js"></script></body></html>
`

const GUIAO = `
const resultados = {}

/**
 * Nascer não chega: tem de responder.
 *
 * Um worker que se constrói e nunca fala é indistinguível, do lado de fora, de
 * um que funciona — e é exactamente o que a cifra apanharia tarde de mais, com
 * o \`#ordenar\` a esgotar os cinco segundos dele por dentro da entrada na
 * chamada. Por isso conta-se a RESPOSTA.
 */
function medir(nome, fazer) {
  return new Promise((resolve) => {
    let worker
    try {
      worker = fazer()
    } catch (erro) {
      resultados[nome] = "atirou: " + erro.message
      return resolve()
    }
    const relogio = setTimeout(() => {
      resultados[nome] = "mudo (nasceu e nao respondeu)"
      resolve()
    }, 4000)
    worker.onerror = (erro) => {
      clearTimeout(relogio)
      resultados[nome] = "recusado: " + (erro.message || "sem mensagem")
      resolve()
    }
    worker.onmessage = (evento) => {
      clearTimeout(relogio)
      resultados[nome] = evento.data && evento.data.vivo ? "respondeu" : "resposta estranha"
      resolve()
    }
    try {
      worker.postMessage({ eco: 1 })
    } catch (erro) {
      clearTimeout(relogio)
      resultados[nome] = "postMessage atirou: " + erro.message
      resolve()
    }
  })
}

const temInsertable = (classe) =>
  typeof classe !== "undefined" && typeof classe.prototype.createEncodedStreams === "function"
const temTransform = (classe) => typeof classe !== "undefined" && "transform" in classe.prototype

resultados.motor = {
  insertableNoEmissor: temInsertable(typeof RTCRtpSender === "undefined" ? undefined : RTCRtpSender),
  insertableNoReceptor: temInsertable(typeof RTCRtpReceiver === "undefined" ? undefined : RTCRtpReceiver),
  scriptTransform: typeof RTCRtpScriptTransform,
  transformNoEmissor: temTransform(typeof RTCRtpSender === "undefined" ? undefined : RTCRtpSender),
  transformNoReceptor: temTransform(typeof RTCRtpReceiver === "undefined" ? undefined : RTCRtpReceiver),
}

const fonte = "self.onmessage=(e)=>{self.postMessage({eco:e.data.eco,vivo:true})}"
await medir("porUrl", () => new Worker(new URL("./worker.js", import.meta.url), { type: "module" }))
await medir("porBlob", () => new Worker(URL.createObjectURL(new Blob([fonte], { type: "text/javascript" }))))

resultados.origem = location.protocol
window.__medicao = resultados
`

const PRINCIPAL = `
const { app, BrowserWindow } = require("electron")
const path = require("node:path")
const pagina = process.argv[process.argv.length - 1]
app.on("ready", async () => {
  const janela = new BrowserWindow({ show: false, width: 200, height: 200 })
  const recusas = []
  janela.webContents.on("console-message", (...args) => {
    const mensagem = typeof args[1] === "string" ? args[1] : (args[0] && args[0].message) || ""
    if (String(mensagem).includes("Content Security Policy")) recusas.push(String(mensagem).split(".")[0])
  })
  await janela.loadFile(pagina)
  await new Promise((r) => setTimeout(r, 12000))
  const medicao = await janela.webContents.executeJavaScript("JSON.stringify(window.__medicao || null)")
  console.log("MEDICAO " + medicao)
  console.log("RECUSAS " + JSON.stringify(recusas))
  console.log("CHROMIUM " + process.versions.chrome + " ELECTRON " + process.versions.electron)
  app.exit(0)
})
`

/**
 * The page that interrogates the PACKAGED worker, written alongside it.
 *
 * Alongside and not in a temp folder: under `script-src 'self'` the worker must
 * be from the same origin as whoever creates it, and in `file://` that means the
 * same tree. Copying the file elsewhere would measure a copy; this measures the
 * file the application loads, where it loads it.
 */
/**
 * The page that interrogates the PACKAGED worker, written alongside it.
 *
 * Alongside and not in a temp folder: under `script-src 'self'` the worker must
 * be from the same origin as whoever creates it, and in `file://` that means the
 * same tree. Copying the file elsewhere would measure a copy; this measures the
 * file the application loads, where it loads it.
 *
 * **And the script goes in a separate file, not in a `<script>` in the middle of
 * the page.** `script-src 'self'` refuses inline scripts, and refuses them
 * silently, the first version of this bench said "measured nothing" and the
 * cause was this, not the worker. It's the same rule the application follows, and
 * following it is part of measuring it.
 */
const PAGINA_EMPACOTADO = `<!doctype html>
<html lang="pt"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${POLITICA}" />
</head><body><script type="module" src="./bancada-cifra-worker.js"></script></body></html>
`

const GUIAO_EMPACOTADO = (ficheiroDoWorker) => `
const resultados = {}
const worker = new Worker(new URL("./assets/${ficheiroDoWorker}", import.meta.url), { type: "module" })

/*
  Uma chave de emissor a sério: 16 bytes de chave + 12 de sal, que é o recorte
  que \`importSframeKey\` faz. Bytes fixos e não aleatórios — isto não guarda
  nada e não cifra frame nenhum, e uma chave reprodutível torna a bancada
  reprodutível.
*/
const material = new Uint8Array(28)
for (let i = 0; i < material.length; i++) material[i] = (i * 7 + 3) & 0xff

const respostas = new Map()
worker.onmessage = (evento) => {
  const resposta = evento.data
  const espera = respostas.get(resposta && resposta.eco)
  if (espera) { respostas.delete(resposta.eco); espera(resposta) }
}
worker.onerror = (erro) => {
  resultados.erro = "recusado: " + (erro.message || "sem mensagem")
  window.__medicao = resultados
}

function ordenar(ordem) {
  return new Promise((resolve) => {
    const relogio = setTimeout(() => { respostas.delete(ordem.eco); resolve(null) }, 4000)
    respostas.set(ordem.eco, (resposta) => { clearTimeout(relogio); resolve(resposta) })
    worker.postMessage(ordem)
  })
}

const pronto = await ordenar({ t: "emissor", eco: 1, chave: { keyId: 7, senderId: 3, material }, contador: 41 })
resultados.instalouChave = pronto && pronto.t === "pronto" ? "pronto" : "sem resposta em 4s"
const contagens = await ordenar({ t: "contar", eco: 2 })
resultados.contagens = contagens && contagens.t === "contagens" ? contagens.contagens : null
window.__medicao = resultados
`

const chunks = existsSync(join(SAIDA_DO_RENDERER, "assets"))
  ? readdirSync(join(SAIDA_DO_RENDERER, "assets")).filter((nome) => /^cifra-worker-.*\.js$/.test(nome))
  : []
if (chunks.length !== 1) {
  process.stderr.write(
    `Esperava um cifra-worker-*.js em apps/client/out/renderer/assets e encontrei ${chunks.length}.\n` +
      "Compilar primeiro: npm run build -w @enclave/client\n",
  )
  process.exit(1)
}
const PAGINA_DO_EMPACOTADO = join(SAIDA_DO_RENDERER, "bancada-cifra-worker.html")
const GUIAO_DO_EMPACOTADO = join(SAIDA_DO_RENDERER, "bancada-cifra-worker.js")

writeFileSync(join(PASTA, "worker.js"), WORKER)
writeFileSync(join(PASTA, "pagina.js"), GUIAO)
writeFileSync(join(PASTA, "com-politica.html"), PAGINA(true))
writeFileSync(join(PASTA, "sem-politica.html"), PAGINA(false))
writeFileSync(join(PASTA, "principal.cjs"), PRINCIPAL)
writeFileSync(PAGINA_DO_EMPACOTADO, PAGINA_EMPACOTADO)
writeFileSync(GUIAO_DO_EMPACOTADO, GUIAO_EMPACOTADO(chunks[0]))

/**
 * With a timeout, and the timeout is part of the measurement.
 *
 * An Electron window that won't open, missing binary, missing screen, hangs
 * forever and doesn't distinguish "didn't measure" from "measured wrong". A
 * timeout turns that into a verdict.
 */
function correr(pagina) {
  return new Promise((resolve) => {
    const filho = spawn(join(RAIZ, "node_modules", ".bin", "electron"), [join(PASTA, "principal.cjs"), pagina], {
      cwd: RAIZ,
      encoding: "utf8",
    })
    let saida = ""
    filho.stdout.on("data", (bloco) => (saida += bloco))
    filho.stderr.on("data", (bloco) => (saida += bloco))
    const relogio = setTimeout(() => {
      filho.kill("SIGKILL")
      resolve({ saida, prazo: true })
    }, 60_000)
    filho.on("close", () => {
      clearTimeout(relogio)
      resolve({ saida, prazo: false })
    })
  })
}

function ler(saida, marca) {
  const linha = saida.split("\n").find((cada) => cada.startsWith(marca + " "))
  return linha ? linha.slice(marca.length + 1) : null
}

/**
 * The entire measurement, inside a function.
 *
 * And not loose at the module level, for a reason that cost a run to discover:
 * **`process.exit()` doesn't run `finally` blocks**. With the exit in the middle
 * of the block, the two files this bench writes in `out/` would stay there after
 * it finished. Here we return the verdict, clean up, and only then pick the exit code.
 */
async function medirTudo() {
  const passagens = []
  for (const [nome, ficheiro] of [
    ["sem política", "sem-politica.html"],
    ["com a política do renderer", "com-politica.html"],
  ]) {
    const { saida, prazo } = await correr(join(PASTA, ficheiro))
    if (prazo) throw new Error(`${nome}: o Electron não respondeu em 60 s`)
    const medicao = ler(saida, "MEDICAO")
    if (!medicao || medicao === "null") throw new Error(`${nome}: a página não chegou a medir nada\n${saida}`)
    passagens.push({ nome, ...JSON.parse(medicao), recusas: JSON.parse(ler(saida, "RECUSAS") ?? "[]") })
    if (passagens.length === 1) process.stdout.write(`Chromium ${ler(saida, "CHROMIUM") ?? "?"}\n\n`)
  }

  const motor = passagens[0].motor
  process.stdout.write("O motor\n")
  process.stdout.write(`  createEncodedStreams   emissor ${motor.insertableNoEmissor} · receptor ${motor.insertableNoReceptor}\n`)
  process.stdout.write(`  RTCRtpScriptTransform  ${motor.scriptTransform} · emissor ${motor.transformNoEmissor} · receptor ${motor.transformNoReceptor}\n\n`)

  process.stdout.write("O worker, em file://\n")
  for (const passagem of passagens) {
    process.stdout.write(`  ${passagem.nome}\n`)
    process.stdout.write(`    por URL (a forma da ponte)   ${passagem.porUrl}\n`)
    process.stdout.write(`    de blob: (a forma embutida)  ${passagem.porBlob}\n`)
    for (const recusa of passagem.recusas) process.stdout.write(`    política: ${recusa}\n`)
  }

  /*
    And the real worker: what `electron-vite` produced, where the application
    has it. The two runs above measure whether ANY worker starts; this one
    measures whether THAT file holds a cipher that responds.
  */
  const { saida, prazo } = await correr(PAGINA_DO_EMPACOTADO)
  const empacotado = prazo ? null : JSON.parse(ler(saida, "MEDICAO") ?? "null")
  process.stdout.write(`\nO worker que a aplicação empacota (${chunks[0]})\n`)
  if (!empacotado) {
    process.stdout.write("  não chegou a medir nada\n")
  } else if (empacotado.erro) {
    process.stdout.write(`  ${empacotado.erro}\n`)
  } else {
    process.stdout.write(`  instalar uma chave de emissor   ${empacotado.instalouChave}\n`)
    process.stdout.write(`  contagens que devolve           ${JSON.stringify(empacotado.contagens)}\n`)
  }

  const nasce = passagens[1].porUrl === "respondeu"
  const responde = empacotado !== null && empacotado.instalouChave === "pronto"
  return nasce && responde
}

let veredicto = false
try {
  veredicto = await medirTudo()
} finally {
  rmSync(PASTA, { recursive: true, force: true })
  rmSync(PAGINA_DO_EMPACOTADO, { force: true })
  rmSync(GUIAO_DO_EMPACOTADO, { force: true })
}

process.stdout.write(
  veredicto
    ? "\nSIM: sob a política da aplicação empacotada o worker por URL nasce, e o worker desta aplicação instala uma chave\n"
    : "\nNÃO: a ponte da secretária não pode oferecer `criarWorkerDeCifra` nestas condições\n",
)
process.exitCode = veredicto ? 0 : 1
