/**
 * **The client marks as read what it could not read, and never asks for it again.**
 *
 *   node scripts/e2e-ordem-das-epocas.mjs      (needs `npm run build` first)
 *
 * Report from the owner to 5 October 2026: real messages gone missing on a
 * laptop that was closed for days. Not a history bug, an ORDER bug, and here's
 * the chain:
 *
 *   1. subscribe (which opens live frames from ALL channels at once)
 *      happens before recovery, on purpose;
 *   2. recovery runs ONE CHANNEL AT A TIME, in order;
 *   3. a live frame from a channel whose turn hasn't come yet applies right away,  *      the `#ancoraPresa` holds the anchor, not the APPLICATION, and a commit
 *      applied this way advances the group epoch;
 *   4. the client stores the current epoch and two (`retainKeysForEpochs: 2` in
 *      `packages/crypto/src/suite.ts`), so at the THIRD commit applied
 *      out of order the messages from the epoch we were in stop opening;
 *   5. a frame that won't open and is from a past epoch falls into
 *      `anteriorAoNossoLugar` and exits silently, without counting as deafness,  *      and that part is right, it's the decision from 16 August;
 *   6. but silence there means `"lido"`: the anchor passes over it and the
 *      event is NEVER ASKED FOR AGAIN, with the bytes still on the server.
 *
 * Step 6 is what turns an order problem into a loss problem.
 *
 * Two scenes, because the bug has two gates and both bit:
 *
 *   **Scene 1, the other channel's turn.** Bento has two channels. While the
 *   first recovers, commits from the author in the SECOND arrive live and
 *   apply all of them: his turn hasn't come, so nothing holds back the recovery.
 *   When the turn arrives, the group has already skipped four epochs and what's
 *   there won't open. The channel that loses carries over a hundred messages
 *   on purpose: the pagination variant is right here.
 *
 *   **Scene 2, mid-read.** One channel, with more events than a
 *   page holds (the limit is 100), and live commits falling during page reads.
 *   The same loss without needing a second channel.
 *
 * **THE RACE IS VERIFIED, not assumed.** This script measures a race, and a
 * script that measures a race without confirming it happened relies on luck and
 * is worthless. So each scene starts by demanding proof that the live frames
 * arrived BEFORE recovery on that channel had read what was there: without that
 * proof, the scene FAILS saying it measured nothing, instead of declaring
 * victory.
 *
 * The measure is Bento's VAULT, not what he saw pass: `history` is what
 * survives closing the app, and that's what the owner had lost. So this script's
 * vault lives in a FILE and is opened fresh before the connection
 * that recovers.
 *
 * EVERYTHING LOCAL AND EVERYTHING DISPOSABLE, following the pattern of `e2e-quem-esta.mjs`:
 * it starts its own homeserver in a temp folder that it deletes at the end, on
 * a port it checks is free, and takes no target by argument or environment.
 * There's no way to point it at production.
 *
 * **Two authors, not one.** The server's send cap is 600 por per minute
 * per account (`Gateway.ENVIOS_POR_MINUTO`), and both scenes together exceed it.
 * Each scene has her own author; without that, the second would measure the cap
 * instead of the bug, and the symptom was a send with no ack mid-script.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"

if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA = 8481
const NOME = `localhost:${PORTA}`

/**
 * How many live commits. FOUR, not one, and the number is not slack.
 *
 * `retainKeysForEpochs: 2` saves the current epoch and two: one commit applied
 * out of order leaves the previous epoch readable, two also. It is on the third
 * that the oldest drops, and the fourth is the margin against a lost update.
 */
const COMMITS_AO_VIVO = 4

const resultados = []
function check(nome, ok, detalhe = "") {
  resultados.push(Boolean(ok))
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

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-ordem-das-epocas-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA),
    ENCLAVE_COMMUNITY_MODE: "false",
    ENCLAVE_RETENTION_DAYS: "30",
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

const sessoes = []
async function arrumar(codigo) {
  for (const sessao of sessoes) {
    try {
      sessao.disconnect()
    } catch {
      // already disconnected
    }
  }
  servidor.kill()
  await new Promise((resolve) => setTimeout(resolve, 300))
  rmSync(dados, { recursive: true, force: true })
  process.exit(codigo)
}

if (!(await servidorDePe())) {
  console.error("O homeserver não arrancou:\n" + registoDoServidor.slice(-2000))
  await arrumar(2)
}

/**
 * The vault in a FILE, which is why this script uses it instead of memory.
 *
 * The proof of this is what survives closing the app. A vault in memory proves
 * the state passed through the object; a vault in a file proves it passed
 * through disk, which is where the owner went looking and did not find it.
 */
function cofreEmFicheiro(caminho) {
  return {
    supportsOsProtection: false,
    async read() {
      try {
        return new Uint8Array(readFileSync(caminho))
      } catch {
        return null
      }
    },
    async write(bytes) {
      writeFileSync(caminho, bytes)
    },
    async clear() {
      rmSync(caminho, { force: true })
    },
  }
}

const FRASE = "frase-de-teste-da-ordem"

async function conta(nome) {
  const caminho = join(dados, `cofre-${nome}.json`)
  const vault = new Vault(cofreEmFicheiro(caminho))
  await vault.create(FRASE)
  const session = new Session(vault)
  sessoes.push(session)
  const identity = await session.createIdentity(NOME)
  await session.connect()
  return { nome, caminho, vault, session, address: identity.address }
}

/** Reopen the vault from scratch: another `Vault`, another `Session`, same bytes. */
async function reabrir(quem) {
  const vault = new Vault(cofreEmFicheiro(quem.caminho))
  await vault.unlock(FRASE)
  const session = new Session(vault)
  sessoes.push(session)
  session.loadIdentity()
  return { ...quem, vault, session }
}

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function esperarPor(session, evento, condicao, etiqueta, prazoMs = 30_000) {
  return new Promise((resolve, reject) => {
    const relogio = setTimeout(() => {
      desligar()
      reject(new Error(`prazo esgotado: ${etiqueta}`))
    }, prazoMs)
    const desligar = session.on(evento, (carga) => {
      if (!condicao(carga)) return
      clearTimeout(relogio)
      desligar()
      resolve(carga)
    })
  })
}

/** The text messages the vault saves from this channel, by body. */
function corposNoCofre(vault, canal) {
  return (vault.contents.history[canal] ?? [])
    .filter((entrada) => entrada.payload?.t === "message")
    .map((entrada) => String(entrada.payload.body))
}

async function dizer(session, canal, corpo) {
  await session.send(canal, {
    t: "message",
    id: crypto.randomUUID(),
    sentAt: Date.now(),
    body: corpo,
    attachments: [],
    mentions: [],
  })
}

/**
 * The order in which things ENTERED the recovery side, for reading in the report.
 *
 * `epoch` comes from `#applyEvent` when a commit enters; `message` comes when a
 * payload opens. Informative, not assertive, on purpose: the fix is precisely
 * to stop interleaving live commits with reading, so this line changes shape
 * between the two versions and serves no guard.
 */
function gravarOrdem(session, canal) {
  const linha = []
  session.on("epoch", (e) => {
    if (e.channel === canal) linha.push("epoch")
  })
  session.on("message", (m) => {
    if (m.channel === canal && m.payload?.t === "message") linha.push("message")
  })
  return linha
}

/**
 * The race verified from the SENDER side, which is the only stable side.
 *
 * What defines the race is the instant the commits left: after the recovery
 * side had subscribed (so live updates already reach it) and before its
 * recovery had finished (`connect()` only resolves at the end of the fetch).
 * Measured this way, the script continues to prove it measured something after
 * the bug is fixed, unlike any measure taken on the ORDER of APPLICATION,
 * which is precisely what the fix changes.
 */
function corridaDeLigacao(session) {
  const estado = { acabou: false }
  estado.ligada = session.connect().then(
    () => {
      estado.acabou = true
    },
    (erro) => {
      estado.acabou = true
      throw erro
    },
  )
  return estado
}

// --- the extras who advance the epochs --------------------------------
/**
 * The extras publish key packages and DISCONNECT.
 *
 * A commit needs someone new to give way to, and a key package on the server
 * is enough for that. Leaving them connected made them join the channels and
 * republish profiles on each epoch, extra events in the count, and noise in
 * the thing itself being measured. Each publishes a pool of single-use packages,
 * so the same extra serves multiple channels.
 */
const figurantes = []
for (const nome of ["carla", "duarte", "elsa", "fausto", "gil", "helena"]) {
  const quem = await conta(nome)
  await dormir(150)
  quem.session.disconnect()
  figurantes.push(quem.address)
}
const usados = new Map()
function figurante(canal) {
  const indice = usados.get(canal) ?? 0
  usados.set(canal, indice + 1)
  const endereco = figurantes[indice]
  if (!endereco) throw new Error(`acabaram os figurantes para ${canal}`)
  return endereco
}

/** Live commits, one after another, with no one waiting for them. */
async function commitarAoVivo(autor, canal) {
  for (let i = 0; i < COMMITS_AO_VIVO; i++) await autor.session.seat(canal, figurante(canal))
}

// ===========================================================================
// Scene 1, the other channel's turn
// ===========================================================================
console.log("\n— Cena 1: commits ao vivo num canal cuja vez ainda não chegou")

const ana = await conta("ana")
const bento = await conta("bento")
// Opaque addresses: the 1.0 server does not debut rooms with names (slice 6a).
const ARQUIVO = moradaDeSala(parseServerName(NOME))
const PERDE = moradaDeSala(parseServerName(NOME))

await ana.session.createSpaceChannel(ARQUIVO)
await ana.session.createSpaceChannel(PERDE)

// Ben joins both, and joins the ARCHIVE first: recovery follows the order the
// groups were saved in the vault, so the ARCHIVE opens the queue and its
// duration gives the window.
const entraNoArquivo = esperarPor(bento.session, "channels", (e) => e.channels.includes(ARQUIVO), "Bento no arquivo")
await ana.session.seat(ARQUIVO, bento.address)
await entraNoArquivo
const entraNoPerde = esperarPor(bento.session, "channels", (e) => e.channels.includes(PERDE), "Bento no canal que perde")
await ana.session.seat(PERDE, bento.address)
await entraNoPerde
await dormir(600)

bento.session.disconnect()
await dormir(300)

// The archive gets ahead in the queue with two pages: that is what makes its
// recovery take time, and that is the time live commits take advantage of.
for (let i = 0; i < 150; i++) await dizer(ana.session, ARQUIVO, `arquivo ${i}`)

// And the channel that loses carries 110 messages in one epoch alone: more than
// a page of a hundred, which is the required variant, all from the epoch where
// Ben is.
const ESPERADAS_PERDE = []
for (let i = 0; i < 110; i++) {
  const corpo = `perde ${i}`
  await dizer(ana.session, PERDE, corpo)
  ESPERADAS_PERDE.push(corpo)
}
await dormir(600)

const bentoDeVolta = await reabrir(bento)
const ordemPerde = gravarOrdem(bentoDeVolta.session, PERDE)
// The `channels` comes on the next tick after `channel.subscribe`, so it is the
// exact signal "live updates already reach here and recovery has not yet read
// anything". Waiting on a clock instead of this would leave the proof to chance.
const subscreveu = esperarPor(bentoDeVolta.session, "channels", () => true, "Bento subscreveu")
const ligar = corridaDeLigacao(bentoDeVolta.session)
await subscreveu
await commitarAoVivo(ana, PERDE)
const corridaCena1 = !ligar.acabou
await ligar.ligada
await dormir(8_000)

check(
  "Cena 1: a corrida aconteceu (commits ao vivo com a recuperação a decorrer)",
  corridaCena1,
  `ordem de aplicação: ${ordemPerde.slice(0, 6).join(",") || "vazia"}`,
)
const lidasPerde = corposNoCofre(bentoDeVolta.vault, PERDE)
const faltamPerde = ESPERADAS_PERDE.filter((corpo) => !lidasPerde.includes(corpo))
check(
  "Cena 1: o Bento lê TODAS as 110 mensagens do canal cuja vez chegou depois",
  faltamPerde.length === 0,
  `${lidasPerde.length}/${ESPERADAS_PERDE.length} no cofre${faltamPerde.length ? `; faltam ${faltamPerde.length}, a primeira é "${faltamPerde[0]}"` : ""}`,
)
const lidasArquivo = corposNoCofre(bentoDeVolta.vault, ARQUIVO)
check(
  "Cena 1: e o canal que recuperou primeiro não perdeu nada",
  lidasArquivo.length === 150,
  `${lidasArquivo.length}/150`,
)

bentoDeVolta.session.disconnect()
ana.session.disconnect()
await dormir(300)

// ===========================================================================
// Scene 2, mid-read
// ===========================================================================
console.log("\n— Cena 2: commits ao vivo a cair a meio das páginas")

const antonio = await conta("antonio")
const carlos = await conta("carlos")
const LONGO = moradaDeSala(parseServerName(NOME))
await antonio.session.createSpaceChannel(LONGO)
const entraNoLongo = esperarPor(carlos.session, "channels", (e) => e.channels.includes(LONGO), "Carlos no longo")
await antonio.session.seat(LONGO, carlos.address)
await entraNoLongo
await dormir(600)

carlos.session.disconnect()
await dormir(300)

const ESPERADAS_LONGO = []
for (let i = 0; i < 180; i++) {
  const corpo = `longo ${i}`
  await dizer(antonio.session, LONGO, corpo)
  ESPERADAS_LONGO.push(corpo)
}
await dormir(600)

const carlosDeVolta = await reabrir(carlos)
const ordemLongo = gravarOrdem(carlosDeVolta.session, LONGO)
const subscreveuCarlos = esperarPor(carlosDeVolta.session, "channels", () => true, "Carlos subscreveu")
const ligarCarlos = corridaDeLigacao(carlosDeVolta.session)
await subscreveuCarlos
await commitarAoVivo(antonio, LONGO)
const corridaCena2 = !ligarCarlos.acabou
await ligarCarlos.ligada
await dormir(8_000)

check(
  "Cena 2: a corrida aconteceu (commits ao vivo com as páginas a serem lidas)",
  corridaCena2,
  `ordem de aplicação: ${ordemLongo.slice(0, 6).join(",") || "vazia"}`,
)
const lidasLongo = corposNoCofre(carlosDeVolta.vault, LONGO)
const faltamLongo = ESPERADAS_LONGO.filter((corpo) => !lidasLongo.includes(corpo))
check(
  "Cena 2: o Carlos lê TODAS as 180 mensagens, em duas páginas",
  faltamLongo.length === 0,
  `${lidasLongo.length}/${ESPERADAS_LONGO.length} no cofre${faltamLongo.length ? `; faltam ${faltamLongo.length}, a primeira é "${faltamLongo[0]}"` : ""}`,
)

// ===========================================================================
console.log("")
const falhas = resultados.filter((ok) => !ok).length
if (falhas > 0) {
  console.error(`${falhas} verificação(ões) a falhar de ${resultados.length}.`)
  await arrumar(1)
}
console.log(`As ${resultados.length} verificações passaram.`)
await arrumar(0)
