/**
 * Publish the installers, with checksums alongside.
 *
 * The installers are not signed, by the owner's decision on 12 August 2026:
 * on macOS the first run requires approval in System Settings, and on Windows
 * the blue SmartScreen appears. The defense against a corrupted file is the
 * SHA-256 checksum, and a checksum is only useful if published alongside the
 * file and never calculated anywhere else.
 *
 * So the downloads page is GENERATED here, from the files that exist: the size,
 * date and checksum come from the file itself at publish time. Written by hand,
 * the page said what someone remembered to write, and drifted at the first
 * installer published in a rush.
 *
 * And signs the Windows installer for auto-update (`actualizacao-windows.json`),
 * with the update private key. Without it, it refuses to publish. See
 * `apps/client/src/main/actualizacao-windows.ts`.
 *
 * Usage:
 *   node scripts/publicar-instaladores.mjs            # only prepare and show
 *   node scripts/publicar-instaladores.mjs --enviar   # and copy to the VPS
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import {
  escolherInstaladores,
  manifestoDeActualizacaoWindows,
  manifestoDeVersao,
  mensagemDaActualizacaoWindows,
} from "./instaladores.mjs"
import { entradaDaVersao, lerNovidades } from "./gerar-novidades.mjs"
import { FICHEIROS, paginaDeTransferencias, tamanhoHumano } from "./pagina-de-transferencias.mjs"

const correr = promisify(execFile)
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const ORIGEM = join(RAIZ, ".verify-data/instaladores")
const SAIDA = join(ORIGEM, "publicar")
const ENVIAR = process.argv.includes("--enviar")

/** The server (`ORWELL_SSH`, user@host), optional SSH key (`ORWELL_SSH_KEY`),
 *  and the path that Caddy serves at `/transferencias/`. */
const VPS = process.env.ORWELL_SSH ?? ""
const CHAVE = process.env.ORWELL_SSH_KEY ? ["-i", process.env.ORWELL_SSH_KEY] : []
const DESTINO = process.env.ORWELL_TRANSFERENCIAS ?? "/opt/enclave/transferencias"

const raiz = JSON.parse(await readFile(join(RAIZ, "package.json"), "utf8"))
const versao = raiz.version
/** "0.1.0" shows as "0.1" in the footer, like other pages: the patch does not
 *  matter to the reader. In the badge at the top it shows in full, because that is
 *  the version OF THE FILES being offered. */
const versaoCurta = versao.split(".").slice(0, 2).join(".")
const nomeDaVersao = raiz.nomeDaVersao

/**
 * No version ships without its entry in `docs/novidades.json`.
 *
 * The "announcements" room on the official channel shows these entries (owner's
 * request on 29 October 2026). An installer published without its entry showed
 * the previous version's news to whoever installed it. Refusing here is the last
 * place where forgetting is still cheap.
 */
if (!entradaDaVersao(lerNovidades(), versao)) {
  console.error(
    `A versão ${versao} não tem entrada em docs/novidades.json. Acrescenta a entrada e corre: node scripts/gerar-novidades.mjs`,
  )
  process.exit(3)
}

/**
 * The name of the homepage CSS, discovered not written.
 *
 * Vite puts the content hash in the name, which lets it be cached forever in the
 * browser. A page written with `/assets/estilo.css` by hand loses all styling the
 * first time someone changes a color-and no one notices, because whoever publishes
 * installers does not open the downloads page.
 */
const dist = join(RAIZ, "apps/site/dist/assets")
const assets = await readdir(dist).catch(() => [])
const folha = assets.find((nome) => nome.endsWith(".css"))
// The site script, for the same reason: it puts the visitor's system button first
// (3 November 2026). Vite gives it the name `sistema-<hash>.js`.
const guiao = assets.find((nome) => /^sistema-[\w-]+\.js$/.test(nome))
if (!folha || !guiao) {
  console.error(`Não encontrei o CSS ou o guião em ${dist}. Constrói a página primeiro: cd apps/site && npx vite build`)
  process.exit(2)
}

/** The two that matter. A `.blockmap` is not for anyone to download. */
const QUE_INTERESSAM = /\.(dmg|exe)$/

/** The name must match `ENDERECO_DA_VERSAO` in `apps/client/src/main/actualizacao.ts`,
 *  which is who fetches it. */
const NOME_DO_MANIFESTO = "versao.json"

/** The signed manifest for Windows auto-update. The name must match
 *  `ENDERECO_DA_ACTUALIZACAO_WINDOWS` in
 *  `apps/client/src/main/actualizacao-windows.ts`. */
const NOME_DO_MANIFESTO_WINDOWS = "actualizacao-windows.json"

/** The private key for updates. Outside the repository; see
 *  `scripts/gerar-chave-de-actualizacoes.mjs`. */
const CHAVE_DE_ACTUALIZACOES =
  process.env.ORWELL_CHAVE_DE_ACTUALIZACOES ?? join(process.env.HOME ?? "", ".orwell/orwell-actualizacoes.key")

const encontrados = []
for (const nome of await readdir(ORIGEM)) {
  if (!QUE_INTERESSAM.test(nome)) continue
  const caminho = join(ORIGEM, nome)
  const info = await stat(caminho)
  const bytes = await readFile(caminho)
  encontrados.push({
    nome,
    caminho,
    bytes: info.size,
    modificado: info.mtimeMs,
    // SHA-256 of the entire file, calculated here and published alongside it.
    soma: createHash("sha256").update(bytes).digest("hex"),
    // SHA-512 for auto-update: this is what the signature covers.
    sha512: createHash("sha512").update(bytes).digest("hex"),
    sistema: nome.endsWith(".dmg") ? "macOS" : "Windows",
  })
}

const { publicar: ficheiros, deFora, divergentes } = escolherInstaladores(encontrados, versao)
for (const { nome, porque } of deFora) console.log(`  de fora  ${nome} (${porque})`)

if (ficheiros.length === 0) {
  console.error(`Não há instaladores em ${ORIGEM}.`)
  console.error("Constrói primeiro: cd apps/client && npx electron-builder --config electron-builder.yml --mac --win")
  process.exit(2)
}

/*
  The page does not publish a number above a file that says another.

  The badge at the top comes from the root `package.json` and always has; the
  files came from a `readdir` and were never compared to it. Skipping the two slow
  steps-building and packing-gave a page saying "Version 0.2.0" with a button to
  download `Orwell-0.1.0-macos-universal.dmg`, and no auto-update fixes it for
  whoever already installed.

  Stop everything and do not publish the ones that mismatch: half published is the
  same bug with fewer people hit. See `scripts/instaladores.mjs`.
*/
if (divergentes.length > 0) {
  console.error(`A raiz está na ${versao} e estes instaladores dizem outra coisa:\n`)
  for (const { nome, versao: dele } of divergentes) {
    console.error(`  ${nome}  (anuncia ${dele ?? "versão nenhuma"})`)
  }
  console.error("\nNada foi publicado. Constrói de novo, e com a versão de agora:")
  console.error("  npm run build -w @enclave/client")
  console.error("  cd apps/client && npx electron-builder --config electron-builder.yml --mac --win")
  process.exit(2)
}

/*
  The Windows signature, before writing anything.
  
  Without the private key nothing is published: a new version without
  `actualizacao-windows.json` left whoever has the app installed seeing the old
  one forever, in silence. Refusing here is cheap; finding out later is not.
  
  And the signature is checked with the PUBLIC key embedded in the app, read from
  the file that goes inside it. A swapped private key signs manifests that no
  installed app accepts, and this catches it before upload.
  */
const windows = ficheiros.find((f) => f.sistema === "Windows")
let manifestoWindows = null
if (windows) {
  let privada
  try {
    privada = createPrivateKey(await readFile(CHAVE_DE_ACTUALIZACOES, "utf8"))
  } catch {
    console.error(`Não encontrei a chave das actualizações em ${CHAVE_DE_ACTUALIZACOES}.`)
    console.error("Sem ela não se assina o instalador do Windows, e nada foi publicado.")
    console.error("Se a chave se perdeu, lê scripts/gerar-chave-de-actualizacoes.mjs antes de gerar outra.")
    process.exit(4)
  }
  manifestoWindows = manifestoDeActualizacaoWindows(versao, windows, (mensagem) => sign(null, mensagem, privada))

  const fonteDaPublica = await readFile(join(RAIZ, "apps/client/src/main/chave-de-actualizacoes.ts"), "utf8")
  const x = /CHAVE_PUBLICA_DE_ACTUALIZACOES = "([A-Za-z0-9_-]{43})"/.exec(fonteDaPublica)?.[1]
  const publica = x ? createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" }) : null
  const confere =
    publica !== null &&
    verify(
      null,
      Buffer.from(mensagemDaActualizacaoWindows(manifestoWindows), "utf8"),
      publica,
      Buffer.from(manifestoWindows.assinatura, "base64"),
    )
  if (!confere) {
    console.error("A chave privada não faz par com a pública embutida na aplicação.")
    console.error("As aplicações instaladas recusavam esta actualização. Nada foi publicado.")
    process.exit(4)
  }
}

await mkdir(SAIDA, { recursive: true })

/**
 * The drawings, read from the homepage and not copied here.
 *
 * The logo is WRITTEN by `marca/gerar-marca.py` inside `index.html`. Copied into
 * this file, it would drift the day the logo changed-and no one would notice,
 * because whoever publishes installers does not open the downloads page. Read from
 * here, it cannot drift.
 */
const fonteHtml = await readFile(join(RAIZ, "apps/site/index.html"), "utf8")
function simbolo(id) {
  const abre = fonteHtml.indexOf(`<symbol id="${id}"`)
  if (abre < 0) {
    console.error(`Não encontrei o <symbol id="${id}"> em apps/site/index.html.`)
    process.exit(2)
  }
  const fecha = fonteHtml.indexOf("</symbol>", abre) + "</symbol>".length
  return fonteHtml.slice(abre, fecha)
}

/**
 * The two pages, English and Portuguese, with the same files and the same
 * checksums. The text lives in `scripts/pagina-de-transferencias.mjs`, tested
 * without installers (`apps/site/testes/transferencias.test.ts`).
 */
const dadosDaPagina = {
  versao,
  versaoCurta,
  nomeDaVersao,
  folha,
  guiao,
  simbolos: ["i-marca", "i-secretaria", "i-browser", "i-escudo"].map(simbolo).join("\n        "),
  ficheiros,
}
await mkdir(join(SAIDA, "pt"), { recursive: true })
for (const lingua of ["en", "pt"]) {
  await writeFile(join(SAIDA, FICHEIROS[lingua]), paginaDeTransferencias(lingua, dadosDaPagina), "utf8")
}
for (const f of ficheiros) {
  await writeFile(join(SAIDA, `${f.nome}.sha256`), `${f.soma}  ${f.nome}\n`, "utf8")
}

/**
 * The manifest that the installed app reads to know it fell behind.
 *
 * This manifest only warns: it is the macOS path, and Windows plan B when
 * automatic updates could not run (that one reads the signed
 * `actualizacao-windows.json`, written right after). The app compares its
 * version with this file once per startup and warns. Nothing gets downloaded
 * by it, and nothing gets executed by it.
 *
 * Written here and not by hand because this is where the truth lives: the same
 * files that generate the page generate this number.
 */
await writeFile(join(SAIDA, NOME_DO_MANIFESTO), `${JSON.stringify(manifestoDeVersao(raiz, ficheiros), null, 2)}\n`, "utf8")
if (manifestoWindows) {
  await writeFile(join(SAIDA, NOME_DO_MANIFESTO_WINDOWS), `${JSON.stringify(manifestoWindows, null, 2)}\n`, "utf8")
}

console.log(`versão ${versao}`)
for (const f of ficheiros) {
  console.log(`  ${f.sistema.padEnd(8)} ${tamanhoHumano(f.bytes).padStart(7)}  ${f.nome}`)
  console.log(`           ${f.soma}`)
}
console.log(`\npáginas (inglês e português), somas e ${NOME_DO_MANIFESTO} em ${SAIDA}`)
if (manifestoWindows) console.log(`${NOME_DO_MANIFESTO_WINDOWS} assinado (versão ${manifestoWindows.versao})`)

if (!ENVIAR) {
  console.log("\nNada foi enviado. Repete com --enviar para copiar para o VPS.")
  process.exit(0)
}

if (!VPS) {
  console.error("Falta ORWELL_SSH (utilizador@anfitriao) para enviar.")
  process.exit(2)
}
console.log("\na enviar para o VPS...")
await correr("ssh", [...CHAVE, VPS, `mkdir -p ${DESTINO}`])
/*
  Installers upload via `rsync --partial --inplace`, with retries, not via
  `scp`. On 3 November 2026 the `scp` of the 214 MB .dmg failed halfway
  ("Can't assign requested address") and left a truncated file on the VPS.
  `rsync` resumes from where it stopped. At the end we verify the checksum on
  the VPS side: a file only counts as sent when the VPS checksum matches the
  page's.
  */
async function subirComRetoma(f) {
  const ssh = `ssh ${CHAVE.join(" ")} -o IdentitiesOnly=yes -o ConnectTimeout=15 -o ServerAliveInterval=15`
  for (let tentativa = 1; ; tentativa++) {
    try {
      await correr("rsync", ["--partial", "--inplace", "-e", ssh, f.caminho, `${VPS}:${DESTINO}/`], { maxBuffer: 1024 * 1024 * 64 })
      break
    } catch (erro) {
      if (tentativa >= 8) throw erro
      console.log(`  a tentativa ${tentativa} caiu, a retomar...`)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  const { stdout } = await correr("ssh", [...CHAVE, VPS, `sha256sum ${DESTINO}/${f.nome}`])
  const lado = stdout.split(/\s+/)[0]
  if (lado !== f.soma) throw new Error(`${f.nome}: a soma no VPS (${lado}) não é a da página (${f.soma})`)
}

for (const f of ficheiros) {
  console.log(`  ${f.nome}`)
  await subirComRetoma(f)
  await correr("scp", [...CHAVE, join(SAIDA, `${f.nome}.sha256`), `${VPS}:${DESTINO}/`])
}
// Upload pages last: while files are uploading, a page that already announces
// them returns 404 to anyone arriving in the middle. English in `index.html`,
// Portuguese in `pt/index.html` (Caddy serves it at `/pt/transferencias/`).
await correr("ssh", [...CHAVE, VPS, `mkdir -p ${DESTINO}/pt`])
for (const lingua of ["en", "pt"]) {
  await correr("scp", [...CHAVE, join(SAIDA, FICHEIROS[lingua]), `${VPS}:${DESTINO}/${FICHEIROS[lingua]}`])
}

/*
  Then the manifest, for the same reason taken one step further.

  It is what makes installed apps warn users. If uploaded before the page, it
  would send them to a page that still announces the previous version. Not a
  404, worse: the page contradicts the warning that sent them there.
*/
await correr("scp", [...CHAVE, join(SAIDA, NOME_DO_MANIFESTO), `${VPS}:${DESTINO}/`])

/*
  Then the signed manifest last of all. It is what makes Windows apps download
  on their own: if uploaded before the installer, it would send them to fetch a
  file that is not there yet (download fails, they stay on their version, try
  again at next startup; not serious, but unnecessary).
*/
if (manifestoWindows) {
  await correr("scp", [...CHAVE, join(SAIDA, NOME_DO_MANIFESTO_WINDOWS), `${VPS}:${DESTINO}/`])
}
console.log("\nfeito. https://orwell.pt/transferencias/ e https://orwell.pt/pt/transferencias/")
