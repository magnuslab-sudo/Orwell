/**
 * Phase 1 mutations: each guarantee broken one at a time, to see who yells.
 *
 * A green test proves nothing by itself. It proves it passed, and it passes the same way if
 * measuring the wrong thing, or if measuring nothing. Three tests were deleted from this
 * repository in one night for passing on the wrong premise, and Phase 0 was born
 * with three sabotages because of it (`scripts/sfu-prova/README.md`). This is the
 * same tool for Phase 1: break a line of the product on purpose
 * and demand that a NAMED test start failing. If it does not fail, the test is not
 * catching what it says it catches, and the test is wrong.
 *
 *   node scripts/sfu-mutacoes.mjs           # all
 *   node scripts/sfu-mutacoes.mjs pausa     # only those that match the argument
 *
 * Does not alter anything permanently: each mutation is applied, measured and
 * reverted, and `finally` restores the file even if it crashes halfway through.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const MOTOR = "apps/server/src/media.ts"
const GATEWAY = "apps/server/src/gateway.ts"
const PROTOCOLO = "packages/protocol/src/wire.ts"

/**
 * `procurar` must exist EXACTLY ONCE in the file. A mutation that
 * does not find the target, because someone rewrote the line, would start running
 * against intact code and give green saying the test failed when nothing failed. That is why
 * the count is checked before making changes.
 */
const MUTACOES = [
  {
    nome: "sem-dtx",
    ficheiro: MOTOR,
    procurar: "usedtx: 1,",
    trocar: "",
    quebra: "anuncia Opus com DTX",
    porque: "sem DTX o Opus envia silêncio codificado o tempo todo: setenta por cento de banda a mais",
  },
  {
    nome: "sem-pausa",
    ficheiro: MOTOR,
    procurar: "rtpCapabilities, paused: true }",
    trocar: "rtpCapabilities, paused: false }",
    quebra: "nasce em pausa",
    porque: "sem pausa, o descodificador recebe ciphertext antes de a decifra estar instalada",
  },
  {
    nome: "sem-separacao-de-ambitos",
    ficheiro: MOTOR,
    procurar: "if (!ambito.produtores.has(produtorId)) {",
    trocar: "if (false) {",
    quebra: "recusa consumir um produtor de outro âmbito",
    porque: "sem isto, um id de produtor apanhado noutro sítio dá acesso a uma chamada onde não se entrou",
  },
  {
    nome: "sem-posse-do-transporte",
    ficheiro: MOTOR,
    procurar: "if (!registo || registo.dono !== dono) {",
    trocar: "if (!registo) {",
    quebra: "recusa um transporte que é de outra ligação",
    porque: "sem isto, um sfu.produce com o id de outra pessoa põe media na chamada dela, em nome dela",
  },
  {
    nome: "router-morre-cedo",
    ficheiro: MOTOR,
    procurar: "if (ambito.membros.size > 0 || ambito.fechado) return",
    trocar: "if (ambito.fechado) return",
    quebra: "fecha o router quando sai o último membro",
    porque: "fechar por transportes em vez de membros mata o router debaixo do primeiro a chegar",
  },
  {
    nome: "sem-endereco-anunciado",
    ficheiro: MOTOR,
    procurar: "const anunciado = opcoes.anunciarIp ? { announcedAddress: opcoes.anunciarIp } : {}",
    trocar: "const anunciado = {}",
    quebra: "anuncia o endereço configurado",
    porque: "dentro do Docker, sem isto os candidatos ICE apontam para a bridge e ninguém liga",
  },
  {
    nome: "arranca-mudo-em-todas-as-interfaces",
    ficheiro: MOTOR,
    procurar: 'if (!opcoes.anunciarIp && (escuta === "0.0.0.0" || escuta === "::")) {',
    trocar: "if (false) {",
    quebra: "recusa arrancar a escutar em 0.0.0.0 sem endereço a anunciar",
    porque:
      "escutar em todas as interfaces sem anunciar endereço põe 0.0.0.0 nos candidatos ICE: o servidor arranca, anuncia a capacidade sfu, e todas as chamadas montam-se mudas",
  },
  {
    nome: "sem-tecto-de-participantes",
    ficheiro: MOTOR,
    procurar: "ambito.membros.size >= PARTICIPANTES_POR_AMBITO",
    trocar: "false",
    quebra: "recusa o seguinte com a razão física",
    porque: "sem tecto, a saída do servidor é o que ceder primeiro, e leva o magnuslab.pt com ela",
  },
  {
    nome: "sem-orcamento-de-codec",
    ficheiro: MOTOR,
    procurar: "if (Number.isFinite(bits) && bits > ORCAMENTO_DE_CODEC) return bits",
    trocar: "if (false) return bits",
    quebra: "recusa um fluxo que peça mais banda",
    porque: "um cliente mal configurado pede 128 kbps estéreo numa sala dimensionada para 32 mono",
  },
  {
    nome: "aceita-video",
    ficheiro: MOTOR,
    procurar: 'if (kind !== "audio") {',
    trocar: "if (false) {",
    quebra: "recusa vídeo",
    porque: "a Fase 1 é voz: uma chamada a quatro com 720p faz 18 Mbps sustentados",
  },

  {
    nome: "router-orfao-por-recusa",
    ficheiro: MOTOR,
    procurar: "const ambito = this.#ambitosResolvidos.get(chave)\n    const meus = ambito?.membros.get(dono)",
    trocar: "const ambito = await this.#ambito(chave)\n    const meus = ambito?.membros.get(dono)",
    quebra: "não deixa router nenhum para trás",
    porque: "criar o âmbito antes de verificar a pertença deixa um router por cada frame recusado",
  },

  // ---------------------------------------------------------------- gateway
  // From here on it is not the engine: it is whoever runs it. The guarantees in this
  // section are what separate this design from an SFU with its own ownership.
  {
    nome: "sfu-sem-mayReach",
    ficheiro: GATEWAY,
    suite: "sfu.test.ts",
    procurar: "if (!this.#mayReach(connection, frame.channel)) {\n          this.#recusarSfu(connection, \"sem-lugar\", \"não tens lugar neste canal\", ref)\n          return\n        }\n        const chave = chaveDeAmbito(frame.channel, frame.scope)\n        const { rtpCapabilities, produtores }",
    trocar: "const chave = chaveDeAmbito(frame.channel, frame.scope)\n        const { rtpCapabilities, produtores }",
    quebra: "recusa a chamada de um canal onde a conta não tem lugar",
    porque: "sem isto o SFU é uma segunda porta para dentro de um canal privado",
  },
  {
    nome: "ambito-sem-canal",
    ficheiro: GATEWAY,
    suite: "sfu.test.ts",
    procurar: "`${channel.length}:${channel}:${scope}`",
    trocar: "`${scope}`",
    quebra: "não junta dois canais que mandem o mesmo âmbito",
    porque: "o âmbito é escolhido pelo cliente: sem o canal na chave, dois canais caem no mesmo router",
  },
  {
    nome: "queda-sem-largar-media",
    ficheiro: GATEWAY,
    suite: "sfu.test.ts",
    procurar: "if (connection.sfu.size > 0) void this.#largarMedia(connection).catch(() => {})",
    trocar: "",
    quebra: "diz que o fluxo acabou quando a ligação cai",
    porque: "uma aba fechada não manda frame nenhum: sem isto ficam transportes pendurados no worker",
  },
  {
    nome: "anuncio-a-toda-a-gente",
    ficheiro: GATEWAY,
    suite: "sfu.test.ts",
    procurar: "if (outra === excepto || !outra.sfu.has(chave)) continue",
    trocar: "if (outra === excepto) continue",
    quebra: "diz aos outros da chamada que há fluxo novo, e só a esses",
    porque: "quem não está na chamada não tem que saber quem lá está a falar",
  },

  // -------------------------------------------------------------- protocolo
  {
    nome: "ambito-de-forma-livre",
    ficheiro: PROTOCOLO,
    suite: "sfu.test.ts",
    procurar: 'scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "expected a base64url SHA-256 digest"),',
    trocar: "scope: z.string().max(64),",
    quebra: "recusa um âmbito que não seja um resumo",
    porque: "com forma livre, o nome de uma sala viaja em claro e fica guardado num mapa do servidor",
    // The `apps/server` imports `@enclave/protocol` from `dist`, not from `src`. Without
    // recompiling, this mutation would run against the old schema and give a false
    // "not caught", the usual trap of this monorepo, in different clothes.
    recompilar: true,
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
      ["vitest", "run", "--root", "apps/server", mutacao.suite ?? "media.test.ts", "-t", mutacao.quebra],
      { encoding: "utf8" },
    )
    const saida = `${corrida.stdout}${corrida.stderr}`
    const correram = /Tests\s+.*\d/.test(saida)
    const passaram = corrida.status === 0

    if (!correram) {
      console.log(`FALHA  ${mutacao.nome}: nenhum teste casou com "${mutacao.quebra}"`)
      falhas += 1
    } else if (passaram) {
      console.log(`FALHA  ${mutacao.nome}: parti "${mutacao.procurar}" e os testes passaram na mesma`)
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
