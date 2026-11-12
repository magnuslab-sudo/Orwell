/**
 * Fails if any patch in this folder is not applied in `node_modules`.
 *
 * It exists because the ts-mls patch spent months outside the production image
 * without anything saying so: `infra/Dockerfile` ran `npm ci` without having
 * copied this folder, `postinstall` answered "No patch files found" and exited
 * with zero, and the served bundle kept `remove).length > 1`: the single-member
 * removal without an UpdatePath that the patch exists to prevent. The image
 * built, went up, and lied.
 *
 * It checks the EFFECT, not the process: it reads the patched file and looks
 * for both forms. `patch-package --error-on-fail` would not do, because it only
 * fails when a patch does not apply; with no patches to apply, it still exits
 * successfully.
 *
 * Usage: `node patches/verificar.mjs`, from the repository root.
 */
import { readFileSync } from "node:fs"

const REMENDOS = [
  {
    remendo: "patches/ts-mls+1.6.2.patch",
    ficheiro: "node_modules/ts-mls/dist/src/clientState.js",
    remendado: "Object.values(grouped.remove).length >= 1",
    original: "Object.values(grouped.remove).length > 1",
  },
  {
    // The validation of unmerged leaves in the joiner's tree (RFC 9420 §12.4.3.1).
    remendo: "patches/ts-mls+1.6.2.patch",
    ficheiro: "node_modules/ts-mls/dist/src/clientState.js",
    remendado: "if (!dpNode.parent.unmergedLeaves.includes(unmergedLeaf))",
    original: "arraysEqual(dpNode.parent.unmergedLeaves, n.parent.unmergedLeaves)",
  },
]

const falhas = []
for (const { remendo, ficheiro, remendado, original } of REMENDOS) {
  let texto
  try {
    texto = readFileSync(ficheiro, "utf8")
  } catch (erro) {
    falhas.push(`${remendo}: não consegui ler ${ficheiro} (${erro.code ?? erro.message})`)
    continue
  }
  if (texto.includes(original) || !texto.includes(remendado)) {
    falhas.push(`${remendo}: ${ficheiro} não tem o remendo (procurei "${remendado}")`)
  }
}

if (falhas.length > 0) {
  for (const falha of falhas) console.error(`REMENDO EM FALTA — ${falha}`)
  console.error("O `npm ci` correu sem a pasta patches/, ou com o postinstall desligado.")
  process.exit(1)
}
console.log(`remendos aplicados: ${REMENDOS.length}`)
