/**
 * Join and leave a call, many times, with real accounts.
 *
 * It exists because of an owner report on August 10: joined a call, went fine;
 * joined a SECOND time and stopped seeing one of the people, while a third kept
 * seeing both. Asymmetric, which is the signature of stale state on one side only.
 *
 * The `carga-chamada.mjs` measures how many people the mesh can handle, and so it
 * puts everyone in ONCE. This measures something else: what remains between one
 * join and the next. Those are different questions and neither answers the other.
 *
 * Usage:
 *   node scripts/churn-chamada.mjs [n] [--voltas=6] [--url=http://localhost:5173]
 *
 *   n         how many accounts (3 by default: the number from the report, and the
 *             minimum that tells "these two don't see each other" from "nobody sees
 *             anybody")
 *   --voltas  how many times each bot leaves and rejoins
 *   --url     which deployment. LOCAL by default, on purpose: see below.
 *   --so=1    only this bot does the cycle; the others stay quiet in the call.
 *             This is the exact form of the report, and the one that isolates the bug.
 *
 * WHY THE DEFAULT TARGET IS LOCAL, unlike `carga-chamada.mjs`: this script creates
 * accounts and joins and leaves calls dozens of times. Against production that is
 * noise on top of people actually talking, and fills the database with disposable
 * accounts. On August 6 a load run against production deleted the founding record
 * that the owner had just published. Point it at production when he asks, with
 * `--url=https://orwell.pt`, never by default.
 *
 * WHAT THIS MEASURES: after leaving and rejoining, whether each pair gets back a
 * live connection in BOTH directions. It is the asymmetry that matters, a connection
 * that exists on one side but not the other reads as "I stopped seeing this person"
 * on screen.
 *
 * WHAT THIS DOES NOT MEASURE: audio quality, bandwidth, and traversal between
 * different networks. Everything runs on one machine.
 */
import { chromium } from "playwright"

import { APP, SERVIDOR as SERVIDOR_OMISSAO } from "./ambiente.mjs"
import { criarContaEEntrar } from "./conta.mjs"

/**
 * Eight by default, by order of the owner.
 *
 * Three was the number from the report and the minimum that tells "these two don't
 * see each other" from "nobody sees anybody". Eight is the ceiling the mesh has
 * already proven in one join (`carga-chamada.mjs`, 56/56 direct and relay), and it
 * is where rejoining does the most damage, because each bot that leaves and rejoins
 * has seven connections to remake instead of two. If the bug is stale state blocking
 * the offer, it multiplies by seven here.
 */
const N = Number(process.argv[2] ?? 8)
const VOLTAS = Number(process.argv.find((a) => a.startsWith("--voltas="))?.split("=")[1] ?? 6)
const URL_BASE = process.argv.find((a) => a.startsWith("--url="))?.split("=")[1] ?? APP
const SO = process.argv.find((a) => a.startsWith("--so="))?.split("=")[1]
/**
 * Which homeserver the accounts live in.
 *
 * The signup screen comes pre-filled with `localhost:8448` whenever the page is
 * served from localhost, no matter the port, and by default that is what we keep
 * here, so the script keeps running as it did. The field exists because the machine
 * now has more than one verification server at the same time, one per agent: without
 * it, these eight bots would create accounts and make calls on someone else's server.
 */
const SERVIDOR = process.argv.find((a) => a.startsWith("--servidor="))?.split("=")[1] ?? SERVIDOR_OMISSAO
/**
 * HOW you leave the call, which is the variable that decides whether the bug shows up.
 *
 * `button` (by default) is what this script always did: click "Leave call". That
 * emits a `voice.leave`, and whoever stays cleans up the connection neatly, so it
 * is the HAPPY path and probably does not reproduce anything.
 *
 * `reload` is what a real person does: close the tab, hit F5, close the laptop.
 * No `voice.leave`. On the side that stays, the connection goes into `disconnected`
 * and sits there half a minute before ICE admits anything, and that is exactly the
 * window when the person rejoins. It is the path the report describes.
 */
const MODO = process.argv.find((a) => a.startsWith("--modo="))?.split("=")[1] ?? "botao"
/**
 * WHICH channel the call happens in.
 *
 * `shared` (by default) uses the server's shared room, which is what someone finds
 * when creating an account. It has a cost visible only on a verification machine:
 * whoever did not FOUND it must be admitted by a member online, and on a freshly
 * started server that does not happen reliably, the bots 1..N end up locked out
 * and the run measures zero, which reads as the worst bug ever instead of "they
 * never got in".
 *
 * `own` makes bot 0 create a channel and invite the others by address, which is
 * the path `e2e-call.mjs` already uses and which works locally. It does not change
 * what we measure: the call is the same, the voice room is the same, and the
 * rejoin is the same.
 */
/**
 * `own` by default, and the script itself already explained why.
 *
 * The shared room needs someone to found it and to admit whoever arrives after,
 * and that "does not happen reliably" on a freshly started server, this is written
 * above, and the old default was the opposite. On August 13, 2026 that cost three
 * minutes of wait per bot and the wrong conclusion that the product was broken.
 */
const SALA = process.argv.find((a) => a.startsWith("--sala="))?.split("=")[1] ?? "propria"
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "churn-2026"
const CORRIDA = `churn-${Date.now().toString(36)}`
/** The own channel, when `--sala=propria`. Unique per run. */
const NOME_CANAL = `churn-${CORRIDA.slice(-6)}`

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

/**
 * Count live connections inside the page, not what the screen shows.
 *
 * The screen might be lying due to delay; an `RTCPeerConnection` in `connected`
 * does not lie. We also track how many have died, because a connection stuck in
 * `failed` without being replaced is exactly the symptom.
 */
const INSTRUMENTAR = () => {
  const Orig = window.RTCPeerConnection
  window.__pcs = []
  window.RTCPeerConnection = function (config) {
    const pc = new Orig(config)
    window.__pcs.push(pc)
    return pc
  }
  window.RTCPeerConnection.prototype = Orig.prototype
  window.__vivas = () => window.__pcs.filter((pc) => pc.connectionState === "connected").length
  window.__mortas = () =>
    window.__pcs.filter((pc) => ["failed", "closed", "disconnected"].includes(pc.connectionState)).length
}

async function abrir(indice) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-churn/${CORRIDA}-${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(INSTRUMENTAR)
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3000)

  // The server comes prefilled from the page address and is no longer on the
  // screen; it's passed here, and `criarConta` opens advanced options to set it.
  await criarContaEEntrar(page, { nome: `bot ${indice}`, frase: FRASE, servidor: SERVIDOR })

  // The address lives in the profile, which is also where the app shows it to the user.
  // Only needed for invites; nobody invites anybody in the common room.
  let address = ""
  if (SALA === "propria") {
    await page.getByRole("button", { name: "Eu" }).click()
    address = ((await page.locator(".me-address").first().getAttribute("title")) ?? "").trim()
    await page.keyboard.press("Escape").catch(() => {})
  }
  return { ctx, page, indice, address }
}

/**
 * A channel of bot 0, with everyone in it.
 *
 * Copied from `e2e-call.mjs`, which does exactly this and works locally. A
 * channel born this way starts with the voice room "voz" (see `SALAS_INICIAIS`), so
 * from here on the rest of the script sees no difference.
 */
async function montarCanalProprio(bots) {
  const dono = bots[0]
  await dono.page.getByRole("button", { name: "Comunidades" }).click()
  // "Create channel", not "Create channel": `e2e-call.mjs` still uses the old name
  // so we can't copy from there blindly.
  await dono.page.getByRole("button", { name: "Criar canal" }).first().click()
  await dono.page.getByPlaceholder("geral").fill(NOME_CANAL)
  await dono.page.getByRole("button", { name: "Confirmar" }).click()
  await dono.page.getByRole("heading", { name: NOME_CANAL }).waitFor({ timeout: 60_000 })
  console.log(`  canal ${NOME_CANAL} criado pelo bot 0`)

  for (const bot of bots.slice(1)) {
    await dono.page.getByRole("button", { name: "Convidar" }).first().click()
    await dono.page.getByPlaceholder("@abc…:servidor").fill(bot.address)
    await dono.page.getByRole("button", { name: "Confirmar" }).click()
    await dono.page.waitForTimeout(1500)
  }
  console.log(`  ${bots.length - 1} convites enviados`)

  for (const bot of bots.slice(1)) {
    await bot.page.getByRole("button", { name: "Comunidades" }).click()
    const linha = bot.page.getByRole("button", { name: new RegExp(NOME_CANAL) }).first()
    try {
      await linha.waitFor({ state: "visible", timeout: 120_000 })
    } catch {
      console.log(`  bot ${bot.indice}: NAO RECEBEU o convite`)
      continue
    }
    await linha.click()
    await bot.page.getByRole("heading", { name: NOME_CANAL }).waitFor({ timeout: 60_000 })
  }

  /**
   * The voice room is created NOW, with everyone already inside the channel.
   *
   * A channel's initial rooms are declared the instant it is born, and a guest
   * only reads "what is sent from now on, not what already passed", that phrase
   * is written in the invite itself. Created before the invites, the room existed
   * for the founder and nobody else: the others saw the channel and no room
   * inside it. Created after, the declaration reaches everyone.
   */
  await dono.page.getByRole("button", { name: "Nova sala" }).first().click()
  await dono.page.getByPlaceholder("Anúncios").fill("churnvoz")
  // The type is a pair of buttons ("Text" / "Voice"), not a dropdown.
  await dono.page.getByRole("button", { name: "Voz", exact: true }).click()
  await dono.page.getByRole("button", { name: "Criar", exact: true }).click()
  await dono.page.waitForTimeout(3000)
  console.log("  sala de voz criada depois dos convites")
}

/** After reloading, the app might not reopen the channel we were in. */
async function reabrirCanal(page) {
  if (SALA !== "propria") return
  if (await page.getByRole("heading", { name: NOME_CANAL }).isVisible().catch(() => false)) return
  await page.getByRole("button", { name: "Comunidades" }).click().catch(() => {})
  const linha = page.getByRole("button", { name: new RegExp(NOME_CANAL) }).first()
  if (await linha.isVisible().catch(() => false)) await linha.click()
}

/**
 * An open modal window swallows all clicks, and the script would die midway.
 *
 * The Playwright error says `<div class="overlay"> intercepts pointer events` and
 * nothing else, it doesn't say WHICH one, and in a ten-minute script that's the
 * difference between knowing and running again. This logs what was on top before
 * we closed it, so an unexpected modal ends up in the report instead of being
 * hidden: if it's an app bug, I want to read it.
 */
async function fecharModal(page, quem) {
  const overlay = page.locator(".overlay").first()
  if (!(await overlay.isVisible().catch(() => false))) return false
  const texto = (await overlay.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160)
  console.log(`  bot ${quem}: modal por cima -- "${texto}"`)
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(300)
  return true
}

/**
 * Enter the voice room by clicking it in the list, which is how a user enters.
 *
 * WAITS for the room instead of asking if it's already there. With eight accounts
 * entering the common channel at the same time, admission takes longer than the
 * instant the account is created: calling `isVisible()` cold returned `false`,
 * we fell back, and the fallback opened the "Enter with a link" modal, a whole
 * run measuring 0/7 and looking like the worst bug ever.
 *
 * The fallback stops clicking blindly for this exact reason. A button whose name
 * matches /entrar|chamada/ could be anything; if the voice room doesn't show up,
 * what matters is saying so, not clicking somewhere else.
 */
async function entrar(page) {
  /**
   * In a private channel you enter via the CHANNEL CALL, not a voice room.
   *
   * A channel's rooms are declared by whoever creates it, and a guest only reads
   * "what is sent from now on, not what already passed", and that phrase is
   * written in the invite itself. The initial room declarations had already
   * passed, so guests see the channel and no room inside it. The channel call
   * needs no declaration from anyone: it's the room with an empty ID, where
   * everyone lands. It's the path `e2e-call.mjs` uses, and that's why it works.
   */
  /**
   * `churnvoz` and not `voz`, and this distinction cost a run to figure out.
   *
   * A channel starts with a voice room called "voz", declared the instant it's
   * created, which the founder sees and guests don't, for the same reason as
   * always. Searching /voz/i put the founder in THEIR room and guests in the new
   * one: three bots in two different calls, each seeing fewer people than they
   * should, and looking exactly like the bug we've been chasing.
   */
  const alvo = SALA === "propria" ? /churnvoz/i : /voz/i
  const sala = page.locator(".room-row").filter({ hasText: alvo }).first()
  try {
    /**
     * Three minutes, not thirty seconds.
     *
     * Whoever didn't FOUND the common room needs to be admitted by a member who
     * is online, and that's a conversation between clients that takes as long as
     * it takes, there's a script just to measure it (`verificar-sala-comum.mjs`).
     * In a run of eight accounts it's the slowest step of all, and cutting it here
     * would give an invalid run dressed up as a severe bug.
     */
    await sala.waitFor({ state: "visible", timeout: 180_000 })
  } catch {
    return false
  }
  await sala.click()
  return true
}

async function sair(page) {
  if (MODO === "recarregar") return recarregar(page)
  const botao = page.getByRole("button", { name: /desligar|sair da chamada/i }).first()
  if (await botao.isVisible().catch(() => false)) {
    await botao.click()
    return true
  }
  return false
}

/**
 * Exit the way users exit: without telling anyone.
 *
 * The page reloads, the instrumentation gets installed again (`addInitScript`
 * runs at each navigation), and this page's counters become the new life's, which
 * is what we want to measure. On the other side no `voice.leave` arrived: the
 * seven connections stay hanging in `disconnected`.
 *
 * The vault asks for the password again, and that's why this isn't just a
 * `reload()`: without reopening the account, the bot would come back as a
 * stranger and the next measurement would measure nothing.
 */
async function recarregar(page) {
  await page.reload({ waitUntil: "domcontentloaded" })
  const pw = page.locator('input[type="password"]').first()
  if (await pw.isVisible({ timeout: 30_000 }).catch(() => false)) {
    await pw.fill(FRASE)
    await page.getByRole("button", { name: /^Abrir$/ }).first().click()
  }
  await page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 90_000 })
  await reabrirCanal(page)
  return true
}

const vivas = (page) => page.evaluate(() => window.__vivas())
const mortas = (page) => page.evaluate(() => window.__mortas())

console.log(
  `${N} contas contra ${URL_BASE} (servidor ${SERVIDOR}), ${VOLTAS} voltas${SO ? ` (so o bot ${SO} cicla)` : ""}`,
)

const bots = []
for (let i = 0; i < N; i++) {
  bots.push(await abrir(i))
  process.stdout.write(`  conta ${i + 1}/${N}\r`)
}
console.log(`\n${N} contas criadas.`)

if (SALA === "propria") await montarCanalProprio(bots)

console.log("todos a entrar pela primeira vez...")
let semSala = 0
for (const bot of bots) {
  await fecharModal(bot.page, bot.indice)
  if (!(await entrar(bot.page))) {
    console.log(`  bot ${bot.indice}: NAO ENCONTROU a sala de voz`)
    semSala++
  }
}
if (semSala > 0) {
  // Without everyone on the call there's nothing to measure, and a run measuring
  // 0/7 because of this reads like the worst bug ever. Better to stop.
  console.log(`\n${semSala} de ${N} bots nao chegaram a entrar. Corrida invalida.`)
  for (const bot of bots) await bot.ctx.close()
  process.exit(2)
}
await bots[0].page.waitForTimeout(15_000)

const esperadas = N - 1
let falhas = 0

/**
 * The measurement BEFORE any cycle, which is what says if there's anything to measure.
 *
 * Without it, a run where the mesh never formed reads as "reentry broke
 * everything", and the conclusion comes out backwards from the truth.
 */
/**
 * Waits for the mesh to SETTLE, instead of taking a photo at any random instant.
 *
 * Eight people entering one after another form 28 connections, and each one
 * takes its own ICE. A single reading caught the mesh mid-form and gave numbers
 * that read as a bug. Returns the last reading, whether it settled or not.
 */
async function assentar(limiteSegundos) {
  let leitura = []
  for (let s = 0; s < limiteSegundos; s += 5) {
    leitura = []
    let completo = true
    for (const bot of bots) {
      const v = await vivas(bot.page)
      leitura.push(`bot${bot.indice}:${v}/${esperadas}`)
      if (v < esperadas) completo = false
    }
    if (completo) return leitura
    await bots[0].page.waitForTimeout(5000)
  }
  return leitura
}

const partida = await assentar(90)
const totalPartida = partida.reduce((soma, linha) => soma + Number(linha.split(":")[1].split("/")[0]), 0)
console.log(`  partida: ${partida.join("  ")}  (total ${totalPartida}/${N * esperadas})`)

if (totalPartida === 0) {
  console.log("\nNinguem ligou a ninguem antes de qualquer ciclo. Corrida invalida.")
  for (const bot of bots) await bot.ctx.close()
  process.exit(2)
}
if (totalPartida < N * esperadas) {
  /**
   * The mesh doesn't always close first, and that's NOT what this script measures.
   *
   * Measured locally on August 10, with and without the reentry fix: three bots
   * entering in a row gave 5/6 connections in both cases, with the missing person
   * varying. It's a FORMATION defect, and it lives somewhere else.
   *
   * Let the run continue and compare against this starting line, instead of
   * against the ideal: what we're asking here is whether reentry WORSENS what was
   * there, and for that what was there is the right reference.
   */
  console.log("  (aviso: a malha nao fechou a partida — compara-se contra ela, e nao contra o ideal)")
}

for (let volta = 1; volta <= VOLTAS; volta++) {
  const ciclistas = SO ? bots.filter((b) => String(b.indice) === SO) : bots

  for (const bot of ciclistas) {
    await fecharModal(bot.page, bot.indice)
    await sair(bot.page)
  }
  await bots[0].page.waitForTimeout(4000)
  for (const bot of ciclistas) {
    await fecharModal(bot.page, bot.indice)
    await entrar(bot.page)
  }
  // Generous: ICE takes time, and a hurried measurement accuses a defect that
  // doesn't exist. If it fails with this, it really failed.
  await bots[0].page.waitForTimeout(20_000)

  const linha = []
  let total = 0
  for (const bot of bots) {
    const v = await vivas(bot.page)
    const m = await mortas(bot.page)
    linha.push(`bot${bot.indice}:${v}/${esperadas}${m ? `(${m}†)` : ""}`)
    total += v
  }
  // Worse than the starting line is that it's this run's defect: reentry left
  // fewer live connections than there were before it.
  const mau = total < totalPartida
  if (mau) falhas++
  console.log(
    `  volta ${volta}: ${linha.join("  ")}  (total ${total}/${N * esperadas})${
      mau ? `   <-- PIOR do que a partida (${totalPartida})` : ""
    }`,
  )
}

console.log(
  falhas === 0
    ? `\n${VOLTAS} voltas: a reentrada nunca deixou a malha pior do que a encontrou (${totalPartida}/${N * esperadas}).`
    : `\n${falhas} de ${VOLTAS} voltas deixaram a malha PIOR do que a partida (${totalPartida}/${N * esperadas}).`,
)

for (const bot of bots) await bot.ctx.close()
process.exit(falhas === 0 ? 0 : 1)
