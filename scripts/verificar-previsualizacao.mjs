// The resulting path: a real page from the Internet, read by the real server,
// with the title and image reaching the client. It complements
// `verificar-ssrf.mjs`, which measures the refusals.
import { fromBase64, generateIdentity, parseServerName, sign, toBase64, PROTOCOL_VERSION } from "@enclave/protocol"

const GATEWAY = process.argv[2] ?? "ws://127.0.0.1:8459/_enclave/gateway"
const HOME = parseServerName(process.argv[3] ?? "127.0.0.1:8459")

const resultados = []
const check = (rotulo, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

const identity = generateIdentity(HOME)
const socket = new WebSocket(GATEWAY)
const fila = []
const espera = []
socket.onmessage = (evento) => {
  const frame = JSON.parse(evento.data)
  const quem = espera.shift()
  if (quem) quem(frame)
  else fila.push(frame)
}
const proximo = () =>
  fila.length > 0 ? Promise.resolve(fila.shift()) : new Promise((resolve) => espera.push(resolve))
const enviar = (frame) => socket.send(JSON.stringify(frame))

await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

enviar({ t: "hello", version: PROTOCOL_VERSION })
await proximo()
enviar({ t: "auth.begin", address: identity.address, signingKey: toBase64(identity.signingPublicKey) })
const desafio = await proximo()
enviar({ t: "auth.finish", signature: toBase64(sign(identity, fromBase64(desafio.nonce))) })
await proximo()

async function pedir(url) {
  enviar({ t: "link.preview", url })
  let frame = await proximo()
  while (frame.t !== "link.preview.result") frame = await proximo()
  return frame
}

// example.com: small, stable, and with a `<title>` that has not changed in years.
const simples = await pedir("https://example.com/")
check("lê uma página real e traz o título", simples.ok === true && Boolean(simples.title), simples.title ?? simples.reason)

// A page with Open Graph for real, including an image.
const comOg = await pedir("https://developer.mozilla.org/en-US/docs/Web/HTML")
check("traz o Open Graph de uma página que o declara", comOg.ok === true && Boolean(comOg.title), comOg.title ?? comOg.reason)
check(
  "a imagem vem em bytes e não em endereço",
  !comOg.image || comOg.image.startsWith("data:image/"),
  comOg.image ? `${comOg.image.slice(0, 30)}… (${comOg.image.length} caracteres)` : "sem imagem",
)
check("o nome do sítio também vem", Boolean(comOg.siteName || comOg.description), comOg.siteName ?? comOg.description ?? "")

// An address that does not exist fails cleanly, without hanging anything.
const inexistente = await pedir("https://sitio-que-nao-existe-de-todo-97531.invalid/")
check("um endereço que não resolve falha limpo", inexistente.ok === false, inexistente.reason)

socket.close()
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length}`)
process.exit(resultados.every(Boolean) ? 0 : 1)
