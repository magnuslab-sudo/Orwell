/**
 * What people do, and in what order they DON'T do it.
 *
 * Disorder is the point. A bot that follows the right script -- create channel,
 * create room, write, leave -- finds nothing, because that is exactly the order
 * the app was written and tested in. What finds bugs is inviting someone while
 * the page reloads, entering a voice room someone just deleted, and accepting
 * an invite to a channel you are already in.
 *
 * Each action is independent and tolerant: check the condition, and if it does
 * not exist return `skipped` instead of crashing. This matters more than it
 * looks. An action that breaks because there was no friend fills the report
 * with failures that are not app bugs -- and a report with noise does not read,
 * and a report that does not read fixes nothing.
 *
 * Actions return `{ estado, detalhe }`:
 *   ok       did what it set out to do
 *   saltada  the condition did not exist (not a finding)
 *   -- and a thrown error is a finding, classified by the caller.
 */
import { fecharSobreposicoes, fotografar, recarregar } from "./bot.mjs"

/** PRNG with seed: without it, a bug found today does not repeat tomorrow. */
export function gerador(semente) {
  let estado = semente >>> 0
  return () => {
    estado |= 0
    estado = (estado + 0x6d2b79f5) | 0
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const escolher = (aleatorio, lista) => lista[Math.floor(aleatorio() * lista.length)]

/** An 8×8 pixel PNG, for when an action needs to attach an image. */
export const PNG_MINIMO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVQoz2P8//8/AzGAiYFIMKpwVOGowlGFAAsvAxfr6i2eAAAAAElFTkSuQmCC",
  "base64",
)

/**
 * Open the context menu and read its contents.
 *
 * The design rule of this app is that actions you cannot perform do not appear
 * grayed out -- they do not appear at all. This makes the context menu the right
 * tool to measure authority: the list of items IS the list of powers this client
 * believes it has in this channel.
 */
export async function menuDoCanal(page, nomeCanal) {
  const linha = page.locator(".channel-row").filter({ hasText: nomeCanal }).first()
  if (!(await linha.isVisible().catch(() => false))) return null
  await linha.click({ button: "right" })
  const menu = page.locator(".context-menu[role=menu]").first()
  if (!(await menu.isVisible({ timeout: 3000 }).catch(() => false))) return null
  const itens = (await menu.locator("button[role=menuitem]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())
  return { menu, itens }
}

export async function fecharMenu(page) {
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(150)
}

async function clicarNoMenu(page, nomeCanal, item) {
  const aberto = await menuDoCanal(page, nomeCanal)
  if (!aberto || !aberto.itens.some((t) => t === item)) {
    await fecharMenu(page)
    return false
  }
  await aberto.menu.getByRole("menuitem", { name: item, exact: true }).click()
  return true
}

/** Accept a `window.confirm`/`prompt` only during this gesture, not always. */
async function comDialogo(page, resposta, gesto) {
  /*
    The interface no longer uses native dialogs: it asks with the in-house
    `Confirmar` (`role="alertdialog"`), with the verb on the right button and
    "Cancel" on the left. The native handler stays for an older client that
    still uses them.
    */
  const responder = (dialogo) => {
    if (typeof resposta === "string") void dialogo.accept(resposta)
    else if (resposta) void dialogo.accept()
    else void dialogo.dismiss()
  }
  page.on("dialog", responder)
  try {
    const pergunta = page.locator('[role="alertdialog"]').first()
    const feito = gesto()
    if (await pergunta.isVisible({ timeout: 3000 }).catch(() => false)) {
      const botoes = pergunta.locator(".prompt-actions button")
      await (resposta ? botoes.last() : botoes.first()).click()
    }
    return await feito
  } finally {
    page.off("dialog", responder)
  }
}

/** The channel open right now, read from the screen and not from what we think we clicked. */
export async function canalAberto(page) {
  const actual = page.locator(".channel-row.current .channel-name").first()
  return (await actual.innerText().catch(() => "")).trim() || null
}

/** The room open. History is per room: without this, we would compare apples to oranges. */
export async function salaAberta(page) {
  const actual = page.locator(".room-row.current .room-name").first()
  return (await actual.innerText().catch(() => "")).trim() || null
}

/** The messages visible in the open room, message by message. This is what proves history. */
export async function mensagensVisiveis(page) {
  // "Load older" exists because the timeline pages. Without it, "messages
  // disappeared" and "not fetched yet" read the same.
  for (let i = 0; i < 4; i++) {
    const mais = page.locator("button.timeline-load-older").first()
    if (!(await mais.isVisible().catch(() => false))) break
    await mais.click().catch(() => {})
    await page.waitForTimeout(400)
  }
  return (await page.locator(".timeline article.message .message-body p").allInnerTexts()).map((t) =>
    t.replace(/\s+/g, " ").trim(),
  )
}

/** A unique and recognizable mark, which is what makes a message proof. */
export const marcar = (bot, contador) => `mrk-${bot.indice}-${contador}-${Math.random().toString(36).slice(2, 7)}`

/**
 * Place the bot on the screen that the action needs, before trying it.
 *
 * The first run burned through by skipping actions: a bot that went to the
 * feed stayed there, and from then on "write message" found no input box and
 * called itself skipped. Twenty-nine actions out of thirty-one ended with no
 * execution at all -- and the report, honestly, said nothing had been
 * exercised. Each action now cleans itself up; it is cheap and what a person
 * does without thinking.
 */
/**
 * The tabs on the Contacts screen, in declaration order.
 *
 * By position not by label: names come from `PEOPLE_TABS` and are
 * `todos | pendentes | adicionar`, but what reads on screen is the translated
 * label, and a harness that depends on translated text breaks when someone
 * improves a word. Order is structure, and that changes by decision.
 */
// The Friends tabs: All, Received, Sent, Find. Old keys still point to new
// locations, so actions do not change.
export const SEPARADOR = { todos: 0, pendentes: 1, enviados: 2, adicionar: 3 }

export async function abrirSeparador(bot, qual) {
  const separadores = bot.page.locator(".people-tabs button")
  if ((await separadores.count()) <= SEPARADOR[qual]) return false
  await separadores.nth(SEPARADOR[qual]).click().catch(() => {})
  await bot.page.waitForTimeout(500)
  return true
}

export async function garantirEcra(bot, ecra) {
  const marcas = {
    Comunidades: ".room-tree, .channel-list",
    Feed: ".feed",
    Amigos: ".people-scroll",
  }
  /**
   * A missing screen is the caller's error and must fail loudly.
   *
   * This is the third time a renamed banner has silently deleted tests: the
   * rail changed from "Conversas" to "Canais" and from "Amigos" to "Contactos" (and on 20
   * August 2026 to "Comunidades" and back to "Amigos"), and during that
   * time `marcas[ecra]` was `undefined`, the `locator` could not
   * find anything, and all actions on that screen reported as skipped. The test
   * run would end saying, quite accurately, that nothing had been exercised,    * and no one read that as a harness failure.
   *
   * A test that fails here costs a minute. One that stays silent cost six.
   */
  if (!marcas[ecra]) throw new Error(`ecrã desconhecido no arnês: "${ecra}" (há ${Object.keys(marcas).join(", ")})`)
  if (await bot.page.locator(marcas[ecra]).first().isVisible().catch(() => false)) return true

  // A sheet on top eats the click, and the `catch` swallowed it without saying anything.
  await fecharSobreposicoes(bot.page)

  const botao = bot.page.getByRole("button", { name: ecra, exact: true }).first()
  if (!(await botao.isVisible().catch(() => false))) return false
  await botao.click().catch(() => {})
  await bot.page.waitForTimeout(600)
  if (await bot.page.locator(marcas[ecra]).first().isVisible().catch(() => false)) return true

  /**
   * The rail is already on Friends, and the body is a CONVERSATION.
   *
   * With a direct chat open, the body of this destination is the chat, not the
   * list: `.people-scroll` does not exist, and clicking the rail button is
   * asking for the view already open -- nothing closes. The harness clicked,
   * waited, did not see the mark, and called the action skipped.
   *
   * It cost 123 skipped in a ten-minute run, and blinded six features at once:
   * request friendship, respond, undo, respond to invite, direct message and
   * nudge. None of them were app bugs; none of them got exercised.
   *
   * A tab closes the chat, because that is what it does in the product. It is
   * the same thing a person does without thinking when they want to go back to
   * the list.
   */
  if (ecra === "Amigos") {
    const separador = bot.page.locator(".people-tabs button").first()
    if (await separador.isVisible().catch(() => false)) {
      await separador.click().catch(() => {})
      await bot.page.waitForTimeout(600)
    }
  }
  return bot.page.locator(marcas[ecra]).first().isVisible().catch(() => false)
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const CATALOGO = [
  {
    nome: "escrever-mensagem",
    peso: 10,
    async correr({ bot, mundo }) {
      const caixa = bot.page.getByPlaceholder("Escreve uma mensagem").first()
      if (!(await caixa.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem caixa de texto" }
      const marca = marcar(bot, bot.enviadas.length)
      const canal = await canalAberto(bot.page)
      const sala = await salaAberta(bot.page)
      const inicio = Date.now()
      await caixa.fill(`${marca} — bot ${bot.indice} a escrever`)
      await bot.page.keyboard.press("Enter")
      // Wait for the message ON THE TIMELINE, not on a clock: what matters to
      // measure is how long until the author sees it published.
      const publicada = bot.page.locator(".timeline article.message").filter({ hasText: marca }).first()
      const chegou = await publicada.waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
      if (!chegou) return { estado: "falhou", detalhe: `a mensagem ${marca} não apareceu na própria timeline` }
      bot.tempos.push({ passo: "enviar-mensagem", ms: Date.now() - inicio })
      bot.enviadas.push({ marca, canal, sala, em: Date.now() })
      mundo.marcas.set(marca, { bot: bot.indice, canal, sala })
      return { estado: "ok", detalhe: marca }
    },
  },
  {
    nome: "mencionar-alguem",
    peso: 3,
    async correr({ bot }) {
      const caixa = bot.page.getByPlaceholder("Escreve uma mensagem").first()
      if (!(await caixa.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem caixa" }
      await caixa.fill("@")
      await bot.page.waitForTimeout(700)
      const opcao = bot.page.locator("ul.mention-picker button.mention-option").first()
      if (!(await opcao.isVisible().catch(() => false))) {
        await caixa.fill("")
        return { estado: "saltada", detalhe: "ninguém para mencionar" }
      }
      await opcao.click()
      await caixa.type(" olha isto")
      await bot.page.keyboard.press("Enter")
      await bot.page.waitForTimeout(600)
      return { estado: "ok" }
    },
  },
  {
    nome: "anexar-imagem",
    peso: 2,
    async correr({ bot, ficheiroImagem }) {
      const entrada = bot.page.locator("label.composer-attach input[type=file]").first()
      if ((await entrada.count()) === 0) return { estado: "saltada", detalhe: "sem anexo nesta sala" }
      await entrada.setInputFiles(ficheiroImagem)
      await bot.page.waitForTimeout(1200)
      const marca = marcar(bot, bot.enviadas.length)
      await bot.page.getByPlaceholder("Escreve uma mensagem").first().fill(`${marca} — com imagem`)
      await bot.page.keyboard.press("Enter")
      await bot.page.waitForTimeout(2500)
      bot.enviadas.push({ marca, canal: await canalAberto(bot.page), em: Date.now(), imagem: true })
      return { estado: "ok", detalhe: marca }
    },
  },
  {
    nome: "escrever-sem-enviar",
    peso: 3,
    /** The typing indicator: ephemeral by design, and that is what we verify. */
    async correr({ bot }) {
      const caixa = bot.page.getByPlaceholder("Escreve uma mensagem").first()
      if (!(await caixa.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem caixa" }
      await caixa.click()
      for (const letra of "estou a pensar no que dizer") {
        await bot.page.keyboard.type(letra)
        await bot.page.waitForTimeout(40)
      }
      // The signal only leaves 4 em 4 segundos; leaving before that does not exercise anything.
      await bot.page.waitForTimeout(4500)
      await caixa.fill("")
      return { estado: "ok" }
    },
  },
  {
    nome: "mudar-de-sala",
    peso: 8,
    async correr({ bot, aleatorio }) {
      const salas = bot.page.locator(".room-tree .room-row button.room")
      const quantas = await salas.count()
      if (quantas === 0) return { estado: "saltada", detalhe: "sem salas" }
      const alvo = salas.nth(Math.floor(aleatorio() * quantas))
      const nome = (await alvo.locator(".room-name").innerText().catch(() => "?")).trim()
      await alvo.click({ timeout: 10_000 })
      await bot.page.waitForTimeout(800)
      return { estado: "ok", detalhe: nome }
    },
  },
  {
    nome: "mudar-de-canal",
    peso: 6,
    async correr({ bot, aleatorio }) {
      const canais = bot.page.locator(".channel-list button.channel")
      const quantos = await canais.count()
      if (quantos <= 1) return { estado: "saltada", detalhe: "só há um canal" }
      const alvo = canais.nth(Math.floor(aleatorio() * quantos))
      const nome = (await alvo.locator(".channel-name").innerText().catch(() => "?")).trim()
      const inicio = Date.now()
      await alvo.click({ timeout: 10_000 })
      await bot.page.locator(".timeline, .timeline-empty").first().waitFor({ timeout: 20_000 }).catch(() => {})
      bot.tempos.push({ passo: "abrir-canal", ms: Date.now() - inicio })
      return { estado: "ok", detalhe: nome }
    },
  },
  {
    nome: "criar-canal",
    peso: 2,
    async correr({ bot, mundo }) {
      const mais = bot.page.getByRole("button", { name: "Criar canal" }).first()
      if (!(await mais.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem botão" }
      const nome = `c${bot.indice}-${mundo.contador++}`
      const inicio = Date.now()
      await mais.click()
      await bot.page.locator("form.prompt input").first().fill(nome)
      await bot.page.locator("form.prompt button.primary").first().click()
      await bot.page.getByRole("heading", { name: nome }).waitFor({ timeout: 30_000 })
      bot.tempos.push({ passo: "criar-canal", ms: Date.now() - inicio })
      bot.canais.add(nome)
      mundo.canais.push({ nome, fundador: bot.indice })
      return { estado: "ok", detalhe: nome }
    },
  },
  {
    nome: "criar-sala",
    peso: 3,
    async correr({ bot, aleatorio, mundo }) {
      const novo = bot.page.locator("button.room.room-new").first()
      if (!(await novo.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem permissão aqui" }
      const voz = aleatorio() < 0.4
      const nome = `${voz ? "v" : "s"}${bot.indice}-${mundo.contador++}`
      await novo.click()
      const folha = bot.page.locator("form.sheet").first()
      await folha.waitFor({ timeout: 10_000 })
      await folha.getByLabel("Nome").fill(nome)
      if (voz) await folha.getByRole("button", { name: "Voz", exact: true }).click()
      await folha.getByRole("button", { name: "Criar", exact: true }).click()
      await bot.page.locator(".room-name", { hasText: nome }).first().waitFor({ timeout: 30_000 })
      return { estado: "ok", detalhe: `${nome} (${voz ? "voz" : "texto"})` }
    },
  },
  {
    nome: "criar-categoria",
    peso: 1,
    async correr({ bot, mundo }) {
      const canal = await canalAberto(bot.page)
      if (!canal) return { estado: "saltada", detalhe: "sem canal aberto" }
      if (!(await clicarNoMenu(bot.page, canal, "Nova categoria"))) {
        return { estado: "saltada", detalhe: "sem permissão de organizar" }
      }
      const nome = `cat${mundo.contador++}`
      const folha = bot.page.locator("form.sheet").first()
      await folha.waitFor({ timeout: 10_000 })
      await folha.getByLabel("Nome").fill(nome)
      await folha.getByRole("button", { name: "Criar", exact: true }).click()
      await bot.page.waitForTimeout(1500)
      return { estado: "ok", detalhe: nome }
    },
  },
  {
    nome: "reordenar-salas",
    peso: 1,
    async correr({ bot, aleatorio }) {
      const linhas = bot.page.locator(".room-tree .room-row")
      const quantas = await linhas.count()
      if (quantas < 2) return { estado: "saltada", detalhe: "menos de duas salas" }
      const de = Math.floor(aleatorio() * quantas)
      let para = Math.floor(aleatorio() * quantas)
      if (para === de) para = (de + 1) % quantas
      await linhas.nth(de).dragTo(linhas.nth(para), { timeout: 15_000 })
      await bot.page.waitForTimeout(900)
      return { estado: "ok", detalhe: `${de} → ${para}` }
    },
  },
  {
    nome: "entrar-em-voz",
    peso: 5,
    async correr({ bot }) {
      if (await bot.page.locator("section.call").isVisible().catch(() => false)) {
        return { estado: "saltada", detalhe: "já está em chamada" }
      }
      const vozes = bot.page.locator(".room-tree .room-row").filter({ has: bot.page.locator(".room-glyph") })
      // The voice room is distinguished by name in this run (prefix v) and by the
      // "voice" room that the common channel brings from origin. There is no
      // attribute to mark it in the DOM, and inventing one would mean changing the
      // app code.
      const alvo = bot.page.locator(".room-tree button.room").filter({ hasText: /^v|voz/i }).first()
      if (!(await alvo.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem sala de voz" }
      void vozes
      const inicio = Date.now()
      await alvo.click()
      const painel = bot.page.locator("section.call")
      const entrou = await painel.waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)
      if (!entrou) return { estado: "falhou", detalhe: "clicou na sala de voz e não abriu chamada" }
      bot.tempos.push({ passo: "entrar-em-chamada", ms: Date.now() - inicio })
      return { estado: "ok" }
    },
  },
  {
    nome: "sair-da-voz",
    peso: 3,
    async correr({ bot }) {
      const sair = bot.page.getByRole("button", { name: "Sair da chamada" }).first()
      if (!(await sair.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "não está em chamada" }
      await sair.click()
      await bot.page.waitForTimeout(1000)
      return { estado: "ok" }
    },
  },
  {
    nome: "silenciar-microfone",
    peso: 2,
    async correr({ bot }) {
      const botao = bot.page
        .getByRole("button", { name: /Microfone ligado. Desligar microfone.|Silenciado. Ligar microfone./ })
        .first()
      if (!(await botao.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem controlo de microfone" }
      await botao.click()
      await bot.page.waitForTimeout(400)
      return { estado: "ok" }
    },
  },
  {
    nome: "convidar-por-endereco",
    peso: 3,
    async correr({ bot, mundo, aleatorio }) {
      const canal = await canalAberto(bot.page)
      // The header and footer of members open the same sheet.
      const porta = bot.page.getByRole("button", { name: "Convidar…" }).first()
      if (!(await porta.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem botão de convidar" }
      const outros = mundo.enderecos.filter((e) => e && e !== bot.endereco)
      if (outros.length === 0) return { estado: "saltada", detalhe: "não há mais ninguém" }
      const quem = escolher(aleatorio, outros)
      await porta.click()
      const campo = bot.page.getByPlaceholder("@abc…:servidor").first()
      if (!(await campo.isVisible({ timeout: 8000 }).catch(() => false))) {
        await fecharSobreposicoes(bot.page)
        return { estado: "falhou", detalhe: "o painel de convite não abriu" }
      }
      await campo.fill(quem)
      await bot.page.locator("form.convidar button.primary").first().click()
      await bot.page.waitForTimeout(1200)
      mundo.convitesEnviados.push({ de: bot.indice, para: quem, canal, em: Date.now() })
      return { estado: "ok", detalhe: `${canal} → ${quem.slice(0, 14)}…` }
    },
  },
  {
    nome: "criar-link-de-convite",
    peso: 2,
    async correr({ bot, mundo }) {
      // The single invite sheet, in "by link" mode.
      const botao = bot.page.getByRole("button", { name: "Convidar…" }).first()
      if (!(await botao.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem botão" }
      const canal = await canalAberto(bot.page)
      await botao.click()
      const folha = bot.page.locator(".sheet").first()
      await folha.waitFor({ timeout: 10_000 })
      await folha.getByRole("button", { name: "Por link" }).click()
      await folha.getByRole("button", { name: "Criar link" }).click()
      await bot.page.waitForTimeout(2000)
      const link = await folha.getByLabel("O teu link").inputValue().catch(() => "")
      await fecharSobreposicoes(bot.page)
      if (!link) return { estado: "falhou", detalhe: "criou o convite e não devolveu link" }
      mundo.links.push({ link, canal, de: bot.indice })
      return { estado: "ok", detalhe: canal }
    },
  },
  {
    nome: "entrar-por-link",
    peso: 2,
    async correr({ bot, mundo, aleatorio }) {
      const alheios = mundo.links.filter((l) => l.de !== bot.indice && !bot.canais.has(l.canal))
      if (alheios.length === 0) return { estado: "saltada", detalhe: "sem links por usar" }
      const escolhido = escolher(aleatorio, alheios)
      const porta = bot.page.locator("button.join-link").first()
      if (!(await porta.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem botão" }
      await porta.click()
      // By the dialog field and not by the example it shows: the example is text,
      // changes with link format and language, and it has already broken this.
      const campo = bot.page.locator("form.prompt input").first()
      await campo.waitFor({ timeout: 10_000 })
      await campo.fill(escolhido.link)
      await bot.page.locator("form.prompt button.primary").first().click()
      await bot.page.waitForTimeout(1500)
      bot.canais.add(escolhido.canal)
      return { estado: "ok", detalhe: escolhido.canal }
    },
  },
  {
    nome: "responder-a-convite",
    peso: 6,
    async correr({ bot, aleatorio }) {
      // The invite lands in the direct chat of whoever sent it: you need to open
      // the people you know to get there. It is the person's path, and it is where
      // they fail.
      const conversas = bot.page.locator(".direct-list button.direct-open")
      const quantas = await conversas.count()
      if (quantas === 0) return { estado: "saltada", detalhe: "sem conversas abertas" }
      for (let i = 0; i < quantas; i++) {
        await conversas.nth(i).click().catch(() => {})
        await bot.page.waitForTimeout(1200)
        const cartao = bot.page.locator(".pedido-card").first()
        if (!(await cartao.isVisible().catch(() => false))) continue
        const aceitar = aleatorio() < 0.75
        const botao = cartao.getByRole("button", { name: aceitar ? /Entrar|Aceitar/ : /Agora não|Recusar/ }).first()
        if (!(await botao.isVisible().catch(() => false))) continue
        const inicio = Date.now()
        await botao.click()
        await bot.page.waitForTimeout(2500)
        bot.tempos.push({ passo: aceitar ? "aceitar-pedido" : "recusar-pedido", ms: Date.now() - inicio })
        return { estado: "ok", detalhe: aceitar ? "aceitou" : "recusou" }
      }
      return { estado: "saltada", detalhe: "nada por responder" }
    },
  },
  {
    nome: "pedir-amizade",
    peso: 3,
    /**
     * By the "Find" tab in Friends, which is how a person does it without
     * account search: paste the address (or the friendship link), open the
     * profile sheet and request there, with "Request friendship".
     */
    async correr({ bot, mundo, aleatorio }) {
      const outros = mundo.enderecos.filter((e) => e && e !== bot.endereco)
      if (outros.length === 0) return { estado: "saltada", detalhe: "não há mais ninguém" }
      if (!(await abrirSeparador(bot, "adicionar"))) return { estado: "saltada", detalhe: "sem separadores" }
      // "Find": paste the address, open the profile, request there.
      const campo = bot.page.getByLabel("Cola um link ou endereço").first()
      if (!(await campo.isVisible().catch(() => false))) {
        await fecharSobreposicoes(bot.page)
        return { estado: "falhou", detalhe: "Encontrar não tem campo para colar" }
      }
      const quem = escolher(aleatorio, outros)
      await campo.fill(quem)
      await bot.page.getByRole("button", { name: "Abrir perfil" }).first().click()
      const pedir = bot.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" })
      if (await pedir.waitFor({ timeout: 8000 }).then(() => true, () => false)) await pedir.click()
      await bot.page.waitForTimeout(1500)
      await fecharSobreposicoes(bot.page)
      return { estado: "ok", detalhe: quem.slice(0, 16) }
    },
  },
  {
    nome: "responder-a-amizade",
    peso: 4,
    async correr({ bot, aleatorio }) {
      // Requests only draw in the tab that belongs to them.
      if (!(await abrirSeparador(bot, "pendentes"))) return { estado: "saltada", detalhe: "sem separadores" }
      const pedidos = bot.page.locator(".people-requests li.person-row")
      if ((await pedidos.count()) === 0) return { estado: "saltada", detalhe: "nada pendente" }
      const aceitar = aleatorio() < 0.8
      const botao = pedidos.first().getByRole("button", { name: aceitar ? "Aceitar" : "Recusar" }).first()
      if (!(await botao.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem botão" }
      const inicio = Date.now()
      await botao.click()
      await bot.page.waitForTimeout(2000)
      bot.tempos.push({ passo: aceitar ? "aceitar-amizade" : "recusar-amizade", ms: Date.now() - inicio })
      return { estado: "ok", detalhe: aceitar ? "aceitou" : "recusou" }
    },
  },
  {
    nome: "desfazer-amizade",
    /**
     * Low weight, and on purpose.
     *
     * The cycle the owner asked for is request, undo, request again -- and it
     * exists because undo is not the opposite of request: undo removes the spot
     * the person had in our feed, and requesting again has to restore it. If
     * something stays uncleaned in between, you see it the second time.
     *
     * With high weight, bots undid faster than they requested and the run
     * passed itself undoing friendships that never existed. Three against the
     * three of `request-friendship` keeps both things happening, and the cycle
     * closes itself because `request-friendship` draws the same people again.
     */
    peso: 3,
    async correr({ bot, aleatorio }) {
      if (!(await abrirSeparador(bot, "todos"))) return { estado: "saltada", detalhe: "sem separadores" }
      const pessoas = bot.page.locator(".people-scroll li.person-row")
      const quantas = await pessoas.count()
      if (quantas === 0) return { estado: "saltada", detalhe: "sem ninguém na lista" }

      // Right click, which is how you reach the person's menu.
      const alvo = pessoas.nth(Math.floor(aleatorio() * quantas))
      const nome = (await alvo.innerText().catch(() => "")).split("\n")[0] ?? ""
      await alvo.click({ button: "right" }).catch(() => {})
      await bot.page.waitForTimeout(400)

      const desfazer = bot.page.getByRole("menuitem", { name: "Desfazer amizade" }).first()
      if (!(await desfazer.isVisible().catch(() => false))) {
        // Not a bug: the entry only exists for who is already a friend, and the list
        // also has who shares channels without being one.
        await fecharSobreposicoes(bot.page)
        return { estado: "saltada", detalhe: "não é amigo" }
      }

      const inicio = Date.now()
      await desfazer.click()
      await bot.page.waitForTimeout(600)

      // The confirmation exists because this removes access: accept it, which is
      // what we want to exercise. If one day there is no dialog, this does not break.
      const confirmar = bot.page.locator(".modal button.primary, form.prompt button.primary").first()
      if (await confirmar.isVisible().catch(() => false)) await confirmar.click().catch(() => {})
      await bot.page.waitForTimeout(1500)
      await fecharSobreposicoes(bot.page)
      bot.tempos.push({ passo: "desfazer-amizade", ms: Date.now() - inicio })
      return { estado: "ok", detalhe: nome.slice(0, 16) }
    },
  },
  {
    nome: "mensagem-directa",
    peso: 4,
    async correr({ bot, aleatorio }) {
      // A chat open in the drawer, or a friend from the list: both doors exist, and
      // a person uses the one in front of them.
      const conversas = bot.page.locator(".direct-list button.direct-open")
      const pessoas = bot.page.locator(".people-list li.person-row .person-name")
      const quantasConversas = await conversas.count()
      const quantas = await pessoas.count()
      if (quantasConversas > 0) {
        await conversas.nth(Math.floor(aleatorio() * quantasConversas)).click()
      } else if (quantas > 0) {
        await pessoas.nth(Math.floor(aleatorio() * quantas)).click()
      } else {
        return { estado: "saltada", detalhe: "ainda não conhece ninguém" }
      }
      await bot.page.waitForTimeout(1500)
      const caixa = bot.page.getByPlaceholder("Escreve uma mensagem").first()
      if (!(await caixa.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "conversa não abriu" }
      const marca = marcar(bot, bot.enviadas.length)
      await caixa.fill(`${marca} — em privado`)
      await bot.page.keyboard.press("Enter")
      await bot.page.waitForTimeout(1200)
      bot.enviadas.push({ marca, canal: "(directa)", em: Date.now() })
      return { estado: "ok", detalhe: marca }
    },
  },
  {
    nome: "dar-cotovelada",
    peso: 2,
    async correr({ bot }) {
      const botao = bot.page.locator("button.composer-buzz").first()
      if (!(await botao.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "só existe em conversas directas" }
      if (await botao.isDisabled().catch(() => false)) return { estado: "saltada", detalhe: "ainda em espera" }
      await botao.click()
      await bot.page.waitForTimeout(600)
      return { estado: "ok" }
    },
  },
  {
    nome: "publicar-no-feed",
    peso: 3,
    async correr({ bot, mundo }) {
      await bot.page.getByRole("button", { name: "Feed", exact: true }).click().catch(() => {})
      await bot.page.waitForTimeout(900)
      const corpo = bot.page.getByPlaceholder("Escreve uma publicação. Só os teus amigos a vêem.").first()
      if (!(await corpo.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem compositor" }
      const marca = marcar(bot, bot.enviadas.length)
      await bot.page.getByPlaceholder("Título (opcional)").first().fill(`bot ${bot.indice}`).catch(() => {})
      await corpo.fill(`${marca} — publicação do bot ${bot.indice} #enxame`)
      await bot.page.getByRole("button", { name: "Publicar", exact: true }).first().click()
      await bot.page.waitForTimeout(2000)
      mundo.marcas.set(marca, { bot: bot.indice, canal: "(feed)" })
      return { estado: "ok", detalhe: marca }
    },
  },
  {
    nome: "comentar-no-feed",
    peso: 3,
    async correr({ bot }) {
      await bot.page.getByRole("button", { name: "Feed", exact: true }).click().catch(() => {})
      await bot.page.waitForTimeout(900)
      const abrir = bot.page.locator("button.vote.wide").first()
      if (!(await abrir.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem publicações" }
      await abrir.click()
      const campo = bot.page.getByPlaceholder("Escrever um comentário…").first()
      if (!(await campo.isVisible({ timeout: 5000 }).catch(() => false))) return { estado: "saltada", detalhe: "sem caixa" }
      await campo.fill(`comentário do bot ${bot.indice}`)
      await bot.page.getByRole("button", { name: "Comentar" }).first().click()
      await bot.page.waitForTimeout(1500)
      return { estado: "ok" }
    },
  },
  {
    nome: "reagir-no-feed",
    peso: 3,
    async correr({ bot, aleatorio }) {
      await bot.page.getByRole("button", { name: "Feed", exact: true }).click().catch(() => {})
      await bot.page.waitForTimeout(900)
      const votos = bot.page.locator("button.vote:not(.wide)")
      const quantos = await votos.count()
      if (quantos === 0) return { estado: "saltada", detalhe: "sem publicações" }
      await votos.nth(Math.floor(aleatorio() * quantos)).click()
      await bot.page.waitForTimeout(700)
      return { estado: "ok" }
    },
  },
  {
    nome: "apagar-publicacao",
    peso: 1,
    async correr({ bot }) {
      await bot.page.getByRole("button", { name: "Feed", exact: true }).click().catch(() => {})
      await bot.page.waitForTimeout(900)
      const mais = bot.page.getByRole("button", { name: "Opções da publicação" }).first()
      if (!(await mais.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem publicações próprias" }
      await mais.click()
      const apagar = bot.page.locator(".context-menu").getByRole("menuitem", { name: "Apagar" }).first()
      if (!(await apagar.isVisible({ timeout: 3000 }).catch(() => false))) {
        await fecharMenu(bot.page)
        return { estado: "saltada", detalhe: "sem item apagar" }
      }
      await comDialogo(bot.page, true, async () => {
        await apagar.click()
        await bot.page.waitForTimeout(1500)
      })
      return { estado: "ok" }
    },
  },
  {
    nome: "criar-papel",
    peso: 2,
    async correr({ bot, mundo, aleatorio }) {
      const canal = await canalAberto(bot.page)
      if (!canal) return { estado: "saltada", detalhe: "sem canal aberto" }
      if (!(await clicarNoMenu(bot.page, canal, "Gerir papéis"))) {
        return { estado: "saltada", detalhe: "sem permissão de gerir papéis" }
      }
      const editor = bot.page.locator("section.role-editor").first()
      if (!(await editor.isVisible({ timeout: 10_000 }).catch(() => false))) {
        await fecharSobreposicoes(bot.page)
        return { estado: "falhou", detalhe: "o editor de papéis não abriu" }
      }
      await editor.getByRole("button", { name: "Novo cargo" }).click()
      const nome = `papel${mundo.contador++}`
      await editor.locator("input[placeholder='Moderador']").fill(nome)
      // Drawing roles is the point: one role with "expel" and another without it
      // make different authority checks.
      for (const poder of ["expulsar", "convidar", "mudar o nome"]) {
        if (aleatorio() < 0.5) await editor.getByLabel(poder).check().catch(() => {})
      }
      await editor.getByRole("button", { name: "Criar cargo" }).click()
      await bot.page.waitForTimeout(1500)
      await fecharSobreposicoes(bot.page)
      mundo.papeis.push({ nome, canal, de: bot.indice })
      return { estado: "ok", detalhe: `${nome} em ${canal}` }
    },
  },
  {
    nome: "atribuir-papel",
    peso: 2,
    async correr({ bot, aleatorio }) {
      const membros = bot.page.locator(".member-list button.member-row")
      const quantos = await membros.count()
      if (quantos === 0) return { estado: "saltada", detalhe: "sem painel de membros" }
      await membros.nth(Math.floor(aleatorio() * quantos)).click()
      await bot.page.waitForTimeout(1200)
      const seccao = bot.page.locator("section.member-roles").first()
      if (!(await seccao.isVisible().catch(() => false))) {
        await fecharSobreposicoes(bot.page)
        return { estado: "saltada", detalhe: "sem papéis atribuíveis" }
      }
      const caixas = seccao.locator("input[type=checkbox]")
      const quantas = await caixas.count()
      if (quantas === 0) {
        await fecharSobreposicoes(bot.page)
        return { estado: "saltada", detalhe: "canal sem papéis declarados" }
      }
      await caixas.nth(Math.floor(aleatorio() * quantas)).click()
      await bot.page.waitForTimeout(1500)
      await fecharSobreposicoes(bot.page)
      return { estado: "ok" }
    },
  },
  {
    nome: "recarregar-a-pagina",
    peso: 4,
    /**
     * In the middle of everything, not at the end.
     *
     * It is the gesture a person does without thinking and what the app least
     * expects: reread the vault from the start, redo subscriptions, and leave
     * whoever was in a call with them hanging without `voice.leave`. Half the
     * bugs this week live in this transition.
     */
    async correr({ bot }) {
      const antes = await mensagensVisiveis(bot.page).catch(() => [])
      const canal = await canalAberto(bot.page)
      await recarregar(bot)
      await bot.page.waitForTimeout(2500)
      return { estado: "ok", detalhe: `${canal ?? "?"}: ${antes.length} mensagens antes` }
    },
  },
  {
    nome: "perder-a-ligacao",
    peso: 3,
    /** Close the laptop, get on the subway. The app has to survive. */
    async correr({ bot, aleatorio }) {
      const segundos = 3 + Math.floor(aleatorio() * 8)
      await bot.ctx.setOffline(true)
      await bot.page.waitForTimeout(segundos * 1000)
      const inicio = Date.now()
      await bot.ctx.setOffline(false)
      // The status bar is the only thing that says the app came back to itself.
      const voltou = await bot.page
        .locator("footer.statusbar", { hasText: "ligado" })
        .first()
        .waitFor({ timeout: 60_000 })
        .then(() => true)
        .catch(() => false)
      if (!voltou) return { estado: "falhou", detalhe: `ficou sem se religar depois de ${segundos}s offline` }
      bot.tempos.push({ passo: "religar-se", ms: Date.now() - inicio })
      return { estado: "ok", detalhe: `${segundos}s offline` }
    },
  },
  {
    nome: "mudar-o-estado",
    peso: 1,
    async correr({ bot, aleatorio }) {
      // Since the account section (0.9) the custom status line only opens through
      // "Custom..." on the status menu, which the identity opens.
      const identidade = bot.page.locator(".me-identity").first()
      if (!(await identidade.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem faixa da conta" }
      await identidade.click()
      const personalizado = bot.page.getByRole("menuitem", { name: /Personalizado|Custom/ }).first()
      if (!(await personalizado.isVisible({ timeout: 5000 }).catch(() => false))) return { estado: "saltada", detalhe: "sem menu de estado" }
      await personalizado.click()
      const campo = bot.page.locator("input.status-input").first()
      if (!(await campo.isVisible({ timeout: 5000 }).catch(() => false))) return { estado: "saltada", detalhe: "não abriu" }
      await campo.fill(escolher(aleatorio, ["a testar", "ocupado", "a pensar", "no metro"]))
      await bot.page.keyboard.press("Enter")
      await bot.page.waitForTimeout(600)
      return { estado: "ok" }
    },
  },
  {
    nome: "voltar-as-conversas",
    peso: 6,
    /** Without this, a bot that went to the feed stayed there for the rest of the run. */
    async correr({ bot }) {
      const botao = bot.page.getByRole("button", { name: "Comunidades", exact: true }).first()
      if (!(await botao.isVisible().catch(() => false))) return { estado: "saltada", detalhe: "sem carril" }
      await botao.click()
      await bot.page.waitForTimeout(700)
      return { estado: "ok" }
    },
  },
]

/**
 * Which screen each action lives on.
 *
 * It goes in a table, not spread across thirty actions, because it is a
 * property of the screen, not the action: if the app moves the feed, we
 * change one line here. The ones not in the table run wherever the bot is --
 * reload, lose connection, change state.
 */
export const ECRA_DE = {
  "escrever-mensagem": "Comunidades",
  "mencionar-alguem": "Comunidades",
  "anexar-imagem": "Comunidades",
  "escrever-sem-enviar": "Comunidades",
  "mudar-de-sala": "Comunidades",
  "mudar-de-canal": "Comunidades",
  "criar-canal": "Comunidades",
  "criar-sala": "Comunidades",
  "criar-categoria": "Comunidades",
  "reordenar-salas": "Comunidades",
  "entrar-em-voz": "Comunidades",
  "sair-da-voz": "Comunidades",
  "convidar-por-endereco": "Comunidades",
  "criar-link-de-convite": "Comunidades",
  "entrar-por-link": "Comunidades",
  "criar-papel": "Comunidades",
  "atribuir-papel": "Comunidades",
  // By the "Find" tab in Friends (key `add` in `TAB`). The map already pointed
  // to Channels, and it was fourteen straight attempts saying "no tabs", which is
  // what `.people-tabs` answers on another screen.
  "pedir-amizade": "Amigos",
  "responder-a-amizade": "Amigos",
  "desfazer-amizade": "Amigos",
  "responder-a-convite": "Amigos",
  "mensagem-directa": "Amigos",
  "dar-cotovelada": "Amigos",
  "publicar-no-feed": "Feed",
  "comentar-no-feed": "Feed",
  "reagir-no-feed": "Feed",
  "apagar-publicacao": "Feed",
}

/** An action drawn by weight: common ones come out more, rare ones come out sometimes. */
export function sortearAccao(aleatorio) {
  const total = CATALOGO.reduce((soma, accao) => soma + accao.peso, 0)
  let ponto = aleatorio() * total
  for (const accao of CATALOGO) {
    ponto -= accao.peso
    if (ponto <= 0) return accao
  }
  return CATALOGO[0]
}

export { fotografar }
