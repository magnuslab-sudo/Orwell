// "No name" in the common room (3/11/2026): many new accounts in a row.
//
// Own local server (never production), with the common room. A founds the room.
// O (observer) stays connected the whole time. F (observer) disconnects before
// the joins and comes back after. Then NEW accounts register in rapid sequence,
// following Setup order (connect, then name). At the end, count for each one how
// many common room members appear without a name in the directory.
//
// Also measures load: how many profile publications went to the common room
// (counted in `Session.prototype.send`, all sessions in this process) and how
// many app events the room stored on the server.
//
//   node scripts/e2e-sem-nome.mjs
//   NOVAS=15 INTERVALO_MS=300 ESPERA_MS=45000 PORTA=8511 node scripts/e2e-sem-nome.mjs
import { spawn, execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { webcrypto } from "node:crypto"
import { Session, Vault } from "@enclave/client-core"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const PORTA = Number(process.env.PORTA ?? 8511)
const SERVER = `localhost:${PORTA}`
const SALA = `!orwell:${SERVER}`
const NOVAS = Number(process.env.NOVAS ?? 12)
const INTERVALO_MS = Number(process.env.INTERVALO_MS ?? 300)
const ESPERA_MS = Number(process.env.ESPERA_MS ?? 45_000)
/*
  Whoever comes from Reddit watches and leaves. SAI_APOS_MS: each new account
  disconnects that long after being in the room (0 = stays). In production this
  is the norm, and it is what leaves a profile lost with no one to repeat it.
*/
const SAI_APOS_MS = Number(process.env.SAI_APOS_MS ?? 5_000)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(join(RAIZ, ".dev-data-scr"), { recursive: true })
const dados = mkdtempSync(join(RAIZ, ".dev-data-scr", "sem-nome-"))
const BASE = join(dados, "enclave.sqlite")
const servidor = spawn(process.execPath, [join(RAIZ, "apps/server/dist/main.js")], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: SERVER,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA),
    ENCLAVE_COMMUNITY_MODE: "true",
    ENCLAVE_COMMON_ROOM: SALA,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let registoDoServidor = ""
servidor.stdout.on("data", (b) => (registoDoServidor += b))
servidor.stderr.on("data", (b) => (registoDoServidor += b))
const fechar = (codigo) => {
  servidor.kill()
  process.exit(codigo)
}
for (let i = 0; i < 100; i++) {
  if (registoDoServidor.includes("listening") || registoDoServidor.includes(String(PORTA))) break
  await pausa(100)
}
await pausa(500)

// The load: profile publications that go to the common room.
// And the profile frames requested on demand (`q` with "pf."), with profiles and bytes.
let perfisNaSala = 0
const relatados = { tramas: 0, perfis: 0, bytes: 0 }
const enviar = Session.prototype.send
Session.prototype.send = function (canal, payload, ...resto) {
  if (canal === SALA && payload?.t === "profile") perfisNaSala++
  if (canal === SALA && payload?.t === "typing" && payload.relatos?.q?.startsWith("pf.")) {
    relatados.tramas++
    relatados.perfis += payload.relatos.itens.length
    relatados.bytes += JSON.stringify(payload.relatos).length
  }
  return enviar.call(this, canal, payload, ...resto)
}
const todas = []
const pedidosDePerfis = () => todas.reduce((n, c) => n + (c.session.estatisticasDaSincronia?.pedidosDePerfis ?? 0), 0)

class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() { return this.bytes }
  async write(b) { this.bytes = b }
  async clear() { this.bytes = null }
}

const registos = new Map()
async function conta(nome) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  await session.createIdentity(SERVER)
  const registo = []
  registos.set(nome, registo)
  session.on("status", (s) => {
    registo.push(`${s.code ?? ""} ${s.detail}`)
    if (process.env.VERBOSO || s.level === "error") console.log(`  [${nome}] ${s.level} ${s.code ?? ""} ${s.detail}`)
  })
  // The order in the browser Setup (`Setup.tsx`): connect, then the profile.
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  void session.ensureCommonRoom().catch(() => {})
  const c = { nome, vault, session }
  todas.push(c)
  return c
}

const naSala = (c) => c.session.channels.includes(SALA)
async function ate(condicao, msMax) {
  const fim = Date.now() + msMax
  while (Date.now() < fim) {
    if (condicao()) return true
    await pausa(200)
  }
  return false
}

/** Members of the common room, by the watcher's tree, without a name in the directory. */
function semNome(c) {
  const eu = c.session.identity.address
  const contas = [...new Set(c.session.channels.includes(SALA) ? c.session.membersOf(SALA).map(String) : [])]
  const dir = c.vault.contents.directory
  const falta = contas.filter((a) => a !== eu && !dir[a]?.payload?.displayName)
  return { membros: contas.length, falta }
}

const A = await conta("Alice")
if (!(await ate(() => naSala(A), 20_000))) { console.log("A não criou a sala comum"); fechar(2) }
await pausa(1_500)
const O = await conta("Observador")
if (!(await ate(() => naSala(O), 30_000))) { console.log("O não entrou"); fechar(2) }
const F = await conta("Fora")
if (!(await ate(() => naSala(F), 30_000))) { console.log("F não entrou"); fechar(2) }
await pausa(5_000)

/*
  The second symptom (3/11/2026): "general chat history disappears for me when a
  new user joins". A and O write in the common room before the joins, and O's
  history is counted in the vault (and what `history\` gives to the interface) after
  each join.
*/
const MENSAGENS = 6
for (let i = 0; i < MENSAGENS; i++) {
  const quem = i % 2 === 0 ? A : O
  await quem.session.send(SALA, { t: "message", id: `historico-${i}-${Date.now()}`, sentAt: Date.now(), body: `antes ${i}`, attachments: [] })
  await pausa(150)
}
await pausa(2_000)
const doHistorico = (c) => c.session.history(SALA).filter((e) => e.payload?.t === "message" && String(e.payload.body ?? "").startsWith("antes ")).length
const historicoMinimo = { O: doHistorico(O), A: doHistorico(A) }
const vigiar = setInterval(() => {
  historicoMinimo.O = Math.min(historicoMinimo.O, doHistorico(O))
  historicoMinimo.A = Math.min(historicoMinimo.A, doHistorico(A))
}, 100)
console.log(`  histórico antes das entradas: O ${doHistorico(O)}, A ${doHistorico(A)} (de ${MENSAGENS})`)

/*
  What O's interface receives as "message" in the common room during joins, by
  type. Before the interface fix, all of this counted toward the 400 limit of
  the in-memory conversation, and what is not conversation pushed the old
  conversation off screen (`App.historicoComEntradas.test.tsx`).
*/
const aoEcraDeO = {}
O.session.on("message", (m) => {
  if (m.channel === SALA) aoEcraDeO[m.payload?.t] = (aoEcraDeO[m.payload?.t] ?? 0) + 1
})
const relatadosAntes = { ...relatados }
const perfisAntes = perfisNaSala
const contarEventos = () =>
  Number(execFileSync("sqlite3", ["-readonly", BASE, `select count(*) from events where channel='${SALA}' and kind='application'`], { encoding: "utf8" }).trim())
const eventosAntes = contarEventos()

F.session.disconnect()
await pausa(500)

const novas = []
const entradas = []
for (let i = 0; i < NOVAS; i++) {
  entradas.push(
    conta(`Nova${String(i + 1).padStart(2, "0")}`).then(async (c) => {
      novas.push(c)
      if (SAI_APOS_MS > 0 && (await ate(() => naSala(c), ESPERA_MS))) {
        await pausa(SAI_APOS_MS)
        c.session.disconnect()
      }
    }),
  )
  await pausa(INTERVALO_MS)
}
await Promise.all(entradas)
console.log(`  ${novas.filter(naSala).length}/${novas.length} contas novas na sala comum`)
await pausa(Number(process.env.ASSENTAR_MS ?? 15_000))

const linha = (rotulo, c) => {
  const r = semNome(c)
  console.log(`  ${rotulo.padEnd(22)} membros ${String(r.membros).padStart(2)}  sem nome ${String(r.falta.length).padStart(2)}`)
  return r.falta.length
}
// An account that joins after the others have closed: only A and O are connected.
const T = await conta("Tardia")
await ate(() => naSala(T), ESPERA_MS)
await F.session.connect()
await pausa(Number(process.env.VOLTA_MS ?? 20_000))
clearInterval(vigiar)
console.log(`\n  histórico durante as entradas, o mínimo visto: O ${historicoMinimo.O}, A ${historicoMinimo.A}; no fim: O ${doHistorico(O)}, A ${doHistorico(A)} (de ${MENSAGENS})`)
const marcas = (nome) => (registos.get(nome) ?? []).filter((l) => /reseat|readopt|deaf|surd|forked|orphan|removed|rejoin|welcome/i.test(l))
for (const nome of ["Alice", "Observador"]) for (const l of marcas(nome).slice(0, 12)) console.log(`    ${nome}: ${l}`)
const historicoPerdido = MENSAGENS * 2 - historicoMinimo.O - historicoMinimo.A
console.log("\nSem nome, com as novas ainda fechadas:")
const a0 = linha("(a) O, sempre ligado", O)
const b0 = linha("(b) F, fora e de volta", F)
const t = linha("(c) Tardia", T)
// The new ones reconnect once to see what each one sees from the others (c).
if (SAI_APOS_MS > 0) {
  await Promise.all(novas.map((c) => c.session.connect().catch(() => {})))
  await pausa(Number(process.env.VOLTA_MS ?? 20_000))
}

console.log("\nSem nome, depois de as novas voltarem uma vez:")
const a = linha("(a) O, sempre ligado", O)
const b = linha("(b) F, fora e de volta", F)
let c = linha("(c) Tardia", T)
for (const n of novas) c += linha(`(c) ${n.nome}`, n)
const perfis = perfisNaSala - perfisAntes
const eventos = contarEventos() - eventosAntes
console.log(`\nCarga com ${NOVAS} contas novas: ${perfis} publicações de perfil na sala comum, ${eventos} eventos de aplicação na sala.`)
console.log(
  `  perfis a pedido: ${pedidosDePerfis()} pedidos (sinal efémero), ${relatados.tramas - relatadosAntes.tramas} tramas de resposta, ` +
    `${relatados.perfis - relatadosAntes.perfis} perfis relatados, ${relatados.bytes - relatadosAntes.bytes} bytes`,
)
console.log(`  «message» na sala que chegaram à interface de O, por tipo: ${JSON.stringify(aoEcraDeO)}`)
console.log(`TOTAL sem nome: novas fechadas a=${a0} b=${b0} tardia=${t}; depois de voltarem a=${a} b=${b} c=${c} (novas e tardia)`)
console.log(`HISTÓRICO perdido (mínimo visto): ${historicoPerdido}`)
fechar(a0 + b0 + t + a + b + c + historicoPerdido === 0 ? 0 : 1)
