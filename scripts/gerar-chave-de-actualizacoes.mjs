/**
 * Generate the auto-update key. Runs ONCE.
 *
 * ## Why we have our own key
 *
 * Installers are not signed with a commercial certificate (owner's decision on August 12, 2026). Without a signature, an updater can only trust what the server says, and a compromised `orwell.pt` would start sending code to run on everyone's machine (see the header of `apps/client/src/main/actualizacao.ts`).
 *
 * An Ed25519 key that's ours alone solves this without paying rent: the private key stays on the owner's Mac and never reaches the server; the public key goes inside the application. Anyone who gains write access to the server can swap the installer, but cannot write a signature that the public key will accept. The anchor stops being the server and becomes this file.
 *
 * ## What it does
 *
 *  1. generates the pair;
 *  2. writes the private key to `~/.orwell/orwell-actualizacoes.key`, with 600 permissions, and REFUSES to overwrite one that already exists: accidentally changing the key would leave all installed applications refusing the next updates, and there is no way back without a manual reinstall on each machine;
 *  3. writes a README beside it for whoever finds the file a year from now;
 *  4. writes the public key to `apps/client/src/main/chave-de-actualizacoes.ts`.
 *
 * Usage:
 *   node scripts/gerar-chave-de-actualizacoes.mjs             # generates the pair
 *   node scripts/gerar-chave-de-actualizacoes.mjs --publica   # rewrites only the public key from the private key that exists
 *
 * The private key path can be changed with `ORWELL_CHAVE_DE_ACTUALIZACOES`, which is what e2e does to never touch the key for real.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Outside the repository on purpose. The `.gitignore` of this repository refuses `*.key` as well, as a second lock. */
export const CAMINHO_DA_CHAVE =
  process.env.ORWELL_CHAVE_DE_ACTUALIZACOES ?? join(process.env.HOME ?? "", ".orwell/orwell-actualizacoes.key")

const FICHEIRO_DA_PUBLICA = join(RAIZ, "apps/client/src/main/chave-de-actualizacoes.ts")

const LEIA_ME = `ORWELL: CHAVE DAS ACTUALIZAÇÕES AUTOMÁTICAS
===========================================

O ficheiro orwell-actualizacoes.key, nesta pasta, é a chave privada que assina
as actualizações automáticas da aplicação Orwell para Windows.

O QUE ELA FAZ
A aplicação instalada só aceita uma versão nova se ela vier assinada com esta
chave. Assim, quem entrar no servidor do Orwell não consegue pôr as aplicações
das pessoas a instalar outra coisa.

SE PERDES ESTA CHAVE
Acabam as actualizações automáticas. Cada pessoa tem de instalar a versão
seguinte à mão, a partir da página de descargas do Orwell. Não há forma de
recuperar a chave.

SE ALGUÉM COPIA ESTA CHAVE
Essa pessoa pode assinar uma actualização falsa. Se o servidor também for
comprometido, as aplicações instalam-na. Nesse caso: gera uma chave nova,
publica uma versão nova à mão e avisa as pessoas.

O QUE TENS DE FAZER
1. Faz já uma cópia de segurança deste ficheiro (por exemplo, numa pen guardada
   num sítio seguro, ou num gestor de palavras-passe).
2. Nunca o envies por email ou chat, nunca o ponhas no servidor nem no git.
3. Quem publica a aplicação (scripts/publicar-instaladores.mjs) lê-o daqui.

Gerado por scripts/gerar-chave-de-actualizacoes.mjs.
`

/** The public key in JWK format (`x`, base64url of 32 bytes): the form that Node's `createPublicKey` accepts without hand-written DER headers. */
function ficheiroDaPublica(x) {
  return `/**
 * A chave pública das actualizações automáticas (Ed25519).
 *
 * ESCRITO por \`scripts/gerar-chave-de-actualizacoes.mjs\`. Não se edita à mão.
 *
 * É a âncora inteira da actualização automática: um instalador só se instala
 * se o manifesto que o descreve vier assinado pela privada que faz par com
 * esta. A privada vive fora do repositório, na máquina de quem publica, e nunca vai ao
 * servidor, por isso um \`orwell.pt\` comprometido não consegue fazer passar
 * uma actualização. Ver \`actualizacao-windows.ts\`.
 *
 * Trocar este valor numa versão nova deixa as versões já instaladas com a
 * chave antiga: elas recusam tudo o que a nova assinar. Uma troca de chave
 * obriga a uma instalação à mão em cada máquina.
 */
export const CHAVE_PUBLICA_DE_ACTUALIZACOES = "${x}"
`
}

async function escreverPublica(privada) {
  const { x } = createPublicKey(privada).export({ format: "jwk" })
  await writeFile(FICHEIRO_DA_PUBLICA, ficheiroDaPublica(x), "utf8")
  return x
}

if (process.argv.includes("--publica")) {
  const privada = createPrivateKey(await readFile(CAMINHO_DA_CHAVE, "utf8"))
  const x = await escreverPublica(privada)
  console.log(`pública reescrita em ${FICHEIRO_DA_PUBLICA}: ${x}`)
  process.exit(0)
}

if (existsSync(CAMINHO_DA_CHAVE)) {
  console.error(`Já existe uma chave em ${CAMINHO_DA_CHAVE}. Não escrevo por cima.`)
  console.error("Trocar a chave pára as actualizações automáticas de quem já tem a aplicação instalada.")
  console.error("Para só reescrever a pública: node scripts/gerar-chave-de-actualizacoes.mjs --publica")
  process.exit(2)
}

const { privateKey } = generateKeyPairSync("ed25519")
await mkdir(dirname(CAMINHO_DA_CHAVE), { recursive: true })
// `wx`: fails if the file appears between `existsSync` and here. Mode 600 goes in the `open` itself, and the `chmod` that follows covers a strange umask.
await writeFile(CAMINHO_DA_CHAVE, privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" })
await chmod(CAMINHO_DA_CHAVE, 0o600)
await writeFile(join(dirname(CAMINHO_DA_CHAVE), "orwell-actualizacoes-LEIA-ME.txt"), LEIA_ME, "utf8")
const x = await escreverPublica(privateKey)

console.log(`privada em ${CAMINHO_DA_CHAVE} (permissões 600)`)
console.log(`pública em ${FICHEIRO_DA_PUBLICA}: ${x}`)
console.log("\nFaz já uma cópia de segurança da privada. Sem ela acabam as actualizações automáticas.")
