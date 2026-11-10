/**
 * Invite someone you have never talked to.
 *
 * REPRODUCES AN OPEN DEFECT. Isolated on 13 August 2026, trying to understand why
 * the bots in `churn-chamada.mjs` never received an invite.
 *
 * What happens: inviting someone to a channel sends a message in a direct conversation.
 * If that conversation already exists, the invite arrives. If it is created in the same
 * gesture -- which is the normal case, inviting someone new -- the message vanishes
 * silently. The inviter sees the invite sent; the invitee never gets anything.
 *
 * The difference is measured here: the same invite, with and without the direct
 * conversation already in place, and the only variable is that.
 *
 * Probable cause, NOT confirmed: `openDirect` creates the group and admits the other
 * person, and the message goes out right after. On the other side, the welcome has not
 * been processed when the message arrives -- and a message that arrives before the
 * welcome is not stored waiting for it.
 *
 * It was not fixed by guessing: the admission path is the most delicate part of the
 * system, and a badly measured patch there costs history. This script stays for whoever
 * fixes it to see the fix working.
 *
 * Usage:
 *   bash scripts/dev-reiniciar-servidor.sh &
 *   node scripts/e2e-convite-sem-dm.mjs
 */
import { Session, Vault } from "@enclave/client-core"
import { moradaDeSala, parseServerName } from "@enclave/protocol"

import { alvo, FRASE } from "./ambiente.mjs"

const SERVER = alvo(process.argv[2])
const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms))

class Memoria {
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

async function conta() {
  const vault = new Vault(new Memoria())
  await vault.create(FRASE)
  const session = new Session(vault)
  const identidade = await session.createIdentity(SERVER)
  await session.connect()
  return { session, address: identidade.address }
}

/**
 * One round: creates two accounts, a channel, and invites.
 *
 * @param {boolean} comDmPrimeiro open the direct conversation before inviting
 */
async function medir(comDmPrimeiro) {
  const a = await conta()
  const b = await conta()

  const vistas = []
  b.session.on("message", (evento) => vistas.push(evento))

  const sala = moradaDeSala(parseServerName(SERVER))
  await a.session.createSpaceChannel(sala)
  await pausa(800)

  if (comDmPrimeiro) {
    const dm = await a.session.openDirect(b.address)
    for (let i = 0; i < 20 && !b.session.channels.includes(dm); i++) await pausa(500)
  }

  await a.session.invite(sala, b.address, "anda ver isto")

  // Twenty seconds: way more than the happy path needs.
  const chegou = () => vistas.some((m) => m.payload?.invite)
  for (let i = 0; i < 40 && !chegou(); i++) await pausa(500)

  a.session.disconnect()
  b.session.disconnect()
  return { chegou: chegou(), mensagens: vistas.length }
}

const sem = await medir(false)
const com = await medir(true)

console.log("")
console.log(`sem conversa directa previa:  ${sem.chegou ? "convite chegou" : "CONVITE PERDIDO"} (${sem.mensagens} mensagens)`)
console.log(`com conversa directa previa:  ${com.chegou ? "convite chegou" : "CONVITE PERDIDO"} (${com.mensagens} mensagens)`)
console.log("")

if (!sem.chegou && com.chegou) {
  console.log("O defeito continua: convidar alguem novo perde o convite.")
  process.exit(1)
}
if (sem.chegou && com.chegou) {
  console.log("Corrigido: o convite chega nos dois casos.")
  process.exit(0)
}
console.log("Resultado inesperado. Se nem com a conversa aberta chega, o problema e outro.")
process.exit(2)
