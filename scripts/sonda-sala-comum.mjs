/**
 * What can a brand-new account see of the public room?
 *
 * READ probe, read-only: creates an account, authenticates, and asks the
 * server three things it should not be able to ask about a room it never
 * joined, the encrypted history, the invites, and who is connected. Nothing
 * is written to any channel, precisely because writes are what would hurt the
 * people in there.
 *
 *   node scripts/sonda-sala-comum.mjs [server] [room]
 *   node scripts/sonda-sala-comum.mjs orwell.pt "!orwell:orwell.pt"
 *
 * The created account stays in the server; delete it later from `accounts`.
 */
import { generateIdentity, sign, toBase64, fromBase64 } from "@enclave/protocol"
import { WebSocket } from "ws"
import { alvo } from "./ambiente.mjs"

const SERVIDOR = alvo(process.argv[2])
const SALA = process.argv[3] ?? `!orwell:${SERVIDOR}`
const ESPERA_PRESENCA_MS = Number(process.argv[4] ?? 8000)

const identidade = generateIdentity(SERVIDOR)
/* `ws://` for local and `wss://` for everything else: a dev server speaks
   HTTP, and asking it for TLS gives an `EPROTO` that does not look anything
   like "target is wrong". */
const esquema = /^(localhost|127\.0\.0\.1|\[?::1)/.test(SERVIDOR) ? "ws" : "wss"
const socket = new WebSocket(`${esquema}://${SERVIDOR}/_enclave/gateway`)
const recebidos = []

const espera = (t, ms = 6000) =>
  new Promise((resolve) => {
    const fim = Date.now() + ms
    const olhar = () => {
      const achado = recebidos.find((f) => f.t === t)
      if (achado) return resolve(achado)
      if (Date.now() > fim) return resolve(null)
      setTimeout(olhar, 25)
    }
    olhar()
  })

const enviar = (frame) => socket.send(JSON.stringify(frame))

socket.on("message", (raw) => recebidos.push(JSON.parse(raw.toString("utf8"))))

await new Promise((resolve, reject) => {
  socket.once("open", resolve)
  socket.once("error", reject)
})

enviar({ t: "hello", version: 1 })
const hello = await espera("hello.ok")
console.log(`servidor    ${hello?.server}`)
console.log(`sala comum  ${hello?.commonRoom ?? "(nao anunciada)"}`)
console.log(`a sondar    ${SALA}`)
console.log(`conta nova  ${identidade.address}\n`)

enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
const desafio = await espera("auth.challenge")
if (!desafio) throw new Error("sem desafio")
enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
if (!(await espera("auth.ok"))) throw new Error("autenticacao recusada")
console.log("autenticado, sem convite nenhum e sem relacao nenhuma com a sala\n")

// 1. The encrypted history of the room.
enviar({ t: "channel.backfill", channel: SALA, afterSeq: -1, limit: 200 })
const pagina = await espera("channel.backfill.page")
console.log(
  pagina
    ? `LEITURA    ${pagina.events.length} eventos cifrados entregues (${pagina.events.reduce((n, e) => n + e.ciphertext.length, 0)} bytes), more=${pagina.more}`
    : "LEITURA    recusada",
)

// 2. The room invites. The server looks up by hash, and the hash comes here.
enviar({ t: "invite.list", channel: SALA })
const convites = await espera("invite.list.result")
console.log(
  convites ? `CONVITES   ${convites.invites.length} codigos entregues (usos: ${convites.invites.map((i) => i.uses).join(",") || "-"})` : "CONVITES   recusado",
)

// 3. Who is connected to the server, live now.
recebidos.length = 0
enviar({ t: "channel.subscribe", channels: [SALA] })
await new Promise((resolve) => setTimeout(resolve, ESPERA_PRESENCA_MS))
const presencas = recebidos.filter((f) => f.t === "presence")
const eventos = recebidos.filter((f) => f.t === "channel.event")
console.log(`PRESENCA   ${new Set(presencas.map((p) => p.address)).size} contas distintas anunciadas em ${ESPERA_PRESENCA_MS / 1000}s`)
console.log(`AO VIVO    ${eventos.length} eventos da sala recebidos sem ser membro`)

socket.close()
