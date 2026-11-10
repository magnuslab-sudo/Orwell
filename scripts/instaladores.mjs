/**
 * Which installers get published, and what stops them from lying.
 *
 * All of this used to live inside `publicar-instaladores.mjs`, tangled with `readdir`, `scp`, and page writing. It came out here for the reason that always applies in this house: the decision is measurable and the rest is I/O. There is no file system here, takes in a list of descriptions, returns the list of what publishes and the list of what is refused, and so there is a test that exercises it (`apps/site/testes/instaladores.test.ts`).
 *
 * ## The fault this exists to catch
 *
 * The downloads page is generated, and the big number at the top comes from the root `package.json`. That guarantees the page does not invent a version. It guaranteed nothing about the FILES it offers: the names came from a `readdir` of the working folder, picked by `mtime`, and no one compared the number inside the name with the number at the top.
 *
 * The result, when someone skips `npm run build -w @enclave/client` and `electron-builder`, which are the two slow steps, and thus the two skipped: the page said **Version 0.2.0** above a button that downloaded `Orwell-0.1.0-macos-universal.dmg`. A page lying with the right number.
 *
 * And it is the worst form of this fault, because no auto-update after can fix it: whoever downloads gets 0.1.0 and stays with it.
 *
 * **The rule, and it is harsh on purpose: an installer whose name does not carry the root version does not publish.** It does not warn and publish anyway. The entire publication stops, because publishing half, the new macOS, the old Windows, is the same fault with fewer people hitting it.
 */

/**
 * The version an installer name announces, or `undefined` if it announces none.
 *
 * The name is written by `artifactName` of `electron-builder.yml`, today
 * `${productName}-${version}-<sistema>-${arch}.${ext}`, `Orwell-0.2.0-macos-universal.dmg`.
 *
 * Read by PATTERN and not by the product: we search for a trio of numbers
 * between hyphens, not `Orwell-`. The product name changed once, and a reader that
 * requires it would return `undefined` on the day of the rename, which, with the
 * guard below, would stop the entire release because of a legitimate rename.
 *
 * `undefined` and not an empty string: "I don't know" and "it says it is the empty
 * version" are different answers, and the caller treats them differently.
 */
export function versaoDoNome(nome) {
  return /-(\d+\.\d+\.\d+)-/.exec(nome)?.[1]
}

/**
 * What publishes, what stays out, and what stops everything.
 *
 * Three answers not one, because these are three different things:
 *
 *  - `publicar`: one per system, the newest by `mtime`.
 *  - `deFora`: older builds of the same system. Normal, and said out loud the same way, an installer silently discarded is indistinguishable from one never built. On August 13, 2026 the folder held four, two with the wrong icon, and the page offered all four.
 *  - `divergentes`: those announcing a version that is not the root's. **This is not a warning, it is a stop.** See the note at the top.
 *
 * The newest is picked by modification date not by name: the names changed once already, and what you want to publish is always the build just finished. The version check is on the name, because the name goes on the page and on the URL people copy.
 *
 * @param {{nome: string, sistema: string, modificado: number}[]} encontrados
 * @param {string} versaoEsperada the root's, the one the page announces
 */
export function escolherInstaladores(encontrados, versaoEsperada) {
  const porSistema = new Map()
  for (const ficheiro of encontrados) {
    const anterior = porSistema.get(ficheiro.sistema)
    if (!anterior || ficheiro.modificado > anterior.modificado) porSistema.set(ficheiro.sistema, ficheiro)
  }

  const escolhidos = [...porSistema.values()]
  const nomesEscolhidos = new Set(escolhidos.map((f) => f.nome))

  const deFora = encontrados
    .filter((f) => !nomesEscolhidos.has(f.nome))
    .map((f) => ({ nome: f.nome, porque: `há um ${f.sistema} mais recente` }))

  /*
    Only the CHOSEN are measured against the version.
    
    An old installer in the working folder is the normal case, it is what was left from the last publication, and making publication stop because of it would require cleaning the folder before each run. What cannot pass is an old one being PUBLISHED, and that is always one of the chosen.
    */
  const divergentes = escolhidos
    .map((f) => ({ nome: f.nome, versao: versaoDoNome(f.nome) }))
    .filter(({ versao }) => versao !== versaoEsperada)

  return { publicar: escolhidos, deFora, divergentes }
}

/**
 * What the installed application reads to know it is behind.
 *
 * Written by the same act that publishes installers and the page, from the same files, and that is the only reason it cannot diverge from them: there is no number here that anyone has to remember to bump. A publication that runs leaves the manifest right; one that does not leaves no new manifest, and the application keeps seeing the previous version, which is the truth.
 *
 * **There is no address here, and the absence is the design.** It used to have a `descargas` field with the production page, out of courtesy for whoever opened the file by hand. It came out for two reasons pointing to the same place:
 *
 *  - **nothing read it.** The application has its own address written in code (`ENDERECO_DAS_DESCARGAS`, in `apps/client/src/main/actualizacao.ts`), and a field no one reads in a security artifact is worse than useless: it looks authoritative, and one day someone hooks it up. A manifest that chose where to send its readers was phishing served over HTTPS from our own domain, open to anyone who gained write access to that folder;
 *  - **`guioes.producao.test.ts` refuses for a script to name production in code**, and refuses it because of two real data losses in August 2026. The right fix was to remove the field, not add an exception to the lock.
 *
 * **The checksums go here for the same reason they go on the page**: they are the only defense this product has against a tampered file, because installers are not signed. See the header of `electron-builder.yml`.
 *
 * @param {{version: string, nomeDaVersao: string}} raiz
 * @param {{nome: string, sistema: string, bytes: number, soma: string}[]} ficheiros
 */
export function manifestoDeVersao(raiz, ficheiros) {
  return {
    versao: raiz.version,
    nome: raiz.nomeDaVersao,
    ficheiros: ficheiros.map((f) => ({
      sistema: f.sistema,
      nome: f.nome,
      bytes: f.bytes,
      soma: f.soma,
    })),
  }
}

/**
 * The prefix of what is signed. Separates THIS signature from any other the same key might make one day: a signature taken from another context does not pass through an update. The `v1` changes if the message form changes.
 *
 * Written twice, here and in `apps/client/src/main/actualizacao-windows.ts` (the application does not import scripts). The test `actualizacao-windows.test.ts` signs with this function and verifies with the application's: if the two diverge, it fails.
 */
export const PREFIXO_DA_ASSINATURA_WINDOWS = "orwell-actualizacao-windows-v1"

/**
 * The message that the private key signs: the version, the name, the size, and the SHA-512 of the installer, one per line.
 *
 * The four fields not just the checksum, because each closes a door:
 *  - the version stops an old, well-signed installer from being served with a new number on top (and the application only accepts higher versions);
 *  - the size makes the download stop at the first extra byte;
 *  - the checksum ties the signature to that file and no other.
 *
 * @param {{versao: string, ficheiro: string, bytes: number, sha512: string}} campos
 */
export function mensagemDaActualizacaoWindows({ versao, ficheiro, bytes, sha512 }) {
  return [PREFIXO_DA_ASSINATURA_WINDOWS, `versao=${versao}`, `ficheiro=${ficheiro}`, `bytes=${bytes}`, `sha512=${sha512}`].join("\n")
}

/**
 * The Windows auto-update manifest, signed.
 *
 * This is the file the installed application reads at startup (`actualizacao-windows.json`). The signature is Ed25519, with the update key (`scripts/gerar-chave-de-actualizacoes.mjs`), and covers everything the application uses to decide. A field changed on the server makes the signature wrong, and the application enters the version it has.
 *
 * @param {string} versao
 * @param {{nome: string, bytes: number, sha512: string}} ficheiro
 * @param {(mensagem: Buffer) => Buffer} assinar who has the private key; taken as a parameter so this stays without disk or keys inside
 */
export function manifestoDeActualizacaoWindows(versao, ficheiro, assinar) {
  const campos = { versao, ficheiro: ficheiro.nome, bytes: ficheiro.bytes, sha512: ficheiro.sha512 }
  const assinatura = assinar(Buffer.from(mensagemDaActualizacaoWindows(campos), "utf8")).toString("base64")
  return { ...campos, assinatura }
}
