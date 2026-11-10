/**
 * Windows auto-update, tested end-to-end without Windows.
 *
 * A local file server acts as the `/transferencias/` folder, with a signed
 * manifest and a test "installer". The code that runs is the SAME from the
 * application (`apps/client/src/main/actualizacao-windows.ts`): the search,
 * signature verification, real HTTP download, checksums and launching detached
 * with NSIS arguments. Only two things change:
 *
 *  - the address: requests to the production server are diverted to the local
 *    server (the application address is a constant, and stays that way);
 *  - the key: a test pair generated here. The real key is never touched.
 *
 * The "installer" is a Node program that writes a proof file with the arguments
 * it received. That proves it ran detached and with the right arguments, and
 * nothing more.
 *
 * WHAT CAN ONLY BE PROVED ON REAL WINDOWS (see the report
 * `docs/planos/actualizacao-windows-relatorio.md`): the splash screen in view,
 * NSIS installing silently over the running version, the application reopening
 * in the new version, and no UAC or SmartScreen.
 *
 * Usage:
 *   node --import tsx scripts/e2e-actualizacao-windows.mjs
 */
import { spawn } from "node:child_process"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { manifestoDeActualizacaoWindows } from "./instaladores.mjs"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

let modulo
try {
  modulo = await import("../apps/client/src/main/actualizacao-windows.ts")
} catch (erro) {
  console.error("Não consegui carregar o código da aplicação. Corre com: node --import tsx scripts/e2e-actualizacao-windows.mjs")
  console.error(erro.message)
  process.exit(2)
}
const { ARGUMENTOS_DO_INSTALADOR, ENDERECO_DA_ACTUALIZACAO_WINDOWS, arranqueComActualizacao, chavePublicaDe, lancarInstalador } =
  modulo

const BANCO = join(RAIZ, ".verify-data/e2e-actualizacao-windows")
const PASTA_DO_SERVIDOR = join(BANCO, "transferencias")
const NOME = "Orwell-1.0.7-windows-x64.exe"

await rm(BANCO, { recursive: true, force: true })
await mkdir(PASTA_DO_SERVIDOR, { recursive: true })
// The repository is `"type": "module"`, and a `.exe` file without this would not
// run in Node. The downloads folder sits inside the database and inherits this.
await writeFile(join(BANCO, "package.json"), '{ "type": "commonjs" }\n')

/** The "installer": writes the proof and exits. Long comment to have size. */
function instaladorDeEnsaio(marca) {
  return `// instalador de ensaio ${marca}\n${"// enchimento\n".repeat(2000)}require("node:fs").writeFileSync(${JSON.stringify(
    join(BANCO, "prova.json"),
  )}, JSON.stringify({ marca: ${JSON.stringify(marca)}, argumentos: process.argv.slice(2) }))\n`
}

const { privateKey: PRIVADA, publicKey } = generateKeyPairSync("ed25519")
const PUBLICA = chavePublicaDe(publicKey.export({ format: "jwk" }).x)
const { privateKey: DO_ATACANTE } = generateKeyPairSync("ed25519")

async function publicar({ versao = "1.0.7", conteudo, chave = PRIVADA, servido }) {
  const bytes = Buffer.from(conteudo)
  const manifesto = manifestoDeActualizacaoWindows(
    versao,
    { nome: NOME, bytes: bytes.length, sha512: createHash("sha512").update(bytes).digest("hex") },
    (mensagem) => sign(null, mensagem, chave),
  )
  await writeFile(join(PASTA_DO_SERVIDOR, "actualizacao-windows.json"), JSON.stringify(manifesto))
  // What the server serves may not be what was signed: that is the attack.
  await writeFile(join(PASTA_DO_SERVIDOR, NOME), servido ?? bytes)
}

/** A static file server, GET only, this folder only. */
const servidor = createServer(async (pedido, resposta) => {
  const nome = decodeURIComponent(new URL(pedido.url, "http://local").pathname.replace(/^\/transferencias\//, ""))
  const caminho = join(PASTA_DO_SERVIDOR, nome)
  if (nome.includes("/") || !existsSync(caminho)) {
    resposta.writeHead(404).end()
    return
  }
  resposta.writeHead(200, { "content-length": (await stat(caminho)).size })
  createReadStream(caminho).pipe(resposta)
})
await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto))
const LOCAL = `http://127.0.0.1:${servidor.address().port}`

/** The application `fetch`, with the production origin swapped for the local one. */
const ORIGEM_DE_PRODUCAO = new URL(ENDERECO_DA_ACTUALIZACAO_WINDOWS).origin
const buscar = (url, init) => fetch(String(url).replace(ORIGEM_DE_PRODUCAO, LOCAL), init)

/** The installer runs via `node`, because there is no Windows here. The arguments
 *  are the same ones the application passes to NSIS. */
const instalar = (caminho) => lancarInstalador(process.execPath, [caminho, ...ARGUMENTOS_DO_INSTALADOR], spawn)

async function arrancar(extras = {}) {
  await rm(join(BANCO, "prova.json"), { force: true })
  const estados = []
  const resultado = await arranqueComActualizacao({
    instalada: "1.0.6",
    chave: PUBLICA,
    pasta: join(BANCO, "descarga"),
    mostrar: (estado) => estados.push(estado.fase),
    semAdministrador: () => true,
    instalar,
    // Here installation is per-user: UAC is never asked. The Program Files path
    // is measured in `actualizacao-windows.test.ts`.
    instalarComAdministrador: async () => {
      throw new Error("o e2e local não pede o UAC")
    },
    buscar,
    ...extras,
  })
  return { resultado, estados }
}

/** Wait for proof from the detached installer (up to 5 s). */
async function prova() {
  for (let i = 0; i < 50; i++) {
    try {
      return JSON.parse(await readFile(join(BANCO, "prova.json"), "utf8"))
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  return null
}

const falhas = []
function confere(nome, condicao, detalhe = "") {
  console.log(`${condicao ? "  ok   " : "  FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
  if (!condicao) falhas.push(nome)
}

console.log(`servidor local em ${LOCAL}\n`)

// 1. O caminho bom.
await publicar({ conteudo: instaladorDeEnsaio("1.0.7") })
{
  const { resultado, estados } = await arrancar()
  const p = await prova()
  confere("versão nova bem assinada: instala", resultado.accao === "sair" && resultado.codigo === "a-instalar", resultado.codigo)
  confere("o ecrã passa por procurar, descarregar e instalar", ["a-procurar", "a-descarregar", "a-instalar"].every((f) => estados.includes(f)))
  confere("o instalador correu desligado", p?.marca === "1.0.7")
  confere("com os argumentos do NSIS", JSON.stringify(p?.argumentos) === JSON.stringify(ARGUMENTOS_DO_INSTALADOR), p?.argumentos?.join(" "))
}

// 2. The compromised server swaps the installer (same size, other bytes).
{
  const bom = instaladorDeEnsaio("1.0.7")
  const mau = bom.replace("ensaio 1.0.7", "ensaio MAU!!")
  await publicar({ conteudo: bom, servido: mau })
  const { resultado } = await arrancar()
  confere("instalador trocado no servidor: não instala", resultado.codigo === "soma-errada", resultado.codigo)
  confere("e não correu nada", (await prova()) === null)
}

// 3. The compromised server signs with its own key.
await publicar({ conteudo: instaladorDeEnsaio("ATACANTE"), chave: DO_ATACANTE })
{
  const { resultado } = await arrancar()
  confere("manifesto assinado por outra chave: não instala", resultado.codigo === "assinatura-errada", resultado.codigo)
  confere("e não correu nada", (await prova()) === null)
}

// 4. An old version, properly signed, served as if it were new.
await publicar({ versao: "1.0.5", conteudo: instaladorDeEnsaio("1.0.5") })
{
  const { resultado } = await arrancar()
  confere("versão antiga bem assinada: está em dia", resultado.codigo === "em-dia", resultado.codigo)
}

// 5. No server.
await new Promise((fechado) => servidor.close(fechado))
{
  const inicio = Date.now()
  const { resultado } = await arrancar()
  confere("sem servidor: entra na versão que tem", resultado.codigo === "sem-rede", `${resultado.codigo}, ${Date.now() - inicio} ms`)
}

await rm(BANCO, { recursive: true, force: true })
console.log("")
if (falhas.length > 0) {
  console.error(`${falhas.length} provas falharam.`)
  process.exit(1)
}
console.log("Todas as provas passaram. O que falta prova-se num Windows real: ver docs/planos/actualizacao-windows-relatorio.md.")
