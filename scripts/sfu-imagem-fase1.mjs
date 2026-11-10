/**
 * Does the production image really have an SFU running?
 *
 * Phase 0 measured the `--ignore-scripts` trap in a lab image
 * (`scripts/sfu-prova/imagem-do-servidor.sh`). This measures `infra/Dockerfile`
 * for real, with the fix applied, and measures it by the ONE question that
 * matters to whoever deploys: **does `hello.ok` announce the `sfu` capability?**
 *
 * The question is that and not "is the file there" because the capability comes
 * from the engine's STATE, `Gateway.declararSfu` takes a predicate that reads
 * `motor.estaDePe()`. If the worker doesn't start, for any reason, the capability
 * doesn't come out. So seeing it on the wire proves the whole chain at once: the
 * library installed, the binary in place, the environment variable pointing to
 * it, the worker starting inside the container, and the gateway knowing about it.
 *
 * And you measure the pair: **first without `ENCLAVE_SFU_PORT`**, where the
 * capability MUST be absent. If it was there in both cases, you weren't measuring
 * anything, that's the same discipline as Phase 0's sabotages.
 *
 *   docker build --platform linux/amd64 --target server -t orwell-fase1-server -f infra/Dockerfile .
 *   node scripts/sfu-imagem-fase1.mjs
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { WebSocket } from "ws"
import { generateIdentity, moradaDeSala, parseServerName, sign, toBase64, fromBase64 } from "@enclave/protocol"

const IMAGEM = process.env.IMAGEM ?? "orwell-fase1-server"
const PLATAFORMA = process.env.PLATAFORMA ?? "linux/amd64"
const PORTO_SFU = 44300
const ANUNCIADO = "203.0.113.7"

const docker = (...args) => spawnSync("docker", args, { encoding: "utf8" })

/** A free port on the host, to not collide with anything there. */
async function portoLivre() {
  const { createServer } = await import("node:net")
  const servidor = createServer()
  await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto))
  const porto = servidor.address().port
  await new Promise((pronto) => servidor.close(pronto))
  return porto
}

async function capacidades(porto) {
  const socket = new WebSocket(`ws://127.0.0.1:${porto}/_enclave/gateway`)
  try {
    await new Promise((pronto, falhar) => {
      socket.once("open", pronto)
      socket.once("error", falhar)
      setTimeout(() => falhar(new Error("o gateway não abriu")), 10_000)
    })
    const resposta = new Promise((pronto, falhar) => {
      socket.once("message", (cru) => pronto(JSON.parse(String(cru))))
      setTimeout(() => falhar(new Error("o hello.ok não chegou")), 10_000)
    })
    socket.send(JSON.stringify({ t: "hello", version: 1 }))
    const frame = await resposta
    return frame.capabilities ?? []
  } finally {
    socket.close()
  }
}

/**
 * The ICE candidates of a transport created INSIDE the container.
 *
 * This closes point 4 of "what this plan doesn't know": the `announcedAddress`.
 * Phase 0's proof all ran on `127.0.0.1`, where it's not needed, and Phase 1
 * measured the mechanism in unit tests, but neither put the worker behind
 * Docker's bridge, which is where it matters: inside there it sees `172.x`, and
 * a candidate with that address tells the client to connect to a machine that,
 * from its side, doesn't exist.
 *
 * The full path is taken from a real client, because there's no shortcut: `#mayReach`
 * guards entry to the call, and being in a channel takes an authenticated account.
 * That's why this signs a challenge.
 */
async function candidatosDeDentro(portoGateway, anunciado) {
  // The server name is what the container has in `ENCLAVE_SERVER_NAME`, not
  // where we reach it: an account address bakes it in, and the gateway rejects
  // with `wrong-homeserver` an account from another name. Here it's `localhost`
  // without a port, the host port is a detail of the Docker mapping.
  const home = parseServerName("localhost")
  const identidade = generateIdentity(home)
  const socket = new WebSocket(`ws://127.0.0.1:${portoGateway}/_enclave/gateway`)

  const fila = []
  const espera = []
  socket.on("message", (cru) => {
    const frame = JSON.parse(String(cru))
    const quem = espera.shift()
    if (quem) quem(frame)
    else fila.push(frame)
  })
  const proximo = () =>
    fila.length > 0
      ? Promise.resolve(fila.shift())
      : new Promise((pronto, falhar) => {
          espera.push(pronto)
          setTimeout(() => falhar(new Error("o servidor não respondeu")), 10_000)
        })

  try {
    await new Promise((pronto, falhar) => {
      socket.once("open", pronto)
      socket.once("error", falhar)
    })

    socket.send(JSON.stringify({ t: "hello", version: 1 }))
    await proximo()
    socket.send(
      JSON.stringify({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) }),
    )
    const desafio = await proximo()
    socket.send(JSON.stringify({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) }))
    const autenticado = await proximo()
    if (autenticado.t !== "auth.ok") throw new Error(`a autenticação falhou: ${JSON.stringify(autenticado)}`)

    // An opaque channel waiting to be claimed: whoever requests it first gets it, and it is the standard way to create a room.
    const canal = moradaDeSala(home)
    socket.send(JSON.stringify({ t: "channel.subscribe", channels: [canal] }))

    const escopo = createHash("sha256").update("geral").digest("base64url")
    socket.send(JSON.stringify({ t: "sfu.scope.join", channel: canal, scope: escopo }))
    let entrada = await proximo()
    while (entrada.t !== "sfu.scope.joined" && entrada.t !== "sfu.error") entrada = await proximo()
    if (entrada.t !== "sfu.scope.joined") throw new Error(`não entrou na chamada: ${JSON.stringify(entrada)}`)

    socket.send(JSON.stringify({ t: "sfu.transport.create", channel: canal, scope: escopo, direction: "envio" }))
    let criado = await proximo()
    while (criado.t !== "sfu.transport.created" && criado.t !== "sfu.error") criado = await proximo()
    if (criado.t !== "sfu.transport.created") throw new Error(`não deu transporte: ${JSON.stringify(criado)}`)

    return criado.iceCandidates.map((candidato) => candidato.address)
  } finally {
    socket.close()
  }
}

async function comOSfu(ligado) {
  const portoGateway = await portoLivre()
  const nome = `orwell-fase1-${ligado ? "com" : "sem"}-${Date.now()}`
  const args = [
    "run", "-d", "--rm", "--name", nome,
    "--platform", PLATAFORMA,
    "-e", "ENCLAVE_SERVER_NAME=localhost",
    "-e", "ENCLAVE_BIND_HOST=0.0.0.0",
    "-e", "ENCLAVE_BIND_PORT=8448",
    "-e", "ENCLAVE_DATA_DIR=/tmp/dados",
    "-p", `127.0.0.1:${portoGateway}:8448`,
  ]
  if (ligado) {
    // A documentation address (RFC 5737), chosen deliberately because the device does not have it: if it appears in the candidates, it came from configuration and not from some interface that happened to match.
    args.push("-e", `ENCLAVE_SFU_PORT=${PORTO_SFU}`, "-e", `ENCLAVE_SFU_ANNOUNCED_IP=${ANUNCIADO}`)
    args.push("-p", `127.0.0.1:${PORTO_SFU}:${PORTO_SFU}/udp`, "-p", `127.0.0.1:${PORTO_SFU}:${PORTO_SFU}/tcp`)
  }
  args.push(IMAGEM)

  const arranque = docker(...args)
  if (arranque.status !== 0) throw new Error(`o contentor não arrancou: ${arranque.stderr}`)

  try {
    // Wait for the gateway to respond, instead of sleeping for a random amount of time.
    const prazo = Date.now() + 30_000
    for (;;) {
      try {
        const lidas = await capacidades(portoGateway)
        const enderecos = ligado ? await candidatosDeDentro(portoGateway, ANUNCIADO) : []
        return {
          capacidades: lidas,
          candidatos: enderecos,
          registos: docker("logs", nome).stderr + docker("logs", nome).stdout,
        }
      } catch (erro) {
        if (Date.now() > prazo) throw erro
        await new Promise((pronto) => setTimeout(pronto, 300))
      }
    }
  } finally {
    docker("stop", "-t", "2", nome)
  }
}

let falhas = 0
const dizer = (bem, texto) => {
  console.log(`${bem ? "PASS " : "FAIL "} ${texto}`)
  if (!bem) falhas += 1
}

console.log(`== a imagem ${IMAGEM}, em ${PLATAFORMA}\n`)

const sem = await comOSfu(false)
dizer(!sem.capacidades.includes("sfu"), `sem ENCLAVE_SFU_PORT, a capacidade sfu NÃO é anunciada (${sem.capacidades.join(", ")})`)

const com = await comOSfu(true)
dizer(com.capacidades.includes("sfu"), `com ENCLAVE_SFU_PORT=${PORTO_SFU}, a capacidade sfu é anunciada (${com.capacidades.join(", ")})`)
dizer(
  !/motor de media não arrancou/.test(com.registos),
  "o servidor não se queixou de o motor não ter arrancado",
)
dizer(com.candidatos.length > 0, `um transporte criado de fora traz candidatos ICE (${com.candidatos.length})`)
dizer(
  com.candidatos.every((endereco) => endereco === ANUNCIADO),
  `dentro do Docker, os candidatos anunciam ${ANUNCIADO} e não o IP da bridge (${[...new Set(com.candidatos)].join(", ")})`,
)

console.log("")
if (falhas === 0) {
  console.log("A imagem de produção tem um SFU de pé, e diz-lo no fio.")
} else {
  console.log(`${falhas} verificações falharam.`)
  console.log("Registos do contentor com o SFU ligado:")
  console.log(com.registos.split("\n").slice(-20).join("\n"))
}
process.exit(falhas === 0 ? 0 : 1)
