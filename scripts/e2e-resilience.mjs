// The user's exact scenario, plus the two ways it used to rot:
//   A invites B (offline) into 2 feeds + 1 room → B connects → joins ALL,
//   with zero visible errors; duplicated welcomes in the queue must not error;
//   and a conversation must survive a server restart (deploy) by itself.
//
//   node scripts/e2e-resilience.mjs [server] [--restart]
//
// --restart needs ORWELL_SSH (user@host of the server) and, if needed,
// ORWELL_SSH_KEY. ORWELL_INFRA_DIR is the remote infra/ folder (default
// /opt/enclave/infra).
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { alvo } from "./ambiente.mjs"

const run = promisify(execFile)
const SERVER = alvo(process.argv[2])
const WITH_RESTART = process.argv.includes("--restart")

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

async function client(name) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(SERVER)
  const errors = []
  session.on("status", (event) => {
    if (event.level === "error") errors.push(event.detail)
  })
  await session.connect()
  console.log(`[${name}] ${identity.address}`)
  return { session, address: identity.address, errors }
}

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const a = await client("A")
const c = await client("C")
const b = await client("B")
// Murals are opaque (1.0 "Arca", D1): each account's is what it knows itself.
const sessoesPorEndereco = () => new Map([a, b, c].map((cliente) => [cliente.address, cliente.session]))
const feedOf = (address) => sessoesPorEndereco().get(address).feedChannel
// Opaque addresses: the 1.0 server does not debut rooms with names (slice 6a).
const room = moradaDeSala(parseServerName(SERVER))

// B disappears before any invite: the real case.
b.session.disconnect()
await new Promise((resolve) => setTimeout(resolve, 400))

await a.session.acceptFollower(b.address)
await c.session.acceptFollower(b.address)
await a.session.createSpaceChannel(room)
// `seat` and not `invite`: here what matters is that B has a seat before
// returning, and inviting no longer gives a seat, it sends a message and waits
// for the answer.
await a.session.seat(room, b.address)
await a.session.post("post do A em ausência", [])
await c.session.post("post do C em ausência", [])

const wants = [feedOf(a.address), feedOf(c.address), room]
const arrivals = wants.map((channel) =>
  waitFor(b.session, "channels", (e) => e.channels.includes(channel), `B entra em ${channel}`),
)
const seesA = waitFor(
  b.session,
  "message",
  (m) => m.payload.t === "post" && m.payload.caption === "post do A em ausência",
  "B vê o post de A",
)
await b.session.connect()

try {
  await Promise.all(arrivals)
  check("B entra nos 2 feeds + 1 sala ao ligar (todos offline no convite)", true)
} catch (error) {
  check("B entra nos 2 feeds + 1 sala ao ligar (todos offline no convite)", false, error.message)
}
try {
  await seesA
  check("posts publicados em ausência chegam", true)
} catch (error) {
  check("posts publicados em ausência chegam", false, error.message)
}
check(
  "convites duplicados não produzem erros visíveis",
  b.errors.length === 0,
  b.errors.length ? b.errors.join(" | ") : "nenhum erro",
)

// Reconnect: the queue redelivers, nothing can shout again.
b.errors.length = 0
b.session.disconnect()
await new Promise((resolve) => setTimeout(resolve, 300))
await b.session.connect()
await new Promise((resolve) => setTimeout(resolve, 2_500))
check("relogin com fila re-entregue continua silencioso", b.errors.length === 0, b.errors.join(" | "))

// --- The owner loses the mural and comes back to it without rebuilding it -------------------
/*
  This is what happens to those who clear storage or restore an old vault: the
  device loses the MLS group of its own mural. In 0.9 the owner rebuilt the channel
  with the same name (the server let them rebuild because the name was theirs), and
  everyone there had to migrate to the new group. In 1.0 "Arca" the address is
  opaque, the server does not let anyone rebuild (slice 6a), and whoever lost the
  group asks for a seat from whoever is there (`channel.rejoin.request`, slice 3): the
  group is the same, and B does nothing. forgetChannel deletes the local state,
  the same loss, on purpose.
*/
b.errors.length = 0
const muralDeA = feedOf(a.address)
await a.session.forgetChannel(muralDeA)
check("A esquece o próprio mural (o grupo sai deste aparelho)", !a.session.channels.includes(muralDeA))

const aVolta = waitFor(a.session, "channels", (e) => e.channels.includes(muralDeA), "A volta ao seu mural", 45_000)
await a.session.repairChannel(muralDeA)
try {
  await aVolta
  check("A pede lugar e B dá-lho: volta ao mesmo grupo, sem refundar", true)
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  const bLe = waitFor(
    b.session,
    "message",
    (m) => m.payload.t === "post" && m.payload.caption === "post depois de voltar",
    "B lê o mural de A depois de A voltar",
    45_000,
  )
  await a.session.post("post depois de voltar", [])
  await bLe
  check("B continua a ler o mural de A, sem ser convidado outra vez", true)
} catch (error) {
  check("A pede lugar e volta ao mural, e B continua a ler", false, error.message)
}
check("o regresso não gera erros visíveis em B", b.errors.length === 0, b.errors.join(" | "))

// --- Surviving a deploy -------------------------------------------
if (WITH_RESTART) {
  const conversation = room
  const heard = waitFor(
    b.session,
    "message",
    (m) => m.payload.t === "message" && m.payload.body === "depois do deploy",
    "B ouve A depois do restart",
    60_000,
  )
  a.errors.length = 0
  b.errors.length = 0

  console.log("… a reiniciar o servidor (docker compose up -d --build)")
  if (!process.env.ORWELL_SSH) throw new Error("--restart needs ORWELL_SSH (user@host)")
  const infra = process.env.ORWELL_INFRA_DIR ?? "/opt/enclave/infra"
  await run("ssh", [
    ...(process.env.ORWELL_SSH_KEY ? ["-i", process.env.ORWELL_SSH_KEY] : []),
    "-o",
    "BatchMode=yes",
    process.env.ORWELL_SSH,
    `cd ${infra} && docker compose up -d --build server >/dev/null 2>&1 && echo restarted`,
  ])

  // Clients reconnect on their own (backoff); we just wait.
  await new Promise((resolve) => setTimeout(resolve, 12_000))
  await a.session.send(conversation, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: "depois do deploy",
  })
  try {
    await heard
    check("conversa sobrevive ao deploy: reconexão automática + entrega", true)
  } catch (error) {
    check("conversa sobrevive ao deploy: reconexão automática + entrega", false, error.message)
  }
}

a.session.disconnect()
b.session.disconnect()
c.session.disconnect()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
