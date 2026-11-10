/**
 * The things that could not happen, verified one by one.
 *
 * Absence of noise proves nothing: the bugs that cost in this application were
 * all silent: the authority that thins, the history that shrinks, the call side
 * that sees fewer people than the other. None of them throw exceptions. That is
 * why these checks exist: they do not ask "was there an error?", they ask "is
 * this still true?".
 *
 * HOW TO REACH THE BRIDGE WITHOUT CHANGING THE APPLICATION CODE. The
 * `EnclaveBridge` is created in `main.tsx` and passed to `<App bridge={…}/>`
 * as a prop; it is not in `window` and should not be. Reach it through the React
 * fiber from `#root`, which is pure read of what is already running. It is the
 * difference between checking the guard for real: the one that lives in the core:
 * and checking whether a button is hidden, which proves nothing: a hidden button
 * does not stop anyone from calling the bridge.
 */

import { garantirEcra } from "./accoes.mjs"
import { fotografar } from "./bot.mjs"

/** Install `window.__ponte` from the React tree. Restored after reload. */
const ACHAR_PONTE = () => {
  if (window.__ponte) return true
  const raiz = document.getElementById("root")
  if (!raiz) return false
  const chave = Object.keys(raiz).find((k) => k.startsWith("__reactContainer$"))
  if (!chave) return false
  const pilha = [raiz[chave]]
  const vistos = new Set()
  while (pilha.length > 0) {
    const fibra = pilha.pop()
    if (!fibra || vistos.has(fibra)) continue
    vistos.add(fibra)
    const props = fibra.memoizedProps
    if (props?.bridge?.channels) {
      window.__ponte = props.bridge
      return true
    }
    if (fibra.child) pilha.push(fibra.child)
    if (fibra.sibling) pilha.push(fibra.sibling)
  }
  return false
}

export async function comPonte(page, fn, ...args) {
  const pronta = await page.evaluate(ACHAR_PONTE).catch(() => false)
  if (!pronta) throw new Error("não foi possível alcançar a ponte pela árvore do React")
  return page.evaluate(fn, ...args)
}

const novo = (nome, porque) => ({ nome, porque, verificacoes: 0, violacoes: 0, provas: [] })

/**
 * Authority does not dissolve.
 *
 * An audit proved that the founding record does not reach guests who join later:
 * the guest's client reads `founder(canal) === null`, and a channel with no
 * recorded founder is, by design, a channel where any member can act, the rule that
 * applies to channels born before founding existed, now applied to channels that
 * have a founder. Everything else flows from that.
 *
 * We do not check if the button is hidden: we check if the bridge REFUSES.
 * Four attempts, all from a guest, all on a channel he did not
 * found, rename, assume founding, create a role with power to
 * kick, and make himself an admin. Any one that passes is the
 * gravest finding this harness can bring.
 *
 * MUTATES STATE on purpose, and runs last for that reason: an attempt that passes
 * leaves the channel renamed, and midway through the run that would skew everything that
 * came next.
 */
export async function verificarAutoridade(bots, registar) {
  const inv = novo(
    "A autoridade não se dilui",
    "Um canal fundado por alguém tem dono. Quem entra depois não renomeia o canal, não assume a fundação, " +
      "não cria papéis com poder de expulsar, e não se nomeia administrador. A guarda tem de viver no núcleo, " +
      "porque um botão escondido não impede ninguém de chamar a ponte.",
  )

  for (const bot of bots) {
    let leitura
    try {
      leitura = await comPonte(bot.page, async (meuEndereco) => {
        const ponte = window.__ponte
        const canais = await ponte.channels.list()
        const saida = []
        for (const canal of canais) {
          // By the spec (1.0 "Arca"): opaque addresses do not say what the channel is.
          const tipo = ponte.channels.fichas?.()[canal]?.tipo
          if (tipo === "directa" || tipo === "mural") continue
          saida.push({
            canal,
            fundador: ponte.channels.founder(canal),
            souFundador: ponte.channels.founder(canal) === meuEndereco,
            mayEdit: ponte.channels.mayEdit(canal),
            mayManageRoles: ponte.channels.mayManageRoles(canal),
            mayDelete: ponte.channels.mayDelete?.(canal) ?? null,
          })
        }
        return saida
      }, bot.endereco)
    } catch (erro) {
      inv.provas.push(`bot${bot.indice}: não foi possível ler a ponte (${erro.message})`)
      continue
    }

    for (const canal of leitura) {
      inv.verificacoes++
      // A channel this bot founded is theirs: nothing to check here.
      if (canal.souFundador) continue
      // A direct conversation has no administration, by design.
      const nome = canal.canal.split(":")[0]

      if (canal.fundador === null) {
        inv.violacoes++
        inv.provas.push(
          `bot${bot.indice} em \`${nome}\`: **o cliente não sabe quem fundou o canal** (\`founder() === null\`), ` +
            "e um canal sem fundação registada é um canal onde manda qualquer membro.",
        )
      }
      if (canal.mayEdit || canal.mayManageRoles) {
        inv.violacoes++
        inv.provas.push(
          `bot${bot.indice} em \`${nome}\`: não fundou o canal e a ponte diz-lhe ` +
            `\`mayEdit=${canal.mayEdit}\`, \`mayManageRoles=${canal.mayManageRoles}\`.`,
        )
      }

      // The serious tries. Only on a channel this bot did not found.
      const tentativas = await comPonte(
        bot.page,
        async ([canalAlvo, meuEndereco]) => {
          const ponte = window.__ponte
          const tentar = async (nome, gesto) => {
            try {
              await gesto()
              return { nome, passou: true }
            } catch (erro) {
              return { nome, passou: false, erro: String(erro.message).split("\n")[0].slice(0, 120) }
            }
          }
          return [
            await tentar("renomear o canal", () =>
              ponte.channels.setMeta(canalAlvo, { name: "TOMADO POR UM CONVIDADO" }),
            ),
            await tentar("assumir a fundação", () => ponte.channels.claimFounder(canalAlvo)),
            await tentar("criar um papel com poder de expulsar", () =>
              ponte.channels.defineRole(canalAlvo, {
                role: "intruso",
                name: "Intruso",
                powers: ["expulsar"],
              }),
            ),
            await tentar("nomear-se a si próprio administrador", () =>
              ponte.channels.setAdmin(canalAlvo, meuEndereco, true),
            ),
          ]
        },
        [canal.canal, bot.endereco],
      ).catch((erro) => [{ nome: "(tentativas)", passou: false, erro: erro.message }])

      for (const tentativa of tentativas) {
        inv.verificacoes++
        if (!tentativa.passou) continue
        inv.violacoes++
        inv.provas.push(
          `bot${bot.indice} (que não fundou \`${nome}\`) conseguiu **${tentativa.nome}** — a ponte devolveu \`ok\`.`,
        )
        registar?.({
          accao: "invariante:autoridade",
          bot: bot.indice,
          classe: "invariante",
          resumo: `convidado conseguiu ${tentativa.nome} em ${nome}`,
        })
      }
    }
  }
  return inv
}

/**
 * Those who arrive later see the house that was already there.
 *
 * Rooms in a channel are DECLARED by whoever creates it, and those who join
 * later only read "what gets sent from now on, not what already passed": the
 * phrase is written in the invite itself. The consequence, when it is the
 * server's common room that does this, is that the second person to create an
 * account lands in a channel with no rooms: nowhere to write, no voice room,
 * nothing.
 *
 * Compare against whoever founded, not against a list written by hand: what
 * matters is not that there are five rooms, it is that people see the same
 * thing.
 */
export async function verificarSalasVisiveis(bots, registar) {
  const inv = novo(
    "Quem chega depois vê a casa que já lá estava",
    "Duas pessoas no mesmo canal têm de ver as mesmas salas. Quem entrou depois de as salas serem " +
      "declaradas não pode ficar com um canal vazio.",
  )
  const salasDe = async (bot) => {
    const nomes = await bot.page
      .locator(".room-tree .room-name")
      .allInnerTexts()
      .catch(() => [])
    return new Set(nomes.map((n) => n.trim()).filter((n) => n && n !== "Nova sala"))
  }

  // The founder of the common room is bot 0: it was the first to create an account.
  const referencia = await salasDe(bots[0])
  if (referencia.size === 0) return inv

  for (const bot of bots.slice(1)) {
    inv.verificacoes++
    const vistas = await salasDe(bot)
    const faltam = [...referencia].filter((sala) => !vistas.has(sala))
    if (faltam.length === 0) continue
    inv.violacoes++
    inv.provas.push(
      `bot${bot.indice} está no mesmo canal que bot0 e não vê ${faltam.length} de ${referencia.size} salas: ` +
        faltam.map((s) => `\`${s}\``).join(", ") +
        (vistas.size === 0 ? " — **o canal está vazio para ele**." : "."),
    )
    registar?.({
      accao: "invariante:salas-visíveis",
      bot: bot.indice,
      classe: "invariante",
      resumo: `não vê ${faltam.length} salas que o fundador vê`,
    })
  }
  return inv
}

/**
 * The history does not disappear.
 *
 * There is a known cascade: a payload that does not validate makes the event
 * ignored, many ignored events declare the channel deaf, and the repair that
 * follows deletes history. Count what each bot wrote and check if it is still
 * there.
 *
 * Measure by the MARKS each bot put on its own messages, not by line count: a
 * number that goes down could be pagination, a mark that vanishes cannot be
 * anything else.
 */
export async function verificarHistorico(bots, registar) {
  const inv = novo(
    "O histórico não desaparece",
    "Cada mensagem que um bot escreveu e viu publicada tem de continuar visível no fim da corrida, " +
      "na mesma sala, ao próprio autor.",
  )

  for (const bot of bots) {
    const minhas = bot.enviadas.filter((m) => m.canal && m.canal !== "(directa)" && m.sala)
    if (minhas.length === 0) continue
    // Gathering diagnostics left the bot in Settings, where the sidebar is hidden.
    // Without this fix, history searches would look in the wrong screen and lose
    // work that was just two clicks away.
    await garantirEcra(bot, "Comunidades")

    /**
     * Grouped by room, because the history exists by room: searching
     * a room for a message written in another left gaps that never were.
     *
     * The key was `canal\0sala`, with a NUL byte as separator, good choice in
     * principle, because no name can hold one. What it cost was not in sight:
     * a single NUL makes `grep` classify the entire file as
     * binary and silently ignore it. This file became invisible to all
     * text searches, and that is why the `garantirEcra(bot, "Conversas")` at
     * line 255 survived the rail banner change: six searches
     * in a row said there was nothing here, and the test would die without
     * finding where. `JSON.stringify` of a pair gives the same guarantee of no
     * collision and leaves the file readable to those who search for it.
     */
    const porSala = new Map()
    for (const mensagem of minhas) {
      const chave = JSON.stringify([mensagem.canal, mensagem.sala])
      porSala.set(chave, [...(porSala.get(chave) ?? []), mensagem])
    }

    for (const [chave, mensagens] of porSala) {
      const [canal, sala] = JSON.parse(chave)
      const linhaCanal = bot.page.locator(".channel-list button.channel").filter({ hasText: canal }).first()
      if (!(await linhaCanal.isVisible().catch(() => false))) {
        // The bot may have left the channel on its own during the run.
        inv.provas.push(`bot${bot.indice}: já não vê o canal \`${canal}\` — as ${mensagens.length} mensagens de lá não foram contadas.`)
        continue
      }
      await linhaCanal.click().catch(() => {})
      await bot.page.waitForTimeout(900)
      const linhaSala = bot.page.locator(".room-tree button.room").filter({ hasText: sala }).first()
      if (await linhaSala.isVisible().catch(() => false)) {
        await linhaSala.click().catch(() => {})
        await bot.page.waitForTimeout(1200)
      }
      // Fetch all history before counting: pagination by search and lost history
      // read the same if you don't do this.
      for (let i = 0; i < 5; i++) {
        const mais = bot.page.locator("button.timeline-load-older").first()
        if (!(await mais.isVisible().catch(() => false))) break
        await mais.click().catch(() => {})
        await bot.page.waitForTimeout(500)
      }
      const texto = await bot.page.locator(".timeline").innerText().catch(() => "")

      for (const mensagem of mensagens) {
        inv.verificacoes++
        if (texto.includes(mensagem.marca)) continue
        inv.violacoes++
        inv.provas.push(
          `bot${bot.indice}: a mensagem \`${mensagem.marca}\` foi publicada em \`${canal}\`/\`${sala}\` ` +
            `às ${new Date(mensagem.em).toLocaleTimeString("pt-PT")}, o próprio autor viu-a na timeline, ` +
            "e já não está lá.",
        )
        registar?.({
          accao: "invariante:histórico",
          bot: bot.indice,
          classe: "invariante",
          resumo: `mensagem ${mensagem.marca} desapareceu de ${canal}/${sala}`,
        })
      }
    }
    // Repair is the mechanism that erases history: if it ran, we say it did, even
    // if nothing was actually lost this time.
    const reparacoes = (bot.diagnostico ?? "").split("\n").filter((l) => l.includes("repair-pass")).length
    if (reparacoes > 0) {
      inv.provas.push(`bot${bot.indice}: ${reparacoes} passagem(ns) de reparação no registo da aplicação.`)
    }
  }
  return inv
}

/**
 * Nobody sees what they shouldn't.
 *
 * Two different questions with the same expected answer: the server cannot read
 * what passed through it, and a bot cannot hold what was said where it wasn't.
 */
export async function verificarConfidencialidade(bots, mundo, lerBaseDeDados) {
  const inv = novo(
    "Ninguém vê o que não devia",
    "O texto de uma mensagem não existe em claro na base de dados do servidor, e não aparece no cliente de " +
      "quem não é membro do canal onde foi escrita.",
  )

  const marcas = [...mundo.marcas.keys()]
  if (marcas.length > 0) {
    const bruto = await lerBaseDeDados()
    inv.verificacoes++
    const vazadas = marcas.filter((marca) => bruto.includes(marca))
    if (vazadas.length > 0) {
      inv.violacoes++
      inv.provas.push(
        `**${vazadas.length} marca(s) de mensagem encontradas em claro na base de dados do servidor**: ` +
          vazadas.slice(0, 5).map((m) => `\`${m}\``).join(", "),
      )
    }
  }

  for (const bot of bots) {
    const alheias = marcas.filter((marca) => mundo.marcas.get(marca).bot !== bot.indice)
    if (alheias.length === 0) continue
    const guardado = await bot.page
      .evaluate(() => {
        const pedacos = []
        for (let i = 0; i < localStorage.length; i++) pedacos.push(localStorage.getItem(localStorage.key(i)) ?? "")
        for (let i = 0; i < sessionStorage.length; i++) pedacos.push(sessionStorage.getItem(sessionStorage.key(i)) ?? "")
        return pedacos.join("\n")
      })
      .catch(() => "")
    inv.verificacoes++
    const emClaro = alheias.filter((marca) => guardado.includes(marca))
    if (emClaro.length > 0) {
      inv.violacoes++
      inv.provas.push(
        `bot${bot.indice}: ${emClaro.length} mensagem(ns) de outros em claro no armazenamento local do browser.`,
      )
    }
  }
  return inv
}

/**
 * If A sees B on a call, B sees A.
 *
 * Asymmetry was the signature of two real bugs this week, and it's what people
 * report as "I stopped seeing this person". Compare what each side shows, not
 * what the log says.
 */
export async function verificarSimetria(bots, registar, esperaEntreLeituras = 30_000) {
  const inv = novo(
    "Se A vê B numa chamada, B vê A",
    "Duas pessoas na mesma sala de voz têm de aparecer uma à outra. Uma ligação viva de um lado só lê-se, " +
      "no ecrã, como alguém que desapareceu.",
  )

  /**
   * TWO reads, thirty seconds apart, and count only what persists.
   *
   * A single read confuses "I can't see you" with "I'm still connecting", and
   * making that accusation costs the investigator more than it's worth. An
   * asymmetry that survives thirty seconds is not ICE spinning up.
   */
  const ler = async () => {
    const leitura = new Map()
    for (const bot of bots) {
      const dentro = await bot.page.locator("section.call").isVisible().catch(() => false)
      if (!dentro) continue
      // `.call-chip-name` is the card label: literally what the person sees.
      const nomes = await bot.page
        .locator("section.call .call-person .call-chip-name")
        .allInnerTexts()
        .catch(() => [])
      const ligacoes = await bot.page.evaluate(() => window.__enxame?.ligacoes ?? []).catch(() => [])
      leitura.set(bot.indice, {
        bot,
        nomes: new Set(nomes.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean)),
        vivas: ligacoes.filter((l) => l.estados.at(-1) === "connected").length,
      })
    }
    return leitura
  }

  const primeira = await ler()
  await bots[0].page.waitForTimeout(esperaEntreLeituras)
  const segunda = await ler()

  /**
   * Compare HOW MANY people each side sees, not names.
   *
   * The first version compared labels and flagged four asymmetries that didn't
   * exist: both sides saw all five people, but one showed bot 0 as `xagmirex`-
   * the start of the address-because its profile never reached it. It was
   * measuring name propagation and calling it a dropped call. Names have their
   * own invariant (`verificarNomes`); here we measure presence.
   */
  const assimetrica = (leitura, a, b) => {
    const ladoA = leitura.get(a)
    const ladoB = leitura.get(b)
    if (!ladoA || !ladoB) return null
    return ladoA.nomes.size !== ladoB.nomes.size
  }

  let passageiras = 0
  for (const a of bots) {
    for (const b of bots) {
      if (a.indice >= b.indice) continue
      if (!segunda.has(a.indice) || !segunda.has(b.indice)) continue
      inv.verificacoes++
      const agora = assimetrica(segunda, a.indice, b.indice)
      if (!agora) continue
      if (!assimetrica(primeira, a.indice, b.indice)) {
        // Appeared between the two reads: we log it, but don't flag it.
        passageiras++
        continue
      }
      inv.violacoes++
      const ladoA = segunda.get(a.indice)
      const ladoB = segunda.get(b.indice)
      inv.provas.push(
        `**assimetria persistente** (nas duas leituras, a ${esperaEntreLeituras / 1000} s de intervalo): ` +
          `na mesma sala de voz, ${a.nome} tem ${ladoA.nomes.size} cartões no ecrã e ${b.nome} tem ` +
          `${ladoB.nomes.size}. Um dos dois está a ver menos gente do que lá está. ` +
          `Ligações em \`connected\`: ${a.nome}=${ladoA.vivas}, ${b.nome}=${ladoB.vivas}.`,
      )
      // BOTH screens, because an asymmetry only shows up in pairs: a screenshot of
      // one side alone looks like a working call.
      const provaA = await fotografar(a, `simetria-vs-bot${b.indice}`)
      const provaB = await fotografar(b, `simetria-vs-bot${a.indice}`)
      inv.provas.push(`   provas: \`${provaA}\` e \`${provaB}\``)
      registar?.({
        accao: "invariante:simetria",
        bot: a.indice,
        classe: "invariante",
        resumo: `${a.nome} e ${b.nome} não se veem um ao outro`,
        prova: provaA,
      })
    }
  }
  if (passageiras > 0) {
    inv.provas.push(
      `(${passageiras} assimetria(s) apareceram só na segunda leitura e não foram contadas como violação: ` +
        "podem ser ligação ainda a formar-se.)",
    )
  }
  return inv
}

/**
 * A person's name reaches the others.
 *
 * Born from a false positive that was worth it: the symmetry check flagged four
 * dropped calls and what was actually broken was something else-everyone saw
 * everyone, but bot 0 appeared to others as `xagmirex`, the start of its
 * address, because the profile it published when creating the account never
 * reached anyone who joined later.
 *
 * Same mechanism as founding records and declared rooms: what was said before
 * someone joined doesn't reach them. The symptom is small and the cause is the
 * same, which is why it's worth keeping it separate and measured.
 */
export async function verificarNomes(bots, registar) {
  const inv = novo(
    "O nome de uma pessoa chega às outras",
    "Quem partilha um canal vê o nome que a outra pessoa escolheu, e não o princípio do endereço dela.",
  )
  for (const bot of bots) {
    const vistos = await bot.page
      .locator(".member-list .member-name")
      .allInnerTexts()
      .catch(() => [])
    const conjunto = new Set(vistos.map((n) => n.replace(/\s+/g, " ").trim()))
    for (const outro of bots) {
      if (outro === bot) continue
      inv.verificacoes++
      if (conjunto.has(outro.nome)) continue
      // The start of the address is what the UI falls back to when there's no profile.
      const local = (outro.endereco ?? "").split("-")[0].replace("@", "")
      const porEndereco = local && [...conjunto].some((n) => n.startsWith(local))
      if (!porEndereco) continue
      inv.violacoes++
      inv.provas.push(
        `bot${bot.indice} vê bot${outro.indice} como \`${local}…\` — o princípio do endereço — ` +
          `e não como "${outro.nome}". O perfil foi publicado antes de bot${bot.indice} existir e nunca lhe chegou.`,
      )
      registar?.({
        accao: "invariante:nomes",
        bot: bot.indice,
        classe: "invariante",
        resumo: `vê bot${outro.indice} pelo endereço em vez do nome`,
      })
    }
  }
  return inv
}

/**
 * Ephemeral data doesn't persist.
 *
 * A typing signal and a nudge are for the moment. If they survive a reload,
 * they stopped being signals and became history-history nobody asked to keep.
 */
export async function verificarEfemero(bots, registar) {
  const inv = novo(
    "O efémero não se grava",
    "Depois de recarregar, nem o sinal de escrita nem a cotovelada podem aparecer como mensagens no histórico.",
  )
  for (const bot of bots) {
    inv.verificacoes++
    const linhas = await bot.page
      .locator(".timeline article.message")
      .allInnerTexts()
      .catch(() => [])
    const gravadas = linhas.filter((t) => /está a escrever|cotovelada|buzz/i.test(t))
    if (gravadas.length === 0) continue
    inv.violacoes++
    inv.provas.push(
      `bot${bot.indice}: ${gravadas.length} linha(s) efémeras no histórico depois de recarregar — ` +
        `"${gravadas[0].replace(/\s+/g, " ").slice(0, 80)}"`,
    )
    registar?.({
      accao: "invariante:efémero",
      bot: bot.indice,
      classe: "invariante",
      resumo: "sinal efémero gravado no histórico",
    })
  }
  return inv
}

/**
 * Someone opening the app in the afternoon joins the same room.
 *
 * The missing invariant, and the one that cost a week in August. All bots in a
 * run are born in the same minute, and the shared room always admits them-they
 * arrive before the room has passed, enter through a fresh card, and whoever's
 * there still has fresh key packages. None of that describes someone who
 * installs the app mid-afternoon in a room that's existed since morning.
 *
 * The August 6 report was exactly that: two accounts on the server, two
 * arriving two to three minutes later, and those were never admitted-with two
 * members online and the request going out. The difference between those who
 * got in and those who didn't was the DELAY, and the harness had no way to
 * exercise it.
 *
 * Here there are two gates and both count: the card, if a slot is still open,
 * and the request to members if not. Which one served doesn't get checked-what
 * gets checked is the result: having somewhere to write.
 *
 * **One extra account per run.** The latecomer opens after the chaos ends and
 * closes right after this measurement, so it doesn't count toward the call or
 * history tallies.
 */
export async function verificarRetardatario(retardatario, registar, limiteMs = 90_000) {
  const inv = novo(
    "Quem abre a aplicação à tarde entra na mesma",
    "Uma conta criada depois de a sala comum já ter vida tem de acabar com onde escrever — pela porta " +
      "(o cartão) ou pelo pedido aos membros. É o caso de toda a gente que não estava lá no primeiro minuto.",
  )

  if (!retardatario) {
    inv.provas.push("o retardatário não chegou a ter conta: nada medido")
    return inv
  }

  inv.verificacoes += 1
  const inicio = Date.now()
  const entrou = await retardatario.page
    .locator(".room-tree button.room")
    .first()
    .waitFor({ timeout: limiteMs })
    .then(() => true)
    .catch(() => false)
  const demorou = Date.now() - inicio

  if (entrou) {
    retardatario.tempos.push({ passo: "admissão-de-quem-chega-tarde", ms: demorou })
    inv.provas.push(`o retardatário entrou em ${(demorou / 1000).toFixed(1)}s`)
    return inv
  }

  inv.violacoes += 1
  const prova = await fotografar(retardatario, "retardatario-sem-salas")
  inv.provas.push(`o retardatário ficou ${(limiteMs / 1000).toFixed(0)}s sem uma sala onde escrever — ${prova}`)
  registar({
    accao: "invariante:retardatario",
    bot: retardatario.indice,
    classe: "invariante",
    resumo: "uma conta criada depois de a sala comum ter vida ficou sem onde escrever",
  })
  return inv
}
