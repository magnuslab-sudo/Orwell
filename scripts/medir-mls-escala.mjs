#!/usr/bin/env node
/**
 * What MLS costs a member of a room at the scale of `!984` (slow-after-join,
 * 4/11/2026).
 *
 * Real groups, with @enclave/crypto compiled (`npx tsc -b` first). Measure for
 * N leaves: apply an external commit, a Welcome, encrypt and decrypt a message,
 * serialize the group to the vault and build the card. No network and no server:
 * it is pure CPU cost, which in the browser runs on the page thread and in the
 * desktop app on the main process.
 *
 *   node scripts/medir-mls-escala.mjs [N=120]
 */
import { generateIdentity, parseServerName } from "@enclave/protocol"
import {
  addMembers,
  createChannel,
  encryptPayload,
  exportSession,
  generateKeyPackages,
  importSession,
  joinChannel,
  joinChannelExternally,
  publishableGroupInfo,
  receive,
} from "@enclave/crypto"

const N = Number(process.argv[2] ?? 120)
const CASA = parseServerName("orwell.test")
const SALA = "!984:orwell.test"

async function medir(nome, vezes, fn) {
  const tempos = []
  let ultimo
  for (let i = 0; i < vezes; i++) {
    const t0 = performance.now()
    ultimo = await fn(i)
    tempos.push(performance.now() - t0)
  }
  tempos.sort((a, b) => a - b)
  const mediana = tempos[Math.floor(tempos.length / 2)]
  console.log(`${nome.padEnd(48)} mediana ${mediana.toFixed(1).padStart(8)} ms   (n=${vezes}, máx ${tempos.at(-1).toFixed(1)})`)
  return ultimo
}

const texto = (body) => ({ t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body, attachments: [], mentions: [], links: [] })

const idFundador = generateIdentity(CASA)
const idMembro = generateIdentity(CASA)
const [pacoteMembro] = await generateKeyPackages(idMembro, 1)
const pacotes = [pacoteMembro.publicPackage]
for (let i = 0; i < N - 2; i++) pacotes.push((await generateKeyPackages(generateIdentity(CASA), 1))[0].publicPackage)

const entrada = await addMembers(await createChannel(idFundador, SALA), pacotes)
console.log(`grupo com ${N} folhas; commit ${entrada.commit.length} B, Welcome ${entrada.welcome.length} B`)

let membro = await medir("joinChannel (Welcome)", 3, () =>
  joinChannel(SALA, entrada.welcome, pacoteMembro.publicPackage, pacoteMembro.privatePackage),
)
let fundador = entrada.session

const estado = exportSession(membro)
console.log(`exportSession: ${estado.length} B (${Math.round((estado.length * 4) / 3)} em base64 no cofre)`)
await medir("exportSession (grupo para o cofre)", 10, () => exportSession(membro))
await medir("importSession (cofre para o grupo)", 5, () => importSession(SALA, estado))

const cartao = await medir("publishableGroupInfo (o cartão)", 5, () => publishableGroupInfo(membro))
console.log(`cartão: ${cartao.length} B (${Math.round((cartao.length * 4) / 3)} caracteres em base64)`)

// Application messages: the founder writes, the member reads. It is the cost per live event.
const cifradas = []
await medir("encryptPayload (texto curto)", 50, async () => {
  const r = await encryptPayload(fundador, texto("olá"))
  fundador = r.session
  cifradas.push(r.ciphertext)
})
let i = 0
await medir("receive (mensagem de aplicação)", 50, async () => {
  const r = await receive(membro, cifradas[i++])
  if (r.kind !== "payload") throw new Error(`esperava payload: ${r.reason}`)
  membro = r.session
})

// An external commit: the newcomer builds the commit with the card; the member applies it.
const externas = []
for (let k = 0; k < 3; k++) {
  const [p] = await generateKeyPackages(generateIdentity(CASA), 1)
  const t0 = performance.now()
  const ext = await joinChannelExternally(SALA, await publishableGroupInfo(fundador), p.publicPackage, p.privatePackage)
  externas.push(performance.now() - t0)
  const rf = await receive(fundador, ext.commit)
  if (rf.kind !== "epoch") throw new Error(`fundador: ${rf.reason}`)
  fundador = rf.session
  const t1 = performance.now()
  const rm = await receive(membro, ext.commit)
  const aplicar = performance.now() - t1
  if (rm.kind !== "epoch") throw new Error(`membro: ${rm.reason}`)
  membro = rm.session
  console.log(`entrada externa ${k + 1}: quem chega monta em ${externas.at(-1).toFixed(1)} ms; quem lá está aplica em ${aplicar.toFixed(1)} ms; commit ${ext.commit.length} B`)
}
console.log(`exportSession depois de 3 epochs: ${exportSession(membro).length} B`)
