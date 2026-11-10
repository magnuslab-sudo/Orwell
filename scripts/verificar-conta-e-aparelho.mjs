// Create account, join a channel, speak, reload, reconnect, with two real
// accounts against a real server.
//
// This is Phase 0 multi-device verification: the account now has two keys
// (account and device) and the MLS leaf now carries the full chain instead of
// the text address. None of this shows from outside, and that is what we prove
// here, plus three more facts that the phase adds and only show internally:
//
//   1. reopening the app returns THE SAME device (already-published leaves are
//      signed by it);
//   2. the address is still the digest of the ACCOUNT key;
//   3. the server stores up to four device records per account (since September 22,
//      2026; it was one, refreshed on each login). This script exercises one device; the four
//      and rotation are tested by `scripts/e2e-aparelhos.mjs` against a throwaway server.
//
//   node scripts/verificar-conta-e-aparelho.mjs [servidor]
import { Session, Vault } from "@enclave/client-core"
import { accountIdFromSigningKey, moradaDeSala, parseAddress, parseServerName } from "@enclave/protocol"

const SERVER = process.argv[2] ?? "localhost:8471"

/** An in-memory vault whose bytes can be handed to a new session. */
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

let passou = 0
let falhou = 0
function check(rotulo, ok, detalhe = "") {
  if (ok) {
    passou++
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou++
    console.log(`FAIL  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
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

async function novaConta(nome) {
  const backend = new MemoryBackend()
  const vault = new Vault(backend)
  await vault.create("frase-de-verificacao")
  const session = new Session(vault)
  const identity = await session.createIdentity(SERVER)
  const erros = []
  session.on("status", (e) => {
    if (e.level === "error") erros.push(e.detail)
  })
  await session.connect()
  console.log(`[${nome}] ${identity.address}`)
  return { backend, vault, session, identity, erros }
}

// --- 1. Criar conta ---------------------------------------------------------
const a = await novaConta("A")
const b = await novaConta("B")

check(
  "o endereço é o resumo da chave de CONTA, e não da do aparelho",
  parseAddress(a.identity.address).localPart === accountIdFromSigningKey(a.identity.signingPublicKey) &&
    parseAddress(a.identity.address).localPart !== accountIdFromSigningKey(a.identity.deviceSigningPublicKey),
)

// --- 2. Join a channel and speak -------------------------------------------
// Opaque addresses: the 1.0 server does not launch rooms with names (shard 6a).
const sala = moradaDeSala(parseServerName(SERVER))
await a.session.createSpaceChannel(sala)

// `seat` not `invite`: here we care that B gets a seat, not the invite message
// flow, that is what `e2e-convite.mjs` verifies.
const entrou = waitFor(b.session, "channels", () => b.session.channels.includes(sala), "B entra na sala", 60_000)
await a.session.seat(sala, b.identity.address)
try {
  await entrou
  check("B entra na sala onde lhe deram lugar", true)
} catch (error) {
  check("B entra na sala onde lhe deram lugar", false, error.message)
}

const ouvido = waitFor(
  b.session,
  "message",
  (m) => m.payload.t === "message" && m.payload.body === "antes de recarregar",
  "B ouve A",
  30_000,
)
await a.session.send(sala, {
  t: "message",
  id: crypto.randomUUID(),
  sentAt: Date.now(),
  body: "antes de recarregar",
})
let recebida = null
try {
  recebida = await ouvido
  check("A fala e B ouve", true)
} catch (error) {
  check("A fala e B ouve", false, error.message)
}

// Authorship does not come in the payload: it is read from the tree, leaf by leaf,
// and the tree now carries the chain instead of the text address. If the address came
// out wrong, the message would arrive under someone else's name, or nobody's.
check(
  "a mensagem chega com o endereço de quem a escreveu",
  recebida?.sender === a.identity.address,
  `${recebida?.sender}`,
)

// --- 3. Recarregar ----------------------------------------------------------
a.session.disconnect()

const cofreRecarregado = new Vault(a.backend)
await cofreRecarregado.unlock("frase-de-verificacao")
const recarregada = new Session(cofreRecarregado)
const relida = recarregada.loadIdentity()
const errosDepois = []
recarregada.on("status", (e) => {
  if (e.level === "error") errosDepois.push(e.detail)
})

check("o endereço sobrevive ao recarregar", relida.address === a.identity.address)
check(
  "o MESMO aparelho sobrevive ao recarregar",
  Buffer.from(relida.deviceSigningPublicKey).equals(Buffer.from(a.identity.deviceSigningPublicKey)),
)
check(
  "a credencial é byte a byte a mesma",
  Buffer.from(relida.credential.signature).equals(Buffer.from(a.identity.credential.signature)),
)
check("o histórico do canal sobrevive ao recarregar", recarregada.history(sala).length > 0)

// --- 4. Reconectar ----------------------------------------------------------
await recarregada.connect()

const ouvidoDepois = waitFor(
  b.session,
  "message",
  (m) => m.payload.t === "message" && m.payload.body === "depois de recarregar",
  "B ouve A depois do recarregar",
  30_000,
)
await recarregada.send(sala, {
  t: "message",
  id: crypto.randomUUID(),
  sentAt: Date.now(),
  body: "depois de recarregar",
})
try {
  await ouvidoDepois
  check("depois de reconectar, A fala e B continua a ouvir", true)
} catch (error) {
  check("depois de reconectar, A fala e B continua a ouvir", false, error.message)
}

const respondido = waitFor(
  recarregada,
  "message",
  (m) => m.payload.t === "message" && m.payload.body === "e eu respondo",
  "A ouve B",
  30_000,
)
await b.session.send(sala, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "e eu respondo" })
try {
  await respondido
  check("e ouve o outro lado", true)
} catch (error) {
  check("e ouve o outro lado", false, error.message)
}

// --- 5. Safety numbers ------------------------------------------------------
// The number is read aloud and compared: it must be the same on both sides.
const naA = recarregada.safetyNumberFor(sala, b.identity.address)
const noB = b.session.safetyNumberFor(sala, a.identity.address)
check("o safety number é o mesmo nas duas pontas", naA !== null && naA === noB, `${naA} vs ${noB}`)

// --- 6. No visible error ---------------------------------------------------
check("nenhum erro visível em A", a.erros.length === 0 && errosDepois.length === 0, [...a.erros, ...errosDepois].join(" | "))
check("nenhum erro visível em B", b.erros.length === 0, b.erros.join(" | "))

recarregada.disconnect()
b.session.disconnect()

console.log(`\n${passou}/${passou + falhou} verificações passaram`)
process.exit(falhou === 0 ? 0 : 1)
