/**
 * Populate a local homeserver with something to look at.
 *
 * These are *real accounts*, not fixtures injected into the interface. They log
 * in with their own keys, create a real channel, claim one of your published key
 * packages and invite you with a real MLS commit. What you see afterwards is
 * what the protocol actually produced — if the seed works, the app works.
 *
 * Because of that, your client has to be running and connected: an invitation is
 * delivered, not conjured, and the Welcome has to reach you.
 *
 *   node scripts/seed-demo.mjs @teu-endereco:localhost:8448
 */
import {
  addMembers, createChannel, decodeKeyPackage, encryptPayload,
  generateKeyPackages, receive,
} from "@enclave/crypto"
import {
  PROTOCOL_VERSION, fromBase64, generateIdentity, moradaDeSala, moradaDoMural, parseServerName, sign, toBase64,
} from "@enclave/protocol"

const target = process.argv[2]
if (!target || !target.startsWith("@")) {
  console.error("Uso: node scripts/seed-demo.mjs @teu-endereco:localhost:8448")
  console.error("O endereço está no teu perfil, dentro da app.")
  process.exit(1)
}

const HOME = parseServerName(target.slice(target.indexOf(":") + 1))
const GATEWAY = `ws://${HOME}/_enclave/gateway`

class Demo {
  constructor(name) {
    this.name = name
    this.identity = generateIdentity(HOME)
    this.inbox = []
    this.waiters = []
    this.ownRefs = new Set()
    this.groups = new Map()
  }

  async connect() {
    this.socket = new WebSocket(GATEWAY)
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve
      this.socket.onerror = reject
    })
    this.socket.onmessage = (event) => {
      const frame = JSON.parse(event.data)
      const waiter = this.waiters.shift()
      if (waiter) waiter(frame)
      else this.inbox.push(frame)
    }

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
  }

  send(frame) { this.socket.send(JSON.stringify(frame)) }

  sendToChannel(frame) {
    const ref = crypto.randomUUID()
    this.ownRefs.add(ref)
    this.send({ ...frame, ref })
  }

  next() {
    const queued = this.inbox.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.waiters.push(resolve)
      setTimeout(() => resolve({ t: "timeout" }), 6000)
    })
  }

  async nextOf(kind) {
    for (let i = 0; i < 30; i++) {
      const frame = await this.next()
      if (frame.t === kind) return frame
      if (frame.t === "timeout") throw new Error(`${this.name}: sem resposta (${kind})`)
    }
    throw new Error(`${this.name}: nunca recebeu ${kind}`)
  }

  async sync() {
    this.send({ t: "ping" })
    await this.nextOf("pong")
  }

  /** Create a group, invite the human, and return it ready to post into. */
  async openChannel(channel, guest) {
    this.groups.set(channel, await createChannel(this.identity, channel))
    this.send({ t: "channel.subscribe", channels: [channel] })
    await this.sync()

    this.send({ t: "keypackage.claim", address: guest })
    const claimed = await this.nextOf("keypackage.claimed")
    if (!claimed.keyPackage) {
      throw new Error(
        `${guest} não tem key packages no servidor.\n` +
          "  Abre a app e deixa-a ligar-se — é nesse momento que os publica.",
      )
    }

    const invite = await addMembers(this.groups.get(channel), [decodeKeyPackage(fromBase64(claimed.keyPackage))])
    this.groups.set(channel, invite.session)
    this.sendToChannel({ t: "channel.send", channel, kind: "handshake", ciphertext: toBase64(invite.commit) })
    this.sendToChannel({
      t: "channel.send", channel, kind: "welcome",
      ciphertext: toBase64(invite.welcome), recipient: guest,
    })
    await this.sync()
  }

  async say(channel, payload) {
    const sealed = await encryptPayload(this.groups.get(channel), payload)
    this.groups.set(channel, sealed.session)
    this.sendToChannel({ t: "channel.send", channel, kind: "application", ciphertext: toBase64(sealed.ciphertext) })
    // A beat between messages so they arrive in a readable order and carry
    // distinct timestamps.
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  profile(displayName, extra = {}) {
    return { t: "profile", displayName, donations: [], updatedAt: Date.now(), ...extra }
  }

  message(body) {
    return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], mentions: [] }
  }

  post(caption, extra = {}) {
    return {
      t: "post", id: crypto.randomUUID(), postedAt: Date.now(),
      caption, media: [], links: [], tags: [], ...extra,
    }
  }
}

const people = [
  { name: "Ana Prazeres", statusText: "a arrumar o jardim" },
  { name: "Bruno Sá", statusText: "café primeiro" },
  { name: "Carla Nunes", bio: "Fotografia e caminhadas." },
]

console.log(`A semear ${HOME} para ${target}\n`)

const demos = []
for (const person of people) {
  const demo = new Demo(person.name)
  await demo.connect()
  demos.push({ demo, person })
  console.log(`  ${person.name.padEnd(16)} ${demo.identity.address}`)
}

const [ana, bruno, carla] = demos

// -------------------------------------------------------------- a channel

// Opaque addresses: the 1.0 server does not debut rooms with names (slice 6a).
const CHANNEL = moradaDeSala(HOME)
console.log(`\nA criar ${CHANNEL} e a convidar-te…`)
await ana.demo.openChannel(CHANNEL, target)

await ana.demo.say(CHANNEL, ana.demo.profile(ana.person.name, { statusText: ana.person.statusText }))
await ana.demo.say(CHANNEL, ana.demo.message("Boas! Alguém alinha num passeio no sábado de manhã?"))
await ana.demo.say(CHANNEL, ana.demo.message("Estava a pensar na Serra de Sintra, saída às 9h."))
await ana.demo.say(CHANNEL, ana.demo.message("Levo termos de café para toda a gente."))

// Bruno and Carla have to be added by Ana before they can speak in her group.
for (const guest of [bruno, carla]) {
  const packages = await generateKeyPackages(guest.demo.identity, 1)
  const invite = await addMembers(ana.demo.groups.get(CHANNEL), [decodeKeyPackage(packages[0].wire)])
  ana.demo.groups.set(CHANNEL, invite.session)
  ana.demo.sendToChannel({ t: "channel.send", channel: CHANNEL, kind: "handshake", ciphertext: toBase64(invite.commit) })

  guest.demo.groups.set(
    CHANNEL,
    await (await import("@enclave/crypto")).joinChannel(
      CHANNEL, invite.welcome, packages[0].publicPackage, packages[0].privatePackage,
    ),
  )
  guest.demo.send({ t: "channel.subscribe", channels: [CHANNEL] })
  await guest.demo.sync()
}

// Everyone applies each other's commits before speaking, or their ratchets drift.
await new Promise((resolve) => setTimeout(resolve, 400))
for (const { demo } of [bruno, carla]) {
  for (let i = 0; i < 12; i++) {
    const frame = await demo.next()
    if (frame.t !== "channel.event") break
    if (frame.ref && demo.ownRefs.delete(frame.ref)) continue
    const result = await receive(demo.groups.get(CHANNEL), fromBase64(frame.ciphertext))
    demo.groups.set(CHANNEL, result.session)
  }
}

await bruno.demo.say(CHANNEL, bruno.demo.profile(bruno.person.name, { statusText: bruno.person.statusText }))
await bruno.demo.say(CHANNEL, bruno.demo.message("Alinho. 9h é cedo mas o café resolve."))
await carla.demo.say(CHANNEL, carla.demo.profile(carla.person.name, { bio: carla.person.bio }))
await carla.demo.say(CHANNEL, carla.demo.message("Também vou! Levo a máquina."))
await ana.demo.say(CHANNEL, ana.demo.message("Combinado então. Ponto de encontro no costume."))

// ----------------------------------------------------------------- feeds

console.log("A criar os feeds e a aceitar-te como seguidor…")

const feedPosts = [
  {
    who: ana,
    posts: [
      ana.demo.post("Primeira geada do ano na horta. As couves aguentaram, os tomates nem por isso. #horta", {
        tags: ["horta"],
      }),
      ana.demo.post("Leitura da semana, e vale mesmo a pena.", {
        links: [
          {
            url: "https://www.rfc-editor.org/rfc/rfc9420.html",
            kind: "link",
            title: "RFC 9420 — Messaging Layer Security",
            siteName: "rfc-editor.org",
            description: "Como é que um grupo de mil pessoas troca chaves sem que ninguém no meio consiga ler.",
          },
        ],
      }),
    ],
  },
  {
    who: bruno,
    posts: [
      bruno.demo.post("Encontrei este documentário sobre cartografia antiga. Uma hora bem passada.", {
        links: [
          {
            url: "https://example.org/videos/cartografia",
            kind: "video",
            title: "Os mapas antes dos satélites",
            siteName: "example.org",
            description: "Como se desenhava uma costa que ninguém tinha visto inteira.",
          },
        ],
      }),
      bruno.demo.post("Bolo de laranja ao terceiro ensaio. Desta vez não abateu no meio."),
    ],
  },
  {
    who: carla,
    posts: [
      carla.demo.post("Nevoeiro na Peneda-Gerês esta manhã. Não se via nada e valeu tudo. #fotografia", {
        tags: ["fotografia"],
      }),
    ],
  },
]

for (const { who, posts } of feedPosts) {
  // The opaque feed address (1.0 "Arca"): the hash of a secret, not the id.
  const feed = moradaDoMural(crypto.getRandomValues(new Uint8Array(32)), parseServerName(HOME))
  await who.demo.openChannel(feed, target)
  await who.demo.say(feed, who.demo.profile(who.person.name))
  for (const post of posts) await who.demo.say(feed, post)
}

console.log(`
Pronto.

  Canal      #fim-de-semana, com três pessoas a conversar
  Feed       ${feedPosts.reduce((total, entry) => total + entry.posts.length, 0)} publicações de ${feedPosts.length} pessoas

Se a app estava aberta, já lá está tudo. Se não estava, abre-a e volta a correr
isto — um convite tem de ser entregue a alguém que esteja a ouvir.
`)

for (const { demo } of demos) demo.socket.close()
