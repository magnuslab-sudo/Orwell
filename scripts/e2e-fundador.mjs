// Who controls a channel, with two real accounts against a real homeserver.
//
// A founds a channel, names it, sets a role, and invites B. Then we ask what
// B knows about the channel, and what B can do with what they know.
//
// That question does not have an offline answer: the founder entry
// (`room.created`) is published ONCE, at founding, in an epoch before any guest
// joins. For persistent secrecy, anyone who joins later never decrypts it. If
// nothing publishes it again, to B the channel has no owner, and "ownerless
// channel" used to mean "everyone can do anything": B could kick A, which is
// cryptographic and cannot be undone.
//
//   node scripts/e2e-fundador.mjs [server]
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"
import { webcrypto } from "node:crypto"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const SERVER = process.argv[2] ?? "localhost:8452"
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}

async function conta(nome) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  await session.createIdentity(SERVER)
  await session.updateProfile({ displayName: nome, donations: [] })
  session.on("status", (s) => {
    if (s.level === "error") console.log(`  [${nome} status ERRO] ${s.detail}`)
  })
  await session.connect()
  return { vault, session, address: session.identity.address }
}

/** Wait for the condition, or give up: delivery is async. */
async function ate(condicao, label, msMax = 20_000) {
  const fim = Date.now() + msMax
  while (Date.now() < fim) {
    if (condicao()) return true
    await pausa(200)
  }
  console.log(`  !! esgotou o tempo à espera de: ${label}`)
  return false
}

const falhas = []
const verificar = (ok, frase) => {
  console.log(`  ${ok ? "ok  " : "FALHA"} ${frase}`)
  if (!ok) falhas.push(frase)
}

const A = await conta("Alice")
const B = await conta("Bob")
console.log("A =", A.address)
console.log("B =", B.address)

// A founds the channel and arranges it BEFORE inviting. That is the order of
// things, and it puts everything describing the channel in an epoch B will
// never have. Opaque addresses: the 1.0 server does not debut rooms with a
// name (slice 6a).
const canal = moradaDeSala(parseServerName(SERVER))
await A.session.createSpaceChannel(canal)
await A.session.updateSpaceMeta(canal, { name: "Lagar do Zé" })
await A.session.defineRole(canal, { role: "porteiro", name: "Porteiro", powers: ["convidar"] })
await A.session.assignRoles(canal, B.address, ["porteiro"])
await pausa(500)
console.log("\nDepois de fundar:")
console.log("  A.founderOf    =", A.session.founderOf(canal))
console.log("  A.may expulsar =", A.session.may(canal, "expulsar"))

const r = await A.session.seat(canal, B.address)
console.log("\nseat(B) =>", r)
await ate(() => B.session.channels.includes(canal), "B entrar no canal")
console.log("B entrou?", B.session.channels.includes(canal))

await ate(() => B.session.founderOf(canal) !== null, "o registo de fundação chegar a B")
await pausa(1500) // let the rest of republishing settle

console.log("\n=== O QUE B SABE DO CANAL ===")
console.log("  B.founderOf        =", B.session.founderOf(canal))
console.log("  B.spaceMeta.name   =", B.session.spaceMeta(canal)?.name)
console.log("  B.rolesOf          =", B.session.rolesOf(canal).map((p) => p.name))
console.log("  B.rolesFor(B)      =", B.session.rolesFor(canal, B.address))
console.log("  B.powersOf(B)      =", B.session.powersOf(canal, B.address))
console.log("  B.mayManageRoles   =", B.session.mayManageRoles(canal))

verificar(B.session.founderOf(canal) === A.address, "B sabe que foi A quem fundou o canal")
verificar(B.session.spaceMeta(canal)?.name === "Lagar do Zé", "B vê o nome do canal")
verificar(B.session.rolesOf(canal).length === 1, "B vê o papel definido antes de entrar")
verificar(B.session.rolesFor(canal, B.address).join() === "porteiro", "B tem o papel que lhe deram")
verificar(B.session.powersOf(canal, B.address).join() === "convidar", "e só o que o papel dá")
verificar(B.session.may(canal, "expulsar") === false, "B não tem a responsabilidade de expulsar")
verificar(B.session.mayManageRoles(canal) === false, "B não gere papéis")

console.log("\n=== CONSEQUÊNCIA: B tenta expulsar o FUNDADOR A ===")
let recusou = false
try {
  await B.session.expel(canal, A.address)
  console.log("  >>> expel(A) NÃO lançou — B commitou a remoção de A")
} catch (e) {
  recusou = true
  console.log("  expel(A) recusado:", e.message)
}
verificar(recusou, "o núcleo de B recusa expulsar o fundador")

await pausa(1500)
console.log("  Membros vistos por A depois:", A.session.membersOf(canal))
verificar(A.session.membersOf(canal).includes(A.address), "A continua membro do canal que fundou")

// Real proof that the kick did not happen: A can still speak in the group. A
// committed removal would lock them out of the next epoch.
let enviou = true
try {
  await A.session.send(canal, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: "ainda cá estou",
    attachments: [],
    links: [],
    mentions: [],
  })
} catch (e) {
  enviou = false
  console.log("  A falhou a enviar:", e.message)
}
verificar(enviou, "A ainda fala no canal depois da tentativa")

A.session.disconnect()
B.session.disconnect()
await pausa(300)
console.log("")
if (falhas.length) {
  console.log(`VEREDICTO: ${falhas.length} falha(s).`)
  for (const f of falhas) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("VEREDICTO: o canal tem dono para quem chega, e o convidado não manda nele.")
process.exit(0)
