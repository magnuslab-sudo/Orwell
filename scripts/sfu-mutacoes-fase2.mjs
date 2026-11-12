/**
 * Phase 2 mutations: each CLIENT guarantee broken one at a time.
 *
 * Phase 1 (`sfu-mutacoes.mjs`) measures the server. This one measures the other side, signaling matched by tag, the call assembly order, the capacity gate, and the cipher coming in through the new path. The tool is the same and so is the reason: a green test proves nothing by itself, it proves it passed, and it passes the same way if measuring the wrong thing, or if measuring nothing. Three tests were deleted from this repository in one night for passing on the wrong premise, and it was the Phase 1 suite that caught two that caught nothing.
 *
 *   node scripts/sfu-mutacoes-fase2.mjs           # all
 *   node scripts/sfu-mutacoes-fase2.mjs ordem     # only those that match the argument
 *
 * Does not alter anything permanently: each mutation is applied, measured and
 * reverted, and `finally` restores the file even if it crashes halfway through.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

const PONTE_WEB = "apps/web/src/bridge.ts"
const MOTOR = "packages/client-core/src/call-sfu.ts"
const CIFRA = "packages/client-core/src/media-sframe.ts"
const CHAMADA = "packages/client-core/src/call.ts"
const SESSAO = "packages/client-core/src/session.ts"
const PROTOCOLO = "packages/protocol/src/wire.ts"

/**
 * `procurar` must exist EXACTLY ONCE in the file. A mutation that
 * does not find the target, because someone rewrote the line, would start running
 * against intact code and give green saying the test failed when nothing failed. That is why
 * the count is checked before making changes.
 */
const MUTACOES = [
  // ------------------------------------------------------- the assembly order
  {
    nome: "resume-antes-da-decifra",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    /*
     * The target is the line BEFORE installing the decipher, not the one with
     * `#consumidores.set`: what we want to break is the order between `resume` and
     * `protegerReceptor`, and changing any other line would leave the test green
     * saying everything was fine. The first attempt at this mutation got the
     * target exactly wrong, and it passed.
     */
    procurar: `      let encrypted = false
      if (consumidor.rtpReceiver) {`,
    trocar: `      await this.deps.sinalizacao.sfuRetomar(recepcao.id, consumidor.id)
      let encrypted = false
      if (consumidor.rtpReceiver) {`,
    quebra: "instala a decifra ANTES de retomar o fluxo",
    porque: "trocar a ordem não dá erro nenhum: dá meio segundo de ruído no ouvido de toda a gente a cada entrada",
  },
  {
    nome: "device-load-antes-do-scope-join",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    procurar: `    const { rtpCapabilities, producers } = await this.deps.sinalizacao.sfuEntrarNoAmbito(canal, ambito)

    const dispositivo = this.deps.criarDispositivo()
    await dispositivo.load({ routerRtpCapabilities: rtpCapabilities })`,
    trocar: `    const dispositivo = this.deps.criarDispositivo()
    await dispositivo.load({ routerRtpCapabilities: {} })
    const { rtpCapabilities, producers } = await this.deps.sinalizacao.sfuEntrarNoAmbito(canal, ambito)
    void rtpCapabilities`,
    quebra: "pede as capacidades ANTES de haver transporte",
    porque: "o device.load precisa das rtpCapabilities do router, e o router é por âmbito: é a razão de o sfu.scope.join existir",
  },
  {
    nome: "sem-insertable-no-transporte",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    procurar: "const opcoes: ParametrosDoTransporte = { ...parametros, additionalSettings: { ...AJUSTES_DE_CIFRA } }",
    trocar: "const opcoes: ParametrosDoTransporte = { ...parametros }",
    quebra: "liga os insertable streams nos DOIS transportes",
    porque: "sem isto o createEncodedStreams() atira InvalidStateError e não há onde pendurar a cifra — a Fase 0 provou-o por diferença",
  },
  {
    nome: "sem-dtx-no-cliente",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    procurar: "  opusDtx: true,",
    trocar: "  opusDtx: false,",
    quebra: "diz as medidas de contenção do lado de quem codifica",
    porque: "só no router, o Chrome ignora-as: sem DTX o Opus envia silêncio codificado o tempo todo",
  },
  {
    nome: "consome-o-mesmo-fluxo-duas-vezes",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    procurar: "    if (this.#aConsumir.has(produtorId)) return\n    this.#aConsumir.add(produtorId)",
    trocar: "    this.#aConsumir.add(produtorId)",
    quebra: "não consome o mesmo fluxo duas vezes",
    porque: "duas vezes o mesmo produtor dá a mesma voz a tocar com meio segundo de diferença, e ouve-se como um eco",
  },
  {
    nome: "aviso-de-outra-chamada",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    procurar: "if (canal !== this.#canal || ambito !== this.#ambito) return",
    trocar: "if (false) return",
    quebra: "ignora um aviso de outra chamada",
    porque: "um aviso de uma chamada anterior ainda em voo punha a voz de quem ficou para trás dentro da chamada seguinte",
  },
  {
    nome: "cifra-sem-canal",
    ficheiro: MOTOR,
    suite: "call-sfu.test.ts",
    procurar: "    this.deps.cifra.canal = canal\n",
    trocar: "",
    quebra: "pendura-se no rtpSender do produtor",
    porque: "sem canal não há chave, e tudo o resto monta na mesma: transportes de pé, fluxos a chegar, e nada a decifrar",
  },

  // --------------------------------------------------------------- a cifra
  {
    nome: "janela-de-uma-chave-so",
    ficheiro: CIFRA,
    suite: "call-sfu.test.ts",
    procurar: "[{ keyId: material.keyId, material: material.material, receiver }, ...cadeia].slice(0, 2),",
    trocar: "[{ keyId: material.keyId, material: material.material, receiver }].slice(0, 2),",
    quebra: "cada pessoa mantém a chave nova E a anterior",
    porque: "sem a chave anterior, cada entrada de alguém corta o som a toda a gente durante a diferença entre os dois commits",
  },
  {
    nome: "contador-emprestado",
    ficheiro: CIFRA,
    suite: "call.cifra-reentrada.test.ts",
    procurar: `        this.aoDiagnosticar("sframe-reserva-falhou", String((erro as Error)?.message ?? erro))
        return undefined`,
    trocar: `        this.aoDiagnosticar("sframe-reserva-falhou", String((erro as Error)?.message ?? erro))
        inicio = actual?.sender.counter ?? 0`,
    quebra: "não monta emissor nenhum em vez de emprestar um contador",
    porque: "o contador do emissor anterior pertence a OUTRA chave: emprestá-lo repete nonces, e em AES-GCM isso não é fraqueza, é quebra",
  },
  {
    nome: "cifra-do-emissor-sem-guarda",
    ficheiro: CIFRA,
    suite: "call-sfu.test.ts",
    /*
     * The `as unknown as` that declared the method as always existing, put
     * back. This is the exact line that produced `createEncodedStreams is not a
     * function` in production: the compiler believes it, and Firefox does not have the
     * method.
     */
    procurar: `    const streams = this.#abrirFluxos(sender, "emissor")`,
    trocar: "    const streams = (sender as unknown as PontaDeMedia).createEncodedStreams!()",
    quebra: "a cifra do emissor responde que não, em vez de atirar",
    porque: "o TypeError subia por dentro da entrada na chamada e desfazia-a a meio: a chamada a aparecer e a desaparecer em milissegundos",
  },
  {
    nome: "cifra-do-receptor-sem-guarda",
    ficheiro: CIFRA,
    suite: "call-sfu.test.ts",
    procurar: `    const streams = this.#abrirFluxos(receiver, "receptor")`,
    trocar: "    const streams = (receiver as unknown as PontaDeMedia).createEncodedStreams!()",
    quebra: "e a do receptor também, com o seu nome",
    porque: "faltar do lado de quem ouve dá uma chamada em que se fala protegido e se ouve ruído, que é indistinguível de avaria",
  },
  {
    nome: "as-duas-faltas-com-o-mesmo-nome",
    ficheiro: CIFRA,
    suite: "call-sfu.test.ts",
    procurar: `      this.aoDiagnosticar("sframe-cifra-recusada", \`\${qual}: \${String((erro as Error)?.message ?? erro)}\`)`,
    trocar: `      this.aoDiagnosticar("sframe-sem-insertable-streams", qual)`,
    quebra: "um emissor que RECUSA leva outro nome, porque é outra avaria",
    porque: '"não existe" é o motor errado e "recusou" é a opção em falta no construtor: confundi-las manda a caçada seguinte para o sítio errado',
  },
  {
    nome: "marca-de-protegido-que-sobrevive-a-falha",
    ficheiro: CIFRA,
    suite: "call-sfu.test.ts",
    procurar: `    const streams = this.#abrirFluxos(sender, "emissor")
    if (!streams) {
      // Não se protegeu nada, e a marca mentiria — a mesma razão de acima.
      this.#protegidos.delete(sender)
      return false
    }`,
    trocar: `    const streams = this.#abrirFluxos(sender, "emissor")
    if (!streams) return false`,
    quebra: "uma segunda tentativa é uma tentativa a sério, e não uma marca velha",
    porque: 'a marca é posta ANTES da derivação da chave: se uma falha a deixar lá, a tentativa seguinte responde "já está protegido" sobre um emissor que vai em claro',
  },
  {
    nome: "chave-por-keyid-e-nao-por-material",
    ficheiro: CIFRA,
    suite: "call.sframe.test.ts",
    procurar: "if (actual && mesmoMaterial(actual.material, material.material)) return actual.sender",
    trocar: "if (actual) return actual.sender",
    quebra: "não cifra a chamada de um canal com a chave de outro",
    porque: "keyId é a epoch truncada a 16 bits e cada canal tem o seu grupo: dois canais dão o mesmo número com chaves diferentes",
  },

  // ------------------------------------------------------------- the gate
  {
    nome: "sfu-sempre",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    // The `await` came in when the desktop bridge gained the path: there the
    // session lives in another process and capacity is only read by promise. See
    // `scripts/sfu-mutacoes-electron.mjs`, which measures what that word catches.
    procurar: "const servidorEncaminha = (await this.bridge.sfu?.suportaSfu()) === true",
    trocar: "const servidorEncaminha = this.bridge.sfu !== undefined",
    quebra: "a chamada seguinte volta à malha, sem ninguém fechar nada à mão",
    porque: "um servidor pode andar para trás: sem ler a capacidade a cada join, o cliente negoceia com uma porta que já não existe",
  },
  {
    nome: "sfu-sem-perguntar-se-sabemos-cifrar",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    /*
     * The production defect of August 17, 2026, put back.
     *
     * With this line like this, an engine without `createEncodedStreams`,      * Firefox, Safari, enters via SFU and will encrypt in a method that does not exist. Before
     * the cipher guard this was a TypeError rising inside the `join` (the
     * call blinking); with it, it is worse in another way: the call is made, and
     * the voice crosses the server in the clear.
     */
    procurar: "if (servidorEncaminha && !semCifra) {",
    trocar: "if (servidorEncaminha) {",
    quebra: "não entra por SFU: faz malha, como fazia ontem",
    porque: "com um SFU a media atravessa uma máquina que não é de nenhum dos lados: sem SFrame por cima, quem encaminha ouve",
  },
  {
    nome: "portao-largo-demais",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    /*
     * The other end, and it is not arrangement symmetry. On a network behind CGNAT mesh
     * does not pass without TURN and the SFU is what makes it pass, for being a
     * public destination. A gate that closes by caution takes exactly that away from
     * those who need it, and the suite must refuse both wrong versions.
     */
    procurar: "    const semCifra = cifraDeMediaEmFalta()",
    trocar: '    const semCifra = cifraDeMediaEmFalta() ?? "por precaução"',
    quebra: "e o motor que SABE cifrar continua a entrar por SFU, que é o que faz as chamadas passar",
    porque: "desligar o SFU por precaução tira a única coisa que faz as chamadas passar numa rede atrás de CGNAT",
  },
  {
    nome: "entrada-sem-rasto-no-registo",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    procurar: `    this.emit("diagnostic", {
      code: "call-entrada",`,
    trocar: `    this.emit("diagnostic", {
      code: "call-entrada-que-nunca-sai",`,
    quebra: "a tentativa fica escrita antes de tudo o que pode falhar",
    porque: "sem a primeira linha, uma entrada que morre na captura não deixa rasto nenhum — foi assim que o registo copiado do terreno veio mudo",
  },
  {
    nome: "caminho-que-mente",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    procurar: 'detail: servidorEncaminha ? (semCifra ? "malha: sem cifra de media" : "sfu") : "malha: servidor sem sfu",',
    trocar: 'detail: "sfu",',
    quebra: "e o caminho escolhido também, que é a pergunta que a interface não responde",
    porque: "duas pessoas na mesma sala podem ir por caminhos diferentes, e um registo que diga sempre o mesmo é pior do que nenhum",
  },
  {
    nome: "malha-por-baixo-do-sfu",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    procurar: "    if (this.#sinalPorSfu(from, payload)) return\n",
    trocar: "",
    quebra: "negoceia com o servidor e não com o par",
    porque: "atender uma oferta com SFU de pé monta uma segunda ligação para a mesma pessoa, e volta a trazer a malha inteira",
  },
  {
    nome: "nao-responde-a-quem-chega",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    procurar: `      if (novo && this.#channel) {`,
    trocar: `      if (false && novo && this.#channel) {`,
    quebra: "quem já lá estava responde a quem chega, senão o recém-chegado fica cego",
    porque:
      "o nosso anúncio saiu antes de haver ouvidos, e o gateway só apresenta PRODUTORES: sem resposta, quem entra recebe a media de quem lá está, decifra-a toda, e não a toca — não há cartão no ecrã onde a tocar",
  },
  {
    nome: "responde-sempre-e-nao-so-a-quem-chega",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    procurar: `      if (novo && this.#channel) {`,
    trocar: `      if (this.#channel) {`,
    quebra: "quem já lá estava responde a quem chega, senão o recém-chegado fica cego",
    porque:
      "um anúncio que gera sempre outro anúncio põe dois clientes a mandar frames um ao outro para sempre, até o tecto de `sfu.*` por minuto fechar a chamada",
  },
  {
    nome: "roster-nao-desenha",
    ficheiro: CHAMADA,
    suite: "call.gate-sfu.test.ts",
    procurar: "      this.#anunciarPorSfu(motor)\n      return",
    trocar: "      return",
    quebra: "desenha quem está na chamada a partir do roster cifrado",
    porque: "sem isto a chamada por SFU aparece sempre vazia: há som e não há ninguém no ecrã",
  },

  // -------------------------------------------------------- the signaling
  {
    nome: "sem-etiqueta-no-pedido",
    ficheiro: SESSAO,
    suite: "session.sfu-sinalizacao.test.ts",
    procurar: "    const ref = `s${this.#sfuEtiqueta++}`",
    trocar: "    const ref = `s`",
    quebra: "cada pedido leva uma etiqueta diferente",
    porque: "duas etiquetas iguais são pior do que nenhuma: dão a aparência de emparelhamento e casam a resposta errada com toda a confiança",
  },
  {
    nome: "resposta-casada-pela-forma",
    ficheiro: SESSAO,
    suite: "session.sfu-sinalizacao.test.ts",
    procurar: "    if (pedido && pedido.esperado === frame.t) pedido.resolver(frame)",
    trocar: "    const qualquer = [...this.#sfuPendentes.values()].find((cada) => cada.esperado === frame.t)\n    if (qualquer) qualquer.resolver(frame)",
    quebra: "dois transportes a nascer ao mesmo tempo, respostas trocadas, cada um recebe o seu",
    porque: "casar pela forma é uma corrida quando dois transportes nascem ao mesmo tempo, e é a categoria de defeito que o SFU existe para acabar",
  },
  {
    nome: "recusa-que-derruba-tudo",
    ficheiro: SESSAO,
    suite: "session.sfu-sinalizacao.test.ts",
    procurar: "      if (pedido) {\n        // A frase do servidor chega intacta a quem pediu.",
    trocar: "      if (true) {\n        this.#falharSfuPendentes(frame.message)\n        return true\n      }\n      if (pedido) {\n        // A frase do servidor chega intacta a quem pediu.",
    quebra: "uma recusa de um pedido não derruba o outro que estava a correr",
    porque: "uma chamada cheia não é motivo para deitar abaixo o transporte que já estava a ligar",
  },
  {
    nome: "queda-sem-falhar-pedidos",
    ficheiro: SESSAO,
    suite: "session.sfu-sinalizacao.test.ts",
    procurar: "    this.#falharSfuPendentes(reason)\n  }",
    trocar: "  }",
    quebra: "a ligação a cair falha o que estava à espera",
    porque: "sem isto a chamada fica quinze segundos a fingir que negoceia contra uma ligação que já não existe",
  },

  // ---------------------------------------------------- the server cap
  // The only cap that holds against a lying client, and the one that Phase 1 wrote
  // without ever seeing it applied.
  {
    nome: "sem-tecto-de-banda",
    ficheiro: "apps/server/src/media.ts",
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: "      await transporte.setMaxIncomingBitrate(BANDA_DE_ENTRADA_POR_TRANSPORTE)",
    trocar: "",
    quebra: "aplica o tecto de banda no transporte de envio",
    porque: "os maxaveragebitrate dos codecs apanham clientes honestos; contra quem declare 32 e envie 200, só este lhe diz que não",
  },
  {
    nome: "tecto-no-transporte-errado",
    ficheiro: "apps/server/src/media.ts",
    raiz: "apps/server",
    suite: "media.test.ts",
    procurar: 'if (sentido === "envio") {\n      await transporte.setMaxIncomingBitrate',
    trocar: 'if (sentido !== "envio") {\n      await transporte.setMaxIncomingBitrate',
    quebra: "não o põe no de recepção, que não tem nada que limitar",
    porque: "um tecto de entrada num caminho por onde não entra nada dá a aparência de uma protecção que não está onde é precisa",
  },

  // ------------------------------------------------------------- the bridges
  // Between the core, which has thousands of tests, and what the person sees, there is a
  // layer that was once silent: that is where we discovered the desktop bridge
  // never implemented `applyMediaPrefs`. A perfect SFU engine with a bridge
  // that does not pass the path to it is the same failure, again, and nothing breaks: calls keep
  // working through mesh and the whole phase does nothing.
  {
    nome: "ponte-sem-caminho-para-o-sfu",
    ficheiro: PONTE_WEB,
    raiz: "apps/web",
    suite: "bridge.sfu.test.ts",
    procurar: "      suportaSfu: () => session.suportaSfu,",
    trocar: "",
    quebra: "dá ao motor de chamada um `sfu`, e não um objecto vazio",
    porque: "sem o caminho, o portão está sempre fechado e toda a gente fica na malha contra um servidor que já tem SFU",
  },
  {
    nome: "capacidade-lida-uma-vez-so",
    ficheiro: PONTE_WEB,
    raiz: "apps/web",
    suite: "bridge.sfu.test.ts",
    procurar: "      suportaSfu: () => session.suportaSfu,",
    trocar: "      suportaSfu: ((capturada) => () => capturada)(session.suportaSfu),",
    quebra: "lê a capacidade da sessão A CADA pergunta",
    porque: "um booleano capturado na construção da ponte é lido antes do hello.ok, e é sempre falso",
  },
  {
    nome: "ponte-nao-entrega-os-avisos",
    ficheiro: PONTE_WEB,
    raiz: "apps/web",
    suite: "bridge.sfu.test.ts",
    /*
     * Subscribe to the wrong event, and do not delete the block: deleting it
     * would leave braces unclosed, the file would not compile, and vitest would not
     * run any test, which reads as "no test matched" and
     * not as "the test does not catch anything". A mutation that does not compile does not measure
     * anything.
     */
    procurar: '  session.on("sfu", (aviso) => {',
    trocar: '  session.on("sfu-que-nao-existe" as "sfu", (aviso) => {',
    quebra: "a ponte inscreve-se mesmo no acontecimento `sfu`",
    porque: "sem isto a chamada monta, ouve-se quem já lá estava, e ninguém que entre DEPOIS se ouve — nunca, e sem um erro em lado nenhum",
  },

  // ---------------------------------------------------------- the protocol
  {
    nome: "ambito-sem-comprimento",
    ficheiro: PROTOCOLO,
    suite: "wire.ambito.test.ts",
    raiz: "packages/protocol",
    procurar: "return toBase64(sha256(new TextEncoder().encode(`${channel.length}:${channel}:${room}`)))",
    trocar: "return toBase64(sha256(new TextEncoder().encode(`${channel}|${room}`)))",
    quebra: "não junta duas chamadas por causa do separador",
    porque: 'com o separador sozinho, ("#a|b:x", "c") e ("#a", "b:x|c") resumem-se à mesma coisa: duas chamadas no mesmo router',
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
