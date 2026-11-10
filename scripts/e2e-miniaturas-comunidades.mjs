/**
 * YouTube thumbnail in community rooms, live.
 *
 *   node scripts/e2e-miniaturas-comunidades.mjs      (requires `npm run build` first)
 *
 * Report from the owner on 3 November 2026: "YouTube thumbnails appear in
 * direct messages, but not in community rooms".
 *
 * Root cause: rooms are tags within a single MLS channel, and the vault stored
 * media bytes only in the 40 most recent entries of the entire channel. One
 * room's conversation would evict the thumbnail from another, and it never
 * comes back. See `foraDaJanelaDeMedia` in `packages/client-core/src/vault.ts`.
 *
 * Ana and Bruno on Chromium, Carla on the desktop app (`apps/client/out`).
 *
 *  1. Bruno publishes the video in room "conversa": Ana sees the thumbnail in
 *     bytes, the click opens a new tab without `window.opener`, and it fits at
 *     390 px.
 *  1b. Ana writes 41 messages in room "anúncios" and reloads: the thumbnail
 *     from room "conversa" is still there. THIS WAS THE BUG.
 *  2. The channel's default room.
 *  3. Carla (desktop) reads the room: thumbnail, and the click goes to
 *     `shell.openExternal` without a new window.
 *  4. Carla publishes from the desktop, Ana reads.
 *  5. The server's shared channel.
 *  6. Ana offline while Bruno publishes; when she comes back, the thumbnail
 *     arrives.
 *  7. Ana's page reloaded: all thumbnails persist.
 *
 * Disposable homeserver on ports 8498 and 8499, never production. The title
 * and thumbnail come from the homeserver, which needs Internet for oEmbed.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, espera, portaoPronto, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
const VIDEO_ID = "aqz-KE-bpKQ"
const VIDEO = `https://www.youtube.com/watch?v=${VIDEO_ID}`
const CAPTURAS = join(RAIZ, "capturas")
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(join(RAIZ, ".verify-data"), { recursive: true })

const { check, resumo } = verificador()
const ESCRITA = 'input[placeholder="Escreve uma mensagem"]'

async function abrirSala(page, nome) {
  const sala = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: nome }) })
    .first()
  await sala.waitFor({ timeout: 60_000 })
  await sala.click()
  await page.locator(ESCRITA).waitFor({ timeout: 30_000 })
  await espera(800)
}

/** Writes the video, waits for the title from the homeserver, and sends. */
async function publicarVideo(page, frase) {
  const escrita = page.locator(ESCRITA)
  await escrita.click()
  await escrita.fill(`${frase} ${VIDEO}`)
  const miniatura = await page
    .locator(".link-attach .facade-thumb")
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true, () => false)
  await escrita.press("Enter")
  return miniatura
}

/** The message facade with this phrase, and the `src` of its thumbnail. */
async function fachadaDe(page, frase, ms = 60_000) {
  const mensagem = page.locator(".message", { hasText: frase }).last()
  const fachada = mensagem.locator(".video-facade").first()
  const chegou = await mensagem.waitFor({ timeout: ms }).then(() => true, () => false)
  if (!chegou) return { chegou, fachada, src: null }
  await ate(async () => (await fachada.locator(".facade-thumb").count()) > 0, 10_000)
  const src = await fachada.locator(".facade-thumb").getAttribute("src", { timeout: 2000 }).catch(() => null)
  return { chegou, fachada, src }
}

const srv = await levantarServidor({ frente: 8498, servidor: 8499, etiqueta: "miniaturas-comunidades" })
console.log(`servidor ${srv.NOME}`)
let browser
let sec
async function arrumar(codigo) {
  await sec?.fechar().catch(() => {})
  await browser?.close().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

try {
  browser = await chromium.launch({ headless: true })
  const contexto = (pagina) => browser.newContext({ locale: "pt-PT", viewport: { width: 1280, height: 860 } }).then(async (ctx) => {
    await ctx.route(/^https:\/\/(www\.)?youtube\.com\//, (rota) =>
      rota.fulfill({ status: 200, contentType: "text/html", body: "<title>YouTube (guião)</title>" }),
    )
    return { ctx, page: await ctx.newPage(), pagina }
  })
  const { ctx: ctxA, page: ana } = await contexto("ana")
  const { page: bruno } = await contexto("bruno")
  const erros = []
  for (const p of [ana, bruno]) p.on("pageerror", (e) => erros.push(String(e)))

  await ana.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana)
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno)
  const [, enderecoBruno] = contasDoServidor(srv.base)

  await criarCanal(ana, "adega")
  check("a Ana convida o Bruno para a comunidade adega", await convidar(ana, "adega", enderecoBruno))
  check("o Bruno aceita", await aceitarConvite(bruno, "adega", { espera: 60_000 }))
  await abrirCanal(ana, "adega")
  await abrirCanal(bruno, "adega")
  await espera(1500)

  // -------------------------------------------- 1. room "conversa"
  await abrirSala(ana, "conversa")
  await abrirSala(bruno, "conversa")
  check("na caixa do Bruno, a miniatura chega (sala conversa)", await publicarVideo(bruno, "na-sala-conversa"))
  const naSala = await fachadaDe(ana, "na-sala-conversa")
  check("a mensagem chega à Ana na sala conversa", naSala.chegou)
  check("sala conversa: a Ana vê a miniatura em bytes", String(naSala.src).startsWith("data:image/"), String(naSala.src).slice(0, 30))
  const doBruno = await fachadaDe(bruno, "na-sala-conversa")
  check("sala conversa: o Bruno vê a própria miniatura", String(doBruno.src).startsWith("data:image/"), String(doBruno.src).slice(0, 30))
  await naSala.fachada.scrollIntoViewIfNeeded().catch(() => {})
  await ana.screenshot({ path: join(CAPTURAS, "miniaturas-comunidades-sala-1280.png") })

  if (naSala.chegou && (await naSala.fachada.count())) {
    const [separador] = await Promise.all([ctxA.waitForEvent("page", { timeout: 10_000 }), naSala.fachada.click()])
    await separador.waitForLoadState("domcontentloaded").catch(() => {})
    check("sala conversa: o clique abre um separador novo com o vídeo", separador.url() === VIDEO, separador.url())
    check("sala conversa: sem `window.opener`", (await separador.evaluate(() => window.opener === null).catch(() => false)) === true)
    await separador.close()
  } else check("sala conversa: há fachada para clicar", false)

  // At 390 px, in the same room.
  await ana.setViewportSize({ width: 390, height: 844 })
  await espera(1200)
  const medida = await ana.evaluate(() => {
    const todas = document.querySelectorAll(".message-body .video-facade")
    const cartao = todas[todas.length - 1]
    return { documento: document.documentElement.scrollWidth, cartao: cartao ? Math.ceil(cartao.getBoundingClientRect().right) : 0 }
  })
  check("a 390 px a miniatura cabe e nada anda de lado", medida.documento <= 390 && medida.cartao > 0 && medida.cartao <= 390, JSON.stringify(medida))
  await ana.locator(".message-body .video-facade").last().scrollIntoViewIfNeeded().catch(() => {})
  await ana.screenshot({ path: join(CAPTURAS, "miniaturas-comunidades-sala-390.png") })
  await ana.setViewportSize({ width: 1280, height: 860 })
  await espera(800)

  // -------------------------------------------- 1b. conversa in another room of the same community
  // Rooms are tags within a single MLS channel. The vault stores media bytes
  // from the last `HISTORY_MEDIA_RECENT` (40) entries of the channel's
  // conversation. In a direct message, those 40 are from that conversation; in a
  // community, they are from all rooms. Forty-one messages in room "anúncios"
  // must not evict the thumbnail from room "conversa".
  await abrirSala(ana, "anúncios")
  const escritaAna = ana.locator(ESCRITA)
  for (let i = 0; i < 41; i++) {
    await escritaAna.fill(`aviso-${i}`)
    await escritaAna.press("Enter")
    await ana.locator(".message", { hasText: `aviso-${i}` }).first().waitFor({ timeout: 30_000 })
  }
  check("a Ana escreve 41 mensagens na sala anúncios", true)
  await espera(4000) // the browser vault writes in batch
  await ana.reload({ waitUntil: "domcontentloaded" })
  {
    const frase = ana.getByPlaceholder("Palavra-passe")
    await frase.waitFor({ timeout: 30_000 }).catch(() => {})
    if (await frase.count()) {
      await frase.fill(FRASE)
      await ana.getByRole("button", { name: "Entrar", exact: true }).click()
    }
  }
  await dentro(ana)
  await ana.locator(".channel-name").filter({ hasNotText: /orwell/i }).first().click({ timeout: 60_000 })
  await abrirSala(ana, "conversa")
  const depoisDosAvisos = await fachadaDe(ana, "na-sala-conversa", 30_000)
  check("recarregada, depois de 41 mensagens noutra sala: a miniatura continua", String(depoisDosAvisos.src).startsWith("data:image/"), depoisDosAvisos.chegou ? String(depoisDosAvisos.src).slice(0, 30) : "a mensagem não está")
  await depoisDosAvisos.fachada.scrollIntoViewIfNeeded().catch(() => {})
  await ana.screenshot({ path: join(CAPTURAS, "miniaturas-comunidades-depois-dos-avisos.png") })

  // -------------------------------------------- 2. the channel's default room
  await abrirCanal(ana, "adega")
  await abrirCanal(bruno, "adega")
  const salaPorOmissao = async (page) => {
    // The first text room line is the default one.
    await page.locator(".room-row button.room").first().click().catch(() => {})
    await page.locator(ESCRITA).waitFor({ timeout: 30_000 })
    await espera(800)
  }
  await salaPorOmissao(ana)
  await salaPorOmissao(bruno)
  check("na caixa do Bruno, a miniatura chega (sala por omissão)", await publicarVideo(bruno, "na-sala-por-omissao"))
  const naOmissao = await fachadaDe(ana, "na-sala-por-omissao")
  check("sala por omissão: a Ana vê a miniatura em bytes", String(naOmissao.src).startsWith("data:image/"), String(naOmissao.src).slice(0, 30))

  // -------------------------------------------- 3. the desktop app, reading the room
  sec = await abrirSecretaria({ rotulo: "miniaturas-secretaria" })
  const carla = sec.page
  await portaoPronto(carla)
  await criarConta(carla, { nome: "Carla", frase: FRASE, servidor: srv.NOME })
  await dentro(carla)
  const enderecoCarla = contasDoServidor(srv.base).at(-1)
  check("a Ana convida a Carla (secretária)", await convidar(ana, "adega", enderecoCarla))
  check("a Carla aceita", await aceitarConvite(carla, "adega", { espera: 60_000 }))
  await abrirCanal(carla, "adega")
  await abrirSala(carla, "conversa")
  await abrirSala(bruno, "conversa")
  check("o Bruno volta a publicar na sala conversa", await publicarVideo(bruno, "para-a-secretaria"))
  const naCarla = await fachadaDe(carla, "para-a-secretaria")
  check("secretária: a mensagem chega à sala conversa", naCarla.chegou)
  check("secretária: a Carla vê a miniatura em bytes", String(naCarla.src).startsWith("data:image/"), String(naCarla.src).slice(0, 30))
  if (naCarla.chegou && (await naCarla.fachada.count())) {
    await sec.app.evaluate(({ shell }) => {
      globalThis.__abertos = []
      shell.openExternal = async (url) => {
        globalThis.__abertos.push(url)
      }
    })
    const janelasAntes = sec.app.windows().length
    await naCarla.fachada.scrollIntoViewIfNeeded().catch(() => {})
    await carla.screenshot({ path: join(CAPTURAS, "miniaturas-comunidades-secretaria.png") })
    await naCarla.fachada.click()
    await espera(1500)
    const abertos = await sec.app.evaluate(() => globalThis.__abertos)
    check("secretária: o clique abre o vídeo no browser do sistema", abertos.length === 1 && abertos[0] === VIDEO, JSON.stringify(abertos))
    check("secretária: e não nasce janela nenhuma", sec.app.windows().length === janelasAntes)
  } else check("secretária: há fachada para clicar", false)

  // -------------------------------------------- 4. the desktop publishing in the room
  await abrirSala(ana, "conversa")
  check("a Carla (secretária) publica na sala conversa", await publicarVideo(carla, "da-secretaria"))
  const daCarla = await fachadaDe(ana, "da-secretaria")
  check("vindo da secretária: a Ana vê a miniatura em bytes", String(daCarla.src).startsWith("data:image/"), String(daCarla.src).slice(0, 30))

  // -------------------------------------------- 5. the server's shared channel
  const abrirComum = async (page) => {
    await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
    await page.locator(".channel-name", { hasText: /orwell/i }).first().click({ timeout: 60_000 })
    await page.locator(ESCRITA).waitFor({ timeout: 30_000 })
    await espera(800)
  }
  const temComum = await abrirComum(ana).then(() => true, () => false)
  check("a Ana tem o canal comum", temComum)
  if (temComum && (await abrirComum(bruno).then(() => true, () => false))) {
    check("na caixa do Bruno, a miniatura chega (canal comum)", await publicarVideo(bruno, "no-canal-comum"))
    const noComum = await fachadaDe(ana, "no-canal-comum")
    check("canal comum: a Ana vê a miniatura em bytes", String(noComum.src).startsWith("data:image/"), String(noComum.src).slice(0, 30))
  } else check("o Bruno tem o canal comum", false)

  // -------------------------------------------- 6. the one who was offline
  await abrirCanal(ana, "adega")
  await abrirSala(ana, "conversa")
  await abrirCanal(bruno, "adega")
  await abrirSala(bruno, "conversa")
  await ctxA.setOffline(true)
  await espera(3000)
  check("com a Ana sem ligação, o Bruno publica na sala", await publicarVideo(bruno, "com-a-ana-fora"))
  await espera(5000)
  await ctxA.setOffline(false)
  const depoisDeVoltar = await fachadaDe(ana, "com-a-ana-fora", 120_000)
  check("ao voltar, a mensagem chega à Ana", depoisDeVoltar.chegou)
  check("ao voltar, a Ana vê a miniatura em bytes", String(depoisDeVoltar.src).startsWith("data:image/"), String(depoisDeVoltar.src).slice(0, 30))

  // -------------------------------------------- 7. the page reloaded
  await espera(4000) // the browser vault writes in batch
  await ana.reload({ waitUntil: "domcontentloaded" })
  const frase = ana.getByPlaceholder("Palavra-passe")
  await frase.waitFor({ timeout: 30_000 }).catch(() => {})
  if (await frase.count()) {
    await frase.fill(FRASE)
    await ana.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  await dentro(ana)
  await ana.locator(".channel-name").filter({ hasNotText: /orwell/i }).first().click({ timeout: 60_000 })
  await abrirSala(ana, "conversa")
  for (const marca of ["na-sala-conversa", "para-a-secretaria", "da-secretaria", "com-a-ana-fora"]) {
    const lida = await fachadaDe(ana, marca, 30_000)
    check(`recarregada: "${marca}" com miniatura`, String(lida.src).startsWith("data:image/"), lida.chegou ? String(lida.src).slice(0, 30) : "a mensagem não está")
  }

  check("sem erros nas páginas", erros.length === 0, erros.slice(0, 2).join(" | "))
  const ok = resumo()
  await arrumar(ok ? 0 : 1)
} catch (erro) {
  console.error(erro)
  for (const page of browser?.contexts().flatMap((c) => c.pages()) ?? []) {
    await page.screenshot({ path: join(RAIZ, ".verify-data", `miniaturas-comunidades-falha-${Date.now()}.png`) }).catch(() => {})
  }
  await arrumar(1)
}
