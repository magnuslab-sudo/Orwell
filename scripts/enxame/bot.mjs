/**
 * A bot: a real browser, a real account, and everything it saw.
 *
 * What sets this apart from the check scripts that already exist is what gets
 * saved. A check script answers "passed" or "failed"; here each bot brings back
 * console errors, page errors, network requests that died, the diagnostics log
 * from the app itself and the time of each step. Without it, a swarm report
 * says "12 errors" and does not help fix anything.
 *
 * All the instrumentation comes from OUTSIDE: `addInitScript` wraps what the
 * app already uses (`RTCPeerConnection`, `navigator.clipboard`) without
 * touching its code. It is a requirement of the work, and it is also what
 * keeps the harness valid when the app changes underneath.
 */
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { criarConta } from "../conta.mjs"

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  // Ten browsers running on a machine with three other agents working cannot use
  // GPU or sound. The goal is to exercise the application, not measure video
  // composition.
  "--disable-gpu",
  "--mute-audio",
  "--disable-dev-shm-usage",
]

/**
 * What wraps inside the page before the application starts.
 *
 * `RTCPeerConnection`: we keep the history of states for each connection, not
 * just the current state. A connection that was alive and dropped reads
 * differently from one that never connected, and the distinction is the
 * difference between "the call never formed" and "the call broke mid-stream".
 *
 * `navigator.clipboard.writeText`: the application copies to the clipboard in
 * eight places: address, invite link, diagnostic log. In headless mode this
 * rejects due to lack of permission, and what would happen was an error toast
 * instead of the text. Wrapped, the text lives in `window.__enxame.copias` and
 * gets read without any permissions: that is how we collect diagnostics from
 * the application itself instead of fabricating another one.
 */
const INSTRUMENTAR = () => {
  window.__enxame = { copias: [], ligacoes: [], erros: [] }

  const Original = window.RTCPeerConnection
  if (Original) {
    window.RTCPeerConnection = function (config) {
      const pc = new Original(config)
      const registo = { estados: [], ligou: false, criada: Date.now(), ligouEm: null }
      window.__enxame.ligacoes.push(registo)
      pc.addEventListener("connectionstatechange", () => {
        registo.estados.push(pc.connectionState)
        if (pc.connectionState === "connected" && !registo.ligou) {
          registo.ligou = true
          registo.ligouEm = Date.now()
        }
      })
      return pc
    }
    window.RTCPeerConnection.prototype = Original.prototype
  }

  const areaDeTransferencia = navigator.clipboard
  if (areaDeTransferencia) {
    const escreverOriginal = areaDeTransferencia.writeText?.bind(areaDeTransferencia)
    areaDeTransferencia.writeText = (texto) => {
      window.__enxame.copias.push(String(texto))
      // Always resolves: what matters is the text, and a rejection here would only
      // make the application show an error that is not its own.
      return escreverOriginal ? escreverOriginal(texto).catch(() => {}) : Promise.resolve()
    }
  }

  // An unhandled rejected promise does not appear in the console the same way
  // across all browsers, and that is where half the network bugs live.
  window.addEventListener("unhandledrejection", (evento) => {
    window.__enxame.erros.push(`unhandledrejection: ${String(evento.reason?.message ?? evento.reason)}`)
  })
}

/** Open a browser, create the account, and return the bot already inside the application. */
export async function abrirBot({ indice, nome, urlWeb, servidor, frase, dirPerfis, dirProvas, escala = 1 }) {
  const bot = {
    indice,
    nome,
    frase,
    servidor,
    urlWeb,
    dirProvas,
    endereco: null,
    /** Console errors, page errors, and dead requests. Zero is the expectation. */
    consola: [],
    /** Everything that went wrong in an action, already categorized. */
    achados: [],
    /** Duration of each step measured, for the distribution at the end. */
    tempos: [],
    /** What this bot knows about the world: channels it created or joined. */
    canais: new Set(),
    /** Messages this bot sent, with the mark that makes them recognizable. */
    enviadas: [],
    accoes: [],
  }

  const ctx = await chromium.launchPersistentContext(join(dirPerfis, `bot-${indice}`), {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
    viewport: { width: 1280, height: 900 },
    /* One by default, which is what the swarm wants: measure what people see.
       The portrait script asks for two because a 1x capture published on a
       retina screen looks soft, and soft text on a product page reads as
       unfinished work. */
    deviceScaleFactor: escala,
  })
  bot.ctx = ctx
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  bot.page = page

  page.on("console", (mensagem) => {
    const tipo = mensagem.type()
    if (tipo !== "error" && tipo !== "warning") return
    bot.consola.push({ em: Date.now(), tipo, texto: mensagem.text().slice(0, 400) })
  })
  page.on("pageerror", (erro) => {
    bot.consola.push({ em: Date.now(), tipo: "pageerror", texto: String(erro.message).slice(0, 400) })
  })
  page.on("requestfailed", (pedido) => {
    // The favicon and font maps fail on every run and tell us nothing.
    if (/favicon|\.map$/.test(pedido.url())) return
    bot.consola.push({
      em: Date.now(),
      tipo: "rede",
      texto: `${pedido.method()} ${pedido.url().slice(0, 120)} — ${pedido.failure()?.errorText ?? "?"}`,
    })
  })

  await page.addInitScript(INSTRUMENTAR)
  await page.goto(urlWeb, { waitUntil: "domcontentloaded" })
  // The server comes pre-set from the page address: `localhost:8448`, which is
  // the port of someone else's `dev:server`. On an ephemeral port run, giving
  // it is not optional, and since it went off the screen, `criarConta` opens
  // advanced options.
  const inicio = Date.now()
  await criarConta(page, { nome, frase, servidor })
  await page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 120_000 })
  bot.tempos.push({ passo: "criar-conta", ms: Date.now() - inicio })

  bot.endereco = await lerEndereco(page)
  return bot
}

/**
 * The account address, read from the screen.
 *
 * The pattern is words separated by hyphens: `@datterum-nadmivo-…`, not the
 * twenty alphanumeric characters that old scripts look for. One still has the
 * old pattern: against this server it would return `null`, the invite would go
 * to a person who does not exist, and the invitee would never see the channel.
 */
export async function lerEndereco(page) {
  const texto = await page.locator("body").innerText()
  return texto.match(/@[a-z0-9-]+:[a-z0-9.:-]+/)?.[0] ?? null
}

/**
 * The diagnostic log of the application itself, collected along the user's
 * path.
 *
 * Settings -> "Copy log" is the button that exists for whoever reports a bug.
 * We read the same text because it is the same text the owner will read, and
 * because inventing a second log in parallel guarantees the two diverge.
 */
export async function colherDiagnostico(bot) {
  const { page } = bot
  try {
    await fecharSobreposicoes(page)
    await page.getByRole("button", { name: "Configurações" }).click({ timeout: 10_000 })
    const copiar = page.getByRole("button", { name: "Copiar registo" }).first()
    if (!(await copiar.isVisible({ timeout: 10_000 }).catch(() => false))) return null
    await copiar.click()
    await page.waitForTimeout(300)
    const copias = await page.evaluate(() => window.__enxame?.copias ?? [])
    await page.keyboard.press("Escape").catch(() => {})
    return copias.at(-1) ?? null
  } catch (erro) {
    return `(não foi possível colher o diagnóstico: ${String(erro.message).split("\n")[0]})`
  }
}

/** The call connections on this page, with the state history for each one. */
export function ligacoes(page) {
  return page.evaluate(() => window.__enxame?.ligacoes ?? [])
}

/**
 * Close whatever is on top, saying what it was.
 *
 * An open modal swallows all clicks and Playwright only says "intercepts pointer
 * events" without saying which one. In a run of ten bots for ten minutes that is
 * the difference between a find and a mystery.
 */
/**
 * What the application said, in words, not just what the DOM ended up being.
 *
 * This did not exist, and the lack cost an entire session. The "create-invite-link"
 * failed thirteen times in twenty-three and the report said "created the invite
 * and did not return link": a sentence the harness invented because it was the
 * only possible conclusion looking at an empty field. The invite was never
 * created: the refusal was on the screen in a toast that said "you do not have
 * the responsibility to invite to this channel", and nobody read it.
 *
 * The rule that follows: when an action fails, what the application SAID matters
 * more than what the harness could deduce. Read it after the gesture and before
 * closing the overlays, which is the only window where the toast is still there.
 */
export async function colherAvisos(page) {
  const avisos = await page
    .locator(".toast")
    .allInnerTexts()
    .catch(() => [])
  return avisos.map((texto) => texto.replace(/\s+/g, " ").trim()).filter(Boolean)
}

export async function fecharSobreposicoes(page) {
  const fechadas = []
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const sobreposicao = page.locator(".overlay, .modal, .sheet").first()
    if (!(await sobreposicao.isVisible().catch(() => false))) break
    const texto = (await sobreposicao.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 120)
    fechadas.push(texto)
    await page.keyboard.press("Escape").catch(() => {})
    await page.waitForTimeout(250)
  }
  return fechadas
}

/**
 * Reload and reopen the vault, which is what a person does without thinking.
 *
 * It matters for two reasons: it is the path where the application reads
 * everything from scratch (and where history that vanished becomes visible), and
 * it is the exit from a call without `voice.leave`: the one that leaves the
 * other side hanging.
 */
export async function recarregar(bot) {
  const inicio = Date.now()
  await bot.page.reload({ waitUntil: "domcontentloaded" })
  const palavra = bot.page.locator('input[type="password"]').first()
  if (await palavra.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await palavra.fill(bot.frase)
    await bot.page.getByRole("button", { name: /^(Abrir|Entrar|Desbloquear)$/ }).first().click()
  }
  await bot.page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 120_000 })
  bot.tempos.push({ passo: "recarregar-e-abrir", ms: Date.now() - inicio })
}

/** A capture with a name, so a line in the report can point to proof. */
export async function fotografar(bot, etiqueta) {
  await mkdir(bot.dirProvas, { recursive: true })
  const caminho = join(bot.dirProvas, `bot${bot.indice}-${etiqueta}-${Date.now().toString(36)}.png`)
  await bot.page.screenshot({ path: caminho, fullPage: false }).catch(() => {})
  return caminho
}

export async function fecharBot(bot) {
  await bot.ctx.close().catch(() => {})
}
