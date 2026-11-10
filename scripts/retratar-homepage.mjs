/**
 * Screenshots of the homepage, taken from the real app.
 *
 * The owner requested, on 12 August 2026: crops that demonstrate features,
 * without lengthy explanation. A full-screen screenshot reduced to 600px shows
 * nothing: what you see is a gray window. So each crop shows ONE thing only,
 * captured by the element, not the screen.
 *
 * Sets up its own homeserver and app on ephemeral ports that are born and die with
 * the run. There is no `--url`, for the same reason as the swarm: on 6 August a run
 * against production deleted the founding record that the owner had just published.
 *
 * Usage:
 *   npx tsc -b && npm run build -w @enclave/web
 *   node scripts/retratar-homepage.mjs
 *
 * Outputs to `apps/site/public/capturas/`, which is what Vite copies to `dist`.
 */
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readdir, rm, unlink } from "node:fs/promises"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { arrancarHomeserver, portaLivre, servirAplicacao } from "./enxame/cenario.mjs"
import { abrirBot, fecharBot, lerEndereco } from "./enxame/bot.mjs"

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const DESTINO = join(RAIZ, "apps/site/public/capturas")
const FRASE = "retratos-orwell-2026"

/**
 * Retina, not one pixel per pixel.
 *
 * The page serves these images at around 600px width; at 2× they look sharp on
 * the screens where everyone will see them, and AVIF handles the file size next.
 */
const ESCALA = 2

const correr = promisify(execFile)

const dizer = (texto) => console.log(`[${new Date().toLocaleTimeString("pt-PT")}] ${texto}`)

let cenario = null
const bots = []

async function desmontar() {
  for (const bot of bots) await fecharBot(bot)
  await cenario?.web.parar().catch(() => {})
  await cenario?.homeserver.parar().catch(() => {})
  if (cenario?.dirPerfis) await rm(cenario.dirPerfis, { recursive: true, force: true }).catch(() => {})
}

/**
 * Crop by ELEMENT. A full screen shrunk down demonstrates nothing.
 *
 * `alturaMaxima` exists because the chat and feed occupy the full column and most
 * of it is empty in a freshly set up scenario: without cropping, what gets published
 * is a rectangle with four lines at the top and six hundred pixels of nothing below.
 */
async function retratar(page, selector, nome, { padding = 0, alturaMaxima = 0 } = {}) {
  // The mouse moves out before taking the shot: staying on a rail button leaves
  // a tooltip open in the middle of the screenshot. It took a run to figure that out.
  await page.mouse.move(1439, 899)
  await page.waitForTimeout(400)

  const alvo = page.locator(selector).first()
  if (!(await alvo.isVisible().catch(() => false))) {
    console.error(`  FALTA  ${nome} — não encontrei ${selector}`)
    return false
  }
  const caixa = await alvo.boundingBox()
  if (!caixa) return false
  if (alturaMaxima > 0) caixa.height = Math.min(caixa.height, alturaMaxima)
  await page.screenshot({
    path: join(DESTINO, `${nome}.png`),
    clip: {
      x: Math.max(0, caixa.x - padding),
      y: Math.max(0, caixa.y - padding),
      width: caixa.width + padding * 2,
      height: caixa.height + padding * 2,
    },
  })
  dizer(`  ${nome}.png`)
  return true
}

try {
  await mkdir(DESTINO, { recursive: true })
  const dirPerfis = await mkdtemp(join(tmpdir(), "orwell-retratos-"))
  const dirDados = await mkdtemp(join(tmpdir(), "orwell-retratos-dados-"))

  const homeserver = await arrancarHomeserver({ raiz: RAIZ, dirDados, porta: await portaLivre() })
  const web = await servirAplicacao({ raiz: RAIZ, porta: await portaLivre() })
  cenario = { homeserver, web, dirPerfis }
  dizer(`homeserver ${homeserver.nome} · aplicação ${web.url}`)

  // Three accounts: one that creates and drives, two so there are people in the voice room
  // and names in the chat. With one alone, all that gets captured is an empty place.
  const nomes = ["Rita", "Bruno", "Zé"]
  for (const [indice, nome] of nomes.entries()) {
    bots.push(
      await abrirBot({
        indice,
        nome,
        urlWeb: web.url,
        servidor: homeserver.nome,
        frase: FRASE,
        dirPerfis,
        dirProvas: DESTINO,
        escala: ESCALA,
      }),
    )
    dizer(`conta ${nome} pronta`)
  }

  const [rita, bruno, ze] = bots
  // A wide window: the crops come from here, and in a narrow window the rooms
  // column disappears, which is exactly one of the things to show.
  for (const bot of bots) await bot.page.setViewportSize({ width: 1440, height: 900 })

  for (const bot of bots) await lerEndereco(bot.page).catch(() => "")

  // Everyone in the common room, which already exists and where everyone joins.
  for (const bot of bots) {
    await bot.page.getByRole("button", { name: "Comunidades" }).first().click().catch(() => {})
    await bot.page.waitForTimeout(1200)
  }

  dizer("a escrever a conversa...")
  const dizerNa = async (bot, texto) => {
    const caixa = bot.page.getByPlaceholder("Escreve uma mensagem").first()
    if (!(await caixa.isVisible().catch(() => false))) return
    await caixa.fill(texto)
    await bot.page.keyboard.press("Enter")
    await bot.page.waitForTimeout(900)
  }

  await dizerNa(rita, "entro na voz daqui a cinco")
  await dizerNa(bruno, "já lá estamos dois")
  await dizerNa(ze, "vou buscar café e vou")
  await dizerNa(rita, "ranked hoje?")

  dizer("a pôr gente na sala de voz...")
  for (const bot of [rita, bruno]) {
    const voz = bot.page.locator(".room-row").filter({ hasText: /voz/i }).first()
    if (await voz.isVisible().catch(() => false)) {
      await voz.click().catch(() => {})
      await bot.page.waitForTimeout(1500)
    }
  }
  await ze.page.waitForTimeout(4000)

  dizer("a publicar no mural...")
  /*
    The composer is ALWAYS on the Social screen, at the top of the feed.
    
    There used to be an `if (await novaPublicacao.isVisible())` around everything:
    the "New post" button lives in the channels sidebar, and after switching to
    Social it is no longer on screen. The condition returned false, the entire block
    was skipped without a warning, and the feed stayed empty. That is how the
    homepage ended up publishing a screenshot with "Dead silence".
    
    No `if`, then. What fails fails hard, and the check down below handles the rest.
    */
  await ze.page.getByRole("button", { name: "Feed" }).first().click().catch(() => {})
  // The TEXTAREA, not the first field: the first in document order is "Title (optional)",
  // and the publish button does not wake up with just a title: it needs a caption,
  // image, file, or link.
  const legenda = ze.page.locator("textarea").first()
  await legenda.waitFor({ timeout: 15_000 })
  await legenda.fill("primeira vitória da noite")
  const publicar = ze.page.getByRole("button", { name: /^Publicar$/ }).first()
  await publicar.waitFor({ timeout: 5_000 })
  await publicar.click()
  await ze.page.locator("article.post").first().waitFor({ timeout: 20_000 })

  dizer("a retratar...")
  // Zé sees the voice room with Rita and Bruno inside, which is what matters
  // to show: a place with people, not an empty place.
  await ze.page.getByRole("button", { name: "Comunidades" }).first().click().catch(() => {})
  await ze.page.waitForTimeout(1200)

  dizer("à espera que os nomes cheguem...")
  /*
    Without this, the screenshot comes out with the `shortAddress` in place of the name:
    the first word of the address, which looks like a nickname. Publishing that on the
    homepage was publishing a known bug pretending to be a feature.

    Who joins publishes the profile; who was already there republishes when the channel
    grows. Both take as long as the network takes, and that is what we wait for here
    instead of a made-up number.
  */
  const nomesNaConversa = async () =>
    (await ze.page.locator(".timeline .author").allInnerTexts()).map((texto) => texto.trim())
  const chegaram = async (segundos) => {
    const limite = Date.now() + segundos * 1000
    while (Date.now() < limite) {
      const vistos = await nomesNaConversa()
      if (nomes.every((nome) => vistos.includes(nome))) return true
      await ze.page.waitForTimeout(1000)
    }
    return false
  }

  if (!(await chegaram(30))) {
    /*
      A nudge, the same as a person would do: save the profile again.
      
      The profile of who was already there was published in an epoch before the arrival
      of who came later, and forward secrecy does the rest. There is automatic republishing
      when the channel grows, but it runs once and might have run before this bot had keys.
      Saving the profile changes the date and forces a new publication on all channels.
      */
    dizer("  a forçar a republicação dos perfis...")
    for (const bot of [rita, bruno]) {
      await bot.page.getByRole("button", { name: "Eu" }).first().click().catch(() => {})
      await bot.page.waitForTimeout(600)
      await bot.page.getByRole("button", { name: /Editar perfil/i }).first().click().catch(() => {})
      await bot.page.waitForTimeout(600)
      await bot.page
        .getByRole("button", { name: /^Guardar$/i })
        .first()
        .click()
        .catch(() => {})
      await bot.page.waitForTimeout(1200)
      await bot.page.getByRole("button", { name: "Comunidades" }).first().click().catch(() => {})
    }
    await chegaram(30)
  }

  const finais = await nomesNaConversa()
  const emFalta = nomes.filter((nome) => !finais.includes(nome))
  if (emFalta.length > 0) {
    // Do not publish a screenshot with the address in place of the name: that would
    // put a known bug on the product page pretending to be a feature.
    throw new Error(`os nomes não chegaram: falta ${emFalta.join(", ")} — vi ${finais.join(", ")}`)
  }

  await retratar(ze.page, ".room-tree, .channel-list", "salas", { padding: 8 })
  await retratar(ze.page, ".timeline", "conversa", { alturaMaxima: 230 })
  await retratar(ze.page, ".members", "pessoas", { alturaMaxima: 280 })
  await ze.page.getByRole("button", { name: "Feed" }).first().click().catch(() => {})
  await ze.page.waitForTimeout(1200)
  // Same reason as the names: an empty feed on the product page is a bug
  // pretending to be a feature.
  if ((await ze.page.locator("article.post").count()) === 0) {
    throw new Error("o mural ficou vazio — a publicação não foi criada")
  }
  await retratar(ze.page, "article.post", "mural", { padding: 10 })

  /*
    PNG to WebP, and the PNGs go away.

    Measured in this run: 72 KB in PNG against 19 KB in WebP, with the same crops.
    The page has a budget written and checked, and a forgotten PNG in `public/` ends up
    in `dist` without anyone noticing until the weight test, which is too late to figure
    out why.
  */
  dizer("a converter para WebP...")
  for (const ficheiro of await readdir(DESTINO)) {
    if (!ficheiro.endsWith(".png")) continue
    const origem = join(DESTINO, ficheiro)
    const destino = origem.replace(/\.png$/, ".webp")
    /*
      Resized before converting, and that is what makes the numbers work.

      The page shows them at around 550px width; at two to one that is 1100, and
      anything over that is bytes nobody sees. Without the crop, the four screenshots
      would be 43 KB and the page would blow past the 50 KB cap: with half those
      bytes serving pixels the browser throws away when drawing.

      `-resize L 0` keeps the ratio: the height comes from the width. Zero does not
      resize anything, which is what we want for screenshots already narrow.
    */
    const { stdout } = await correr("sips", ["-g", "pixelWidth", origem])
    const largura = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0)
    const alvo = largura > 1100 ? ["-resize", "1100", "0"] : []
    await correr("cwebp", ["-quiet", "-q", "80", ...alvo, origem, "-o", destino])
    await unlink(origem)
  }

  dizer(`feito. As capturas estão em ${DESTINO}`)
} catch (erro) {
  console.error(`\nNão consegui montar o cenário: ${erro.message}`)
  if (erro.stack) console.error(erro.stack)
  process.exitCode = 2
} finally {
  await desmontar()
}
