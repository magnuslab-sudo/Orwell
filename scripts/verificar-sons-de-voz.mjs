/**
 * The sounds of entering and leaving the voice room, heard by three accounts
 * for real.
 *
 * The question this answers cannot be answered with unit tests: when WE ENTER a
 * room where people already are, each one of them responds to our announcement
 * with theirs, and they all arrive at the same time. Those are presences
 * appearing, not people arriving, and playing there is the most likely defect
 * of this feature and the most unpleasant to hear. Three accounts are the
 * minimum that tells the difference: one already there, one entering, and a
 * third one entering after to prove the first still hears and the second does
 * not hear itself.
 *
 * No sound is heard with ears: intercept `createOscillator` before the app
 * starts and read what was SCHEDULED. Each voice in the palette has its own
 * frequency signature (`lib/sounds.ts`), so what was registered says without
 * ambiguity which sound would have come out and when.
 *
 * Usage:
 *   node scripts/verificar-sons-de-voz.mjs [--url=http://127.0.0.1:5176] [--servidor=localhost:8453]
 *
 * LOCAL on purpose, and no production option: this creates throwaway accounts
 * and enters and leaves calls. Against production it would be noise on top of
 * people who are actually talking.
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL_BASE = comLingua(arg("--url") ?? "http://127.0.0.1:5176")
const SERVIDOR = arg("--servidor") ?? "localhost:8453"
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "sons-2026"
const CORRIDA = `sons-${Date.now().toString(36)}`

function arg(nome) {
  return process.argv.find((entrada) => entrada.startsWith(`${nome}=`))?.split("=").slice(1).join("=")
}

const ARGS = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]

const resultados = []
function verificar(rotulo, ok, detalhe = "") {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FALHA"}  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
}

/**
 * The instrument records the first tick of each scheduled oscillator.
 *
 * Wraps the prototype, not the constructor, to catch the context that the app
 * creates on its own schedule. Does not alter any sound, it reads and passes through.
 */
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

/** The palette signatures, by frequencies. See `VOICES` in `lib/sounds.ts`. */
const ASSINATURAS = [
  // Proof that the call was established. This script is not about that, it is
  // about who joins and who leaves, but the call sound plays in the middle of it,
  // and without this line it would show as "unknown" in each verification detail.
  // To see it proven: `verificar-som-de-ligacao.mjs`.
  { nome: "ligada", hz: [493.88, 739.99, 987.77] },
  { nome: "entrada", hz: [587.33, 783.99] },
  { nome: "saída", hz: [783.99, 587.33] },
  { nome: "chamada", hz: [587.33, 880, 587.33, 880, 587.33, 880] },
  { nome: "notificação", hz: [659.25, 987.77] },
  { nome: "cotovelada", hz: [740, 740, 740] },
  { nome: "mensagem", hz: [784] },
  { nome: "enviado", hz: [523.25] },
]

/**
 * From what was scheduled to what would have been heard.
 *
 * A sound is a group: its notes are all scheduled at the same clock instant
 * (the phase shift between them lives in audio time, not here), so any interval
 * above a few tens of milliseconds separates two different sounds.
 */
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

async function abrir(indice, nome) {
  const ctx = await chromium.launchPersistentContext(`/tmp/orwell-sons/${CORRIDA}-${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(ESCUTAR)
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)

  // The server is not the default: this verification runs against a custom
  // homeserver so it does not interfere with or get interfered by another session.
  // Since it is off screen, it passes here and `criarConta` opens the advanced options.
  await criarContaEEntrar(page, { nome, frase: FRASE, servidor: SERVIDOR, entrada: 120_000 })
  /**
   * And wait for the server's main channel before returning.
   *
   * The main room is arbitrated: the first account creates it, the following ones
   * request entry and wait for an ONLINE member to admit them. Without waiting here,
   * the next account would be created before this one was admitted, and all three
   * would never end up in the same voice room, which is the condition for the entire verification.
   */
  await page.getByText(/^orwell$/i).first().waitFor({ timeout: 240_000 })
  return { ctx, page, nome, indice }
}

/** The host enters by clicking the voice room, which is how a person enters. */
async function entrar(bot) {
  const sala = bot.page.locator(".room-row").filter({ hasText: /voz/i }).first()
  await sala.waitFor({ timeout: 60_000 })
  await sala.click()
  // Proof that we actually joined, not just that we clicked.
  await bot.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 30_000 })
}

/**
 * Invited members enter through the "in call" banner.
 *
 * Through the banner and not through the room list, due to a limitation of the
 * development server and not this feature: the main channel rooms were declared
 * in an epoch before the newcomers arrived, and only whoever administers the
 * channel can republish them, something the main channel, by design, does not do.
 * The banner is the path the interface offers to someone who sees that a
 * conversation is happening, and it leads to the SAME voice room (see `salaDaChamadaDe`),
 * which is all this verification needs.
 */
async function entrarPelaFaixa(bot) {
  const botao = bot.page.getByRole("button", { name: /^entrar$/i }).first()
  await botao.waitFor({ timeout: 120_000 })
  await botao.click()
  await bot.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 60_000 })
}

async function sair(bot) {
  const botao = bot.page.getByRole("button", { name: /sair da chamada/i }).first()
  await botao.waitFor({ timeout: 20_000 })
  await botao.click()
}

/** What was scheduled since the last cleanup, already translated. */
async function escutados(bot) {
  return ouvidos(await bot.page.evaluate(() => window.__sons ?? []))
}

async function limpar(bots) {
  for (const bot of bots) await bot.page.evaluate(() => void (window.__sons = []))
}

const conta = (lista, nome) => lista.filter((som) => som === nome).length

console.log(`três contas contra ${URL_BASE} (servidor ${SERVIDOR})\n`)

const ana = await abrir(0, "Ana")
console.log("  Ana criada")
const bruno = await abrir(1, "Bruno")
console.log("  Bruno criado")
const carla = await abrir(2, "Carla")
console.log("  Carla criada")
const bots = [ana, bruno, carla]

// Ana joins first and stays inside: she is the one already there.
await entrar(ana)
await ana.page.waitForTimeout(8000)
await limpar(bots)

console.log("\n1) o Bruno entra numa sala onde já está a Ana")
await entrarPelaFaixa(bruno)
await bruno.page.waitForTimeout(12_000)
const anaOuviuBruno = await escutados(ana)
const brunoAoEntrar = await escutados(bruno)
verificar("a Ana ouve uma entrada", conta(anaOuviuBruno, "entrada") === 1, anaOuviuBruno.join(" ") || "silêncio")
verificar(
  "o Bruno não se ouve a si próprio nem à lista a encher",
  conta(brunoAoEntrar, "entrada") === 0 && conta(brunoAoEntrar, "saída") === 0,
  brunoAoEntrar.join(" ") || "silêncio",
)

await limpar(bots)

console.log("\n2) a Carla entra numa sala onde já estão duas pessoas")
await entrarPelaFaixa(carla)
await carla.page.waitForTimeout(12_000)
const anaOuviuCarla = await escutados(ana)
const brunoOuviuCarla = await escutados(bruno)
const carlaAoEntrar = await escutados(carla)
verificar("a Ana ouve uma entrada", conta(anaOuviuCarla, "entrada") === 1, anaOuviuCarla.join(" ") || "silêncio")
verificar("o Bruno ouve uma entrada", conta(brunoOuviuCarla, "entrada") === 1, brunoOuviuCarla.join(" ") || "silêncio")
verificar(
  "a Carla entra numa sala com duas pessoas e não ouve duas chegadas",
  conta(carlaAoEntrar, "entrada") === 0,
  carlaAoEntrar.join(" ") || "silêncio",
)

await limpar(bots)

console.log("\n3) a Carla sai")
await sair(carla)
await carla.page.waitForTimeout(8000)
const anaOuviuSaida = await escutados(ana)
const brunoOuviuSaida = await escutados(bruno)
const carlaAoSair = await escutados(carla)
verificar("a Ana ouve uma saída", conta(anaOuviuSaida, "saída") === 1, anaOuviuSaida.join(" ") || "silêncio")
verificar("o Bruno ouve uma saída", conta(brunoOuviuSaida, "saída") === 1, brunoOuviuSaida.join(" ") || "silêncio")
verificar("a Carla não se ouve a sair", conta(carlaAoSair, "saída") === 0, carlaAoSair.join(" ") || "silêncio")

await limpar(bots)

console.log("\n4) o Bruno sai, e fica só a Ana")
await sair(bruno)
await bruno.page.waitForTimeout(8000)
const anaSozinha = await escutados(ana)
verificar("a Ana ouve a última saída", conta(anaSozinha, "saída") === 1, anaSozinha.join(" ") || "silêncio")

const falhas = resultados.filter((ok) => !ok).length
console.log(falhas === 0 ? "\nTudo o que devia soar soou, e nada mais." : `\n${falhas} verificações falhadas.`)

for (const bot of bots) await bot.ctx.close()
process.exit(falhas === 0 ? 0 : 1)
