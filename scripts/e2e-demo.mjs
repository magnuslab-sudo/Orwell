// End-to-end walkthrough against a live homeserver: two independent clients,
// real MLS, real gateway. Nothing here is mocked.
import {
  addMembers, createChannel, decodeKeyPackage, encryptPayload,
  generateKeyPackages, joinChannel, receive,
} from "@enclave/crypto"
import {
  PROTOCOL_VERSION, fromBase64, generateIdentity, moradaDeSala, moradaDoMural, parseServerName, sign, toBase64,
} from "@enclave/protocol"

const HOME = parseServerName("localhost:8448")
const GATEWAY = "ws://127.0.0.1:8448/_enclave/gateway"

class Client {
  constructor(name, identity) {
    this.name = name
    this.identity = identity
    this.inbox = []
    this.waiters = []
    this.groups = new Map()
    this.keyPackages = []
    this.ownRefs = new Set()
  }

  static async connect(name) {
    const client = new Client(name, generateIdentity(HOME))
    client.socket = new WebSocket(GATEWAY)
    await new Promise((resolve, reject) => {
      client.socket.onopen = resolve
      client.socket.onerror = reject
    })
    client.socket.onmessage = (event) => {
      const frame = JSON.parse(event.data)
      const waiter = client.waiters.shift()
      if (waiter) waiter(frame)
      else client.inbox.push(frame)
    }
    return client
  }

  send(frame) { this.socket.send(JSON.stringify(frame)) }

  next() {
    const queued = this.inbox.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
      setTimeout(() => resolve({ t: "timeout" }), 5000)
    })
  }

  async nextOf(kind) {
    for (let i = 0; i < 20; i++) {
      const frame = await this.next()
      if (frame.t === kind) return frame
      if (frame.t === "timeout") throw new Error(`${this.name}: timed out waiting for ${kind}`)
    }
    throw new Error(`${this.name}: never saw ${kind}`)
  }

  async login() {
    this.send({ t: "hello", version: PROTOCOL_VERSION })
    await this.nextOf("hello.ok")
    this.send({
      t: "auth.begin",
      address: this.identity.address,
      signingKey: toBase64(this.identity.signingPublicKey),
    })
    const challenge = await this.nextOf("auth.challenge")
    this.send({ t: "auth.finish", signature: toBase64(sign(this.identity, fromBase64(challenge.nonce))) })
    await this.nextOf("auth.ok")
    console.log(`  ${this.name} autenticado como ${this.identity.address}`)
  }

  async publishKeyPackages(count) {
    const generated = await generateKeyPackages(this.identity, count)
    this.keyPackages = generated
    this.send({ t: "keypackage.publish", packages: generated.map((k) => toBase64(k.wire)) })
  }

  /** Round-trip a ping so everything sent before it has definitely been applied. */
  async sync() {
    this.send({ t: "ping" })
    await this.nextOf("pong")
  }

  /**
   * Send something into a channel and tag it, so we can recognise the server's
   * echo of it. We are subscribed to our own channels, so everything we send
   * comes back — and our own commits and messages must never be fed to MLS.
   */
  sendToChannel(frame) {
    const ref = crypto.randomUUID()
    this.ownRefs.add(ref)
    this.send({ ...frame, ref })
  }

  /** The next event in this channel that somebody *else* sent. */
  async nextForeignEvent() {
    for (let i = 0; i < 20; i++) {
      const frame = await this.nextOf("channel.event")
      if (frame.ref && this.ownRefs.delete(frame.ref)) continue
      return frame
    }
    throw new Error(`${this.name}: only ever saw its own echoes`)
  }
}

const step = (n, text) => console.log(`\n[${n}] ${text}`)

step(1, "Ligar dois clientes ao homeserver")
const alice = await Client.connect("alice")
const bob = await Client.connect("bob")
await alice.login()
await bob.login()

step(2, "Bob publica key packages (para poder ser convidado offline)")
await bob.publishKeyPackages(3)
await bob.sync()

step(3, "Alice cria o canal #geral")
// Opaque addresses: the 1.0 server does not debut rooms with names (slice 6a).
const CHANNEL = moradaDeSala(HOME)
alice.groups.set(CHANNEL, await createChannel(alice.identity, CHANNEL))
alice.send({ t: "channel.subscribe", channels: [CHANNEL] })
bob.send({ t: "channel.subscribe", channels: [CHANNEL] })
await alice.sync()
await bob.sync()

step(4, "Alice reclama um key package do Bob e convida-o")
alice.send({ t: "keypackage.claim", address: bob.identity.address })
const claimed = await alice.nextOf("keypackage.claimed")
if (!claimed.keyPackage) throw new Error("nenhum key package disponível")

const invite = await addMembers(alice.groups.get(CHANNEL), [decodeKeyPackage(fromBase64(claimed.keyPackage))])
alice.groups.set(CHANNEL, invite.session)
alice.sendToChannel({ t: "channel.send", channel: CHANNEL, kind: "handshake", ciphertext: toBase64(invite.commit) })
alice.sendToChannel({
  t: "channel.send", channel: CHANNEL, kind: "welcome",
  ciphertext: toBase64(invite.welcome), recipient: bob.identity.address,
})

step(5, "Bob recebe o Welcome e entra no grupo")
let welcomeFrame
for (let i = 0; i < 10; i++) {
  const frame = await bob.nextForeignEvent()
  if (frame.kind === "welcome") { welcomeFrame = frame; break }
}
if (!welcomeFrame) throw new Error("Bob não recebeu o welcome")

let joined = null
for (const candidate of bob.keyPackages) {
  try {
    joined = await joinChannel(CHANNEL, fromBase64(welcomeFrame.ciphertext), candidate.publicPackage, candidate.privatePackage)
    break
  } catch { /* wrong key package, try the next one */ }
}
if (!joined) throw new Error("Bob não conseguiu entrar")
bob.groups.set(CHANNEL, joined)
console.log(`  Bob entrou, época ${joined.state.groupContext.epoch}`)

step(6, "Alice envia uma mensagem cifrada")
const SECRET = "isto nunca passa em claro por servidor nenhum"
const sent = await encryptPayload(alice.groups.get(CHANNEL), {
  t: "message", id: crypto.randomUUID(), sentAt: Date.now(),
  body: SECRET, attachments: [], mentions: [],
})
alice.groups.set(CHANNEL, sent.session)
alice.sendToChannel({ t: "channel.send", channel: CHANNEL, kind: "application", ciphertext: toBase64(sent.ciphertext) })

step(7, "Bob decifra")
const event = await bob.nextForeignEvent()
const result = await receive(bob.groups.get(CHANNEL), fromBase64(event.ciphertext))
bob.groups.set(CHANNEL, result.session)
if (result.kind !== "payload") throw new Error(`Bob obteve ${result.kind}: ${result.reason ?? ""}`)
console.log(`  Bob leu: "${result.payload.body}"`)
console.log(`  autor autenticado pelo MLS: ${result.sender}`)
if (result.payload.body !== SECRET) throw new Error("conteúdo não corresponde")
if (result.sender !== alice.identity.address) throw new Error("atribuição de autor errada")

step(8, "Bob responde")
const reply = await encryptPayload(bob.groups.get(CHANNEL), {
  t: "message", id: crypto.randomUUID(), sentAt: Date.now(),
  body: "recebido, e o servidor continua sem perceber nada", attachments: [], mentions: [],
})
bob.groups.set(CHANNEL, reply.session)
bob.sendToChannel({ t: "channel.send", channel: CHANNEL, kind: "application", ciphertext: toBase64(reply.ciphertext) })

const echo = await alice.nextForeignEvent()
const atAlice = await receive(alice.groups.get(CHANNEL), fromBase64(echo.ciphertext))
if (atAlice.kind !== "payload") throw new Error(`Alice obteve ${atAlice.kind}: ${atAlice.reason ?? ""}`)
console.log(`  Alice leu: "${atAlice.payload.body}"`)
console.log(`  autor: ${atAlice.sender}`)

step(9, "O que o servidor guardou")
const onWire = new TextDecoder("latin1").decode(fromBase64(event.ciphertext))
console.log(`  bytes armazenados: ${fromBase64(event.ciphertext).length}`)
console.log(`  contém o texto?        ${onWire.includes(SECRET)}`)
console.log(`  contém o endereço?     ${onWire.includes(alice.identity.address)}`)
console.log(`  timestamp registado:   minuto ${event.receivedAtMinute} (sem milissegundos)`)

step(10, "Social: Alice publica no feed, Bob (seguidor) lê")
// A feed is the same primitive as a channel: an MLS group the author owns and
// followers are members of. Nothing new to trust.
// The opaque address of the wall (1.0 "Arca"): the hash of Alice's secret, not
// her id. The server does not know who owns it.
const FEED = moradaDoMural(crypto.getRandomValues(new Uint8Array(32)), parseServerName("localhost:8448"))
alice.groups.set(FEED, await createChannel(alice.identity, FEED))
alice.send({ t: "channel.subscribe", channels: [FEED] })
bob.send({ t: "channel.subscribe", channels: [FEED] })
await alice.sync(); await bob.sync()

// Accepting a follower is adding them to the group — an MLS commit, which no
// server can forge or silently undo.
alice.send({ t: "keypackage.claim", address: bob.identity.address })
const followerKp = await alice.nextOf("keypackage.claimed")
if (!followerKp.keyPackage) throw new Error("Bob ficou sem key packages")

const accept = await addMembers(alice.groups.get(FEED), [decodeKeyPackage(fromBase64(followerKp.keyPackage))])
alice.groups.set(FEED, accept.session)
alice.sendToChannel({ t: "channel.send", channel: FEED, kind: "handshake", ciphertext: toBase64(accept.commit) })
alice.sendToChannel({
  t: "channel.send", channel: FEED, kind: "welcome",
  ciphertext: toBase64(accept.welcome), recipient: bob.identity.address,
})

let feedWelcome
for (let i = 0; i < 10; i++) {
  const frame = await bob.nextForeignEvent()
  if (frame.channel === FEED && frame.kind === "welcome") { feedWelcome = frame; break }
}
if (!feedWelcome) throw new Error("Bob não recebeu o welcome do feed")

let feedSession = null
for (const candidate of bob.keyPackages) {
  try {
    feedSession = await joinChannel(FEED, fromBase64(feedWelcome.ciphertext), candidate.publicPackage, candidate.privatePackage)
    break
  } catch { /* next */ }
}
if (!feedSession) throw new Error("Bob não entrou no feed")
bob.groups.set(FEED, feedSession)
console.log("  Bob passou a seguir Alice")

const post = await encryptPayload(alice.groups.get(FEED), {
  t: "post",
  id: crypto.randomUUID(),
  postedAt: Date.now(),
  caption: "Ordem cronológica, sem algoritmo. #privacidade #mls",
  media: [],
  tags: ["privacidade", "mls"],
})
alice.groups.set(FEED, post.session)
alice.sendToChannel({ t: "channel.send", channel: FEED, kind: "application", ciphertext: toBase64(post.ciphertext) })

const postEvent = await bob.nextForeignEvent()
const readPost = await receive(bob.groups.get(FEED), fromBase64(postEvent.ciphertext))
if (readPost.kind !== "payload") throw new Error(`Bob obteve ${readPost.kind}: ${readPost.reason ?? ""}`)
if (readPost.payload.t !== "post") throw new Error(`esperava um post, veio ${readPost.payload.t}`)
console.log(`  Bob leu o post: "${readPost.payload.caption}"`)
console.log(`  etiquetas: ${readPost.payload.tags.join(", ")}`)
console.log(`  autor: ${readPost.sender}`)

step(11, "Perfil: nome, imagem, email e donativos — tudo dentro do ciphertext")
const profilePayload = {
  t: "profile",
  displayName: "Alice",
  statusText: "a testar o Enclave",
  bio: "Sem conta, sem password no servidor.",
  email: "alice@exemplo.pt",
  donations: [
    { kind: "url", label: "site", value: "https://exemplo.pt/apoiar" },
    { kind: "iban", label: "transferência", value: "PT50000000000000000000000" },
  ],
  updatedAt: Date.now(),
}
const profileMsg = await encryptPayload(alice.groups.get(CHANNEL), profilePayload)
alice.groups.set(CHANNEL, profileMsg.session)
alice.sendToChannel({ t: "channel.send", channel: CHANNEL, kind: "application", ciphertext: toBase64(profileMsg.ciphertext) })

const profileEvent = await bob.nextForeignEvent()
const gotProfile = await receive(bob.groups.get(CHANNEL), fromBase64(profileEvent.ciphertext))
bob.groups.set(CHANNEL, gotProfile.session)
if (gotProfile.kind !== "payload" || gotProfile.payload.t !== "profile") {
  throw new Error(`esperava um perfil, veio ${gotProfile.kind}/${gotProfile.payload?.t}`)
}
console.log(`  Bob vê o nome: "${gotProfile.payload.displayName}"`)
console.log(`  email: ${gotProfile.payload.email}`)
console.log(`  donativos: ${gotProfile.payload.donations.map((d) => d.kind).join(", ")}`)

// The whole point: none of that reached the server in readable form.
const profileWire = new TextDecoder("latin1").decode(fromBase64(profileEvent.ciphertext))
const leaks = ["Alice", "alice@exemplo.pt", "PT50000000000000000000000", "exemplo.pt", "displayName"]
  .filter((needle) => profileWire.includes(needle))
console.log(`  o que o servidor consegue ler do perfil: ${leaks.length === 0 ? "nada" : leaks.join(", ")}`)
if (leaks.length > 0) throw new Error(`perfil a vazar para o servidor: ${leaks.join(", ")}`)

console.log("\n✅ Fluxo completo: identidade → convite federável → grupo MLS → mensagens → feed social → perfil cifrado.")
alice.socket.close()
bob.socket.close()
