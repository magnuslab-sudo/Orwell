/**
 * How much of this product is platform code, and how much is screen code.
 *
 * The question that decides between wrapping and rewriting is not "what's the best
 * framework", it's "how much gets thrown away". This counts lines per package and
 * separates what is React, which React Native CANNOT reuse, because `div` and `Text`
 * are not the same, from what is logic, which any path reuses.
 *
 *   node scripts/movel-reaproveitamento.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const PACOTES = [
  ["packages/ui", "ecrã (React/DOM)"],
  ["packages/client-core", "lógica (sessão, cofre, chamadas)"],
  ["packages/protocol", "lógica (formatos, ids)"],
  ["packages/crypto", "lógica (MLS, SFrame)"],
  ["apps/web", "arranque web"],
  ["apps/client", "arranque Electron"],
  ["apps/server", "servidor (não vai para o telemóvel)"],
  ["apps/site", "sítio público (não vai para o telemóvel)"],
]

const andar = (dir, saida = []) => {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "dist" || nome === "out") continue
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) andar(caminho, saida)
    else if (/\.tsx?$/.test(nome)) saida.push(caminho)
  }
  return saida
}

const linhas = []
let totalCliente = 0
let totalTsx = 0

for (const [pacote, papel] of PACOTES) {
  const ficheiros = andar(pacote)
  let codigo = 0
  let teste = 0
  let tsx = 0
  for (const f of ficheiros) {
    const n = readFileSync(f, "utf8").split("\n").length
    // One condition only, read once. Two copies of this question would make `tsx`
    // bigger than `codigo`, which is what happened, and is impossible.
    const ehTeste = f.includes("/testes/") || /\.test\.tsx?$/.test(f)
    if (ehTeste) teste += n
    else {
      codigo += n
      if (f.endsWith(".tsx")) tsx += n
    }
  }
  linhas.push({ pacote, papel, ficheiros: ficheiros.length, codigo, teste, tsx })
  if (!pacote.startsWith("apps/server") && !pacote.startsWith("apps/site")) {
    totalCliente += codigo
    totalTsx += tsx
  }
}

console.table(linhas)
console.log("")
console.log("Código de cliente (sem servidor nem sítio):", totalCliente, "linhas")
console.log("Dessas, .tsx (ecrã React/DOM):", totalTsx, "linhas —", Math.round((totalTsx / totalCliente) * 100) + "%")
console.log("Lógica reaproveitável por qualquer caminho:", totalCliente - totalTsx, "linhas —",
  Math.round(((totalCliente - totalTsx) / totalCliente) * 100) + "%")
