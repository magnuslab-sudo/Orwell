// Production smoke: two throwaway vaults against a live homeserver, walking
// the DM, voice-signalling, presence and friendship paths end to end.
// Nothing here is mocked — this is the same client-core the web app ships.
//
//   node scripts/e2e-dm.mjs [server]   (default: orwell.pt)
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

function waitFor(session, event, predicate, label, timeoutMs = 20_000) {
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
  console.log(`[${name}] ligado como ${identity.address}`)
  return { name, session, address: identity.address }
}

const results = []
function check(label, ok, detail = "") {
  results.push([label, ok])
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const a = await client("A")
const b = await client("B")

// --- DM: A opens, B is invited and enters -----------------------------------
await new Promise((r) => setTimeout(r, 3000)) // gives time for B to publish
// A direct is an opaque address (1.0 "Arca"): B recognizes it by the card, not by name.
const bGetsDm = waitFor(b.session, "channels", (e) => e.channels.some((c) => b.session.tipoDoCanal(c) === "directa"), "B entra na DM")
const dm = await a.session.openDirect(b.address)
check("A criou a DM determinística (opaca)", a.session.tipoDoCanal(dm) === "directa" && !dm.startsWith("!dm-"), dm)

// The case that failed in production: the friend request fired RIGHT after
// the invite, before B had processed the welcome. No catch-up on entry,
// it was lost until the next reconnect.
const bGetsEarlyRequest = waitFor(
  b.session,
  "message",
  (m) => m.payload.t === "friend.request" && m.sender === a.address,
  "B recebe o pedido imediato",
  25_000,
)
await a.session.sendFriendRequest(dm)

await bGetsDm
check("B recebeu o welcome e entrou na DM", b.session.channels.includes(dm))
try {
  await bGetsEarlyRequest
  check("pedido enviado logo após o convite chegou a B (catch-up ao entrar)", true)
} catch (error) {
  check("pedido enviado logo após o convite chegou a B (catch-up ao entrar)", false, error.message)
}

// --- Message: B speaks, A listens --------------------------------------------
const aHears = waitFor(a.session, "message", (m) => m.payload.t === "message" && m.payload.body === "olá do B", "A ouve B")
await b.session.send(dm, { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: "olá do B" })
await aHears
check("mensagem de B chegou a A pela DM", true)

// --- Voice signalling: A enters a call, B has to hear the join --------
const bHearsJoin = waitFor(b.session, "voice", (v) => v.payload.t === "voice.join" && v.from === a.address, "B ouve voice.join de A")
await a.session.send(dm, { t: "voice.join", at: Date.now(), video: false, sframe: true })
try {
  await bHearsJoin
  check("voice.join de A chegou a B (sinalização viva)", true)
} catch (error) {
  check("voice.join de A chegou a B (sinalização viva)", false, error.message)
}
const aHearsJoin = waitFor(a.session, "voice", (v) => v.payload.t === "voice.join" && v.from === b.address, "A ouve voice.join de B")
await b.session.send(dm, { t: "voice.join", at: Date.now(), video: false, sframe: true })
try {
  await aHearsJoin
  check("voice.join de B chegou a A (os dois sentidos)", true)
} catch (error) {
  check("voice.join de B chegou a A (os dois sentidos)", false, error.message)
}

// --- Presence: reconnecting B should notify A ---------------------------------
const aSeesOffline = waitFor(a.session, "presence", (p) => p.address === b.address && !p.online, "A vê B offline")
b.session.disconnect()
try {
  await aSeesOffline
  check("A viu B ficar offline (presença viva)", true)
} catch (error) {
  check("A viu B ficar offline (presença viva)", false, error.message)
}
const aSeesOnline = waitFor(a.session, "presence", (p) => p.address === b.address && p.online, "A vê B online")
await b.session.connect()
try {
  await aSeesOnline
  check("A viu B voltar (presença viva)", true)
} catch (error) {
  check("A viu B voltar (presença viva)", false, error.message)
}

// --- Friendship: B's request crosses A's and comes out as acceptance -------------
/*
  A already asked B for friendship (above, right after the invite). Since phase 1d,
  asking someone who already asked us is to accept (`sendFriendRequest`, "two
  crossed requests make friendship"): what reaches A is a `friend.accept`, not a
  second `friend.request` waiting for a reply. Until slice 6a, this step would wait
  for the request and stop here.
*/
const aGetsAccept = waitFor(
  a.session,
  "message",
  (m) => m.payload.t === "friend.accept" && m.sender === b.address,
  "A recebe a aceitação de B",
)
await b.session.sendFriendRequest(dm)
try {
  await aGetsAccept
  check("o pedido cruzado de B chegou a A como aceitação", true)
} catch (error) {
  check("o pedido cruzado de B chegou a A como aceitação", false, error.message)
}
const saoAmigos = (quem, outro) => quem.session.friendTies().get(outro.address)?.link === "amigos"
for (let volta = 0; volta < 40 && !(saoAmigos(a, b) && saoAmigos(b, a)); volta++) await new Promise((r) => setTimeout(r, 250))
check("A e B ficam amigos dos dois lados", saoAmigos(a, b) && saoAmigos(b, a))

// --- Circle: feeds flow both ways ----------------------------
// Friendship made. B should receive the welcome from A's feed.
// The walls are opaque (D1): each one knows theirs, and the other's comes in the profile.
const aFeed = a.session.feedChannel
const bFeed = b.session.feedChannel
try {
  if (!b.session.channels.includes(aFeed)) {
    await waitFor(b.session, "channels", (e) => e.channels.includes(aFeed), "B entra no feed de A")
  }
  check("B entrou no feed de A (aceitação convida)", true)
} catch (error) {
  check("B entrou no feed de A (aceitação convida)", false, error.message)
}
const bSeesPost = waitFor(b.session, "message", (m) => m.payload.t === "post" && m.payload.caption === "post do A", "B vê o post de A")
await a.session.post("post do A", [])
try {
  await bSeesPost
  check("post de A visível a B", true)
} catch (error) {
  check("post de A visível a B", false, error.message)
}

// Follow-back (what the Shell does on receiving friend.accept): B invites A.
await b.session.acceptFollower(a.address)
try {
  if (!a.session.channels.includes(bFeed)) {
    await waitFor(a.session, "channels", (e) => e.channels.includes(bFeed), "A entra no feed de B")
  }
  check("A entrou no feed de B (follow-back)", true)
} catch (error) {
  check("A entrou no feed de B (follow-back)", false, error.message)
}
/*
  A pause, and not excessive patience.

  B's feed channel appearing in A's channels says the welcome was ACCEPTED, not
  that the subscription is already active on the server side. Publishing in the
  next instant falls in that window: the event is written before there is anyone
  to receive it live, and the catch-up had already run.

  This is NOT a product defect. It was measured on 14 August 2026 with a minimal
  script that does the same sequence with two seconds in between, and the publish
  always arrives. It was the script running faster than any person ever would, and
  calling the script's speed a defect.
*/
await new Promise((r) => setTimeout(r, 2000))
const aSeesPost = waitFor(a.session, "message", (m) => m.payload.t === "post" && m.payload.caption === "post do B", "A vê o post de B")
await b.session.post("post do B", [])
try {
  await aSeesPost
  check("post de B visível a A (círculo completo)", true)
} catch (error) {
  check("post de B visível a A (círculo completo)", false, error.message)
}

a.session.disconnect()
b.session.disconnect()

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`)
process.exit(failed.length === 0 ? 0 : 1)
