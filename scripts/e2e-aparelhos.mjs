/**
 * Slice 2 of multi-device, end-to-end, against a real server.
 *
 *   node scripts/e2e-aparelhos.mjs          (needs `npm run build` first)
 *
 * What is tested:
 *
 *   1. the `hello.ok` announces `devices` and states `retentionDays`;
 *   2. five devices from the same account join one after the other: four stay
 *      in the `devices` table, and the one that left is the FIRST (rotation
 *      deletes the oldest), read directly from the server database;
 *   3. an account that logs in via a real client publishes the v1 manifest
 *      on its own with its own device, signed by the account key;
 *   4. `manifest.get` returns it to another account, and what it returns is verified;
 *   5. republishing v1 is rejected with `stale-version`, and the stored one stays;
 *   6. a manifest signed by the right account but sent by another connection
 *      is rejected with `not-yours`;
 *   7. login without the chain (the account key hitting the address directly)
 *      STILL gets accepted. Not closed in this slice: six scripts and five
 *      server test files use it. See docs/PENDENTES.md.
 *
 * And slice 3, the claim in bundle:
 *
 *   9. the `hello.ok` announces `keypackage-bundle`; two identities from the same
 *      account publish pools (one announces the device, the other does not and the server
 *      infers it from login), the account publishes v1 and then v2 with both,
 *      signed by hand with the account key; a third one claims the bundle and
 *      gets two, one per device, with the manifest; without `bundle` gets one and
 *      the response is the usual one; with `devices` only the request. All tracked in
 *      the server's `key_packages` table, per device;
 *  10. the real client: Ben sets up an account with two devices in his channel,
 *      and the tree ends up with two leaves from him, one per device, in one
 *      commit, spending one package from each.
 *
 * And phase 5, revocation:
 *
 *  11. Dora's PC pairs a mobile, Ed adds both to a channel, and the PC revokes
 *      the mobile: the manifest goes up without it, the leaf leaves the channel
 *      (in Ed's tree and in the PC's), the mobile hears `device-revoked`, and
 *      does not come back: the session is rejected WITH `device-revoked`
 *      (any other rejection does not prove anything), a raw login with its chain
 *      gets `device-revoked`, and its packages leave the bundle. Its leaf
 *      also leaves the account channel (`!self-`, I1), which is not in the
 *      channel list but is in the groups.
 *
 * ALL LOCAL AND ALL DISPOSABLE, after the pattern of `e2e-convite-link.mjs`: it
 * raises its own homeserver in a temporary folder that it cleans up at the end,
 * on a port verified to be free, and accepts no target by argument or environment.
 * There is no way to point it at production.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { WebSocket } from "ws"
import { Session, Vault } from "@enclave/client-core"
import { deviceKeyAtLeaf, generateKeyPackages, importSession, leavesOf } from "@enclave/crypto"
import {
  fromBase64,
  generateIdentity,
  identityFromPrivateKey,
  moradaDeSala,
  parseServerName,
  sign,
  signDeviceManifest,
  signWithDevice,
  toBase64,
  verifyDeviceManifest,
} from "@enclave/protocol"
import { ed25519 } from "@noble/curves/ed25519.js"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SERVIDOR_JS = join(RAIZ, "apps/server/dist/main.js")
const PORTA = 8474
const NOME = `localhost:${PORTA}`

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

// --- the homeserver, disposable -----------------------------------------------
const dados = mkdtempSync(join(tmpdir(), "orwell-e2e-aparelhos-"))
const servidor = spawn(process.execPath, [SERVIDOR_JS], {
  env: {
    ...process.env,
    ENCLAVE_DATA_DIR: dados,
    ENCLAVE_SERVER_NAME: NOME,
    ENCLAVE_BIND_HOST: "127.0.0.1",
    ENCLAVE_BIND_PORT: String(PORTA),
    ENCLAVE_COMMUNITY_MODE: "false",
    ENCLAVE_RETENTION_DAYS: "12",
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
async function arrumar(codigoDeSaida) {
  for (const s of sessoes) {
    try {
      s.disconnect()
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

// --- a raw client, just enough to talk to the gateway ---------------
class ClienteCru {
  #fila = []
  #espera = []
  static async ligar() {
    const socket = new WebSocket(`ws://127.0.0.1:${PORTA}/_enclave/gateway`)
    await new Promise((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })
    const cliente = new ClienteCru()
    cliente.socket = socket
    socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString("utf8"))
      const w = cliente.#espera.shift()
      if (w) w(frame)
      else cliente.#fila.push(frame)
    })
    return cliente
  }
  enviar(frame) {
    this.socket.send(JSON.stringify(frame))
  }
  proximo() {
    const q = this.#fila.shift()
    if (q) return Promise.resolve(q)
    return new Promise((resolve) => {
      this.#espera.push(resolve)
      setTimeout(() => resolve({ t: "error", code: "timeout" }), 4000)
    })
  }
  async proximoDe(t) {
    for (let i = 0; i < 10; i++) {
      const f = await this.proximo()
      if (f.t === t) return f
      if (f.t === "error" && f.code === "timeout") break
    }
    throw new Error(`nunca chegou ${t}`)
  }
  fechar() {
    this.socket.close()
  }
}

/** Login with the chain (what today's client does). */
async function entrarComCadeia(cliente, identidade) {
  cliente.enviar({ t: "hello", version: 1, capabilities: ["commit-after-echo"] })
  const hello = await cliente.proximoDe("hello.ok")
  cliente.enviar({
    t: "auth.begin",
    address: identidade.address,
    signingKey: toBase64(identidade.deviceSigningPublicKey),
    accountKey: toBase64(identidade.signingPublicKey),
    deviceCert: toBase64(identidade.credential.signature),
  })
  const desafio = await cliente.proximo()
  if (desafio.t !== "auth.challenge") return { hello, resultado: desafio }
  cliente.enviar({ t: "auth.finish", signature: toBase64(signWithDevice(identidade, fromBase64(desafio.nonce))) })
  return { hello, resultado: await cliente.proximo() }
}

/** Login WITHOUT chain (what old scripts and five server suites do). */
async function entrarSemCadeia(cliente, identidade) {
  cliente.enviar({ t: "hello", version: 1 })
  await cliente.proximoDe("hello.ok")
  cliente.enviar({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) })
  const desafio = await cliente.proximo()
  if (desafio.t !== "auth.challenge") return desafio
  cliente.enviar({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) })
  return cliente.proximo()
}

const HOME = parseServerName(NOME)

try {
  // ---------------------------------------------------------------------------
  // 1. O hello.ok
  // ---------------------------------------------------------------------------
  const sonda = await ClienteCru.ligar()
  const { hello, resultado } = await entrarComCadeia(sonda, generateIdentity(HOME))
  check("hello.ok anuncia devices", hello.capabilities.includes("devices"), hello.capabilities.join(","))
  check("hello.ok diz retentionDays, o do ambiente", hello.retentionDays === 12, String(hello.retentionDays))
  check("o login com cadeia continua a entrar", resultado.t === "auth.ok", resultado.t)
  sonda.fechar()

  // ---------------------------------------------------------------------------
  // 2. Five devices from the same account: four stay, the first leaves.
  // ---------------------------------------------------------------------------
  const contaPrivada = ed25519.utils.randomSecretKey()
  const aparelhos = [1, 2, 3, 4, 5].map(() => identityFromPrivateKey(contaPrivada, HOME))
  const endereco = aparelhos[0].address
  check("os cinco aparelhos são a mesma conta", aparelhos.every((a) => a.address === endereco))
  for (const [i, aparelho] of aparelhos.entries()) {
    const c = await ClienteCru.ligar()
    const r = (await entrarComCadeia(c, aparelho)).resultado
    check(`o aparelho ${i + 1} entra`, r.t === "auth.ok", r.t)
    c.fechar()
  }
  // Read the server table. Read-only, and on a copy of the connection: the
  // server's WAL lets another process read what has already been committed.
  const db = new DatabaseSync(join(dados, "enclave.sqlite"), { readOnly: true })
  const linhas = db
    .prepare("SELECT device_key FROM devices WHERE address = ? ORDER BY added_minute ASC, rowid ASC")
    .all(endereco)
    .map((l) => toBase64(new Uint8Array(l.device_key)))
  const esperadas = aparelhos.slice(1).map((a) => toBase64(a.deviceSigningPublicKey))
  check("na tabela ficam quatro aparelhos", linhas.length === 4, String(linhas.length))
  check("o que saiu foi o primeiro, e a ordem é a de entrada", JSON.stringify(linhas) === JSON.stringify(esperadas))
  check("o primeiro aparelho já não está lá", !linhas.includes(toBase64(aparelhos[0].deviceSigningPublicKey)))

  // ---------------------------------------------------------------------------
  // 3. The real client publishes the v1 manifest on its own when it logs in.
  // ---------------------------------------------------------------------------
  class MemoryBackend {
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
  async function contaNova() {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-de-verificacao")
    const session = new Session(vault)
    const identity = await session.createIdentity(NOME)
    const erros = []
    session.on("status", (e) => {
      if (e.level === "error") erros.push(`${e.code}: ${e.detail}`)
    })
    await session.connect()
    sessoes.push(session)
    return { session, identity, erros, vault }
  }
  const ana = await contaNova()
  check("a sessão vê a capacidade devices", ana.session.suportaAparelhos)
  check("a sessão lê retentionDays", ana.session.serverRetentionDays === 12, String(ana.session.serverRetentionDays))
  // Publishing is best-effort after the handshake: give it a moment.
  for (let volta = 0; volta < 40 && ana.vault.contents.deviceManifests[ana.identity.address] === undefined; volta++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check("o cofre da Ana guarda a versão 1 do próprio manifesto", ana.vault.contents.deviceManifests[ana.identity.address] === 1)

  const guardado = db.prepare("SELECT version, manifest FROM device_manifests WHERE address = ?").get(ana.identity.address)
  check("o servidor tem o manifesto v1 da Ana na tabela", guardado?.version === 1, String(guardado?.version))
  const verificado = guardado ? verifyDeviceManifest(JSON.parse(guardado.manifest)) : { ok: false }
  check("e o que lá está verifica, com a chave de conta da Ana", verificado.ok && toBase64(verificado.manifest.accountKey) === toBase64(ana.identity.signingPublicKey))
  check(
    "e lista exactamente o aparelho da Ana",
    verificado.ok && verificado.manifest.devices.length === 1 && toBase64(verificado.manifest.devices[0].deviceKey) === toBase64(ana.identity.deviceSigningPublicKey),
  )

  // ---------------------------------------------------------------------------
  // 4. manifest.get returns it to another account.
  // ---------------------------------------------------------------------------
  const bento = await contaNova()
  const lido = await bento.session.deviceManifestOf(ana.identity.address)
  check("o Bento lê o manifesto da Ana pelo cliente, verificado", lido !== null && lido.version === 1 && lido.address === ana.identity.address)
  check("e o cofre do Bento guarda a versão vista da Ana", bento.vault.contents.deviceManifests[ana.identity.address] === 1)
  check("quem nunca publicou dá null", (await bento.session.deviceManifestOf("@ninguem:" + NOME)) === null)

  // ---------------------------------------------------------------------------
  // 5. Republishing v1 is rejected; the stored one stays.
  // ---------------------------------------------------------------------------
  const cru = await ClienteCru.ligar()
  check("a Ana entra outra vez por um cliente cru", (await entrarComCadeia(cru, ana.identity)).resultado.t === "auth.ok")
  const agora = Math.floor(Date.now() / 1000)
  const outraV1 = signDeviceManifest(ana.identity.signingPrivateKey, {
    address: ana.identity.address,
    version: 1,
    devices: [{ deviceKey: ana.identity.deviceSigningPublicKey, addedAt: agora }],
    signedAt: agora + 1,
  })
  cru.enviar({ t: "manifest.publish", manifest: outraV1 })
  const veredicto = await cru.proximoDe("manifest.published")
  check("republicar a v1 é recusado com stale-version", veredicto.ok === false && veredicto.reason === "stale-version", JSON.stringify(veredicto))
  const depois = db.prepare("SELECT manifest FROM device_manifests WHERE address = ?").get(ana.identity.address)
  check("e a guardada continua a ser a primeira", depois?.manifest === guardado?.manifest)
  const v2 = signDeviceManifest(ana.identity.signingPrivateKey, {
    address: ana.identity.address,
    version: 2,
    devices: [{ deviceKey: ana.identity.deviceSigningPublicKey, addedAt: agora }],
    signedAt: agora + 2,
  })
  cru.enviar({ t: "manifest.publish", manifest: v2 })
  check("a v2 entra", (await cru.proximoDe("manifest.published")).ok === true)
  check("e o Bento passa a ler a v2", (await bento.session.deviceManifestOf(ana.identity.address))?.version === 2)
  cru.fechar()

  // ---------------------------------------------------------------------------
  // 6. Signed by Ana, sent by Ben: not-yours.
  // ---------------------------------------------------------------------------
  const cruDoBento = await ClienteCru.ligar()
  await entrarComCadeia(cruDoBento, bento.identity)
  cruDoBento.enviar({
    t: "manifest.publish",
    manifest: signDeviceManifest(ana.identity.signingPrivateKey, {
      address: ana.identity.address,
      version: 3,
      devices: [{ deviceKey: ana.identity.deviceSigningPublicKey, addedAt: agora }],
      signedAt: agora + 3,
    }),
  })
  const alheio = await cruDoBento.proximoDe("manifest.published")
  check("uma conta não publica em nome de outra: not-yours", alheio.ok === false && alheio.reason === "not-yours", JSON.stringify(alheio))
  check("e o servidor ficou na v2", db.prepare("SELECT version FROM device_manifests WHERE address = ?").get(ana.identity.address)?.version === 2)
  cruDoBento.fechar()

  // ---------------------------------------------------------------------------
  // 7. Login without the chain stays open (not closed in this slice).
  // ---------------------------------------------------------------------------
  const antigo = await ClienteCru.ligar()
  const semCadeia = await entrarSemCadeia(antigo, generateIdentity(HOME))
  check("o login sem cadeia continua a ser aceite (porta por fechar, ver PENDENTES.md)", semCadeia.t === "auth.ok", semCadeia.t)
  antigo.fechar()

  // ---------------------------------------------------------------------------
  // 9. The claim in bundle, tracked in the server table.
  // ---------------------------------------------------------------------------
  check("hello.ok anuncia keypackage-bundle", hello.capabilities.includes("keypackage-bundle"), hello.capabilities.join(","))

  const contaDupla = ed25519.utils.randomSecretKey()
  const dupA = identityFromPrivateKey(contaDupla, HOME)
  const dupB = identityFromPrivateKey(contaDupla, HOME)
  const dup = dupA.address
  const chaveA = toBase64(dupA.deviceSigningPublicKey)
  const chaveB = toBase64(dupB.deviceSigningPublicKey)
  const porAparelho = (aparelho) =>
    db
      .prepare("SELECT claimed, count(*) AS n FROM key_packages WHERE address = ? AND device = ? GROUP BY claimed")
      .all(dup, fromBase64(aparelho))
      .reduce((acc, l) => ({ ...acc, [l.claimed ? "gastos" : "livres"]: l.n }), { livres: 0, gastos: 0 })
  const semAparelho = () => db.prepare("SELECT count(*) AS n FROM key_packages WHERE address = ? AND device IS NULL").get(dup).n

  const ligA = await ClienteCru.ligar()
  const ligB = await ClienteCru.ligar()
  check("o aparelho A da conta dupla entra", (await entrarComCadeia(ligA, dupA)).resultado.t === "auth.ok")
  check("o aparelho B da conta dupla entra", (await entrarComCadeia(ligB, dupB)).resultado.t === "auth.ok")
  const pacotesA = await generateKeyPackages(dupA, 5)
  const pacotesB = await generateKeyPackages(dupB, 5)
  // A announces the device; B does not, like a 0.2.3 client, and the server infers it from login.
  ligA.enviar({ t: "keypackage.publish", packages: pacotesA.map((p) => toBase64(p.wire)), replace: true, device: chaveA })
  ligB.enviar({ t: "keypackage.publish", packages: pacotesB.map((p) => toBase64(p.wire)), replace: true })
  ligA.enviar({ t: "ping" })
  await ligA.proximoDe("pong")
  ligB.enviar({ t: "ping" })
  await ligB.proximoDe("pong")
  check("a piscina do A tem cinco pacotes com o aparelho escrito", porAparelho(chaveA).livres === 5, JSON.stringify(porAparelho(chaveA)))
  check("a piscina do B tem cinco pacotes com o aparelho tirado do login", porAparelho(chaveB).livres === 5, JSON.stringify(porAparelho(chaveB)))
  check("nenhum pacote da conta dupla ficou sem aparelho", semAparelho() === 0, String(semAparelho()))

  // v1 with one device, and v2 with both, signed by hand with the account key.
  const agoraDup = Math.floor(Date.now() / 1000)
  ligA.enviar({
    t: "manifest.publish",
    manifest: signDeviceManifest(dupA.signingPrivateKey, { address: dup, version: 1, devices: [{ deviceKey: dupA.deviceSigningPublicKey, addedAt: agoraDup }], signedAt: agoraDup }),
  })
  check("o v1 da conta dupla entra", (await ligA.proximoDe("manifest.published")).ok === true)
  ligA.enviar({
    t: "manifest.publish",
    manifest: signDeviceManifest(dupA.signingPrivateKey, {
      address: dup,
      version: 2,
      devices: [
        { deviceKey: dupA.deviceSigningPublicKey, addedAt: agoraDup },
        { deviceKey: dupB.deviceSigningPublicKey, addedAt: agoraDup + 1 },
      ],
      signedAt: agoraDup + 1,
    }),
  })
  check("o v2 com os dois aparelhos entra", (await ligA.proximoDe("manifest.published")).ok === true)

  // A third one claims the bundle: two packages, one per device, and the manifest.
  const terceiro = await ClienteCru.ligar()
  await entrarComCadeia(terceiro, generateIdentity(HOME))
  terceiro.enviar({ t: "keypackage.claim", address: dup, bundle: true })
  const bundle = await terceiro.proximoDe("keypackage.claimed")
  check("o bundle traz dois pacotes, um por aparelho", bundle.keyPackages?.length === 2 && [chaveA, chaveB].every((c) => bundle.keyPackages.some((p) => p.deviceKey === c)), JSON.stringify(bundle.keyPackages?.map((p) => p.deviceKey)))
  check("o bundle traz o manifesto v2, e verifica", bundle.manifest?.version === 2 && verifyDeviceManifest(bundle.manifest).ok)
  check("o singular é o primeiro do bundle", bundle.keyPackage === bundle.keyPackages?.[0]?.keyPackage)
  check("gastou um pacote do A e um do B", porAparelho(chaveA).gastos === 1 && porAparelho(chaveB).gastos === 1, `${JSON.stringify(porAparelho(chaveA))} ${JSON.stringify(porAparelho(chaveB))}`)

  // Without bundle: one package, and the usual response.
  terceiro.enviar({ t: "keypackage.claim", address: dup })
  const singular = await terceiro.proximoDe("keypackage.claimed")
  check("sem bundle recebe um pacote, sem keyPackages nem manifest na resposta", singular.keyPackage !== null && !("keyPackages" in singular) && !("manifest" in singular), Object.keys(singular).join(","))
  check("e gastou exactamente um", porAparelho(chaveA).gastos + porAparelho(chaveB).gastos === 3, `${JSON.stringify(porAparelho(chaveA))} ${JSON.stringify(porAparelho(chaveB))}`)

  // With devices: only the request.
  const antesDevices = porAparelho(chaveA).gastos
  terceiro.enviar({ t: "keypackage.claim", address: dup, bundle: true, devices: [chaveB] })
  const soB = await terceiro.proximoDe("keypackage.claimed")
  check("com devices só vem o aparelho pedido", soB.keyPackages?.length === 1 && soB.keyPackages[0].deviceKey === chaveB, JSON.stringify(soB.keyPackages?.map((p) => p.deviceKey)))
  check("e o A não perdeu nada", porAparelho(chaveA).gastos === antesDevices)
  terceiro.fechar()

  // ---------------------------------------------------------------------------
  // 10. The real client sets up the dual account: two leaves, one commit.
  // ---------------------------------------------------------------------------
  // Opaque addresses: the 1.0 server does not start rooms with names (slice 6a).
  const CANAL_DUP = moradaDeSala(parseServerName(NOME))
  const livresAntes = [porAparelho(chaveA).livres, porAparelho(chaveB).livres]
  await bento.session.createSpaceChannel(CANAL_DUP)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const eventosAntes = db.prepare("SELECT count(*) AS n FROM events WHERE channel = ? AND kind = 'handshake'").get(CANAL_DUP).n
  const assento = await bento.session.seat(CANAL_DUP, dup).catch((e) => `erro: ${e.message}`)
  check("o Bento assenta a conta dupla no canal", assento === "invited", String(assento))
  await new Promise((resolve) => setTimeout(resolve, 1500))
  await bento.session.flush()
  const gravada = await importSession(CANAL_DUP, fromBase64(bento.vault.contents.groups[CANAL_DUP]))
  const arvore = gravada.state.ratchetTree
  const folhasDup = leavesOf(arvore, dup).map((f) => toBase64(deviceKeyAtLeaf(arvore, f)))
  check("a árvore do Bento tem duas folhas da conta dupla, uma por aparelho", folhasDup.length === 2 && folhasDup.includes(chaveA) && folhasDup.includes(chaveB), JSON.stringify(folhasDup))
  const eventosDepois = db.prepare("SELECT count(*) AS n FROM events WHERE channel = ? AND kind = 'handshake'").get(CANAL_DUP).n
  check("num commit só", eventosDepois - eventosAntes === 1, String(eventosDepois - eventosAntes))
  check("gastando um pacote de cada aparelho", porAparelho(chaveA).livres === livresAntes[0] - 1 && porAparelho(chaveB).livres === livresAntes[1] - 1, `${JSON.stringify(porAparelho(chaveA))} ${JSON.stringify(porAparelho(chaveB))}`)
  check("e convidar de novo é recusado", (await bento.session.invite(CANAL_DUP, dup).then(() => "entrou", (e) => e.message)) === "that person is already in this channel")
  ligA.fechar()
  ligB.fechar()

  // ---------------------------------------------------------------------------
  // 11. Revoke (phase 5): Dora's PC removes her mobile. The manifest goes up
  //     without it, the leaf leaves Ed's channel, the mobile hears it was
  //     removed, and does not come back: not via session, not via raw login,
  //     not via the packages it had published.
  // ---------------------------------------------------------------------------
  check("hello.ok anuncia device-revocation", hello.capabilities.includes("device-revocation"), hello.capabilities.join(","))
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  function esperarFase(session, fase, prazoMs = 20_000) {
    return new Promise((resolve, reject) => {
      const prazo = setTimeout(() => {
        desligar()
        reject(new Error(`nunca chegou a fase ${fase}`))
      }, prazoMs)
      const desligar = session.on("pair", (evento) => {
        if (evento.fase === fase) {
          clearTimeout(prazo)
          desligar()
          resolve(evento)
        } else if (evento.fase === "falhou") {
          clearTimeout(prazo)
          desligar()
          reject(new Error(`falhou: ${evento.razao}`))
        }
      })
    })
  }
  async function folhasDe(quem, canal, endereco) {
    await quem.session.flush()
    const grupo = await importSession(canal, fromBase64(quem.vault.contents.groups[canal]))
    const arvore = grupo.state.ratchetTree
    return leavesOf(arvore, endereco).map((f) => toBase64(deviceKeyAtLeaf(arvore, f)))
  }
  const dora = await contaNova()
  const doraTel = await (async () => {
    const vault = new Vault(new MemoryBackend())
    await vault.create("frase-de-verificacao")
    const session = new Session(vault)
    sessoes.push(session)
    const estados = []
    session.on("status", (e) => estados.push(e.code ?? ""))
    const sasPc = esperarFase(dora.session, "sas")
    const { link } = await dora.session.emparelharComoAnfitriao()
    const sasTel = esperarFase(session, "sas")
    session.emparelharComoConvidado(link)
    await Promise.all([sasPc, sasTel])
    const certificado = esperarFase(session, "certificado")
    const concluido = esperarFase(dora.session, "concluido", 30_000)
    await session.confirmarSas()
    await dora.session.confirmarSas()
    await certificado
    const identity = session.loadIdentity()
    await session.connect()
    await esperar(500)
    session.concluirEmparelhamento()
    await concluido
    return { session, identity, vault, estados }
  })()
  const chaveDoTel = toBase64(doraTel.identity.deviceSigningPublicKey)
  const chaveDoPc = toBase64(dora.identity.deviceSigningPublicKey)
  check("a Dora emparelha o telemóvel no PC", doraTel.identity.address === dora.identity.address)
  const eduardo = await contaNova()
  const CANAL_REV = moradaDeSala(parseServerName(NOME))
  await eduardo.session.createSpaceChannel(CANAL_REV)
  await esperar(300)
  await eduardo.session.seat(CANAL_REV, dora.identity.address)
  await esperar(1500)
  const folhasAntes = (await folhasDe(eduardo, CANAL_REV, dora.identity.address)).sort()
  check("o canal do Eduardo tem as duas folhas da Dora", JSON.stringify(folhasAntes) === JSON.stringify([chaveDoPc, chaveDoTel].sort()), JSON.stringify(folhasAntes))
  const versaoAntes = db.prepare("SELECT version FROM device_manifests WHERE address = ?").get(dora.identity.address)?.version
  // The account channel (`!self-`) with both leaves, before revocation (I1).
  const SELF_DORA = dora.session.canalDaConta
  async function folhasNoSelf() {
    return dora.vault.contents.groups[SELF_DORA] ? (await folhasDe(dora, SELF_DORA, dora.identity.address)).sort() : []
  }
  /*
    The account channel is born when the PC (with the key) knows the mobile
    can use it: the mobile announces itself when it logs in, in a channel where
    there is another leaf from the account (now Ed's), and the PC creates it
    and invites the mobile on the next connection. This is the path for real
    devices, not a shortcut from the script.
    */
  doraTel.session.disconnect()
  await doraTel.session.connect()
  await esperar(1500)
  dora.session.disconnect()
  await dora.session.connect()
  for (let vez = 0; vez < 60 && (await folhasNoSelf()).length < 2; vez++) await esperar(250)
  check(
    "o canal da conta da Dora tem as duas folhas (PC e telemóvel)",
    JSON.stringify(await folhasNoSelf()) === JSON.stringify([chaveDoPc, chaveDoTel].sort()),
    JSON.stringify(await folhasNoSelf()),
  )

  await dora.session.revokeDevice(chaveDoTel)
  await esperar(2000)

  const depoisDaRevogacao = db.prepare("SELECT version, manifest FROM device_manifests WHERE address = ?").get(dora.identity.address)
  const listados = depoisDaRevogacao ? JSON.parse(depoisDaRevogacao.manifest).devices.map((d) => d.deviceKey) : []
  check("o manifesto sobe uma versão", depoisDaRevogacao?.version === versaoAntes + 1, `v${versaoAntes} → v${depoisDaRevogacao?.version}`)
  check("e já não lista o telemóvel", listados.length === 1 && !listados.includes(chaveDoTel), JSON.stringify(listados))
  check("a folha do telemóvel sai do canal do Eduardo; a do PC fica", JSON.stringify(await folhasDe(eduardo, CANAL_REV, dora.identity.address)) === JSON.stringify([chaveDoPc]))
  check("e da árvore do PC da Dora também", JSON.stringify(await folhasDe(dora, CANAL_REV, dora.identity.address)) === JSON.stringify([chaveDoPc]))
  check("e sai do canal da conta (!self-, I1): só fica o PC", JSON.stringify(await folhasNoSelf()) === JSON.stringify([chaveDoPc]), JSON.stringify(await folhasNoSelf()))
  check("o telemóvel ouviu que foi tirado da conta (device-revoked)", doraTel.estados.includes("device-revoked"), doraTel.estados.filter(Boolean).join(","))
  check("o cofre do Eduardo lembra o aparelho revogado", (eduardo.vault.contents.revokedDevices?.[dora.identity.address] ?? []).includes(chaveDoTel))

  // The revoked one does not come back: its session, again.
  doraTel.session.disconnect()
  const estadosAntes = doraTel.estados.length
  const religar = await doraTel.session.connect().then(() => "ligou", (e) => `recusado: ${e.message}`)
  await esperar(1500)
  const ouviuOutraVez = doraTel.estados.slice(estadosAntes).includes("device-revoked")
  // Rejected, and rejected FOR BEING REVOKED: any other rejection (network, server
  // down) would pass here without proving anything.
  check(
    "o telemóvel revogado volta a tentar e o servidor recusa-o com device-revoked",
    religar !== "ligou" && ouviuOutraVez,
    `${religar}; ${doraTel.estados.slice(estadosAntes).filter(Boolean).join(",")}`,
  )
  // A raw login with its chain.
  const cruDoTel = await ClienteCru.ligar()
  const loginDoTel = (await entrarComCadeia(cruDoTel, doraTel.identity)).resultado
  check("um login cru com a cadeia do telemóvel é recusado", loginDoTel.t === "error" && ["device-revoked", "bad-device-cert"].includes(loginDoTel.code), JSON.stringify(loginDoTel).slice(0, 120))
  cruDoTel.fechar()
  // The packages it had published leave the bundle.
  const cruDoEdu = await ClienteCru.ligar()
  await entrarComCadeia(cruDoEdu, generateIdentity(HOME))
  cruDoEdu.enviar({ t: "keypackage.claim", address: dora.identity.address, bundle: true })
  const bundleDaDora = await cruDoEdu.proximoDe("keypackage.claimed")
  const doBundle = (bundleDaDora.keyPackages ?? []).map((p) => p.deviceKey)
  check("o bundle da Dora já não traz pacotes do telemóvel", doBundle.length >= 1 && !doBundle.includes(chaveDoTel), JSON.stringify(doBundle))
  cruDoEdu.fechar()
  check("nenhum erro visível no PC da Dora", dora.erros.length === 0, dora.erros.join(" | "))

  // ---------------------------------------------------------------------------
  // 8. No visible errors in real sessions.
  // ---------------------------------------------------------------------------
  check("nenhum erro visível na Ana", ana.erros.length === 0, ana.erros.join(" | "))
  check("nenhum erro visível no Bento", bento.erros.length === 0, bento.erros.join(" | "))
  db.close()
} catch (erro) {
  check(`sem excepções pelo caminho: ${erro.message}`, false)
  console.error(erro.stack)
}

const passaram = results.filter(Boolean).length
console.log(`\n${passaram}/${results.length} verificações passaram`)
await arrumar(passaram === results.length ? 0 : 1)
