/**
 * The swarm: many bots using the app for real, and a diagnosis of what broke,
 * with proof.
 *
 * Not a test. A test says "passed"; this says what happened, where, and with
 * what proof -- which is the only thing you fix anything with.
 *
 * Usage:
 *   node scripts/enxame.mjs                      6 bots, 3 minutes
 *   node scripts/enxame.mjs --bots=10 --minutos=8
 *   node scripts/enxame.mjs --semente=123456     repeat a run exactly
 *   node scripts/enxame.mjs --forcar             run even if the machine is busy
 *
 * RULES THAT DECIDE IF THIS WORKS, written in code and not just here:
 *
 *   LOCAL TARGET, ALWAYS. No `--url`. The homeserver starts with the run on an
 *   ephemeral port and dies with it. On August 6th, a load run against production
 *   deleted the founding record the owner had just published; this script has no
 *   path there.
 *
 *   MODEST SCALE. The machine has other agents working. Six bots by default, and
 *   it refuses to start if load is already high -- a run that kills the machine
 *   produces no diagnosis and breaks the other work.
 *
 *   SEED. The order of actions repeats. A bug you cannot repeat is a bug nobody fixes.
 *
 *   FAIL LOUD. If the scenario does not set up, say INVALID RUN and show no
 *   numbers. The opposite happened once: a run where bots never got in measured
 *   zero and read as the worst failure ever.
 */
import { cpus, loadavg, tmpdir } from "node:os"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { arrancarHomeserver, portaLivre, servirAplicacao } from "./enxame/cenario.mjs"
import { abrirBot, colherAvisos, colherDiagnostico, fecharBot, fotografar, recarregar } from "./enxame/bot.mjs"
import { CATALOGO, ECRA_DE, PNG_MINIMO, garantirEcra, gerador, sortearAccao } from "./enxame/accoes.mjs"
import {
  verificarAutoridade,
  verificarConfidencialidade,
  verificarEfemero,
  verificarHistorico,
  verificarNomes,
  verificarRetardatario,
  verificarSalasVisiveis,
  verificarSimetria,
} from "./enxame/invariantes.mjs"
import { classificar, compor, escrever, resumirErro } from "./enxame/relatorio.mjs"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const argumento = (nome, omissao) => {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nome}=`))
  return encontrado ? encontrado.split("=")[1] : omissao
}

const BOTS = Number(argumento("bots", 6))
const MINUTOS = Number(argumento("minutos", 3))
const SEMENTE = Number(argumento("semente", Date.now() % 1_000_000))
const FORCAR = process.argv.includes("--forcar")
const FRASE = process.env.ORWELL_ENXAME_PASSPHRASE ?? "enxame-2026"
const ID = `${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}-s${SEMENTE}`

/** Proofs live outside version control: captures and databases are not committed. */
const DIR_CORRIDA = join(RAIZ, ".verify-data", "enxame", ID)

const corrida = []
const achados = []
const registarAchado = (achado) => {
  achados.push({ em: Date.now(), ...achado })
  corrida.push({ tipo: "achado", em: Date.now(), ...achado })
}

const agora = () => new Date().toLocaleTimeString("pt-PT")
const dizer = (texto) => console.log(`[${agora()}] ${texto}`)

// ---------------------------------------------------------------------------
// Before spending a single browser: can the machine handle this?
// ---------------------------------------------------------------------------
const NUCLEOS = cpus().length
const CARGA = loadavg()[0]
if (CARGA > NUCLEOS * 0.9 && !FORCAR) {
  console.error(
    `A máquina está com carga ${CARGA.toFixed(1)} em ${NUCLEOS} núcleos. ` +
      `Uma corrida de ${BOTS} browsers em cima disto não mede nada e estraga o trabalho de quem lá está.\n` +
      "Espera, baixa --bots, ou insiste com --forcar.",
  )
  process.exit(2)
}

/**
 * The `dist` may be older than the source, and it fooled an audit once.
 *
 * We do not build here on purpose: a build in the middle of another agent's run
 * is a file changing under its feet. We say so, and whoever runs it decides.
 */
function idadeDoDist() {
  const bundle = join(RAIZ, "apps/web/dist/index.html")
  if (!existsSync(bundle)) return { falta: true }
  const construido = statSync(bundle).mtimeMs
  let maisRecente = 0
  const olhar = (pasta) => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      if (entrada.name === "node_modules" || entrada.name === "dist" || entrada.name.startsWith(".")) continue
      const caminho = join(pasta, entrada.name)
      if (entrada.isDirectory()) olhar(caminho)
      else maisRecente = Math.max(maisRecente, statSync(caminho).mtimeMs)
    }
  }
  for (const pacote of ["packages/ui/src", "packages/client-core/src", "apps/web/src"]) {
    const caminho = join(RAIZ, pacote)
    if (existsSync(caminho)) olhar(caminho)
  }
  return { falta: false, velho: maisRecente > construido, construido, maisRecente }
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
const comecouEm = Date.now()
let cenario = null
let bots = []
/** The console and timings of the latecomer, who closes before the report builds. */
const retardatarioConsola = []
const retardatarioTempos = []
let valida = true
let motivoInvalidez = ""

async function desmontar() {
  for (const bot of bots) await fecharBot(bot)
  await cenario?.web.parar().catch(() => {})
  await cenario?.homeserver.parar().catch(() => {})
  if (cenario?.dirPerfis) await rm(cenario.dirPerfis, { recursive: true, force: true }).catch(() => {})
}

async function invalidar(motivo) {
  valida = false
  motivoInvalidez = motivo
  dizer(`CORRIDA INVÁLIDA: ${motivo}`)
}

try {
  const dist = idadeDoDist()
  if (dist.falta) {
    console.error("Não há aplicação construída. Corre `npx tsc -b && npm run build -w @enclave/web` primeiro.")
    process.exit(2)
  }
  if (dist.velho) {
    dizer(
      "AVISO: `apps/web/dist` é mais velho do que a fonte. Estás a medir código antigo — " +
        "reconstrói antes de acreditar no que vier a seguir.",
    )
  }

  await mkdir(DIR_CORRIDA, { recursive: true })
  const dirProvas = join(DIR_CORRIDA, "provas")
  const dirPerfis = await mkdtemp(join(tmpdir(), "orwell-enxame-"))
  const dirDados = join(DIR_CORRIDA, "servidor")
  await mkdir(dirDados, { recursive: true })
  const ficheiroImagem = join(DIR_CORRIDA, "imagem.png")
  await writeFile(ficheiroImagem, PNG_MINIMO)

  dizer(`enxame ${ID} — ${BOTS} bots, ${MINUTOS} min, semente ${SEMENTE}`)
  const homeserver = await arrancarHomeserver({ raiz: RAIZ, dirDados, porta: await portaLivre() })
  const web = await servirAplicacao({ raiz: RAIZ, porta: await portaLivre() })
  cenario = { homeserver, web, dirPerfis }
  dizer(`homeserver ${homeserver.nome} · aplicação ${web.url}`)

  const mundo = {
    enderecos: [],
    canais: [],
    links: [],
    papeis: [],
    convitesEnviados: [],
    marcas: new Map(),
    contador: 1,
  }

  // Accounts start one at a time, not all at once: ten browsers starting together
  // take the machine to its knees and what you measure is just the startup.
  for (let i = 0; i < BOTS; i++) {
    try {
      const bot = await abrirBot({
        indice: i,
        nome: `bot ${i}`,
        urlWeb: web.url,
        servidor: homeserver.nome,
        frase: FRASE,
        dirPerfis,
        dirProvas,
      })
      bots.push(bot)
      mundo.enderecos.push(bot.endereco)
      dizer(`  bot ${i} pronto — ${bot.endereco ?? "(sem endereço lido)"}`)
    } catch (erro) {
      registarAchado({
        accao: "montagem:criar-conta",
        bot: i,
        classe: "montagem",
        resumo: resumirErro(erro),
      })
      dizer(`  bot ${i} NÃO ARRANCOU: ${resumirErro(erro)}`)
    }
  }

  if (bots.length < 2) {
    await invalidar(
      `só ${bots.length} de ${BOTS} bots chegaram a ter conta. Sem duas pessoas não há nada para medir, ` +
        "e um zero medido assim lê-se como avaria e não é.",
    )
  }

  // The common room is moderated: whoever founds it owns it, and whoever arrives
  // later must be admitted by someone online. It is the slowest step and the one
  // that most often invalidates a run without saying why.
  let dentro = 0
  if (valida) {
    dizer("a esperar que toda a gente seja admitida na sala comum...")
    // All at once, not one after another: in sequence, five bots with no rooms
    // cost ten minutes of waiting before learning the run would not happen. In
    // parallel, two minutes.
    const esperar = async (bot, limite) => {
      const inicio = Date.now()
      // Wait for a ROOM, not the channel name.
      //
      // The name appears the instant the account exists, so it always measures
      // zero and we called it "admitted". Being admitted is having somewhere to
      // write, and that is rooms -- which arrive by declaration from the channel
      // founder and may never arrive.
      const viu = await bot.page
        .locator(".room-tree button.room")
        .first()
        .waitFor({ timeout: limite })
        .then(() => true)
        .catch(() => false)
      if (viu) bot.tempos.push({ passo: "admissão-à-sala-comum", ms: Date.now() - inicio })
      return viu
    }

    let comSalas = await Promise.all(bots.map((bot) => esperar(bot, 90_000)))
    const semSalas = bots.filter((_, i) => !comSalas[i])

    /**
     * When someone lands in a channel with no rooms, test WHY before giving up.
     *
     * The hypothesis is known and written in the invite itself: rooms are
     * declared by the channel creator, and whoever enters later reads "what
     * gets sent from now on, not what already happened". If that is it, a NEW
     * declaration -- made now, with everyone already there -- must reach
     * everyone. If it does, the diagnosis is proven and the run has somewhere
     * to happen; if not, the problem is different and deeper.
     */
    if (semSalas.length > 0) {
      dizer(`  ${semSalas.length} bot(s) entraram na sala comum e não veem salas nenhumas`)
      for (const bot of semSalas) {
        registarAchado({
          accao: "montagem:salas-da-sala-comum",
          bot: bot.indice,
          classe: "montagem",
          resumo: "entrou na sala comum e não vê lá uma única sala em 90 s",
          prova: await fotografar(bot, "sem-salas"),
        })
      }
      const fundador = bots[comSalas.findIndex(Boolean)]
      if (fundador) {
        dizer("  o fundador vai declarar uma sala nova, para se saber se o que falha é o passado ou o canal")
        try {
          await fundador.page.locator("button.room.room-new").first().click({ timeout: 15_000 })
          const folha = fundador.page.locator("form.sheet").first()
          await folha.waitFor({ timeout: 15_000 })
          await folha.getByLabel("Nome").fill("praca")
          await folha.getByRole("button", { name: "Criar", exact: true }).click()
          await fundador.page.waitForTimeout(4000)
        } catch (erro) {
          dizer(`  (o fundador não conseguiu declarar a sala: ${resumirErro(erro)})`)
        }
        const depois = await Promise.all(semSalas.map((bot) => esperar(bot, 60_000)))
        const chegou = depois.filter(Boolean).length
        registarAchado({
          accao: "montagem:salas-da-sala-comum",
          bot: 0,
          classe: "montagem",
          resumo:
            `declaração NOVA de sala chegou a ${chegou}/${semSalas.length} dos que não viam nada — ` +
            (chegou === semSalas.length
              ? "o canal está bom e o que não chega é o que foi declarado ANTES de eles entrarem"
              : "nem as declarações novas chegam: o problema é mais fundo do que o histórico"),
        })
        dizer(`  a sala nova chegou a ${chegou}/${semSalas.length}`)
        comSalas = await Promise.all(bots.map((bot) => esperar(bot, 5_000)))
      }
    }

    for (let i = 0; i < bots.length; i++) {
      if (!comSalas[i]) continue
      dentro++
      bots[i].canais.add("Orwell")
    }
    dizer(`  ${dentro}/${bots.length} com onde escrever na sala comum`)
    if (dentro < 2) {
      await invalidar(
        `só ${dentro} bot(s) entraram na sala comum. A corrida mediria zero por não haver onde falar, ` +
          "e isso não é uma avaria da aplicação — é um cenário que não montou.",
      )
    }
  }

  // -------------------------------------------------------------------------
  // A desordem
  // -------------------------------------------------------------------------
  const contagem = new Map(CATALOGO.map((a) => [a.nome, { nome: a.nome, tentativas: 0, ok: 0, saltada: 0, falhou: 0 }]))

  if (valida) {
    dizer(`a soltar ${bots.length} bots durante ${MINUTOS} minutos...`)
    const fim = Date.now() + MINUTOS * 60_000

    await Promise.all(
      bots.map(async (bot) => {
        // Each bot with its own random stream, derived from the seed: the run repeats,
        // and one more bot does not change the choices of the others.
        const aleatorio = gerador(SEMENTE + bot.indice * 7919)
        while (Date.now() < fim) {
          const accao = sortearAccao(aleatorio)
          const linha = contagem.get(accao.nome)
          linha.tentativas++
          const inicio = Date.now()
          try {
            // Take the bot to the screen where the action exists. Without this, a bot
            // that went to the feed stayed there and the rest of the run skipped itself.
            const ecra = ECRA_DE[accao.nome]
            if (ecra && !(await garantirEcra(bot, ecra))) {
              linha.saltada++
              corrida.push({ tipo: "accao", em: inicio, bot: bot.indice, accao: accao.nome, estado: "saltada", detalhe: `não chegou ao ecrã ${ecra}` })
              await bot.page.waitForTimeout(300)
              continue
            }
            const resultado = await accao.correr({ bot, mundo, aleatorio, ficheiroImagem })
            linha[resultado.estado === "ok" ? "ok" : resultado.estado === "saltada" ? "saltada" : "falhou"]++
            corrida.push({
              tipo: "accao",
              em: inicio,
              ms: Date.now() - inicio,
              bot: bot.indice,
              accao: accao.nome,
              ...resultado,
            })
            if (resultado.estado === "falhou") {
              /**
               * What the app SAID matters more than what the harness deduced.
               *
               * "create-invite-link" failed thirteen times in twenty-three and
               * the summary said "created the invite and did not return link" --
               * a sentence the harness invented, because it was the only reading
               * of an empty field. The invite never existed: the refusal was on
               * the screen, in words, and nobody read them. It took a session to
               * discover something that was written.
               */
              const avisos = await colherAvisos(bot.page)
              registarAchado({
                accao: accao.nome,
                bot: bot.indice,
                classe: "acção falhou",
                resumo: avisos.length > 0 ? `${resultado.detalhe ?? "falhou"} · a app disse: ${avisos.join(" / ")}` : (resultado.detalhe ?? "sem detalhe"),
                prova: await fotografar(bot, accao.nome),
              })
            }
            bot.accoes.push(accao.nome)
          } catch (erro) {
            linha.falhou++
            const classe = classificar(erro)
            registarAchado({
              accao: accao.nome,
              bot: bot.indice,
              classe,
              resumo: resumirErro(erro),
              prova: await fotografar(bot, `erro-${accao.nome}`).catch(() => null),
            })
            corrida.push({ tipo: "erro", em: inicio, bot: bot.indice, accao: accao.nome, classe, erro: resumirErro(erro) })
            // A stuck modal swallows everything that follows; if we do not exit here,
            // this bot fails in a chain for the rest of the run.
            await bot.page.keyboard.press("Escape").catch(() => {})
          }
          // Human think time, and what stops six browsers from hammering in unison --
          // which is a load nobody has.
          await bot.page.waitForTimeout(400 + Math.floor(aleatorio() * 1800)).catch(() => {})
        }
      }),
    )
    dizer("a desordem acabou; a verificar as invariantes...")
  }

  // -------------------------------------------------------------------------
  // The invariants, and order matters: those that change state go last
  // -------------------------------------------------------------------------
  const invariantes = []
  if (valida) {
    // Reload everyone BEFORE looking at history and ephemeral: it is the gesture
    // that makes the app re-read everything from the start, and that is where
    // what was lost stops living in memory pretending to be fine.
    for (const bot of bots) {
      await recarregar(bot).catch((erro) =>
        registarAchado({
          accao: "invariante:recarregar",
          bot: bot.indice,
          classe: "acção falhou",
          resumo: resumirErro(erro),
        }),
      )
    }
    await bots[0].page.waitForTimeout(5000)

    // Everyone back to the common room, where almost everything was written:
    // history only counts in the room that is open, and a bot stuck on the
    // feed proves nothing about messages not on the screen.
    for (const bot of bots) {
      await garantirEcra(bot, "Comunidades")
      await bot.page.locator(".channel-list button.channel").first().click().catch(() => {})
      await bot.page.waitForTimeout(1200)
    }

    /*
      The latecomer: an account created NOW, in a room that already has life.
      
      All the other bots were born the same minute, and that is what hid the
      admission failure of August 6th -- someone who arrived two minutes later
      was never admitted, with members online and the request going out. Without
      an account that arrives late, the harness never exercises the person who
      installs the app in the middle of the afternoon, which is everyone except
      the first five.
      
      Opens here, measured in `verificarRetardatario`, and closes after: it does
      not enter the call counts or the authority counts, which are measured over
      everyone who lived through all the chaos.
      */
    let retardatario = null
    if (valida) {
      dizer("a abrir uma conta que chega tarde, numa sala que já tem vida...")
      try {
        retardatario = await abrirBot({
          indice: bots.length,
          nome: "bot tarde",
          urlWeb: web.url,
          servidor: homeserver.nome,
          frase: FRASE,
          dirPerfis,
          dirProvas,
        })
      } catch (erro) {
        registarAchado({
          accao: "montagem:retardatario",
          bot: bots.length,
          classe: "montagem",
          resumo: resumirErro(erro),
        })
        dizer(`  o retardatário NÃO ARRANCOU: ${resumirErro(erro)}`)
      }
    }
    invariantes.push(await verificarRetardatario(retardatario, registarAchado))
    if (retardatario) {
      // His console counts like any other: a page error on startup for a latecomer
      // is a product error too. The browser closes now, to not weigh on the call
      // that follows.
      retardatarioConsola.push(...retardatario.consola.map((linha) => ({ ...linha, bot: retardatario.indice })))
      // His time is the only number in this run that describes someone NOT there
      // in the first minute, and it is what the timing table did not have.
      retardatarioTempos.push(...retardatario.tempos)
      await fecharBot(retardatario)
    }

    invariantes.push(await verificarSalasVisiveis(bots, registarAchado))
    invariantes.push(await verificarNomes(bots, registarAchado))
    invariantes.push(await verificarEfemero(bots, registarAchado))
    for (const bot of bots) bot.diagnostico = await colherDiagnostico(bot)
    invariantes.push(await verificarHistorico(bots, registarAchado))

    // Everyone to the SAME call, not each to his own: the voice room must
    // be the same or you measure people alone in different rooms, which
    // happened once in an entire run of the churn script.
    dizer("a pôr toda a gente na mesma chamada...")
    for (const bot of bots) {
      await garantirEcra(bot, "Comunidades")
      const comum = bot.page.locator(".channel-list button.channel").filter({ hasText: "Orwell" }).first()
      if (await comum.isVisible().catch(() => false)) {
        await comum.click().catch(() => {})
        await bot.page.waitForTimeout(900)
      }
      const voz = bot.page.locator(".room-tree button.room").filter({ hasText: /^voz$/i }).first()
      if (await voz.isVisible().catch(() => false)) {
        await voz.click().catch(() => {})
        await bot.page.waitForTimeout(900)
      }
    }
    await bots[0].page.waitForTimeout(20_000)
    invariantes.push(await verificarSimetria(bots, registarAchado))

    invariantes.push(
      await verificarConfidencialidade(bots, mundo, async () => {
        const base = join(DIR_CORRIDA, "servidor", "enclave.sqlite")
        return existsSync(base) ? (await readFile(base)).toString("latin1") : ""
      }),
    )

    // Authority goes last because attempts CHANGE the channel.
    invariantes.push(await verificarAutoridade(bots, registarAchado))
  }

  // -------------------------------------------------------------------------
  // The diagnosis
  // -------------------------------------------------------------------------
  const consolaTodos = [
    ...bots.flatMap((bot) => bot.consola.map((linha) => ({ ...linha, bot: bot.indice }))),
    ...retardatarioConsola,
  ]
  const gruposConsola = new Map()
  for (const linha of consolaTodos) {
    const chave = `${linha.tipo}::${linha.texto.replace(/\d{3,}/g, "N").slice(0, 120)}`
    const grupo = gruposConsola.get(chave) ?? { tipo: linha.tipo, texto: linha.texto.slice(0, 120), quantos: 0, bots: new Set() }
    grupo.quantos++
    grupo.bots.add(linha.bot)
    gruposConsola.set(chave, grupo)
  }

  const naoExercitado = [
    ...CATALOGO.filter((a) => (contagem.get(a.nome)?.ok ?? 0) === 0).map(
      (a) => `\`${a.nome}\` — nunca chegou a acontecer nesta corrida (${contagem.get(a.nome)?.tentativas ?? 0} tentativa(s), todas saltadas ou falhadas).`,
    ),
    "**Expulsar pela interface** — não existe botão nenhum que o faça. A responsabilidade existe no núcleo (`session.expel`) e nenhuma interface a chama, portanto o caminho da pessoa não foi exercitado; verificou-se a guarda pela ponte, que é onde ela vive.",
    "**Editar e apagar mensagens de conversa** — a aplicação não tem essas acções na conversa (só no feed social). Nada aqui prova que existam ou funcionem.",
    "**Federação entre servidores** — corre tudo num homeserver só. Travessia entre servidores, chaves de federação e listas de permissão ficaram por tocar.",
    "**Travessia de rede a sério** — todos os browsers estão na mesma máquina, sem NAT, sem TURN e sem perda de pacotes. Uma chamada que funciona aqui pode não funcionar entre duas casas.",
    "**Ficheiros grandes e histórico longo** — as imagens são de 8×8 pixels e a corrida dura minutos. Nada aqui mede o que acontece com meses de conversa ou fotografias a sério.",
    "**Vários dispositivos na mesma conta** — cada bot tem um cofre só. A reconciliação entre dois dispositivos da mesma pessoa não foi exercitada.",
    "**IndexedDB** — a busca por conteúdo alheio olhou para `localStorage` e `sessionStorage`; o cofre em IndexedDB está cifrado e não foi decifrado nem inspeccionado.",
    "**Recuperação depois de o servidor cair** — o homeserver nunca foi morto a meio da corrida.",
  ]

  const relatorio = compor({
    identificacao: {
      id: ID,
      semente: SEMENTE,
      bots: bots.length,
      minutos: MINUTOS,
      duracaoMs: Date.now() - comecouEm,
      urlWeb: cenario?.web.url ?? "(não chegou a servir)",
      servidor: cenario?.homeserver.nome ?? "(não chegou a arrancar)",
      carga: CARGA.toFixed(2),
      cpus: NUCLEOS,
      comecouEm,
    },
    valida,
    motivoInvalidez,
    invariantes,
    achados,
    consola: {
      total: consolaTodos.length,
      porBot: bots.map((bot) => bot.consola.length),
      grupos: [...gruposConsola.values()]
        .sort((a, b) => b.quantos - a.quantos)
        .map((g) => ({ ...g, bots: g.bots.size })),
    },
    tempos: [...bots.flatMap((bot) => bot.tempos), ...retardatarioTempos],
    catalogo: [...contagem.values()],
    naoExercitado,
    registoServidor: cenario?.homeserver.registo ?? [],
  })

  // Each bot's diagnostic log goes raw to the run folder: it is what the app
  // itself says about itself, not our reading of it.
  for (const bot of bots) {
    if (!bot.diagnostico) continue
    await writeFile(join(DIR_CORRIDA, `diagnostico-bot${bot.indice}.txt`), bot.diagnostico, "utf8")
  }

  const { caminhoMd } = await escrever({ dirCorrida: DIR_CORRIDA, corrida, relatorio })

  const violacoes = invariantes.reduce((soma, inv) => soma + inv.violacoes, 0)
  console.log("")
  console.log(relatorio.split("## 2.")[0])
  dizer(`relatório completo: ${caminhoMd}`)

  await desmontar()
  process.exit(!valida ? 2 : violacoes > 0 ? 1 : 0)
} catch (erro) {
  console.error(`\nO arnês não conseguiu montar o cenário: ${erro.message}`)
  console.error("Isto NÃO é uma medição da aplicação. Nada foi medido.")
  // The trail, not just the phrase. A run that dies halfway takes ten minutes
  // to find; discovering WHERE it died took another ten without this.
  if (erro.stack) console.error(`\n${erro.stack}`)
  await desmontar()
  process.exit(2)
}
