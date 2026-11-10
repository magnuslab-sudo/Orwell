/**
 * Unlock a channel: give it the epoch where the members are.
 *
 * The server accepts one commit per epoch in each channel (`channel_epochs`),
 * and reads the epoch in clear in the MLS header, it cannot verify it. A
 * member with a seat who sends a forged commit with the channel's exact epoch
 * locks it: the server moves to the next epoch, the true members do not apply
 * it, and all their commits are then rejected. The same happens to a group
 * channel remade with the same name, which cannot be refounded. This is the
 * known risk written in docs/THREAT-MODEL.md, and this is the operator's exit.
 *
 * Write the requested epoch (ORWELL_EPOCH), and do not delete the row.
 * Deleting it would undo itself: on the next startup, `inicializarEpochs`
 * recalculates the epoch of the whole channel without a row from the stored
 * commits, that is, from the same history that locked it, and a restart
 * before the next commit would lock it again. A written row is not recalculated.
 *
 * The right epoch is the one where the true members are, the one of the next
 * commit they will send, that is the last true commit plus one. The server does
 * not know it (that is the problem) and does not keep a record of rejections;
 * it must come from one of the members. Do not touch anything else, events,
 * card, subscriptions stay. With the server running it takes effect at once,
 * because it reads the table at each commit.
 *
 * Do not write anywhere who unlocked what or when: this server does not keep
 * logs of who does what, by design, and an operator script is no exception.
 *
 * Usage:
 *   node scripts/destrancar-canal.mjs '!984:orwell.pt'                      # show only
 *   ORWELL_EPOCH=18 node scripts/destrancar-canal.mjs '!984:orwell.pt'      # show what would change
 *   ORWELL_EPOCH=18 ORWELL_DESTRANCAR=sim node scripts/destrancar-canal.mjs '!984:orwell.pt'
 *
 * The database is by default the LOCAL development one (.dev-data/enclave.sqlite),
 * or whichever ORWELL_BASE says. The production server only with ORWELL_ALVO=producao
 * and ORWELL_SSH (user@host); ORWELL_SSH_KEY picks the key if needed.
 */
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const PRODUCAO = process.env.ORWELL_ALVO === "producao"
const ANFITRIAO = process.env.ORWELL_SSH ?? ""
const CHAVE = process.env.ORWELL_SSH_KEY ? ["-i", process.env.ORWELL_SSH_KEY] : []
if (PRODUCAO && !ANFITRIAO) {
  console.error("Falta ORWELL_SSH (por exemplo utilizador@anfitriao) para ir ao servidor.")
  process.exit(2)
}
const BASE = PRODUCAO
  ? "/var/lib/docker/volumes/enclave_server-data/_data/enclave.sqlite"
  : (process.env.ORWELL_BASE ?? fileURLToPath(new URL("../.dev-data/enclave.sqlite", import.meta.url)))

const canal = process.argv[2]

// The identifier goes into SQL and, in production, into a remote shell line.
// Only channel identifier format passes; nothing else.
if (!canal || !/^![A-Za-z0-9._-]+:[A-Za-z0-9.-]+(:[0-9]+)?$/.test(canal)) {
  console.error("Uso: node scripts/destrancar-canal.mjs '!canal:servidor'")
  console.error(canal ? `Identificador recusado: ${JSON.stringify(canal)}` : "Falta o identificador do canal.")
  process.exit(2)
}

// A local database that does not exist is not created: sqlite3 would create
// it empty beside the project, and the next query would fail with "no such table".
if (!PRODUCAO && !existsSync(BASE)) {
  console.error(`A base local não existe: ${BASE}`)
  console.error("Diz qual é com ORWELL_BASE, ou ORWELL_ALVO=producao para o servidor.")
  process.exit(1)
}

/** SQL on the database, with `-bail` and waiting for the server if it is writing. */
function naBase(sql) {
  if (!PRODUCAO) {
    return execFileSync("sqlite3", ["-bail", "-cmd", ".timeout 5000", BASE, sql], { encoding: "utf8" }).trim()
  }
  return execFileSync(
    "ssh",
    [...CHAVE, "-o", "BatchMode=yes", ANFITRIAO, `sqlite3 -bail -cmd '.timeout 5000' ${BASE} "${sql}"`],
    { encoding: "utf8" },
  ).trim()
}

// The requested epoch: a non-negative integer that fits exactly in a number.
// Validated before any query, because it also goes into SQL.
const pedida = process.env.ORWELL_EPOCH
const epochPedida = pedida !== undefined && /^(0|[1-9][0-9]{0,15})$/.test(pedida) && Number(pedida) <= Number.MAX_SAFE_INTEGER - 1
  ? Number(pedida)
  : undefined
if (pedida !== undefined && epochPedida === undefined) {
  console.error(`ORWELL_EPOCH tem de ser um inteiro não negativo, e veio ${JSON.stringify(pedida)}.`)
  process.exit(2)
}

const literal = `'${canal}'`
const epoch = naBase(`SELECT epoch FROM channel_epochs WHERE channel = ${literal};`)
const handshakes = naBase(`SELECT count(*) FROM events WHERE channel = ${literal} AND kind = 'handshake';`)
const cartao = naBase(`SELECT count(*) FROM group_infos WHERE channel = ${literal};`)

console.log(`Base: ${PRODUCAO ? `${ANFITRIAO}:${BASE}` : BASE}`)
console.log(`Canal: ${canal}`)
console.log(`  epoch guardada:      ${epoch === "" ? "nenhuma (sem epoch guardada)" : `${epoch} (só aceita commits desta epoch)`}`)
console.log(`  handshakes guardados: ${handshakes}`)
console.log(`  cartão de entrada:    ${cartao === "0" ? "não" : "sim"}`)

if (epochPedida === undefined) {
  console.log("")
  console.log("Nada foi alterado. Falta dizer a epoch em que os membros estão: ORWELL_EPOCH=n.")
  console.log("É a epoch do próximo commit que eles vão mandar: a do último commit verdadeiro, mais um.")
  process.exit(process.env.ORWELL_DESTRANCAR === "sim" ? 2 : 0)
}

console.log("")
console.log(`Destrancar grava a epoch ${epochPedida} (era ${epoch === "" ? "nenhuma" : epoch}): o canal passa a aceitar`)
console.log(`o commit da epoch ${epochPedida}, e só esse. Se não for a epoch em que os membros estão,`)
console.log("continua trancado, agora noutro número.")

if (process.env.ORWELL_DESTRANCAR !== "sim") {
  console.log("")
  console.log("Nada foi alterado.")
  console.log(`Para destrancar mesmo:  ORWELL_EPOCH=${epochPedida} ORWELL_DESTRANCAR=sim node scripts/destrancar-canal.mjs '${canal}'`)
  process.exit(0)
}

// Write, do not delete: a deleted row was recalculated from history on the
// next startup. See the header.
naBase(
  `BEGIN IMMEDIATE; INSERT INTO channel_epochs (channel, epoch) VALUES (${literal}, ${epochPedida}) ` +
    `ON CONFLICT (channel) DO UPDATE SET epoch = excluded.epoch; COMMIT;`,
)
console.log("")
console.log(`Destrancado: ${canal} aceita agora o commit da epoch ${epochPedida}.`)
