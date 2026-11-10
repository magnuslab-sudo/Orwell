// Live verification of the preview finder: real server, real gateway, real
// authenticated account. A legitimate account requests addresses it should not
// reach, and what we measure is the refusal.
//
// Runs against a server already listening. Usage:
//   node scripts/verificar-ssrf.mjs [ws://127.0.0.1:8459/_enclave/gateway]
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
const autenticado = await proximo()
check("a conta autentica-se no gateway", autenticado.t === "auth.ok", autenticado.t)

/** Request a preview and return the response. */
async function pedir(url) {
  enviar({ t: "link.preview", url })
  let frame = await proximo()
  while (frame.t !== "link.preview.result") frame = await proximo()
  return frame
}

// ------------------------------------------------------ what must be refused
//
// Each of these is a different way to ask the server to reach where the
// requester cannot. The machine is shared with another site in production.
const proibidos = [
  ["o loopback em nome", "http://localhost:8459/_enclave/health"],
  ["o loopback em número", "http://127.0.0.1:8459/_enclave/health"],
  ["o loopback em IPv6", "http://[::1]:8459/_enclave/health"],
  ["o loopback disfarçado de IPv6", "http://[::ffff:127.0.0.1]:8459/_enclave/health"],
  ["os metadados de nuvem", "http://169.254.169.254/latest/meta-data/"],
  ["a rede privada", "http://192.168.1.1/"],
  ["outra rede privada", "http://10.0.0.1/"],
  ["o esquema file:", "file:///etc/passwd"],
  ["o esquema data:", "data:text/html,<title>ola</title>"],
  ["o esquema gopher:", "gopher://127.0.0.1:8459/_"],
]

for (const [rotulo, url] of proibidos) {
  const resposta = await pedir(url)
  check(`recusa ${rotulo}`, resposta.ok === false, resposta.ok ? "PASSOU!" : resposta.reason)
  // The refusal never says why in detail: the difference between "private",
  // "did not resolve" and "timed out" is a map of the internal network drawn from outside.
  if (resposta.ok === false) {
    check(
      `  e não conta o que encontrou lá dentro (${rotulo})`,
      !/privad|loopback|127\.|169\.254|ECONNREFUSED|ENOTFOUND/i.test(resposta.reason ?? ""),
      resposta.reason,
    )
  }
}

// ------------------------------------------------------------------- the limit
//
// Without a cap per account, this is a traffic amplifier with our IP.
const rajada = []
for (let i = 0; i < 25; i++) rajada.push(await pedir(`https://exemplo-inexistente-${i}.invalid/`))
check(
  "uma rajada esbarra no limite por conta",
  rajada.some((r) => r.reason === "demasiados pedidos"),
  `${rajada.filter((r) => r.reason === "demasiados pedidos").length} de 25 travados`,
)

socket.close()
console.log(`\n${resultados.filter(Boolean).length}/${resultados.length}`)
process.exit(resultados.every(Boolean) ? 0 : 1)
