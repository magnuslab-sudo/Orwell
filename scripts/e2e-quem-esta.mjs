/**
 * "Who is in the room?", the newcomer asks, and invisibly too.
 *
 *   node scripts/e2e-quem-esta.mjs          (needs `npm run build` first)
 *
 * Owner's report on 5 October 2026, after a call with other people:
 * "some people do not see who is in the room before they enter."
 *
 * The cause is not an oversight. The list of who is in a voice room is built
 * from the `voice.join` signals that the device HEARD, and those who already
 * left are not recovered in the catchup, voice signaling only works live,
 * on purpose (replaying a morning announcement would have the app negotiating
 * with people who disconnected hours ago). What we had was the server's
 * presence notification making those in a call re-announce themselves...
 * and that notification "does not go to the newcomer if they arrive invisibly",
 * and that is correct: invisible means invisible. For them, the list only
 * filled on the next heartbeat, which is 50 seconds.
 *
 * What we prove here, in this order, and the order is the point:
 *
 *   1. Ana and Bento are in a voice room of the channel;
 *   2. Carla opens the app INVISIBLY and after three seconds has heard nothing,  *      this measures the bug, and shows that without asking she would wait for
 *      the heartbeat;
 *   3. Carla asks, and sees both in LESS THAN TWO SECONDS;
 *   4. both answered with `voice.join`, the usual announcement, and it says
 *      WHICH of the rooms the conversation is in;
 *   5. the question did not pull Ana or Bento out of their call with each other,  *      it has the form of a `voice.leave` so an old client can receive it without
 *      choking, and that cannot cost the roster of those inside;
 *   6. and those in a call do not ask about the channel they are in, which is the
 *      guard that keeps the question from erasing us from others' screens.
 *
 * ALL LOCAL AND ALL DISPOSABLE, following the pattern of `e2e-aparelhos.mjs`: it
 * spins up its own homeserver in a temp folder that it deletes at the end, on a
 * port it verifies is free, and takes no target by argument or environment. There
 * is no way to point it at production.
 *
 * "WebRTC is fake, and only it." Node has no `RTCPeerConnection` or
 * `getUserMedia`; what matters here is signaling, who asks, who answers, and how
 * long it takes, and all of that goes through MLS and the real server. Nothing
 * here proves two machines cross a NAT, and no stub ever would.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { Call, Session, Vault, ehPerguntaDePresenca } from "@enclave/client-core"
import { parseServerName } from "@enclave/protocol"

if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA = 8479
const NOME = `localhost:${PORTA}`
const SALA = "contio-obras"
/** How long to wait for the question. The heartbeat is 50 s: this must be another order of magnitude. */
const PRAZO_MS = 2000

const results = []
function check(nome, ok, detalhe = "") {
  results.push(Boolean(ok))
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
}

if (!existsSync(SERVIDOR_JS)) {
  console.error(`Falta o servidor construído: ${SERVIDOR_JS}. Corre \`npm run build\` primeiro.`)
  process.exit(2)
}

async function portaLivre(porta) {
  return new Promise((resolve) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolve(false))
    sonda.once("listening", () => sonda.close(() => resolve(true)))
    sonda.listen(porta, "127.0.0.1")
  })
}
if (!(await portaLivre(PORTA))) {
  console.error(`A porta ${PORTA} já tem dono. Este guião não mata processos de ninguém: liberta-a e volta a correr.`)
  process.exit(2)
}

// --- the fake WebRTC, before `Call` is born ---------------------------
class LigacaoFalsa {
  localDescription = null
  connectionState = "new"
  ontrack = null
  onicecandidate = null
  onconnectionstatechange = null
  addTrack() {
    return {}
  }
  addTransceiver() {
    return { sender: {} }
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0\r\n" }
  }
  async createAnswer() {
    return { type: "answer", sdp: "v=0\r\n" }
  }
  async setLocalDescription(d) {
    this.localDescription = d
  }
  async setRemoteDescription() {}
  async addIceCandidate() {}
  close() {}
}
function faixasFalsas() {
  const audio = { kind: "audio", enabled: true, stop: () => {} }
  return { getTracks: () => [audio], getAudioTracks: () => [audio], getVideoTracks: () => [] }
}
globalThis.RTCPeerConnection = LigacaoFalsa
globalThis.RTCRtpSender = class {}
// `navigator` exists in Node 24 and is read-only: assigning to it breaks. What
// we need is `mediaDevices`, which it does not have, so we define the
// property on the object that is already there.
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  configurable: true,
  value: { getUserMedia: async () => faixasFalsas() },
})

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-quem-esta-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA),
    ENCLAVE_COMMUNITY_MODE: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (bocado) => (registoDoServidor += bocado))
servidor.stderr.on("data", (bocado) => (registoDoServidor += bocado))

async function servidorDePe() {
  for (let volta = 0; volta < 60; volta++) {
    const ok = await new Promise((resolve) => {
      const sonda = net.connect(PORTA, "127.0.0.1", () => {
        sonda.destroy()
        resolve(true)
      })
      sonda.on("error", () => resolve(false))
    })
    if (ok) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

const pessoas = []
async function arrumar(codigoDeSaida) {
  for (const quem of pessoas) {
    try {
      quem.session.disconnect()
    } catch {
      // already disconnected
    }
  }
  servidor.kill()
  await new Promise((resolve) => setTimeout(resolve, 300))
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigoDeSaida)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

const HOME = parseServerName(NOME)
const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for the condition, or gives up. Returns how long it took, or `null`. */
async function ate(condicao, msMax) {
  const inicio = Date.now()
  while (Date.now() - inicio < msMax) {
    if (condicao()) return Date.now() - inicio
    await pausa(25)
  }
  return null
}

class CofreNaMemoria {
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

/**
 * A person: vault, session, and the `Call` connected as the bridges connect it.
 *
 * The connection is the one in `apps/web/src/bridge.ts`, on purpose and with the same
 * lines: `voice` goes to `handleSignal`, and a QUESTION does not count as anyone
 * leaving in the presence map. Writing it differently here would prove
 * an app that does not exist.
 */
async function pessoa(nome) {
  const vault = new Vault(new CofreNaMemoria())
  await vault.create("frase-de-teste-quem-esta")
  const session = new Session(vault)
  const identidade = await session.createIdentity(NOME)
  const erros = []
  session.on("status", (s) => {
    if (s.level === "error") erros.push(`${nome}: ${s.detail}`)
  })

  /** Who is in a call in this channel, as the sidebar builds it. */
  const vozPorSala = new Map()
  const perguntasRecebidas = []

  const call = new Call({
    get selfAddress() {
      return session.identity.address
    },
    sendSignal: (channel, payload) => session.send(channel, payload),
    mediaKey: (channel, address) => session.mediaKey(channel, address),
    reservarContadorSframe: (channel, keyId) => session.reservarContadorSframe(channel, keyId),
  })
  call.on("error", (e) => erros.push(`${nome} call: ${e.detail}`))

  session.on("voice", (event) => {
    void call.handleSignal(event.channel, event.from, event.payload).catch((erro) => {
      erros.push(`${nome} sinalização: ${erro.message}`)
    })
    if (ehPerguntaDePresenca(event.payload)) {
      perguntasRecebidas.push({ channel: event.channel, from: event.from })
      return
    }
    if (event.payload.t !== "voice.join" && event.payload.t !== "voice.leave") return
    const chave = `${event.channel} ${event.payload.room ?? ""}`
    const naSala = vozPorSala.get(chave) ?? new Set()
    if (event.payload.t === "voice.join") naSala.add(event.from)
    else naSala.delete(event.from)
    vozPorSala.set(chave, naSala)
  })

  const quemEstaEm = (channel, room) => [...(vozPorSala.get(`${channel} ${room}`) ?? [])]

  const quem = { nome, vault, session, call, address: identidade.address, erros, quemEstaEm, perguntasRecebidas }
  pessoas.push(quem)
  return quem
}

try {
  const ana = await pessoa("Ana")
  const bento = await pessoa("Bento")
  const carla = await pessoa("Carla")
  await ana.session.connect()
  await bento.session.connect()
  // Carla connects first for one reason only: the connection publishes her
  // invite keys, and without them no one can seat her in a channel.
  await carla.session.connect()

  const canal = `!prova-quem-esta-${Date.now().toString(36)}:${HOME}`
  await ana.session.createSpaceChannel(canal)
  await ana.session.seat(canal, bento.address)
  check("o Bento entra no canal", (await ate(() => bento.session.channels.includes(canal), 20_000)) !== null)
  await ana.session.seat(canal, carla.address)
  check("e a Carla também", (await ate(() => carla.session.channels.includes(canal), 20_000)) !== null)

  /*
    And Carla closes the app BEFORE the call begins.

    It matches the report: someone opening the app in the middle of a conversation.
    Ana and Bento's `voice.join` signals will go out while she is away, and they
    are not recovered in the catchup, voice signaling only works live.
  */
  carla.session.disconnect()
  await pausa(500)

  // ---------------------------------------------------------------------------
  // 1. Ana and Bento in a voice room.
  // ---------------------------------------------------------------------------
  await ana.call.join(canal, { room: SALA })
  await bento.call.join(canal, { room: SALA })
  await pausa(1500)
  check(
    "a Ana vê o Bento na sala",
    ana.quemEstaEm(canal, SALA).includes(bento.address),
    ana.quemEstaEm(canal, SALA).join(","),
  )
  check(
    "e o Bento vê a Ana",
    bento.quemEstaEm(canal, SALA).includes(ana.address),
    bento.quemEstaEm(canal, SALA).join(","),
  )

  // ---------------------------------------------------------------------------
  // 2. Carla opens the app INVISIBLY, and hears nothing.
  // ---------------------------------------------------------------------------
  carla.session.setVisible(false)
  await carla.session.connect()
  check("a Carla volta invisível", carla.session.visible === false)
  check("e no canal", carla.session.channels.includes(canal))

  /*
    This measures the bug, and is what makes the rest of this script mean
    anything. Invisible, no one is notified that she arrived, so no one
    re-announces, and voice signaling does not recover in the catchup. Three seconds
    is plenty of margin for a round trip to 127.0.0.1; what she would really
    wait for is the heartbeat, which is 50 seconds.
  */
  await pausa(3000)
  const antesDaPergunta = carla.quemEstaEm(canal, SALA)
  check(
    "sem perguntar, a sala aparece-lhe VAZIA (é o defeito, medido)",
    antesDaPergunta.length === 0,
    antesDaPergunta.join(","),
  )

  // ---------------------------------------------------------------------------
  // 3. Carla asks, and sees both in less than two seconds.
  // ---------------------------------------------------------------------------
  const marca = Date.now()
  carla.call.perguntarQuemEsta(carla.session.channels)
  const levou = await ate(() => carla.quemEstaEm(canal, SALA).length >= 2, PRAZO_MS)
  check(
    `a Carla vê a sala cheia em menos de ${PRAZO_MS} ms`,
    levou !== null,
    levou === null ? `ainda vazia depois de ${Date.now() - marca} ms` : `${levou} ms`,
  )
  const vistos = carla.quemEstaEm(canal, SALA)
  check("e vê as duas pessoas certas", vistos.includes(ana.address) && vistos.includes(bento.address), vistos.join(","))

  // ---------------------------------------------------------------------------
  // 4. Both received the question, and answered with the usual announcement.
  // ---------------------------------------------------------------------------
  check(
    "a Ana recebeu a pergunta, no canal certo",
    ana.perguntasRecebidas.some((p) => p.channel === canal && p.from === carla.address),
    JSON.stringify(ana.perguntasRecebidas),
  )
  check(
    "o Bento também",
    bento.perguntasRecebidas.some((p) => p.channel === canal && p.from === carla.address),
    JSON.stringify(bento.perguntasRecebidas),
  )

  // ---------------------------------------------------------------------------
  // 5. And the question did not break the call already in progress.
  // ---------------------------------------------------------------------------
  check(
    "a Ana continua a ver o Bento na sala",
    ana.quemEstaEm(canal, SALA).includes(bento.address),
    ana.quemEstaEm(canal, SALA).join(","),
  )
  check(
    "e o Bento continua a ver a Ana",
    bento.quemEstaEm(canal, SALA).includes(ana.address),
    bento.quemEstaEm(canal, SALA).join(","),
  )

  // ---------------------------------------------------------------------------
  // 6. Those in a call do not ask about the channel they are in.
  // ---------------------------------------------------------------------------
  /*
    The guard that is not about saving resources: the question travels as a `voice.leave`, and
    in the presence map of whoever reads it a `voice.leave` erases the person from the
    entire CHANNEL. Asking from inside would erase us from others' screens until the
    next heartbeat.
  */
  bento.perguntasRecebidas.length = 0
  ana.call.perguntarQuemEsta(ana.session.channels)
  await pausa(1500)
  check(
    "a Ana, que está na chamada, não perguntou por este canal",
    bento.perguntasRecebidas.length === 0,
    JSON.stringify(bento.perguntasRecebidas),
  )
  check(
    "e o Bento continua na sala aos olhos da Ana",
    ana.quemEstaEm(canal, SALA).includes(bento.address),
    ana.quemEstaEm(canal, SALA).join(","),
  )

  // ---------------------------------------------------------------------------
  // 7. No visible errors anywhere.
  // ---------------------------------------------------------------------------
  for (const quem of [ana, bento, carla]) {
    check(`nenhum erro visível na sessão da ${quem.nome}`, quem.erros.length === 0, quem.erros.join(" | "))
  }
} catch (erro) {
  check(`sem excepções pelo caminho: ${erro.message}`, false)
  console.error(erro.stack)
}

const passaram = results.filter(Boolean).length
console.log(`\n${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
