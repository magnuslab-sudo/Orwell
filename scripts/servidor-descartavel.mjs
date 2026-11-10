/**
 * A disposable homeserver and the front that acts as Caddy, in one place.
 *
 * The scripts from phase 7 (interoperability) all need the same setup that
 * `e2e-emparelhar.mjs` writes by hand: a server in a temp folder, with a common
 * room, and a front that serves `apps/web/dist` at `/app/` and passes the rest
 * (HTTP and WebSocket) to the server. Copying it five times was a guarantee
 * that one day one copy would drift from the others.
 *
 * LOCAL BY CONSTRUCTION: listens at 127.0.0.1, with ports requested by the
 * caller, and the server name is `localhost:<porta da frente>`. No way for this to point at
 * production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { tmpdir } from "node:os"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

export const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const DIST_WEB = join(RAIZ, "apps/web/dist")

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm" }

export async function portaLivre(porta) {
  return new Promise((resolve) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolve(false))
    sonda.once("listening", () => sonda.close(() => resolve(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}

/**
 * @param {{ frente: number, servidor: number, sfu?: number, dist?: string, servidorJs?: string, etiqueta?: string }} ports
 *   `sfu` runs the SFU on that port (production runs with it; without it calls are
 *   mesh, two different paths). `dist` serves OTHER web at `/app/`, and `servidorJs`
 *   runs another server (the cross-version script uses both for 0.8.0 built from an
 *   earlier commit). `distAntiga` serves a SECOND web at the same origin, for
 *   clients with the `orwell-dist=antiga` cookie: an old and new client on the
 *   same server, same name (origin is the same, name comes from it). Without
 *   `distAntiga`, nothing changes.
 */
export async function levantarServidor({ frente: PORTA_DA_FRENTE, servidor: PORTA_DO_SERVIDOR, sfu = 0, dist = DIST_WEB, distAntiga = null, servidorJs = SERVIDOR_JS, etiqueta = "fase7" }) {
  for (const [o_que, caminho] of [["a web construída", join(dist, "index.html")], ["o servidor construído", servidorJs], ...(distAntiga ? [["a web antiga", join(distAntiga, "index.html")]] : [])]) {
    if (!existsSync(caminho)) throw new Error(`Falta ${o_que}: ${caminho}. Corre \`npm run build\` primeiro.`)
  }
  for (const porta of [PORTA_DA_FRENTE, PORTA_DO_SERVIDOR]) {
    if (!(await portaLivre(porta))) throw new Error(`A porta ${porta} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
  }
  const NOME = `localhost:${PORTA_DA_FRENTE}`
  const dados = mkdtempSync(join(tmpdir(), `orwell-${etiqueta}-`))
  const filho = spawn(process.execPath, [servidorJs], {
    env: {
      ...process.env,
      ENCLAVE_DATA_DIR: dados,
      ENCLAVE_SERVER_NAME: NOME,
      ENCLAVE_BIND_HOST: "127.0.0.1",
      ENCLAVE_BIND_PORT: String(PORTA_DO_SERVIDOR),
      ENCLAVE_COMMUNITY_MODE: "true",
      ENCLAVE_COMMON_ROOM: `!orwell:${NOME}`,
      ...(sfu ? { ENCLAVE_SFU_PORT: String(sfu), ENCLAVE_SFU_ANNOUNCED_IP: "127.0.0.1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const registo = { texto: "" }
  filho.stdout.on("data", (bocado) => (registo.texto += bocado))
  filho.stderr.on("data", (bocado) => (registo.texto += bocado))

  const frente = http.createServer((pedido, resposta) => {
    const caminho = (pedido.url ?? "/").split("?")[0]
    if (caminho.startsWith("/app")) {
      const relativo = normalize(decodeURIComponent(caminho.slice("/app".length))).replace(/^(\.\.[/\\])+/, "")
      const raiz = distAntiga && /(?:^|;\s*)orwell-dist=antiga(?:;|$)/.test(pedido.headers.cookie ?? "") ? distAntiga : dist
      let ficheiro = join(raiz, relativo)
      if (!ficheiro.startsWith(raiz) || !existsSync(ficheiro) || statSync(ficheiro).isDirectory()) ficheiro = join(raiz, "index.html")
      resposta.writeHead(200, { "content-type": TIPOS[extname(ficheiro)] ?? "application/octet-stream", "cache-control": "no-cache" })
      resposta.end(readFileSync(ficheiro))
      return
    }
    const adiante = http.request({ host: "127.0.0.1", port: PORTA_DO_SERVIDOR, path: pedido.url, method: pedido.method, headers: pedido.headers }, (vinda) => {
      resposta.writeHead(vinda.statusCode ?? 502, vinda.headers)
      vinda.pipe(resposta)
    })
    adiante.on("error", () => {
      resposta.writeHead(502)
      resposta.end()
    })
    pedido.pipe(adiante)
  })
  frente.on("upgrade", (pedido, socket, cabeca) => {
    const destino = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
      const linhas = [`${pedido.method} ${pedido.url} HTTP/${pedido.httpVersion}`]
      for (let i = 0; i < pedido.rawHeaders.length; i += 2) linhas.push(`${pedido.rawHeaders[i]}: ${pedido.rawHeaders[i + 1]}`)
      destino.write(`${linhas.join("\r\n")}\r\n\r\n`)
      if (cabeca.length) destino.write(cabeca)
      socket.pipe(destino).pipe(socket)
    })
    destino.on("error", () => socket.destroy())
    socket.on("error", () => destino.destroy())
  })
  await new Promise((resolve) => frente.listen(PORTA_DA_FRENTE, "127.0.0.1", resolve))

  let dePe = false
  for (let volta = 0; volta < 60 && !dePe; volta++) {
    dePe = await new Promise((resolve) => {
      const sonda = net.connect(PORTA_DO_SERVIDOR, "127.0.0.1", () => {
        sonda.destroy()
        resolve(true)
      })
      sonda.on("error", () => resolve(false))
    })
    if (!dePe) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const fechar = () => {
    frente.close()
    filho.kill()
    rmSync(dados, { recursive: true, force: true })
  }
  if (!dePe) {
    fechar()
    throw new Error("O homeserver não arrancou:\n" + registo.texto.slice(-2000))
  }
  return {
    NOME,
    APP: `http://${NOME}/app/?lingua=pt`,
    dados,
    base: join(dados, "enclave.sqlite"),
    registo,
    fechar,
  }
}
