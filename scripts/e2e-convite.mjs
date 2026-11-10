// Invite by address, with two real accounts against a real homeserver.
//
// One question only, asked several ways: does inviting put someone in the room? No.
// Does accepting put them in? Yes. What we measure here is not the state the app claims
// to have, it's the member list on both sides and what each one can read from the other.
//
//   node scripts/e2e-convite.mjs [servidor]
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"

const SERVER = process.argv[2] ?? "localhost:8452"

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

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Any text message, the kind the core exposes: `send`. */
const dizer = (session, channel, body) =>
  session.send(channel, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body,
    attachments: [],
    links: [],
    mentions: [],
  })

/** Wait for a message with this text, or give up after the timeout. */
function esperaTexto(session, corpo, label, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timeout: ${label}`))
    }, timeoutMs)
    const off = session.on("message", (message) => {
      if (message.payload.t !== "message" || !(message.payload.body ?? "").includes(corpo)) return
      clearTimeout(timer)
      off()
      resolve(message)
    })
  })
}

async function conta(nome) {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(SERVER)
  await session.connect()
  console.log(`[${nome}] ${identity.address}`)
  return { nome, session, address: identity.address, vault, backend }
}

/** Reload the app: fresh session over the same vault bytes. */
async function recarregar(quem) {
  quem.session.disconnect()
  await pausa(300)
  const vault = new Vault(quem.backend)
  await vault.unlock("frase-de-teste")
  const session = new Session(vault)
  session.loadIdentity()
  await session.restore()
  await session.connect()
  return { ...quem, session, vault }
}

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

let a = await conta("A")
let b = await conta("B")
let c = await conta("C")
await pausa(2_000)

// ---------------------------------------------------------------------------
// 1. Inviting does not put anyone in the room, and the invite arrives as a private message.
// ---------------------------------------------------------------------------

// An opaque room (1.0 "Arca"): the server with the cutoff gate refuses the old format.
const sala = moradaDeSala(parseServerName(SERVER))
await a.session.createSpaceChannel(sala)
await a.session.updateSpaceMeta(sala, { name: "Lagar do Zé" }).catch(() => {})
await pausa(500)

const conviteChega = esperaTexto(b.session, "Convido-te para", "o convite não chegou a B")
await a.session.invite(sala, b.address, "vem cá ver isto")
await pausa(2_500)

check("depois de convidar, a sala continua com um membro só", a.session.membersOf(sala).length === 1, `membros: ${a.session.membersOf(sala).length}`)
check("quem foi convidado NÃO está na sala", !b.session.channels.includes(sala))

let convite = null
try {
  convite = await conviteChega
  check("o convite chega como mensagem privada", true)
} catch (error) {
  check("o convite chega como mensagem privada", false, error.message)
}

check(
  "chega numa conversa directa, e não numa sala",
  // By id, not by name: the direct is an opaque address (1.0 "Arca").
  convite !== null && b.session.tipoDoCanal(convite.channel) === "directa",
  convite ? convite.channel : "sem mensagem",
)
check(
  "a mensagem leva o convite, e leva o nome da sala",
  convite?.payload.invite?.channel === sala && convite?.payload.invite?.name === "Lagar do Zé",
  JSON.stringify(convite?.payload.invite ?? null),
)
check("a nota de quem convidou viaja no corpo", (convite?.payload.body ?? "").includes("vem cá ver isto"))

const pendentes = b.session.pendingChannelInvites()
check("do lado de B o convite aparece por responder", pendentes.length === 1 && pendentes[0]?.target === sala)
check("do lado de A não aparece por responder: o convite é dele", a.session.pendingChannelInvites().length === 0)

// ---------------------------------------------------------------------------
// 2. Inviting twice does not create two invites or two slots.
// ---------------------------------------------------------------------------

await a.session.invite(sala, b.address).catch(() => {})
await a.session.invite(sala, b.address).catch(() => {})
await pausa(2_000)
check("convidar três vezes deixa UM convite", b.session.pendingChannelInvites().length === 1, `${b.session.pendingChannelInvites().length}`)
check("e a sala continua com um membro só", a.session.membersOf(sala).length === 1)

// ---------------------------------------------------------------------------
// 3. Accepting actually puts the person in, both ways.
// ---------------------------------------------------------------------------

const tie = b.session.pendingChannelInvites()[0]
/*
  Store it, not a convenience line.
  
  These three dereferences were bare, with the `check` above doing only a LOG
  of the failure. A late invite would throw `TypeError` and abort the whole run,   and what you read at the end was a JavaScript error, which looks nothing like
  "the invite never arrived". It hid the real cause during a whole investigation
  on August 13, 2026.
  */
if (!tie) {
  check("B tem o convite por responder", false, "nao chegou nenhum")
  console.error("\nSem convite nao ha nada a aceitar. O resto da corrida nao mede nada.")
  process.exit(1)
}
await b.session.acceptChannelInvite(tie.channel, tie.target)
await pausa(5_000)

check("depois de aceitar, a sala tem dois membros do lado de A", a.session.membersOf(sala).length === 2, `${a.session.membersOf(sala).length}`)
check("e B entrou mesmo: a sala está nos canais dele", b.session.channels.includes(sala))
check(
  "e B vê os dois membros, não só a si próprio",
  b.session.membersOf(sala).length === 2,
  `${b.session.membersOf(sala).length}`,
)
check("o convite deixa de estar por responder", b.session.pendingChannelInvites().length === 0)

// The only proof that matters: speak in the room and be read.
const bOuve = esperaTexto(b.session, "primeira coisa dita no lagar", "B não leu o que A disse na sala")
await dizer(a.session, sala, "primeira coisa dita no lagar")
try {
  await bOuve
  check("B lê o que se diz na sala", true)
} catch (error) {
  check("B lê o que se diz na sala", false, error.message)
}

const aOuve = esperaTexto(a.session, "e eu respondo", "A não leu o que B disse na sala")
await dizer(b.session, sala, "e eu respondo")
try {
  await aOuve
  check("e A lê o que B diz", true)
} catch (error) {
  check("e A lê o que B diz", false, error.message)
}

// ---------------------------------------------------------------------------
// 4. Declining gives no slot, and frees up the next invite.
// ---------------------------------------------------------------------------

const sala2 = moradaDeSala(parseServerName(SERVER))
await a.session.createSpaceChannel(sala2)
await pausa(500)
const recusaChega = esperaTexto(c.session, "Convido-te para", "o convite não chegou a C")
await a.session.invite(sala2, c.address)
await recusaChega.catch(() => {})
await pausa(1_500)

const conviteC = c.session.pendingChannelInvites()[0]
check("C tem o convite por responder", conviteC?.target === sala2)
if (!conviteC) {
  console.error("\nSem convite para C. O resto da corrida nao mede nada.")
  process.exit(1)
}
await c.session.declineChannelInvite(conviteC.channel, conviteC.target)
await pausa(3_000)

check("recusar não dá lugar nenhum", a.session.membersOf(sala2).length === 1, `${a.session.membersOf(sala2).length}`)
check("C continua fora da sala", !c.session.channels.includes(sala2))
check("o convite sai dos que esperam resposta", c.session.pendingChannelInvites().length === 0)
check(
  "e do lado de quem convidou fica RECUSADO, não pendente",
  [...a.session.channelInvites().values()].find((t) => t.target === sala2)?.state === "recusado",
)

// After a decline, inviting again is a fresh invite.
await a.session.invite(sala2, c.address)
await pausa(2_500)
check("depois de recusado, convidar outra vez volta a valer", c.session.pendingChannelInvites().length === 1)

// ---------------------------------------------------------------------------
// 5. Inviter offline: accepting waits, and the slot arrives when they return.
// ---------------------------------------------------------------------------

const sala3 = moradaDeSala(parseServerName(SERVER))
await a.session.createSpaceChannel(sala3)
await pausa(500)
await a.session.invite(sala3, b.address)
await pausa(2_500)
const conviteB3 = b.session.pendingChannelInvites().find((t) => t.target === sala3)
check("B recebe o convite para a terceira sala", conviteB3 !== undefined)

// A goes offline BEFORE the response arrives. This is the real-world case.
a.session.disconnect()
await pausa(500)
if (!conviteB3) {
  console.error("\nSem convite para a terceira sala. O resto da corrida nao mede nada.")
  process.exit(1)
}
await b.session.acceptChannelInvite(conviteB3.channel, conviteB3.target)
await pausa(3_000)
check("com quem convidou desligado, aceitar não mete ninguém lá dentro", !b.session.channels.includes(sala3))

// A comes back, and RELOADS the app, to prove the debt lives in the vault and
// not in a session's memory.
a = await recarregar(a)
await pausa(8_000)
check("quando quem convidou volta, o lugar é dado sozinho", a.session.membersOf(sala3).length === 2, `${a.session.membersOf(sala3).length}`)
check("e B entra mesmo, sem carregar em mais nada", b.session.channels.includes(sala3))

const bOuve3 = esperaTexto(b.session, "no celeiro também se fala", "B não leu o que A disse no celeiro")
await dizer(a.session, sala3, "no celeiro também se fala")
try {
  await bOuve3
  check("e lê o que lá se diz", true)
} catch (error) {
  check("e lê o que lá se diz", false, error.message)
}

// ---------------------------------------------------------------------------
// 6. The invite link still works. This is the path that works today.
// ---------------------------------------------------------------------------

const link = await a.session.createInvite(sala2)
// An https you click, with the fixed path and EVERYTHING else after the hash:
// neither the channel nor the code can appear in what the browser sends to the server.
const cunhado = typeof link === "string" ? new URL(link) : null
check(
  "o link é cunhado, em https e com o segredo só no fragmento",
  cunhado !== null &&
    /^https?:$/.test(cunhado.protocol) &&
    cunhado.pathname === "/app/convite" &&
    cunhado.search === "" &&
    /^#[^/]+\/[A-Za-z0-9_-]{32}$/.test(cunhado.hash),
  cunhado ? `${cunhado.origin}${cunhado.pathname}${cunhado.search}` : "não é texto",
)
await c.session.redeemInvite(link)
await pausa(6_000)
check("quem tem o link entra", c.session.channels.includes(sala2), `canais: ${c.session.channels.length}`)
check("e a sala do link passa a dois membros", a.session.membersOf(sala2).length === 2, `${a.session.membersOf(sala2).length}`)

const cOuve = esperaTexto(c.session, "na adega fala-se por link", "C não leu o que A disse na adega")
await dizer(a.session, sala2, "na adega fala-se por link")
try {
  await cOuve
  check("e lê o que lá se diz", true)
} catch (error) {
  check("e lê o que lá se diz", false, error.message)
}

console.log("")
const passaram = results.filter(Boolean).length
console.log(`${passaram}/${results.length} verificações passaram`)
process.exit(passaram === results.length ? 0 : 1)
