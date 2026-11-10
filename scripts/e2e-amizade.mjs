// Mutual friendship, with two real accounts, against a real homeserver.
//
// Friendship cannot be proven alone: it is proven with two. What we measure
// here is not the state the app claims to have, it is the only state that
// matters, who can decrypt what the other publishes. Each check goes through
// a real publish that arrives, or does not arrive, on the other side.
//
//   node scripts/e2e-amizade.mjs [server]
import { Session, Vault } from "@enclave/client-core"

const SERVER = process.argv[2] ?? "localhost:8448"

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

/** Wait for a publish with this text, or give up after the time runs out. */
function esperaPost(session, caption, label, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`timeout: ${label}`))
    }, timeoutMs)
    const off = session.on("message", (message) => {
      if (message.payload.t !== "post" || message.payload.caption !== caption) return
      clearTimeout(timer)
      off()
      resolve(message)
    })
  })
}

/**
 * The question that matters, asked backwards: a publish that MUST NOT arrive.
 * You can only answer by waiting, and that is why these checks are expensive.
 * Worth it: this is where you see if a cut was really a cut.
 */
async function naoChega(session, caption, janelaMs = 6_000) {
  try {
    await esperaPost(session, caption, "não devia chegar", janelaMs)
    return false
  } catch {
    return true
  }
}

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function conta(nome) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  const identity = await session.createIdentity(SERVER)
  await session.connect()
  await session.ensureFeed()
  console.log(`[${nome}] ${identity.address}`)
  return { nome, session, address: identity.address, vault }
}

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const a = await conta("A")
const b = await conta("B")
const c = await conta("C")
const d = await conta("D")

// ---------------------------------------------------------------------------
// 1. A request, an accept, and the link both ways.
// ---------------------------------------------------------------------------

const dmAB = await a.session.openDirect(b.address)
await a.session.sendFriendRequest(dmAB, "vamos ser amigos")
await pausa(1_500)

check(
  "o pedido chega ao outro lado e fica por responder",
  b.session.openFriendRequests().some((tie) => tie.peer === a.address),
)
check(
  "quem pediu vê o seu pedido como enviado, não como amizade",
  a.session.friendTies().get(b.address)?.link === "pedido-enviado",
)

// ONE accept. This is the whole act.
await b.session.acceptFriend(dmAB, a.address)
await pausa(3_000)

check("depois de aceitar, o pedido deixa de estar por responder", b.session.openFriendRequests().length === 0)
check('os dois lados dizem "amigos"', a.session.friendTies().get(b.address)?.link === "amigos" && b.session.friendTies().get(a.address)?.link === "amigos")

// And now the only proof that matters: publish and be read.
const aVeDeB = esperaPost(a.session, "publicação do B")
const bVeDeA = esperaPost(b.session, "publicação do A")
await a.session.post("publicação do A")
await b.session.post("publicação do B")

try {
  await bVeDeA
  check("B lê o que A publica", true)
} catch (error) {
  check("B lê o que A publica", false, error.message)
}
try {
  await aVeDeB
  check("A lê o que B publica (a metade que antes exigia um segundo acto)", true)
} catch (error) {
  check("A lê o que B publica (a metade que antes exigia um segundo acto)", false, error.message)
}

// ---------------------------------------------------------------------------
// 2. Accept from someone who requested while OFFLINE, the cost of the chosen
//    path, and the proof that it pays for itself at the next connection.
// ---------------------------------------------------------------------------

const dmAC = await a.session.openDirect(c.address)
await a.session.sendFriendRequest(dmAC)
await pausa(1_500)

a.session.disconnect()
await pausa(500)

// C accepts with A offline. C gives up their slot at once; the return slot
// cannot be given by anyone but A's device.
await c.session.acceptFriend(dmAC, a.address)
await c.session.post("publicado enquanto o A estava fora")
await pausa(1_000)

const aVeDeC = esperaPost(a.session, "publicado enquanto o A estava fora", "A recebe em catch-up", 20_000)
await a.session.connect()
try {
  await aVeDeC
  check("quem aceitou é lido logo: A apanha em catch-up o que C publicou", true)
} catch (error) {
  check("quem aceitou é lido logo: A apanha em catch-up o que C publicou", false, error.message)
}

// Reconciliation runs by itself when A connects. It gives the slot back.
await pausa(5_000)
const cVeDeA = esperaPost(c.session, "publicado depois de o A voltar", "C lê A depois da reconciliação")
await a.session.post("publicado depois de o A voltar")
try {
  await cVeDeA
  check("a reconciliação fecha a amizade sem ninguém carregar em nada", true)
} catch (error) {
  check("a reconciliação fecha a amizade sem ninguém carregar em nada", false, error.message)
}

// ---------------------------------------------------------------------------
// 3. Decline gives no access, in any direction.
// ---------------------------------------------------------------------------

const dmAD = await a.session.openDirect(d.address)
await a.session.sendFriendRequest(dmAD)
await pausa(1_500)
await d.session.declineFriend(dmAD)
await pausa(2_000)

check("recusado, não há amizade de nenhum dos lados", a.session.friendTies().get(d.address)?.link !== "amigos" && d.session.friendTies().get(a.address)?.link !== "amigos")

const dNaoLeA = naoChega(d.session, "depois de o D recusar")
const aNaoLeD = naoChega(a.session, "publicação do D depois de recusar")
await a.session.post("depois de o D recusar")
await d.session.post("publicação do D depois de recusar")
check("quem recusou não passa a ler quem pediu", await dNaoLeA)
check("quem pediu não passa a ler quem recusou", await aNaoLeD)

// And whoever was declined can ask again: a decline closes the request, not the door.
let podeRepetir = true
try {
  await a.session.sendFriendRequest(dmAD)
} catch (error) {
  podeRepetir = false
  console.log(`  (segundo pedido recusado: ${error.message})`)
}
check("depois de uma recusa, pedir outra vez é possível", podeRepetir)

// ---------------------------------------------------------------------------
// 4. Ending the friendship removes BOTH slots.
// ---------------------------------------------------------------------------

await a.session.unfriend(b.address)
await pausa(4_000)

check("quem desfez deixa de chamar amigo ao outro", a.session.friendTies().get(b.address)?.link === "nenhum")
check("e o outro lado também, depois de receber o corte", b.session.friendTies().get(a.address)?.link === "nenhum")

const bNaoLeA = naoChega(b.session, "publicado depois do corte, por A")
const aNaoLeB = naoChega(a.session, "publicado depois do corte, por B")
await a.session.post("publicado depois do corte, por A")
await b.session.post("publicado depois do corte, por B")
check("quem foi removido deixa de ler quem removeu", await bNaoLeA)
check("e quem removeu deixa de ler quem foi removido — os dois lugares, não um", await aNaoLeB)

// ---------------------------------------------------------------------------
// 5. Cross requests resolve into friendship.
// ---------------------------------------------------------------------------

const cruzado1 = await c.session.openDirect(d.address)
await c.session.sendFriendRequest(cruzado1)
await pausa(1_500)
const cruzado2 = await d.session.openDirect(c.address)
// D requests the person who already requested D. This is acceptance, not a second pending request.
await d.session.sendFriendRequest(cruzado2)
await pausa(3_000)

check("dois pedidos cruzados dão uma amizade, não duas esperas", c.session.friendTies().get(d.address)?.link === "amigos" && d.session.friendTies().get(c.address)?.link === "amigos")

const cVeDeD = esperaPost(c.session, "publicação do D, cruzado")
const dVeDeC = esperaPost(d.session, "publicação do C, cruzado")
await c.session.post("publicação do C, cruzado")
await d.session.post("publicação do D, cruzado")
try {
  await dVeDeC
  await cVeDeD
  check("e leem-se nos dois sentidos", true)
} catch (error) {
  check("e leem-se nos dois sentidos", false, error.message)
}

// ---------------------------------------------------------------------------
// 6. Canceling a request closes it on both sides, and requesting again is a
//    new request, which gets accepted.
// ---------------------------------------------------------------------------

const e = await conta("E")
const f = await conta("F")
const dmEF = await e.session.openDirect(f.address)
await pausa(1_500)
await e.session.sendFriendRequest(dmEF, "um pedido que vai ser retirado")
await pausa(1_500)
check("o pedido chega e fica por responder", f.session.openFriendRequests().some((tie) => tie.peer === e.address))
check("e quem pediu vê-o nos Enviados", e.session.sentFriendRequests().some((tie) => tie.peer === f.address))

const avisosDeF = []
const largarAvisos = f.session.on("status", (estado) => avisosDeF.push(estado))
await e.session.cancelFriendRequest(f.address)
await pausa(2_000)
largarAvisos()
check("cancelado, o pedido sai dos Recebidos do outro lado", !f.session.openFriendRequests().some((tie) => tie.peer === e.address))
check("e dos Enviados de quem o fez", e.session.sentFriendRequests().length === 0)
check(
  "e do outro lado sai o aviso para tirar o pedido do sino",
  avisosDeF.some((estado) => estado.code === "friend-withdrawn" && estado.actor === e.address),
)

await e.session.sendFriendRequest(dmEF)
await pausa(1_500)
await f.session.acceptFriend(dmEF, e.address)
await pausa(3_000)
check("cancelar e pedir outra vez dá uma amizade", e.session.friendTies().get(f.address)?.link === "amigos" && f.session.friendTies().get(e.address)?.link === "amigos")

// ---------------------------------------------------------------------------
// 7. Blocking a friend ends the friendship on both sides, and what they say in
//    the direct channel stops arriving. Unblocking lets them request again.
// ---------------------------------------------------------------------------

const fVeDeE = esperaPost(f.session, "publicação do E antes do bloqueio")
await e.session.post("publicação do E antes do bloqueio")
try {
  await fVeDeE
  check("antes do bloqueio, F lê E", true)
} catch (error) {
  check("antes do bloqueio, F lê E", false, error.message)
}

await f.session.block(e.address)
await pausa(4_000)
check('bloqueado, os dois lados dizem "desfeita"', e.session.friendTies().get(f.address)?.severed === true && f.session.friendTies().get(e.address)?.severed === true)

const fNaoLeE = naoChega(f.session, "publicado por E depois do bloqueio")
const eNaoLeF = naoChega(e.session, "publicado por F depois do bloqueio")
await e.session.post("publicado por E depois do bloqueio")
await f.session.post("publicado por F depois do bloqueio")
check("quem bloqueou deixa de ler quem foi bloqueado", await fNaoLeE)
check("e quem foi bloqueado deixa de ler quem bloqueou", await eNaoLeF)

const vistosPorF = []
const largarVistos = f.session.on("message", (mensagem) => {
  if (mensagem.channel === dmEF) vistosPorF.push(mensagem.payload.t)
})
await e.session.sendFriendRequest(dmEF, "deixa-me voltar")
await pausa(2_000)
check("um pedido de quem está bloqueado não chega ao ecrã nem fica por responder", vistosPorF.length === 0 && f.session.openFriendRequests().length === 0)

await f.session.unblock(e.address)
await pausa(1_000)
// A request sent while blocked does not come back: it was discarded on arrival. On
// E's side it stays "sent", so E cancels it and requests again.
await e.session.cancelFriendRequest(f.address)
await pausa(1_000)
await e.session.sendFriendRequest(dmEF)
await pausa(2_000)
largarVistos()
check("desbloqueado, um pedido novo chega", f.session.openFriendRequests().some((tie) => tie.peer === e.address))

// ---------------------------------------------------------------------------
// 8. The friend list shown: only the friends of the person showing it can read it.
// ---------------------------------------------------------------------------

// C is a friend of A (section 2) and of D (section 5); B is not a friend of C.
await c.session.setShownFriends([a.address, d.address, b.address])
await pausa(2_500)
const vistaPorA = a.session.shownFriendsOf(c.address)?.shown ?? null
const vistaPorD = d.session.shownFriendsOf(c.address)?.shown ?? null
check("um amigo lê a lista, só com amigos dentro", JSON.stringify(vistaPorA) === JSON.stringify([a.address, d.address]), JSON.stringify(vistaPorA))
check("e outro amigo lê a mesma", JSON.stringify(vistaPorD) === JSON.stringify([a.address, d.address]), JSON.stringify(vistaPorD))
check("quem não é amigo não a lê", b.session.shownFriendsOf(c.address) === null)
await c.session.setShownFriends([])
await pausa(2_500)
check("uma lista vazia deixa de mostrar", (a.session.shownFriendsOf(c.address)?.shown ?? ["?"]).length === 0)

for (const quem of [a, b, c, d, e, f]) quem.session.disconnect()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
