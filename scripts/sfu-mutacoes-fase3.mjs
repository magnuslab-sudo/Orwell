/**
 * Phase 3 mutations: each VIDEO guarantee broken one at a time.
 *
 * Phase 1 measures the server engine, Phase 2 the client, the Electron one the
 * desktop bridge. This one measures what the image brought: the source that separates the
 * screen from the camera, the caps that decide how much leaves the server, closing a
 * producer without leaving the call, and organizing streams by person.
 *
 *   node scripts/sfu-mutacoes-fase3.mjs           # all
 *   node scripts/sfu-mutacoes-fase3.mjs fonte     # only those that match the argument
 *
 * **`recompilar` is not optional where the target is in `packages/`.** The `apps/*`
 * resolve `@enclave/*` by `dist`, not by source: a mutation without `tsc -b`
 * measures the OLD code and gives green saying the test does not catch anything. It cost
 * the most important mutation in the Electron round.
 *
 * Does not alter anything permanently: each mutation is applied, measured and
 * reverted, and `finally` restores the file even if it crashes halfway through.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const MOTOR_DO_SERVIDOR = "apps/server/src/media.ts"
const GATEWAY = "apps/server/src/gateway.ts"
const MOTOR = "packages/client-core/src/call-sfu.ts"
const CHAMADA = "packages/client-core/src/call.ts"
const CIFRA = "packages/crypto/src/sframe.ts"
const PAINEL = "packages/ui/src/screens/call/CallPanel.tsx"

/**
 * `procurar` must exist EXACTLY ONCE in the file. A mutation that
 * does not find the target, because someone rewrote the line, would start running
 * against intact code and give green saying the test failed when nothing failed.
 */
const MUTACOES = [
  // ------------------------------------------------- the server forwards video
  {
    nome: "router-sem-video",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `  {
    kind: "video",
    mimeType: "video/VP8",`,
    trocar: `  {
    kind: "video",
    mimeType: "video/VP9",`,
    quebra: "negoceia VP8, e só VP8",
    porque: "o cliente codifica VP8; um router que negoceie outra coisa dá uma partilha que negoceia e nunca entrega um pixel",
  },
  {
    nome: "fonte-deduzida-sempre-camara",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `    if (fonte === undefined) return kind === "audio" ? "microfone" : "camara"`,
    trocar: `    if (fonte === undefined) return "camara"`,
    quebra: "deduz a fonte pelo `kind` quando o cliente não a declara",
    porque: "um microfone de cliente antigo lido como câmara apanha o tecto da câmara, e a voz dele passa a contar para o tecto das câmaras da sala",
  },
  {
    nome: "fonte-incoerente-aceite",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `    if (kind !== esperado) {`,
    trocar: `    if (false) {`,
    quebra: "recusa uma fonte que não bate certo com o `kind`",
    porque: "um vídeo declarado como microfone apanha o orçamento da voz e passa por baixo de todos os tectos de imagem",
  },
  {
    nome: "dois-ecras-na-mesma-chamada",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `      if (ecras >= ECRAS_POR_AMBITO) {`,
    trocar: `      if (false) {`,
    quebra: "recusa o segundo ecrã da chamada, com a razão física",
    porque: "dois ecrãs a dez espectadores são 50 Mbps sozinhos — a fatia inteira da máquina, sem voz nem câmaras",
  },
  {
    nome: "ecra-sem-tecto-de-gente",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `      if (ambito.membros.size > PESSOAS_COM_ECRA) {`,
    trocar: `      if (false) {`,
    quebra: "recusa partilhar o ecrã numa chamada com mais de",
    porque: "o ecrã sai do servidor uma vez por pessoa: numa sala de dezasseis são 37 Mbps, e a interface é partilhada com o site",
  },
  {
    nome: "orcamento-igual-para-todas-as-fontes",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `    const tecto = ORCAMENTO_POR_FONTE[fonte]

    for (const codec of rtpParameters.codecs ?? []) {`,
    trocar: `    const tecto = ORCAMENTO_POR_FONTE["ecra"]

    for (const codec of rtpParameters.codecs ?? []) {`,
    quebra: "recusa uma câmara com o orçamento do ECRÃ, que é maior",
    porque: "uma câmara a 2,5 Mbps servida a dez pessoas são 25 Mbps de uma pessoa só, e quatro delas são a máquina inteira",
  },
  {
    nome: "orcamento-de-video-nao-lido",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `    for (const codificacao of rtpParameters.encodings ?? []) {`,
    trocar: `    for (const codificacao of []) {`,
    quebra: "recusa um ecrã que declare mais banda do que o tecto do ecrã",
    porque: "o Opus declara o ritmo no codec e o VP8 na codificação: ler só um deixa o fluxo que pesa trinta vezes mais sem verificação nenhuma",
  },
  {
    nome: "fechar-produtor-de-outra-pessoa",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `      (cada) => cada.dono === dono && cada.produtores.has(produtorId),`,
    trocar: `      (cada) => cada.produtores.has(produtorId),`,
    quebra: "recusa fechar um fluxo de outra pessoa",
    porque: "um identificador de produtor apanhado noutro sítio calava o ecrã de outra pessoa",
  },
  {
    nome: "produtor-fechado-fica-no-ambito",
    ficheiro: MOTOR_DO_SERVIDOR,
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: `    this.#ambitosResolvidos.get(registo.chaveDoAmbito)?.produtores.delete(produtorId)`,
    trocar: `    void registo.chaveDoAmbito`,
    quebra: "tira o fluxo da chamada e deixa o transporte de pé",
    porque: "o âmbito ficava a anunciar a quem chegasse um fluxo que já não existe, e o cliente novo esperava por media que nunca vinha",
  },

  // ------------------------------------------------------ the gateway echoes the source
  {
    nome: "gateway-nao-ecoa-a-fonte",
    ficheiro: GATEWAY,
    raiz: "apps/server",
    suite: "sfu.test.ts",
    procurar: `producer: id, kind: frame.kind, address: connection.address as string, fonte },`,
    trocar: `producer: id, kind: frame.kind, address: connection.address as string },`,
    quebra: "diz aos outros que o fluxo novo é um ECRÃ, e não uma câmara",
    porque: "sem a fonte, do outro lado o ecrã é indistinguível de uma câmara e vai parar ao cartão de 190 por 128 com as bordas cortadas",
  },

  // ------------------------------------------------------------- the client engine
  {
    nome: "produtor-sem-fonte",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `      appData: { fonte },`,
    trocar: `      appData: {},`,
    quebra: "põe a câmara na chamada com a fonte dita, e o tecto dela",
    porque: "a fonte viaja no appData do produtor: sem ela o servidor lê o kind e chama câmara a um ecrã",
  },
  {
    nome: "video-sem-tecto-de-codificacao",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `        : { encodings: [{ maxBitrate: TECTO_POR_FONTE[fonte] }] }),`,
    trocar: `        : {}),`,
    quebra: "partilha o ecrã como um produtor NOVO, sem desmontar nada",
    porque: "sem tecto na codificação, o Chrome sobe até onde a rede o deixar e o servidor passa a servir isso a toda a gente",
  },
  {
    nome: "partilha-sem-perguntar-ao-router",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `    if (!this.podeVideo) {
      this.deps.aoDiagnosticar("sfu-sem-video")
      return false
    }`,
    trocar: `    if (false) {
      this.deps.aoDiagnosticar("sfu-sem-video")
      return false
    }`,
    quebra: "recusa partilhar contra um servidor que não negoceia vídeo, sem tocar no servidor",
    porque: "contra um servidor da Fase 2 o selector abria, a marca de gravação do sistema acendia, e não saía um pixel",
  },
  {
    nome: "parar-sem-avisar-o-servidor",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `      await this.deps.sinalizacao.sfuFecharProdutor(produtor.id)`,
    trocar: `      await Promise.resolve()`,
    quebra: "parar de partilhar diz ao SERVIDOR, e só depois fecha o produtor",
    porque: "sem o frame, quem estava a ver fica com o último frame congelado para sempre e o servidor continua a anunciar um fluxo que morreu",
  },
  {
    nome: "captura-viva-quando-o-servidor-nao-responde",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `    produtor.close()
    this.deps.aoMudar()
  }`,
    trocar: `    this.deps.aoMudar()
  }`,
    quebra: "pára a captura mesmo quando o servidor não responde",
    porque: "a marca de gravação do sistema operativo fica acesa enquanto o produtor viver",
  },
  {
    nome: "ecra-no-cartao-da-pessoa",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `    ;(fonte === "ecra" ? fluxos.ecra : fluxos.pessoa).addTrack(faixa)`,
    trocar: `    fluxos.pessoa.addTrack(faixa)`,
    quebra: "põe o ecrã à parte, e não dentro do cartão da pessoa",
    porque: "o palco desenha em contain e o mosaico em cover: um ecrã de 16:9 no mosaico fica com as bordas cortadas",
  },
  {
    nome: "video-sem-fonte-lido-como-ecra",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `      const fonte: FonteDeMedia = fonteDeclarada ?? (params.kind === "audio" ? "microfone" : "camara")`,
    trocar: `      const fonte: FonteDeMedia = fonteDeclarada ?? (params.kind === "audio" ? "microfone" : "ecra")`,
    quebra: "chama câmara a um vídeo que chega sem fonte, e nunca ecrã",
    porque: "um servidor anterior a esta fase não manda fonte nenhuma, e ler a ausência como ecrã põe a CARA de alguém no palco",
  },
  {
    nome: "um-fluxo-em-claro-nao-conta",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    recompilar: true,
    procurar: `        encrypted: (ja?.encrypted ?? true) && entrada.encrypted,`,
    trocar: `        encrypted: (ja?.encrypted ?? false) || entrada.encrypted,`,
    quebra: "uma pessoa com um fluxo em claro entre outros cifrados não se desenha como protegida",
    porque: "a marca de protegido tem de descrever a PIOR das partes: uma cara em claro não fica protegida por a voz ao lado estar",
  },

  // ------------------------------------------------------------ the call and the screen
  {
    nome: "ecra-nao-vai-pelo-sfu",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    recompilar: true,
    procurar: `        await this.#motor.partilharEcra(faixa)`,
    trocar: `        await Promise.resolve(faixa)`,
    quebra: "abre o selector, produz o ecrã pelo SFU, e anuncia-o no roster",
    porque: "sem esta linha o selector abre, a marca de gravação acende, o roster diz que há ecrã — e não passa um pixel",
  },
  {
    nome: "tecto-da-malha-numa-chamada-por-sfu",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    recompilar: true,
    procurar: `    return this.#motor ? PESSOAS_COM_ECRA : Call.LIMITE_DE_PARTILHA`,
    trocar: `    return Call.LIMITE_DE_PARTILHA`,
    quebra: "recusa numa chamada grande de mais, com a razão física do SFU e não a da malha",
    porque: "seis é o número da malha, onde quem partilha envia uma cópia por pessoa: com SFU envia uma, e o tecto é outro",
  },

  // --------------------------------------------------------------- a interface
  {
    nome: "painel-le-o-tecto-da-malha",
    ficheiro: PAINEL,
    raiz: "packages/ui",
    suite: "CallPanel.ecra.test.tsx",
    procurar: `  const tecto = call.tectoDePartilha`,
    trocar: `  const tecto = Call.LIMITE_DE_PARTILHA`,
    quebra: "numa chamada por SFU o tecto é outro, e a frase também",
    porque: "ler a constante da malha no painel escondia o botão a onze pessoas que cabiam perfeitamente",
  },

  // ------------------------------------------------------------------- a cifra
  {
    nome: "janela-curta-para-tres-fluxos",
    ficheiro: CIFRA,
    raiz: "packages/crypto",
    suite: "sframe.test.ts",
    procurar: `  static readonly WINDOW = 1024`,
    trocar: `  static readonly WINDOW = 128`,
    quebra: "aceita um keyframe do ECRÃ atrasado dois segundos, com as três faixas a contar",
    porque: "com três fluxos a partilhar o contador, 128 cobre pouco mais de um segundo — e um keyframe atrasado é recusado como repetição, em silêncio",
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
      ["vitest", "run", "--root", mutacao.raiz ?? "packages/client-core", mutacao.suite, "-t", mutacao.quebra],
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
