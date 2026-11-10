// The user's shape of account, not a clean one: many channels and a pile of
// pending welcomes waiting at login. Reproduces the handshake window where a
// client that has not yet restored its vault is handed invitations it cannot
// possibly open.
//
//   node scripts/e2e-loaded-account.mjs [server]
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import { alvo } from "./ambiente.mjs"

const SERVER = alvo(process.argv[2])

class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(bytes) {
    this.bytes = bytes
  }
  async clear() {
    this.bytes = null
  }
}

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const waitFor = (session, event, predicate, label, timeoutMs = 30_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timeout: ${label}`))
    }, timeoutMs)
    const off = session.on(event, (payload) => {
      if (!predicate(payload)) return
      clearTimeout(timer)
      off()
      resolve(payload)
    })
  })

// Host with several channels, and the guest who will be invited to all of
// them while offline — the pile the real account has.
const hostVault = new Vault(new MemoryBackend())
await hostVault.create("frase")
const host = new Session(hostVault)
const hostId = await host.createIdentity(SERVER)
await host.connect()

const guestBackend = new MemoryBackend()
const guestVault = new Vault(guestBackend)
await guestVault.create("frase")
const guest = new Session(guestVault)
const guestId = await guest.createIdentity(SERVER)
await guest.connect()
console.log(`host ${hostId.address}\nguest ${guestId.address}`)

// The guest goes away, and a pile builds up: 6 channels + the host's feed.
guest.disconnect()
await new Promise((resolve) => setTimeout(resolve, 500))

const rooms = []
for (let i = 0; i < 6; i++) {
  const room = moradaDeSala(parseServerName(SERVER))
  await host.createSpaceChannel(room)
  // `seat` not `invite`: what we measure is the stack of welcomes waiting for
  // who comes back, and admission creates it. Inviting no longer admits anyone.
  await host.seat(room, guestId.address)
  rooms.push(room)
}
await host.acceptFollower(guestId.address)
await host.post("publicado antes do login do convidado", [])
// The board is opaque (1.0 "Arca", D1): the host's is what he knows.
const hostFeed = host.feedChannel

// The guest returns with a vault that must be restored before a single
// welcome can be opened — the exact window that was broken.
const status = []
guest.on("status", (event) => status.push(`${event.level ?? "info"}: ${event.detail}`))
let connectionState = "?"
guest.on("connection", (event) => {
  connectionState = event.state
})

const allArrive = Promise.all(
  [...rooms, hostFeed].map((channel) =>
    waitFor(guest, "channels", (e) => e.channels.includes(channel), `entra em ${channel}`, 40_000),
  ),
)
await guest.connect()

check("o handshake completa e a ligação fica online", connectionState === "online", connectionState)

try {
  await allArrive
  check("entra nos 7 canais que tinha à espera (6 salas + feed)", true)
} catch (error) {
  check("entra nos 7 canais que tinha à espera (6 salas + feed)", false, error.message)
}

const errors = status.filter((line) => line.startsWith("error"))
check("nenhum erro visível durante o login carregado", errors.length === 0, errors.slice(0, 2).join(" | "))

// And the crucial one: the pile must not be written off. A second login has
// to keep working, and posts must flow.
guest.disconnect()
await new Promise((resolve) => setTimeout(resolve, 500))
const seesPost = waitFor(
  guest,
  "message",
  (m) => m.payload.t === "post" && m.payload.caption === "publicado depois do relogin",
  "vê o post novo",
  40_000,
)
await guest.connect()
await new Promise((resolve) => setTimeout(resolve, 2_000))
await host.post("publicado depois do relogin", [])
try {
  await seesPost
  check("depois de relogin continua a ler o feed do host", true)
} catch (error) {
  check("depois de relogin continua a ler o feed do host", false, error.message)
}

host.disconnect()
guest.disconnect()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
