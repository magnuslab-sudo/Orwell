// Production probe for the key-package claim chain: pool size, depletion
// behaviour, and concurrent claims, the three ways "timeout waiting for
// keypackage.claimed" used to happen.
//
//   node scripts/e2e-claims.mjs [server]   (default: orwell.pt)
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
const victim = await client("V")
// V publishes the pool on connect and disappears: no keypackage.low, no refill.
victim.session.disconnect()

// --- Concurrency: three invites at once, none can timeout ----
// `seat` not `invite`: what is measured here is the key-package reserve, which
// is spent at ADMISSION. Inviting no longer seats anyone, it sends a message, // and that path does not reach this mechanism.

// Opaque addresses: the 1.0 server does not debut rooms with names (slice 6a).
const room = () => moradaDeSala(parseServerName(SERVER))
const three = [room(1), room(2), room(3)]
for (const r of three) await a.session.createSpaceChannel(r)
try {
  await Promise.all(three.map((r) => a.session.seat(r, victim.address)))
  check("3 convites concorrentes resolvem todos (fila de waiters)", true)
} catch (error) {
  check("3 convites concorrentes resolvem todos (fila de waiters)", false, error.message)
}

// --- Depletion: drain the pool to the end and see the right error ------------
let consumed = 3 // the three above
let finalError = null
for (let i = 0; i < 30; i++) {
  const r = room(100 + i)
  await a.session.createSpaceChannel(r)
  try {
    await a.session.seat(r, victim.address)
    consumed++
  } catch (error) {
    finalError = error.message
    break
  }
}
console.log(`pool consumido: ${consumed} key packages até esgotar`)
check("esgotar o pool dá erro claro e acionável, nunca timeout", finalError === "that person has no invite keys", finalError ?? "nunca esgotou")
check("o erro não é o timeout mudo", finalError !== "the server did not answer in time", finalError ?? "")

// --- Malformed address: immediate response, not silence ------------------
const bad = room()
await a.session.createSpaceChannel(bad)
const started = Date.now()
try {
  await a.session.seat(bad, "@endereço com espaços:!!")
  check("convite para endereço malformado falha", false, "não devia ter passado")
} catch (error) {
  const seconds = (Date.now() - started) / 1000
  check(
    "endereço malformado responde depressa com erro claro",
    seconds < 8 && error.message !== "the server did not answer in time",
    `${seconds.toFixed(1)}s — ${error.message.slice(0, 70)}`,
  )
}

a.session.disconnect()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
