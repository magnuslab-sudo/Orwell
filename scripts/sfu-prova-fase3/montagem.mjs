/**
 * Phase 3 setup: the same product, with a screen-sharing display.
 *
 * Two things differ from the Phase 2 setup, and both are in the browser:
 *
 *  1. **`--auto-select-desktop-capture-source`**, without which `getDisplayMedia`
 *     on a Chrome with no one at the keyboard waits for a choice that never
 *     comes. Measured before writing this: with the flag, a headless Chromium
 *     delivers a real 1920x1080 monitor-not a black image, not a blank screen.
 *  2. **The instrumentation is from this folder**, which counts by TRACK. The
 *     Phase 2 version counts everything together, and in a call with voice and
 *     screen that leaves a share where not a single frame passes hidden behind
 *     the audio that went through.
 *
 * Everything else-accounts, invite accepted, voice room-comes from Phase 2
 * unchanged, on purpose: it is the product, it is the same, and a second copy
 * is a copy to diverge from.
 */
import { chromium } from "playwright"
import { comLingua } from "../ambiente.mjs"
import { criarContaEEntrar } from "../conta.mjs"
import { INSTRUMENTAR } from "./instrumento.mjs"

export { abrirCanal, assentar, criarCanal, enderecoDe, entrarNaChamada } from "../sfu-prova-fase2/montagem.mjs"

/**
 * The flags that give fake media AND screen to Chromium.
 *
 * `--use-fake-device-for-media-stream` puts a tone on the microphone and an
 * animated image on the camera. The screen is NOT fake: it is the virtual
 * monitor of the headless session, captured by the true system path, and that
 * is what makes this measurement worth something-a screen drawn by us would
 * only prove our drawing.
 */
export const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--auto-select-desktop-capture-source=Entire screen",
  "--autoplay-policy=no-user-gesture-required",
]

/** Open a browser with the instrumentation attached and the account created. */
export async function abrirConta(app, { nome, frase, indice, perfil, sabotagem = "" }) {
  const ctx = await chromium.launchPersistentContext(`${perfil}/${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone", "camera"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  // BEFORE `goto`: the instrumentation must be attached when the product calls
  // `createEncodedStreams()`, and it calls it on the first call.
  await page.addInitScript(INSTRUMENTAR, sabotagem)
  /*
    The language is REQUESTED in the address, like in the Phase 2 bench next
    door and like in all scripts: Playwright's Chromium starts in English, the
    application detects the language by itself since August 20, 2026, and the
    setup looks for Portuguese text. Without this, the bench dies saying the
    application did not start. See the twin comment in `../sfu-prova-fase2/montagem.mjs`.
  */
  await page.goto(comLingua(app), { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2000)
  await criarContaEEntrar(page, { nome, frase })
  return { ctx, page, nome, indice }
}

/**
 * The share button, in the call panel.
 *
 * By `aria-label`, not by class: it is the name the person hears and what a
 * voice command requests, and a renamed class would take the script along with
 * it without saying a word. The text comes from `strings.call.screenAria`.
 */
export async function partilharEcra(page) {
  const botao = page.getByRole("button", { name: "Partilhar ecrã." }).first()
  if (!(await botao.isVisible({ timeout: 5000 }).catch(() => false))) return false
  await botao.click()
  return true
}

/** The same button, on the other side of the state. */
export async function pararEcra(page) {
  const botao = page.getByRole("button", { name: /Parar de partilhar/ }).first()
  if (!(await botao.isVisible({ timeout: 5000 }).catch(() => false))) return false
  await botao.click()
  return true
}

/** Whether the share button is even offered, and why if not. */
export async function estadoDaPartilha(page) {
  return await page.evaluate(() => {
    const botao = [...document.querySelectorAll(".call-controls button")].find((elemento) =>
      (elemento.getAttribute("aria-label") ?? "").startsWith("Partilhar ecrã"),
    )
    const nota = document.querySelector(".call-share-off, .call-nota")
    return { temBotao: Boolean(botao), nota: nota?.textContent ?? null }
  })
}
