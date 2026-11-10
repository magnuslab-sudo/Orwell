/** Serves pagina.html on 127.0.0.1, for the WKWebView to load over http. */
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const aqui = dirname(fileURLToPath(import.meta.url))
const porta = Number(process.argv[2] ?? 8931)

const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" }

createServer((pedido, resposta) => {
  const nome = new URL(pedido.url, "http://127.0.0.1").pathname.replace(/^\/+/, "") || "pagina.html"
  // One file from this folder only. Not a server: a test rig.
  if (nome.includes("/") || nome.includes("..")) { resposta.writeHead(403).end(); return }
  try {
    const corpo = readFileSync(join(aqui, nome))
    resposta.writeHead(200, { "Content-Type": TIPOS[nome.slice(nome.lastIndexOf("."))] ?? "text/plain" })
    resposta.end(corpo)
  } catch {
    resposta.writeHead(404).end()
  }
}).listen(porta, "127.0.0.1", () => console.log("a servir em http://127.0.0.1:" + porta + "/"))
