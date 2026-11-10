/**
 * The "We are looking for ambassadors" section and the /pt/embaixadores.html page, screenshot captured (Portuguese version; English has been at the root since 3/11/2026).
 *
 *   npm run build -w @enclave/site
 *   node scripts/retratar-embaixadores.mjs
 *
 * Serves the built `apps/site/dist` on a local port (8511) and takes four
 * screenshots at 1280 and 390 px: the section from the landing page and the entire page.
 * Also measures what can be measured without eyes: nothing exceeds the window width,
 * and the tribute zone shows the empty state message.
 *
 * Does not need a homeserver or the e2e server: the site connects to nothing.
 * Saves to `capturas/embaixadores-*.png`.
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const DIST = join(RAIZ, "apps/site/dist")
const DESTINO = join(RAIZ, "capturas")
// Above 8500, far from the e2e ports and other screenshot scripts.
const PORTA = 8511

if (!existsSync(join(DIST, "pt/embaixadores.html"))) {
  console.error("Falta o site construído. Corre `npm run build -w @enclave/site` primeiro.")
  process.exit(2)
}

const livre = await new Promise((resolve) => {
  const sonda = net.createServer()
  sonda.once("error", () => resolve(false))
  sonda.once("listening", () => sonda.close(() => resolve(true)))
  sonda.listen(PORTA, "127.0.0.1")
})
if (!livre) {
  console.error(`A porta ${PORTA} já tem dono. Este guião não mata processos de ninguém.`)
  process.exit(2)
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".woff2": "font/woff2",
}
const servidor = http.createServer((pedido, resposta) => {
  let caminho = normalize(decodeURIComponent((pedido.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "")
  if (caminho.endsWith("/")) caminho += "index.html"
  const ficheiro = join(DIST, caminho)
  if (!ficheiro.startsWith(DIST) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) {
    resposta.writeHead(404)
    resposta.end()
    return
  }
  resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream" })
  resposta.end(readFileSync(ficheiro))
})
await new Promise((resolve) => servidor.listen(PORTA, "127.0.0.1", resolve))

const resultados = []
function conferir(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

const browser = await chromium.launch()
try {
  for (const largura of [1280, 390]) {
    const pagina = await browser.newPage({ viewport: { width: largura, height: 900 }, deviceScaleFactor: 1 })
    const erros = []
    // The `frame-ancestors` warning in a <meta> tag is on all pages and is
    // well known: the directive only applies in an HTTP header, and the browser warns.
    // It does not come from this section. Everything else counts.
    pagina.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("'frame-ancestors'")) erros.push(m.text())
    })

    await pagina.goto(`http://127.0.0.1:${PORTA}/pt/`, { waitUntil: "networkidle" })
    await pagina.evaluate(() => document.fonts.ready)
    const seccao = pagina.locator("#embaixadores")
    await seccao.scrollIntoViewIfNeeded()
    await seccao.screenshot({ path: join(DESTINO, `embaixadores-seccao-${largura}.png`), animations: "disabled" })
    const larguraDaPagina = await pagina.evaluate(() => document.documentElement.scrollWidth)
    conferir(`homepage a ${largura}: nada passa da janela`, larguraDaPagina <= largura, `${larguraDaPagina} px`)
    const botao = await seccao.locator(".embaixadores-links a").first().getAttribute("href")
    conferir(`homepage a ${largura}: o botão leva à app`, botao === "/app/", botao ?? "sem href")

    await pagina.goto(`http://127.0.0.1:${PORTA}/pt/embaixadores.html`, { waitUntil: "networkidle" })
    await pagina.evaluate(() => document.fonts.ready)
    await pagina.screenshot({ path: join(DESTINO, `embaixadores-pagina-${largura}.png`), fullPage: true, animations: "disabled" })
    const larguraDaOutra = await pagina.evaluate(() => document.documentElement.scrollWidth)
    conferir(`página a ${largura}: nada passa da janela`, larguraDaOutra <= largura, `${larguraDaOutra} px`)
    const vazio = await pagina.locator("#tributo .tributo-vazio").textContent()
    conferir(`página a ${largura}: a zona de tributo diz a frase do vazio`, vazio === "Os primeiros nomes ficam aqui.")
    conferir(`a ${largura}: sem erros na consola`, erros.length === 0, erros.join(" | "))
    await pagina.close()
  }
} finally {
  await browser.close()
  servidor.close()
}

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações certas. Capturas em capturas/embaixadores-*.png`)
process.exit(falhas ? 1 : 0)
