/**
 * The setup: real accounts, a real channel, and real people in it.
 *
 * It stands apart from the proof for a reason Phase 2 paid for: when the setup
 * fails, ALL measurements fail, and each fails with a message about something
 * else. The phase summary says this at length, "the channel ends up with one
 * person and the checks measure emptiness". Here the setup returns what it
 * managed to set up, and the proof refuses to measure what it does not have.
 */
import { chromium } from "playwright"
import { comLingua } from "../ambiente.mjs"
import { criarContaEEntrar } from "../conta.mjs"
import { aceitarConvite, convidar, etiquetaDe, textoDaEtiqueta } from "../convite.mjs"
import { INSTRUMENTAR } from "./instrumento.mjs"

/**
 * The switches that give Chromium fake media.
 *
 * `--use-fake-device-for-media-stream` puts a continuous tone in the
 * microphone. It is the worst case for bandwidth, a tone never stops and Opus
 * DTX never fires, and the best case for measuring: sound that does not stop
 * is sound that counts.
 */
export const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

/** Open a browser with the instrumentation attached and the account created. */
export async function abrirConta(app, { nome, frase, indice, perfil, sabotagem = "" }) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  // BEFORE `goto`: the instrumentation must be attached when the product calls
  // `createEncodedStreams()`, and it calls it on the first call.
  await page.addInitScript(INSTRUMENTAR, sabotagem)
  /*
    The language is REQUESTED in the address, as in all scripts.
    
    Without this, this test rig only runs on a machine whose browser is already
    in Portuguese: Playwright's Chromium starts in English, the app detects
    language on its own since August 20, 2026, and `criarContaEEntrar` looks
    for "Como queres aparecer" on a screen that says "How do you want your name
    shown?". What you saw was a timeout pointing to `conta.mjs`, as if the app
    had not started.
    
    The `guioes.lingua.test.ts` exists precisely so this does not happen, and
    it missed this call because it only reads `scripts/*.mjs`, these test rigs
    live one folder deeper. See the report: the guard should go into
    subfolders.
    */
  await page.goto(comLingua(app), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarContaEEntrar(page, { nome, frase })
  return { ctx, page, nome, indice }
}

/**
 * The address of this account, as it appears on screen.
 *
 * Addresses are WORDS separated by hyphens since identifiers
 * became readable; the old pattern (`@[a-z0-9]{20,}`) describes the
 * previous format and matches nothing. The `:porta` is part of the address on a
 * development server, removing it sends the invite to a place that does not
 * exist, and the invite never arrives.
 */
export const enderecoDe = (page) =>
  page.evaluate(() => document.body.innerText.match(/@[a-z0-9-]{10,}:[a-z0-9.:-]+/)?.[0] ?? null)

/** Create the channel where all this happens. */
export async function criarCanal(anfitriao, nome) {
  await anfitriao.getByRole("button", { name: "Criar canal" }).first().click()
  await anfitriao.waitForTimeout(1000)
  await anfitriao.getByPlaceholder("geral").first().fill(nome)
  await anfitriao.keyboard.press("Enter")
  await anfitriao.waitForTimeout(5000)
}

/**
 * Put someone in the channel: invite from one side, accept from the other.
 *
 * @returns whether the person is really in there, both halves, not just the
 * first. An invite sent to someone who never accepts it leaves the channel
 * with one person and the call with no other end.
 */
export async function assentar(anfitriao, convidado, nomeDaSala) {
  const etiqueta = etiquetaDe(nomeDaSala)
  const endereco = await enderecoDe(convidado.page)
  if (!(await convidar(anfitriao.page, etiqueta, endereco))) return false
  return await aceitarConvite(convidado.page, etiqueta)
}

/** Open the channel, from the side of someone already in it. */
export async function abrirCanal(page, nomeDaSala) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click()
  const etiqueta = etiquetaDe(nomeDaSala)
  const linha = page.locator(".channel-list .channel-name", { hasText: textoDaEtiqueta(etiqueta) }).first()
  if (!(await linha.isVisible().catch(() => false))) return false
  await linha.click()
  await page.waitForTimeout(1200)
  return true
}

/**
 * Enter the call, which is entering the VOICE ROOM.
 *
 * There is no call button in a channel, and it is a design choice: "in a
 * channel the call belongs to a voice room, and you enter it by clicking it in
 * the list" (`ChatScreen.tsx`). The "Call" button in the header only exists in
 * direct conversations, where there are no rooms or where to put them, and
 * that was what `e2e-chamada-epoch.mjs` was clicking, in a channel, with the
 * failure swallowed by a `.catch(() => {})`. A channel starts with a voice room
 * called "voz" (`Session.SALAS_INICIAIS`).
 *
 * @returns whether the click went through. A silent catch here would repeat
 * the defect.
 */
export async function entrarNaChamada(page, nomeDaSalaDeVoz = "voz") {
  const sala = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: nomeDaSalaDeVoz }) })
    .first()
  if (!(await sala.isVisible({ timeout: 5000 }).catch(() => false))) return false
  await sala.click()
  return true
}
