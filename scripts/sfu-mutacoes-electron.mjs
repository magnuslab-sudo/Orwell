/**
 * Mutations of the SFU path in the INSTALLED APPLICATION.
 *
 * Phase 1 (`sfu-mutacoes.mjs`) measures the server; Phase 2
 * (`sfu-mutacoes-fase2.mjs`) measures the client and the browser bridge. This one measures
 * the missing bridge: the desktop one, where the session lives in another process and everything
 * goes through IPC.
 *
 * This is the layer with the worst history in the repository. It revealed that
 * `applyMediaPrefs` was never implemented, noise suppression, gain and
 * microphone selection never worked in the installed application, ever, and it is where
 * the path to the SFU went unconnected when Phase 2 closed. Neither failure broke anything: calls kept
 * working through mesh, and the feature simply did not happen. **A green test only proves it passed.**
 *
 *   node scripts/sfu-mutacoes-electron.mjs           # all
 *   node scripts/sfu-mutacoes-electron.mjs portao    # only those that match
 *
 * Does not alter anything permanently: each mutation is applied, measured and
 * reverted, and `finally` restores the file even if it crashes halfway through.
 *
 * **`recompilar: true` in mutations in `packages/`, and it is not optional.** The
 * `apps/client` resolves `@enclave/client-core` by `dist`, not by source: a
 * mutation in `packages/client-core/src` without `tsc -b` measures the OLD code and gives
 * green saying the test does not catch anything. It happened when writing this
 * file, with the most important mutation of all.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const PONTE = "apps/client/src/renderer/bridge.ts"
const PRINCIPAL = "apps/client/src/main/sfu.ts"
const CHAMADA = "packages/client-core/src/call.ts"

const MUTACOES = [
  // --------------------------------------------------- the gate, in the core
  {
    nome: "portao-sem-await",
    ficheiro: CHAMADA,
    raiz: "apps/client",
    suite: "bridge.sfu.test.ts",
    recompilar: true,
    // The line changed when the gate gained the second question, the cipher one -,
    // and the `await` still holds exactly the same thing on this side.
    procurar: "const servidorEncaminha = (await this.bridge.sfu?.suportaSfu()) === true",
    trocar: "const servidorEncaminha = this.bridge.sfu?.suportaSfu() !== undefined",
    quebra: "constrói a ligação par-a-par, e não toca no caminho do SFU",
    porque:
      "a ponte da secretária responde com uma promessa, e uma promessa é um objecto: sem await, a aplicação instalada entra por SFU contra TODOS os servidores, incluindo os que não têm motor de media nenhum",
  },

  // --------------------------------------------------- a ponte do renderer
  {
    nome: "ponte-electron-sem-caminho",
    ficheiro: PONTE,
    raiz: "apps/client",
    suite: "bridge.sfu.test.ts",
    procurar: "    sfu: {\n      /*",
    trocar: "    sfuQueNinguemLe: {\n      /*",
    quebra: "negoceia com o servidor, e não constrói malha nenhuma",
    porque:
      "é a falta que existiu de facto: sem o caminho, a aplicação instalada fica na malha contra um servidor que já tem SFU, e nada quebra",
  },
  {
    nome: "capacidade-electron-lida-uma-vez-so",
    ficheiro: PONTE,
    raiz: "apps/client",
    suite: "bridge.sfu.test.ts",
    procurar: "      suportaSfu: async () => {",
    trocar:
      "      suportaSfu: ((prometida) => async () => prometida)(host.sfu.suporta()),\n      suportaSfuMorto: async () => {",
    quebra: "e um servidor que anda para trás fecha o portão sozinho, na mesma ponte",
    porque:
      'perguntada uma vez na construção da ponte, a resposta fica "sim" para sempre e a chamada seguinte negoceia com um motor que já não existe',
  },
  {
    nome: "ponte-electron-nao-entrega-os-avisos",
    ficheiro: PONTE,
    raiz: "apps/client",
    suite: "bridge.sfu.test.ts",
    /*
     * Subscribe to the wrong event, and do not delete the block: deleting it
     * would leave braces unclosed and vitest would not run any test,      * which reads as "no test matched" and not as "the test does not catch
     * anything". A mutation that does not compile does not measure anything.
     */
    procurar: "  host.on.sfu((cru) => {",
    trocar: "  host.on.voice((cru) => {",
    quebra: "quem entra DEPOIS de nós é consumido, e não fica em silêncio",
    porque:
      "sem isto a chamada monta, ouve-se quem já lá estava, e ninguém que entre depois se ouve — nunca, e sem um erro em lado nenhum",
  },

  // ------------------------------------------------- o processo principal
  {
    nome: "principal-sem-canal-da-capacidade",
    ficheiro: PRINCIPAL,
    raiz: "apps/client",
    suite: "main/sfu.test.ts",
    procurar: "  registar(CANAIS_SFU.suporta, () => sessao.suportaSfu)",
    trocar: "",
    quebra: "regista os oito pedidos, e não um subconjunto que compila na mesma",
    porque: "sem o canal, o `invoke` do preload não tem handler e a entrada em chamada rebenta na primeira pergunta",
  },
  {
    nome: "principal-capacidade-guardada",
    ficheiro: PRINCIPAL,
    raiz: "apps/client",
    suite: "main/sfu.test.ts",
    procurar: "  registar(CANAIS_SFU.suporta, () => sessao.suportaSfu)",
    trocar: "  const guardada = sessao.suportaSfu\n  registar(CANAIS_SFU.suporta, () => guardada)",
    quebra: "lê a capacidade A CADA pergunta, e não uma vez ao arrancar",
    porque:
      "lida ao arrancar é lida antes do hello.ok e é falsa para sempre; e um servidor que ande para trás nunca mais fecha o portão",
  },
  {
    nome: "principal-troca-argumentos-do-retomar",
    ficheiro: PRINCIPAL,
    raiz: "apps/client",
    suite: "main/sfu.test.ts",
    procurar: "    sessao.sfuRetomar(transport, consumer).then(() => ({ ok: true })),",
    trocar: "    sessao.sfuRetomar(consumer, transport).then(() => ({ ok: true })),",
    quebra: "delega cada pedido na sessão, com os argumentos pela ordem certa",
    porque:
      "são os dois cadeias e trocá-los compila sem uma queixa: o consumidor fica em pausa para sempre e o som chega, decifra-se, e nunca sai",
  },
  {
    nome: "principal-nao-empurra-os-avisos",
    ficheiro: PRINCIPAL,
    raiz: "apps/client",
    suite: "main/sfu.test.ts",
    procurar: '  sessao.on("sfu", (aviso) => enviar(CANAIS_SFU.aviso, aviso))',
    trocar: '  sessao.on("sfu-que-nao-existe" as "sfu", (aviso) => enviar(CANAIS_SFU.aviso, aviso))',
    quebra: "o principal inscreve-se mesmo no acontecimento `sfu` da sessão",
    porque: "o aviso morre neste processo e o renderer nunca sabe que apareceu um fluxo novo",
  },
]

/** `tsc -b` incremental. @returns whether it compiled. */
function recompilar() {
  return spawnSync("npx", ["tsc", "-b"], { encoding: "utf8" }).status === 0
}

const filtro = process.argv[2]
const escolhidas = filtro ? MUTACOES.filter((cada) => cada.nome.includes(filtro)) : MUTACOES

let falhas = 0
for (const mutacao of escolhidas) {
  const original = readFileSync(mutacao.ficheiro, "utf8")
  /*
   * The target must exist EXACTLY ONCE. A mutation that does not find it,    * because someone rewrote the line, would start running against intact code
   * and give green saying the test failed when nothing failed.
   */
  const ocorrencias = original.split(mutacao.procurar).length - 1
  if (ocorrencias !== 1) {
    console.log(`FALHA  ${mutacao.nome}: o alvo aparece ${ocorrencias} vezes, e tem de aparecer uma`)
    console.log(`       alvo: ${mutacao.procurar}`)
    falhas += 1
    continue
  }

  try {
    writeFileSync(mutacao.ficheiro, original.replace(mutacao.procurar, mutacao.trocar))
    if (mutacao.recompilar && !recompilar()) {
      console.log(`FALHA  ${mutacao.nome}: a mutação não compila, e por isso não se mede nada`)
      falhas += 1
      continue
    }
    const corrida = spawnSync(
      "npx",
      ["vitest", "run", "--root", mutacao.raiz, mutacao.suite, "-t", mutacao.quebra],
      { encoding: "utf8" },
    )
    const saida = `${corrida.stdout}${corrida.stderr}`
    const correram = /Tests\s+.*\d/.test(saida)
    const passaram = corrida.status === 0

    if (!correram) {
      console.log(`FALHA  ${mutacao.nome}: nenhum teste casou com "${mutacao.quebra}"`)
      falhas += 1
    } else if (passaram) {
      console.log(`FALHA  ${mutacao.nome}: parti "${mutacao.procurar.slice(0, 60)}…" e os testes passaram na mesma`)
      console.log(`       ${mutacao.porque}`)
      falhas += 1
    } else {
      console.log(`BEM    ${mutacao.nome} → "${mutacao.quebra}" falhou, como tinha de falhar`)
    }
  } finally {
    writeFileSync(mutacao.ficheiro, original)
    if (mutacao.recompilar) recompilar()
  }
}

console.log("")
console.log(falhas === 0 ? `${escolhidas.length} mutações, todas apanhadas.` : `${falhas} mutações NÃO apanhadas.`)
process.exit(falhas === 0 ? 0 : 1)
