/**
 * Clear the server state to repeat a test from scratch.
 *
 * It exists because cleanup was in a loose command that I ran from memory, and on 6
 * August that deleted the founding record that the channel owner had just
 * published, minutes after I asked him to do it. The command could not
 * tell the difference between test state and someone else's work,  * and could not, because everything the server keeps is encrypted.
 *
 * Now it requires explicit confirmation and tells you what it will destroy before
 * doing it. Not a technical safeguard, but a mandatory stop: whoever runs
 * this must look at the numbers and type yes.
 *
 * Usage:
 *   node scripts/limpar-servidor.mjs            # just shows what exists
 *   ORWELL_APAGAR=sim node scripts/limpar-servidor.mjs
 *
 * The database, by default, is the LOCAL development one (.dev-data/enclave.sqlite),
 * or whichever ORWELL_BASE says. The production server only with
 * ORWELL_ALVO=producao and ORWELL_SSH (user@host); ORWELL_SSH_KEY
 * chooses the key if needed. It pointed to production by default, against house rules: a script
 * that deletes everything cannot have production as the place where you land by accident.
 *
 * NINE tables, always. Missing channel_claims or channel_activity leaves the
 * channel marked as used, no one recreates the common room, and all accounts
 * end up asking to enter a room that does not exist. That cost three test runs
 * to figure out.
 *
 * Missing channel_epochs is worse and more silent: the recreated room is born at epoch 0,
 * the server remembers the epoch of the deleted group, and refuses as stale every
 * commit from the new group, no one enters, no one is invited, and the only sign
 * is a `stale-epoch` on the socket of whoever tries.
 *
 * And group_infos: the entry card of the deleted group was waiting for arrivals,
 * and with no channel epoch to contradict it, it was delivered, the door
 * to a room that no longer exists.
 *
 * And vaults with cofres_meta (phase 3a): the encrypted state of deleted channels
 * stayed on disk, and a new room at the same address inherited the versions from
 * the old vault. On a database before vaults, both are missing and skipped.
 *
 * And THE MARKER, always. Deleting the tables clears the server but tells the
 * clients nothing: each one still has the rooms in the vault, talking about a state that
 * on the other side no longer exists. The `reset_at_minute` is what makes them forget, and on
 * 7 August the cleanup was done without it, the space was claimed by an
 * address that no longer existed, and no one could create it. The two halves are
 * one operation; that is why they live here together and not in two commands.
 *
 * What we do NOT touch: `accounts_reset_at_minute`. That key calls
 * `vault.destroy()` on each client and deletes the private key, the
 * accounts cease to exist, there is no way to recover them, and the owner of this project
 * said explicitly to keep them. If it is ever really needed, it is
 * his decision and not a line in a cleanup script.
 *
 * The `accounts` table also does not get deleted, for the same reason.
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

// A local database that does not exist does not get created: sqlite3 would create it empty.
if (!PRODUCAO && !existsSync(BASE)) {
  console.error(`A base local nao existe: ${BASE}`)
  console.error("Diz qual e com ORWELL_BASE, ou ORWELL_ALVO=producao para o servidor.")
  process.exit(1)
}
if (!PRODUCAO) console.log(`Base local: ${BASE}`)
const TABELAS =["events", "subscriptions", "key_packages", "channel_claims", "channel_activity", "channel_epochs", "group_infos", "cofres", "cofres_meta"]

/**
 * Run SQL on the database with `-bail`: at the first error sqlite3 stops and
 * exits with an error, and any open transaction rolls back when the connection
 * closes. The `.timeout` waits for the server instead of failing if it is
 * writing at that moment.
 */
function noServidor(sql) {
  if (!PRODUCAO) {
    return execFileSync("sqlite3", ["-bail", "-cmd", ".timeout 5000", BASE, sql], { encoding: "utf8" }).trim()
  }
  return execFileSync(
    "ssh",
    [...CHAVE, "-o", "BatchMode=yes", ANFITRIAO, `sqlite3 -bail -cmd '.timeout 5000' ${BASE} "${sql}"`],
    { encoding: "utf8" },
  ).trim()
}

// Accounts are counted in `accounts`, that is where they live. Counting by
// `key_packages` would give a different number, of who has keys to use, and
// would make the warning lie about what would survive.
const contas = noServidor("SELECT count(*) FROM accounts;")
const eventos = noServidor("SELECT count(*) FROM events;")
const canais = noServidor("SELECT count(DISTINCT channel) FROM subscriptions;")
const reclamados = noServidor("SELECT count(*) FROM channel_claims;")

console.log("O que existe agora no servidor:")
console.log(`  contas:     ${contas}  (sobrevivem)`)
console.log(`  eventos:    ${eventos}`)
console.log(`  canais:     ${canais}`)
console.log(`  reclamados: ${reclamados}`)

if (process.env.ORWELL_APAGAR !== "sim") {
  console.log("")
  console.log("Nada foi apagado.")
  console.log("Isto destroi historico, salas, feeds e registos de administracao de TODA a gente,")
  console.log("incluindo o que alguem tenha acabado de fazer. Nao ha como distinguir: esta tudo cifrado.")
  console.log("As CONTAS mantem-se — chave, frase-passe e perfil. E o que muda e onde elas estao.")
  console.log("")
  console.log("Para apagar mesmo:  ORWELL_APAGAR=sim node scripts/limpar-servidor.mjs")
  process.exit(0)
}

// Only the tables the database has. A database from before `channel_epochs` would
// make the DELETE blow up in the middle: the first five already went, and the
// marker, which came next, never got written, the worst of both worlds.
const existentes = new Set(noServidor("SELECT name FROM sqlite_master WHERE type = 'table';").split("\n"))
const aApagar = TABELAS.filter((tabela) => existentes.has(tabela))
const emFalta = TABELAS.filter((tabela) => !existentes.has(tabela))
if (emFalta.length > 0) console.log(`\nesta base nao tem: ${emFalta.join(", ")} (salta-se)`)

console.log("\na apagar...")

// One transaction, with the marker inside it and at the end. Either all or
// nothing: without this, a failure in the middle left tables deleted and no
// marker, and clients talking about rooms that no longer exist. And the marker
// never before the tables: a connected client could see the reset, forget the
// rooms and claim the space again before the DELETE, which led to a new claim
// with it. Inside the same transaction, nobody sees one without the other.
const minuto = Math.floor(Date.now() / 60000)
noServidor(
  [
    "BEGIN IMMEDIATE;",
    ...aApagar.map((tabela) => `DELETE FROM ${tabela};`),
    `INSERT OR REPLACE INTO server_meta (key,value) VALUES ('reset_at_minute', ${minuto});`,
    "COMMIT;",
  ].join(" "),
)

// Outside the transaction, because it must be (SQLite does not accept VACUUM
// inside one). If it fails, what matters is done: it is just disk space.
try {
  noServidor("VACUUM;")
} catch (erro) {
  console.log(`(o VACUUM falhou, e nao faz mal: ${String(erro).split("\n")[0]})`)
}

console.log(`apagado. contas mantidas: ${noServidor("SELECT count(*) FROM accounts;")}`)
console.log(`marcador escrito: reset_at_minute = ${minuto}`)
console.log("")
console.log("Cada cliente vai esquecer salas e feeds no proximo login, e manter conta, chave e perfil.")
console.log("Alguem tem de reclamar o espaco outra vez — o primeiro a faze-lo fica fundador.")
