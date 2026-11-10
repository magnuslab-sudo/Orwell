// Does a newly registered account join the common room? (report from 2/11/2026)
//
// A founds the common room. B registers with A online. C registers with A and B
// online. Each one must get the common room and keep it during the window.
//
//   node scripts/e2e-sala-comum-registo.mjs [server] [room]
import { Session, Vault } from "@enclave/client-core"
import { generateIdentity, sign, toBase64, fromBase64 } from "@enclave/protocol"
import { WebSocket } from "ws"
import { webcrypto } from "node:crypto"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const SERVER = process.argv[2] ?? "localhost:8466"
const SALA = process.argv[3] ?? `!orwell:${SERVER}`
const JANELA_MS = Number(process.argv[4] ?? 40_000)
const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

class MemoryBackend {
  bytes = null
  supportsOsProtection = false
  async read() { return this.bytes }
  async write(b) { this.bytes = b }
  async clear() { this.bytes = null }
}

async function conta(nome) {
  const vault = new Vault(new MemoryBackend())
  await vault.create("frase-de-teste")
  const session = new Session(vault)
  await session.createIdentity(SERVER)
  const registo = []
  session.on("status", (s) => {
    registo.push(`${s.code ?? ""} ${s.detail}`)
    if (process.env.VERBOSO || s.level === "error") console.log(`  [${nome}] ${s.level} ${s.code ?? ""} ${s.detail}`)
  })
  // The order in the browser Setup (`Setup.tsx`): connect, then the profile.
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  // What the application does after connecting (App.tsx).
  void session.ensureCommonRoom().catch(() => {})
  return { nome, vault, session, registo }
}

async function ate(condicao, msMax) {
  const fim = Date.now() + msMax
  while (Date.now() < fim) {
    if (condicao()) return true
    await pausa(200)
  }
  return false
}

/*
  No port: the common room card is single-use, and whoever arrives after
  another (or an old card) enters via the lower path, admitted by an online
  member. This is the path that the production server logged on 2/11/2026.
  SEM_CARTAO=1 pulls the card before each new account, with a separate account.
*/
async function levantarCartao() {
  const id = generateIdentity(SERVER)
  const ws = new WebSocket(`ws://${SERVER}/_enclave/gateway`)
  const chegou = []
  ws.on("message", (raw) => chegou.push(JSON.parse(raw.toString("utf8"))))
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject) })
  const espera = async (t) => { for (let i = 0; i < 200; i++) { const f = chegou.find((x) => x.t === t); if (f) return f; await pausa(25) } return null }
  const enviar = (f) => ws.send(JSON.stringify(f))
  enviar({ t: "hello", version: 1, capabilities: ["commit-after-echo"] }); await espera("hello.ok")
  enviar({ t: "auth.begin", address: id.address, signingKey: toBase64(id.signingPublicKey) })
  const desafio = await espera("auth.challenge")
  enviar({ t: "auth.finish", signature: toBase64(sign(id, fromBase64(desafio.nonce))) })
  await espera("auth.ok")
  enviar({ t: "channel.groupinfo.take", channel: SALA })
  const r = await espera("channel.groupinfo")
  ws.close()
  return Boolean(r?.info)
}

/*
  INSISTENCIA_MS=n shortens the first retry (15 s in production) to see what
  happens when admission takes longer than it: in production, with dozens of
  members and mobile devices, it takes time.
*/
if (process.env.INSISTENCIA_MS) Session.REJOIN_RETRY_MS = Number(process.env.INSISTENCIA_MS)

const naSala = (c) => c.session.channels.includes(SALA)
let ultimaConta = null
const falhas = []
const verificar = (ok, frase) => {
  console.log(`  ${ok ? "ok  " : "FALHA"} ${frase}`)
  if (!ok) falhas.push(frase)
}

const A = await conta("Alice")
verificar(await ate(() => naSala(A), 20_000), "A (primeira conta) cria a sala comum")
await pausa(2_000)

/*
  The production room is not for two people: it has dozens of unprivileged online
  members, and the founder almost never. MEMBROS=n adds n unprivileged accounts
  before the new accounts; FUNDADORA_SAI=1 disconnects A after that.
*/
const membros = []
for (let i = 0; i < Number(process.env.MEMBROS ?? 0); i++) {
  const M = await conta(`Membro${i}`)
  if (!(await ate(() => naSala(M), JANELA_MS))) console.log(`  (Membro${i} não entrou)`)
  membros.push(M)
  await pausa(1_000)
}
if (membros.length) {
  await pausa(10_000)
  console.log(`  (${membros.filter(naSala).length}/${membros.length} membros na sala)`)
}
if (process.env.FUNDADORA_SAI) A.session.disconnect?.()

for (const nome of ["Bob", "Carla"]) {
  if (process.env.SEM_CARTAO) console.log(`  (cartão levantado antes de ${nome}: ${await levantarCartao()})`)
  const X = await conta(nome)
  ultimaConta = X
  const entrou = await ate(() => naSala(X), JANELA_MS)
  verificar(entrou, `${nome} entra na sala comum`)
  // And it stays: the room cannot disappear or be re-admitted in a loop.
  let saidas = 0
  const fim = Date.now() + 15_000
  while (Date.now() < fim) {
    if (!naSala(X)) saidas++
    await pausa(250)
  }
  verificar(saidas === 0, `${nome} fica na sala comum durante 15 s`)
  const readm = X.registo.filter((l) => l.includes(SALA) && (l.startsWith("channel-readopted") || l.startsWith("channel-joined entrou"))).length
  verificar(readm <= 1, `${nome} entra uma vez só (entradas/readopções: ${readm})`)
  if (process.env.REGISTO) for (const l of X.registo) console.log(`    ${nome}: ${l}`)
}

/*
  READMISSOES=n: the last account requests a place again n times, as the production
  client did from 15 em 15 s, 30, 60 e 120. Each request is a remove+add by a
  member, and each add is a broadcast to all. Measures how many messages the room
  carries per readmission (the server base, via SQL).
*/
if (process.env.READMISSOES) {
  const { execFileSync } = await import("node:child_process")
  const base = process.env.BASE ?? ".dev-data-scr/enclave.sqlite"
  const contar = () => Number(execFileSync("sqlite3", ["-readonly", base, `select count(*) from events where channel='${SALA}' and kind='application'`], { encoding: "utf8" }).trim())
  const ultima = ultimaConta
  for (let i = 0; i < Number(process.env.READMISSOES); i++) {
    const antes = contar()
    ultima.session.requestRejoin(SALA)
    await pausa(20_000)
    console.log(`  readmissão ${i + 1}: ${contar() - antes} mensagens de aplicação na sala em 20 s`)
  }
}
console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : "\ntudo ok")
process.exit(falhas.length ? 1 : 0)
