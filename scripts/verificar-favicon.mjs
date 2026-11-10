// Live favicon verification: what a browser receives, not what is in the
// repository.
//
// The bug this guards against does not show when reading files. The mark changed
// on August 13, the right SVG was in the repository since then, and in tabs of
// people who already visited it the eye stayed closed, because Chrome stores
// favicons in its own database indexed by the icon URL, and a URL that does not
// change is not revisited for days. "It is in the repository" and "it reaches
// someone's screen" are two different statements, and this measures the second.
//
// Builds both `dist`, serves them the way Caddy does, and does three things:
//   1. requests the icon by the URL the HTML declares (must return 200 and be SVG);
//   2. requests the OLD name, without fingerprint (must return 404, if it returned 200
//      there were two copies in the air and the old one would still be served to anyone
//      who has it in cache);
//   3. opens the page in a real Chrome and reads the `href` the DOM resolved, which
//      is what the favicon database will index.
//
// Usage:
//   node scripts/verificar-favicon.mjs            # builds and verifies
//   node scripts/verificar-favicon.mjs --sem-construir
import { execFileSync, spawn } from "node:child_process"
import { createReadStream, existsSync, readFileSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = fileURLToPath(new URL("..", import.meta.url))
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORTO = 5391

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

if (!process.argv.includes("--sem-construir")) {
  console.log("a construir os dois dist…")
  execFileSync("npm", ["run", "build", "-w", "@enclave/site"], { cwd: REPO, stdio: "inherit" })
  execFileSync("npm", ["run", "build", "-w", "@enclave/web"], { cwd: REPO, stdio: "inherit" })
  console.log("")
}

// The file server, with the same path split as `infra/Caddyfile`: the root is
// the public page, `/app/` is the app. Without that, the app's `./marca…svg`, // relative, and relative to `/app/`, would resolve to the wrong place and the
// verification would measure something production does not do.
const TIPOS = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript" }
const servidor = createServer((pedido, resposta) => {
  const caminho = decodeURIComponent(new URL(pedido.url, "http://x").pathname)
  const dentroDaApp = caminho.startsWith("/app/")
  const raiz = join(REPO, dentroDaApp ? "apps/web/dist" : "apps/site/dist")
  const relativo = normalize(dentroDaApp ? caminho.slice(4) : caminho).replace(/^(\.\.[/\\])+/, "")
  const ficheiro = join(raiz, relativo.endsWith("/") ? `${relativo}index.html` : relativo)
  if (!ficheiro.startsWith(raiz) || !existsSync(ficheiro)) {
    resposta.writeHead(404).end("não existe")
    return
  }
  resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream" })
  createReadStream(ficheiro).pipe(resposta)
})
await new Promise((resolve) => servidor.listen(PORTO, "127.0.0.1", resolve))
const base = `http://127.0.0.1:${PORTO}`

/** The `href` of the favicon declared in the served HTML, already resolved against the page. */
async function faviconDe(pagina) {
  const html = await (await fetch(`${base}${pagina}`)).text()
  const href = /<link rel="icon" href="([^"]+)"/.exec(html)?.[1]
  return href ? new URL(href, `${base}${pagina}`).toString() : null
}

// The design the repository has today: it is against this that we compare what
// the server delivers. Bytes against bytes, not "looks the same".
const noRepositorio = (() => {
  const publico = join(REPO, "apps/web/public")
  const nome = execFileSync("ls", [publico]).toString().split("\n").find((n) => n.startsWith("marca"))
  return { nome, svg: readFileSync(join(publico, nome), "utf8") }
})()

const paginas = ["/index.html", "/ambassadors.html", "/privacy.html", "/terms.html", "/pt/index.html", "/pt/embaixadores.html", "/pt/privacidade.html", "/pt/termos.html", "/app/index.html"]

for (const pagina of paginas) {
  const url = await faviconDe(pagina)
  if (!url) {
    check(`${pagina} declara um favicon`, false)
    continue
  }
  const resposta = await fetch(url)
  const corpo = await resposta.text()
  const nome = url.split("/").pop()
  check(
    `${pagina} → ${nome} servido a sério`,
    resposta.ok && resposta.headers.get("content-type")?.includes("svg"),
    `${resposta.status} ${resposta.headers.get("content-type")}`,
  )
  check(`${pagina} → e é o desenho que está no repositório`, corpo === noRepositorio.svg,
    corpo === noRepositorio.svg ? noRepositorio.nome : "o que se serve não é o que está em public/")
  check(`${pagina} → o nome traz a impressão`, /^marca\.[0-9a-f]{8}\.svg$/.test(nome ?? ""), nome)
}

// The old name must have disappeared from what is served. While it responds, a
// browser with the old copy in cache still has a point.
for (const antigo of [`${base}/marca.svg`, `${base}/app/marca.svg`]) {
  const resposta = await fetch(antigo)
  check(`o nome antigo já não existe (${new URL(antigo).pathname})`, resposta.status === 404, String(resposta.status))
}

// Real Chrome reading the page, because HTML that only passes through regex
// can be broken in ways regex doesn't see.
//
// The public page, not the app, on purpose: the app opens a WebSocket to the
// homeserver and keeps retrying when it doesn't respond, so loading never
// finishes and a `--dump-dom` hangs, we measured it, and it's 60 seconds of
// waiting for nothing, because `--virtual-time-budget` doesn't advance while
// there's network to resolve. The app's `./` resolution is already measured
// above, against the server.
if (existsSync(CHROME)) {
  // `spawn` not `spawnSync`, and this cost us a measurement to figure out: the
  // server that Chrome visits runs in THIS process, and `spawnSync` blocks the
  // event loop, the request arrives and nobody serves it. The symptom is Chrome
  // hanging waiting for a server that's waiting for Chrome.
  //
  // And `spawn` not `execFile` because this Chrome writes Google's updater logs
  // entirely to stderr and exits with a non-zero code because of it. What
  // matters is the DOM that came through stdout.
  const dom = await new Promise((resolve) => {
    const chrome = spawn(CHROME, ["--headless", "--disable-gpu", "--dump-dom", `${base}/index.html`])
    let saida = ""
    chrome.stdout.on("data", (pedaco) => (saida += pedaco))
    chrome.on("close", () => resolve(saida))
    setTimeout(() => chrome.kill(), 60_000).unref()
  })
  check("um Chrome verdadeiro lê a página e vê o favicon com impressão", dom.includes(`href="/${noRepositorio.nome}"`),
    /<link rel="icon"[^>]*>/.exec(dom)?.[0] ?? `sem link (${dom.length} bytes de DOM)`)
} else {
  console.log("(sem Chrome nesta máquina: a verificação do DOM ficou por fazer)")
}

servidor.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} passaram`)
process.exit(falhas === 0 ? 0 : 1)
