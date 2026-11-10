/**
 * The bell that swings when a notification arrives, without eyes and without ears.
 *
 * Two measurements, and neither is a screenshot. The sound is read from what was
 * SCHEDULED in the `AudioContext` (the instrument from `verificar-sons-de-voz.mjs`); the
 * movement is read from `getComputedStyle` of the bell itself, caught at the moment
 * the class enters it, by a `MutationObserver` installed before the app
 * starts.
 *
 * **And it runs twice: with and without `prefers-reduced-motion`.** That is where the
 * defect this feature could repeat lives. There is a universal rule in
 * `base.css` that zeros the duration of ALL animations with `!important` when the
 * preference is on, and it beats any `@media` written in another
 * file, that is how the nudge stayed for months as sound only, with the
 * alternative written and invisible. The bell's exception lives in the same
 * `@media` block that would cancel it, and what we measure here is whether it wins.
 *
 * GOTCHA, and it cost an iteration for whoever came before: `--force-prefers-reduced-
 * motion` DOES NOT work under Playwright, which imposes `no-preference` another way.
 * The preference is set with `reducedMotion: "reduce"` in the context, and that is what
 * is done below.
 *
 * Usage:
 *   node scripts/verificar-sino-de-notificacao.mjs [--url=http://127.0.0.1:5191] [--servidor=localhost:8461]
 *
 * LOCAL on purpose: creates throwaway accounts and sends friend requests.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL_BASE = comLingua(arg("--url") ?? "http://127.0.0.1:5191")
const SERVIDOR = arg("--servidor") ?? "localhost:8461"
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "sino-2026"
const CORRIDA = `sino-${Date.now().toString(36)}`

function arg(nome) {
  return process.argv.find((entrada) => entrada.startsWith(`${nome}=`))?.split("=").slice(1).join("=")
}

const resultados = []
function verificar(rotulo, ok, detalhe = "") {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FALHA"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

/** The sound instrument: the first frequency of each scheduled oscillator. */
const ESCUTAR = () => {
  const Contexto = window.AudioContext ?? window.webkitAudioContext
  if (!Contexto) return
  window.__sons = []
  const criar = Contexto.prototype.createOscillator
  Contexto.prototype.createOscillator = function () {
    const osc = criar.call(this)
    const param = osc.frequency
    const original = param.setValueAtTime.bind(param)
    let primeira = true
    param.setValueAtTime = (valor, quando) => {
      if (primeira) {
        window.__sons.push({ hz: Math.round(valor * 100) / 100, t: Date.now() })
        primeira = false
      }
      return original(valor, quando)
    }
    return osc
  }
}

/**
 * The motion instrument: the computed style of the bell at the moment of the
 * alert.
 *
 * At document level and with `subtree`, because the button is born long after
 * this runs, the app mounts, unlocks and only then renders the account card.
 * Read in the `MutationObserver` itself and not after: the class lasts 520 ms,
 * and a read done after a `waitForTimeout` arrives almost always too late.
 */
const OBSERVAR = () => {
  window.__sino = []
  const arrancar = () => {
    new MutationObserver((mutacoes) => {
      for (const mutacao of mutacoes) {
        const alvo = mutacao.target
        if (!(alvo instanceof Element)) continue
        if (!alvo.classList.contains("me-bell") || !alvo.classList.contains("avisa")) continue
        const estilo = getComputedStyle(alvo)
        window.__sino.push({
          animationName: estilo.animationName,
          animationDuration: estilo.animationDuration,
          t: Date.now(),
        })
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] })
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar)
  else arrancar()
}

const ASSINATURAS = [
  { nome: "notificação", hz: [659.25, 987.77] },
  { nome: "mensagem", hz: [784] },
  { nome: "enviado", hz: [523.25] },
  { nome: "ligada", hz: [493.88, 739.99, 987.77] },
  { nome: "entrada", hz: [587.33, 783.99] },
  { nome: "saída", hz: [783.99, 587.33] },
  { nome: "chamada", hz: [587.33, 880, 587.33, 880, 587.33, 880] },
  { nome: "cotovelada", hz: [740, 740, 740] },
]

function ouvidos(agendados) {
  const grupos = []
  for (const nota of agendados) {
    const ultimo = grupos.at(-1)
    if (ultimo && nota.t - ultimo.t <= 60) ultimo.hz.push(nota.hz)
    else grupos.push({ t: nota.t, hz: [nota.hz] })
  }
  return grupos.map((grupo) => {
    const assinatura = ASSINATURAS.find(
      (candidata) =>
        candidata.hz.length === grupo.hz.length && candidata.hz.every((hz, i) => Math.abs(hz - grupo.hz[i]) < 0.5),
    )
    return assinatura?.nome ?? `desconhecido(${grupo.hz.join(",")})`
  })
}

async function conta(nome, etiqueta, movimento) {
  const ctx = await chromium.launchPersistentContext(`${process.cwd()}/.dev-data/${CORRIDA}-${etiqueta}`, {
    headless: true,
    viewport: { width: 1280, height: 900 },
    // The preference is set HERE. See the trap at the top of the file.
    ...(movimento === "reduzido" ? { reducedMotion: "reduce" } : {}),
    args: ["--autoplay-policy=no-user-gesture-required"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(ESCUTAR)
  await page.addInitScript(OBSERVAR)
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })

  await criarConta(page, { nome, frase: FRASE, servidor: SERVIDOR })
  await page.locator(".rail").waitFor({ timeout: 60_000 })
  return { nome, ctx, page }
}

async function enderecoDe(page) {
  const alvo = page.locator(".me-address").first()
  await alvo.waitFor({ timeout: 30_000 })
  return (await alvo.textContent())?.trim() ?? null
}

const sons = (bot) => bot.page.evaluate(() => window.__sons ?? []).then(ouvidos)
const avisos = (bot) => bot.page.evaluate(() => window.__sino ?? [])
async function limpar(bots) {
  for (const bot of bots) {
    await bot.page.evaluate(() => {
      window.__sons = []
      window.__sino = []
    })
  }
}

/** Send a friend request the real way: the address pasted in "Find". */
async function pedirAmizade(bot, endereco) {
  await bot.page.getByRole("button", { name: "Amigos" }).click()
  await bot.page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await bot.page.getByRole("button", { name: "Encontrar", exact: true }).click()
  await bot.page.getByLabel("Cola um link ou endereço").fill(endereco)
  await bot.page.getByRole("button", { name: "Abrir perfil" }).click()
  // The address opens the profile sheet; the request is made there, with the single button.
  await bot.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" }).click()
  // The sheet stays open after the request and covers the page: close it.
  await bot.page.keyboard.press("Escape")
}

/** One full rotation, in one of the two motion modes. */
async function corrida(movimento) {
  console.log(`\n===== movimento ${movimento} =====`)
  const ana = await conta("Ana", `ana-${movimento}`, "normal")
  const bruno = await conta("Bruno", `bruno-${movimento}`, movimento)
  const enderecoDoBruno = await enderecoDe(bruno.page)
  const enderecoDaAna = await enderecoDe(ana.page)
  await limpar([ana, bruno])

  console.log("\n1) a Ana manda um pedido de amizade ao Bruno")
  await pedirAmizade(ana, enderecoDoBruno)
  await bruno.page.waitForTimeout(9000)

  const ouviu = await sons(bruno)
  verificar("o pedido de amizade toca no Bruno", ouviu.includes("notificação"), ouviu.join(" ") || "silêncio")

  const balancou = await avisos(bruno)
  verificar("e o sino balança", balancou.length >= 1, `${balancou.length} aviso(s)`)
  if (balancou.length > 0) {
    const primeiro = balancou[0]
    const esperado = movimento === "reduzido" ? "sino-realce" : "sino-bate"
    verificar(
      `a animação é a certa para este modo (${esperado})`,
      primeiro.animationName === esperado,
      `animationName=${primeiro.animationName}`,
    )
    // The whole point of the exception in `base.css`: with reduced motion the
    // universal rule would zero this to 0.01 ms, and the highlight would be
    // invisible.
    const segundos = Number.parseFloat(primeiro.animationDuration)
    verificar(
      "e dura o suficiente para se ver",
      segundos >= 0.5 && segundos <= 0.6,
      `animationDuration=${primeiro.animationDuration}`,
    )
    verificar(
      "e é mais curta do que a cotovelada (0,82 s) e do que o eco do botão (0,62 s)",
      segundos < 0.62,
      `${segundos}s`,
    )
  }

  console.log("\n2) o Bruno aceita, e é a Ana que fica a saber")
  await limpar([ana, bruno])
  await bruno.page.getByRole("button", { name: "Amigos" }).click()
  await bruno.page.waitForTimeout(2000)
  // The request lives in the "Received" tab, which is not always the open one.
  if ((await bruno.page.getByRole("button", { name: "Aceitar" }).count()) === 0) {
    await bruno.page.getByRole("button", { name: /Pendentes/ }).click()
    await bruno.page.waitForTimeout(1500)
  }
  await bruno.page.getByRole("button", { name: "Aceitar" }).first().click()
  await ana.page.waitForTimeout(9000)
  const anaOuviu = await sons(ana)
  const anaBalancou = await avisos(ana)
  verificar("a aceitação toca na Ana", anaOuviu.includes("notificação"), anaOuviu.join(" ") || "silêncio")
  verificar("e o sino dela balança", anaBalancou.length >= 1, `${anaBalancou.length} aviso(s)`)

  console.log("\n3) uma mensagem privada: um acontecimento, um som")
  await limpar([ana, bruno])
  await ana.page.locator(".people-aside .direct-row .direct-open").first().click()
  await ana.page.waitForTimeout(1500)
  const escrita = ana.page.locator(".chat-composer input:not([type=file])").first()
  await escrita.fill("olá")
  await escrita.press("Enter")
  await bruno.page.waitForTimeout(9000)
  const brunoOuviu = await sons(bruno)
  const brunoBalancou = await avisos(bruno)
  /**
   * The private message is the curious case: it enters the notification list by
   * its own path (one entry per conversation, not one per message) and so it
   * does NOT go through `pushNotification`. Its sound is the message sound, and
   * the notification one is deliberately muted, one event, one sound. The bell,
   * though, swings the same: the trigger is the badge going up, and it goes up.
   */
  verificar("a mensagem privada toca como mensagem", brunoOuviu.includes("mensagem"), brunoOuviu.join(" ") || "silêncio")
  verificar(
    "e não toca uma segunda vez como notificação",
    !brunoOuviu.includes("notificação"),
    brunoOuviu.join(" ") || "silêncio",
  )
  verificar("mas o sino balança na mesma, porque o crachá subiu", brunoBalancou.length >= 1, `${brunoBalancou.length} aviso(s)`)

  await ana.ctx.close()
  await bruno.ctx.close()
  return enderecoDaAna
}

console.log(`duas contas contra ${URL_BASE} (servidor ${SERVIDOR})`)
await corrida("normal")
await corrida("reduzido")

const falhas = resultados.filter((ok) => !ok).length
console.log(falhas === 0 ? "\nTudo o que devia mexer mexeu, e nada mais." : `\n${falhas} verificações falhadas.`)
process.exit(falhas === 0 ? 0 : 1)
