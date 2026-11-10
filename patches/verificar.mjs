/**
 * Falha se algum remendo desta pasta não estiver aplicado em `node_modules`.
 *
 * Existe porque o remendo do ts-mls passou meses fora da imagem de produção sem
 * que nada o dissesse: o `infra/Dockerfile` corria `npm ci` sem ter copiado esta
 * pasta, o `postinstall` respondia "No patch files found" e saía com zero, e o
 * bundle servido ficou com `remove).length > 1` — a expulsão singular sem
 * UpdatePath que o remendo existe para impedir. A imagem construía, subia, e
 * mentia.
 *
 * Verifica o EFEITO e não o processo: lê o ficheiro remendado e procura as duas
 * formas. `patch-package --error-on-fail` não servia, porque só falha quando um
 * remendo não aplica — sem remendos para aplicar, sai com sucesso na mesma.
 *
 * Uso: `node patches/verificar.mjs`, a partir da raiz do repositório.
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
    // A validação das folhas por fundir na árvore de quem entra (RFC 9420 §12.4.3.1).
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
