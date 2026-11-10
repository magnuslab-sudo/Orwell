// The real two-person case the always-online e2e never covered: A accepts a
// friendship / opens a DM while B is OFFLINE. B connects later and must still
// receive the welcome, join, and see the posts.
//
//   node scripts/e2e-offline-welcome.mjs [server]
import { Session, Vault } from "@enclave/client-core"
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

function waitFor(session, event, predicate, label, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
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
}

async function client(name) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(SERVER)
  await session.connect()
  console.log(`[${name}] ${identity.address}`)
  return { session, address: identity.address }
}

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const a = await client("A")
const b = await client("B")

// B disconnects BEFORE any invite. This is the real-world case.
b.session.disconnect()
await new Promise((resolve) => setTimeout(resolve, 500))

// A accepts B's friend request in absence: invites him to the feed and opens the DM.
await a.session.acceptFollower(b.address)
await a.session.post("publicado enquanto o B dormia", [])
const dm = await a.session.openDirect(b.address)
await a.session.sendFriendRequest(dm)

// B returns hours later (here: now).
// The board is opaque (1.0 "Arca", D1): A's board is what A knows.
const aFeed = a.session.feedChannel
const bFeedArrives = waitFor(
  b.session,
  "channels",
  (e) => e.channels.includes(aFeed),
  "B recebe o welcome do feed de A ao ligar",
)
const bDmArrives = waitFor(b.session, "channels", (e) => e.channels.includes(dm), "B recebe o welcome da DM")
const bSeesPost = waitFor(
  b.session,
  "message",
  (m) => m.payload.t === "post" && m.payload.caption === "publicado enquanto o B dormia",
  "B vê o post publicado em ausência",
)
const bSeesRequest = waitFor(
  b.session,
  "message",
  (m) => m.payload.t === "friend.request" && m.sender === a.address,
  "B recebe o pedido enviado em ausência",
)
await b.session.connect()

try {
  await bFeedArrives
  check("welcome do feed entregue ao ligar (destinatário estava offline)", true)
} catch (error) {
  check("welcome do feed entregue ao ligar (destinatário estava offline)", false, error.message)
}
try {
  await bDmArrives
  check("welcome da DM entregue ao ligar", true)
} catch (error) {
  check("welcome da DM entregue ao ligar", false, error.message)
}
try {
  await bSeesPost
  check("post publicado em ausência chegou (catch-up ao entrar)", true)
} catch (error) {
  check("post publicado em ausência chegou (catch-up ao entrar)", false, error.message)
}
try {
  await bSeesRequest
  check("pedido de amizade em ausência chegou", true)
} catch (error) {
  check("pedido de amizade em ausência chegou", false, error.message)
}

// B's reconnect does not duplicate anything: re-delivered welcomes are ignored.
b.session.disconnect()
await new Promise((resolve) => setTimeout(resolve, 300))
await b.session.connect()
await new Promise((resolve) => setTimeout(resolve, 2_000))
check(
  "reconnect com welcomes re-entregues não parte nada (idempotente)",
  b.session.channels.includes(aFeed) && b.session.channels.includes(dm),
)

a.session.disconnect()
b.session.disconnect()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
