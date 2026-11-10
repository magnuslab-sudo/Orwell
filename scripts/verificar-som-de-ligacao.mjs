/**
 * The sound of the call that picked up, heard by three accounts for real.
 *
 * The question this answers cannot be answered with unit tests: the ringtone
 * must come out ONCE per entry, not once per connected pair. With two accounts
 * that cannot be told apart, there is one pair only, and once per pair also
 * gives one. A third account is needed: someone who enters a room where two
 * people already are has TWO pairs connecting, and that is where a sound per
 * pair shows itself.
 *
 * And the empty room, which is the other case and has no pair at all: entering
 * first is half the entries that exist, and the ringtone must come out the
 * same, after the `SALA_VAZIA_MS` timeout.
 *
 * No sound is heard with ears: intercept `createOscillator` before the app
 * starts and read what was SCHEDULED, the same instrument from
 * `verificar-sons-de-voz.mjs`, and on purpose. Each voice in the palette has
 * its own frequency signature (`lib/sounds.ts`), so what was registered says
 * without ambiguity which sound would have come out and when.
 *
 * Usage:
 *   node scripts/verificar-som-de-ligacao.mjs [--url=http://127.0.0.1:5191] [--servidor=localhost:8461]
 *
 * LOCAL on purpose, and no production option: this creates throwaway accounts
 * and enters and leaves calls. Against production it would be noise on top of
 * people who are actually talking.
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL_BASE = comLingua(arg("--url") ?? "http://127.0.0.1:5191")
const SERVIDOR = arg("--servidor") ?? "localhost:8461"
const FRASE = process.env.ORWELL_DIAG_PASSPHRASE ?? "sons-2026"
const CORRIDA = `lig-${Date.now().toString(36)}`

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

/** The instrument: registers the first frequency of each scheduled oscillator. */
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
 * A sound is a group: all its notes are scheduled at the same clock instant
 * (the offset between them lives in audio time, not here).
 */
function agrupar(agendados) {
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
    return { nome: assinatura?.nome ?? `desconhecido(${grupo.hz.join(",")})`, t: grupo.t }
  })
}

const ouvidos = (agendados) => agrupar(agendados).map((som) => som.nome)

async function abrir(indice, nome) {
  const ctx = await chromium.launchPersistentContext(`${process.cwd()}/.dev-data/sons-${CORRIDA}-${indice}`, {
    headless: true,
    args: ARGS,
    permissions: ["microphone"],
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(ESCUTAR)
  await page.goto(URL_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)

  await criarContaEEntrar(page, { nome, frase: FRASE, servidor: SERVIDOR, entrada: 120_000 })
  // The common room is arbitrated: without waiting here, the accounts do not all
  // end up in the same voice room, which is the condition of the whole check.
  await page.getByText(/^orwell$/i).first().waitFor({ timeout: 240_000 })
  return { ctx, page, nome, indice }
}

/** The host enters by clicking the voice room, which is how a person enters. */
async function entrar(bot) {
  const sala = bot.page.locator(".room-row").filter({ hasText: /voz/i }).first()
  await sala.waitFor({ timeout: 60_000 })
  const em = Date.now()
  await sala.click()
  await bot.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 30_000 })
  return em
}

/**
 * The guests enter via the "in a call" banner.
 *
 * Via the banner and not the room list, due to a limitation of the development
 * server and not this feature, see `verificar-sons-de-voz.mjs`, where the
 * reason is written out in full. It leads to the SAME voice room.
 */
async function entrarPelaFaixa(bot) {
  const botao = bot.page.getByRole("button", { name: /^entrar$/i }).first()
  await botao.waitFor({ timeout: 120_000 })
  const em = Date.now()
  await botao.click()
  await bot.page.getByRole("button", { name: /sair da chamada/i }).first().waitFor({ timeout: 60_000 })
  return em
}

async function escutados(bot) {
  return ouvidos(await bot.page.evaluate(() => window.__sons ?? []))
}

async function escutadosComRelogio(bot) {
  return agrupar(await bot.page.evaluate(() => window.__sons ?? []))
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

console.log("\n1) a Ana entra sozinha numa sala de voz vazia")
await limpar(bots)
const anaEntrouEm = await entrar(ana)
await ana.page.waitForTimeout(9000)
const anaSozinha = await escutadosComRelogio(ana)
const ligacaoDaAna = anaSozinha.filter((som) => som.nome === "ligada")
verificar(
  "a Ana ouve a confirmação, uma vez",
  ligacaoDaAna.length === 1,
  anaSozinha.map((som) => som.nome).join(" ") || "silêncio",
)
if (ligacaoDaAna.length === 1) {
  const atraso = ligacaoDaAna[0].t - anaEntrouEm
  verificar(
    "e só depois do prazo da sala vazia, e não ao clique",
    atraso >= 3000 && atraso < 9000,
    `${atraso} ms depois do clique`,
  )
}

await limpar(bots)

console.log("\n2) o Bruno entra numa sala onde já está a Ana (um par)")
await entrarPelaFaixa(bruno)
await bruno.page.waitForTimeout(12_000)
const brunoAoEntrar = await escutados(bruno)
const anaComBruno = await escutados(ana)
verificar("o Bruno ouve a confirmação, uma vez", conta(brunoAoEntrar, "ligada") === 1, brunoAoEntrar.join(" ") || "silêncio")
verificar(
  "a Ana não ouve outra confirmação: a dela já foi",
  conta(anaComBruno, "ligada") === 0,
  anaComBruno.join(" ") || "silêncio",
)
verificar("a Ana ouve a entrada do Bruno, que é outra coisa", conta(anaComBruno, "entrada") === 1, anaComBruno.join(" "))

await limpar(bots)

console.log("\n3) a Carla entra numa sala onde já estão DUAS pessoas (dois pares)")
await entrarPelaFaixa(carla)
await carla.page.waitForTimeout(14_000)
const carlaAoEntrar = await escutados(carla)
const anaComCarla = await escutados(ana)
const brunoComCarla = await escutados(bruno)
verificar(
  "a Carla ouve UMA confirmação, e não uma por par",
  conta(carlaAoEntrar, "ligada") === 1,
  carlaAoEntrar.join(" ") || "silêncio",
)
verificar(
  "e nem a Ana nem o Bruno ouvem confirmação nenhuma",
  conta(anaComCarla, "ligada") === 0 && conta(brunoComCarla, "ligada") === 0,
  `ana: ${anaComCarla.join(" ") || "silêncio"} · bruno: ${brunoComCarla.join(" ") || "silêncio"}`,
)

await limpar(bots)

console.log("\n4) o Bruno sai e volta a entrar: é outra entrada")
await bruno.page.getByRole("button", { name: /sair da chamada/i }).first().click()
await bruno.page.waitForTimeout(4000)
await limpar(bots)
await entrarPelaFaixa(bruno)
await bruno.page.waitForTimeout(12_000)
const brunoOutraVez = await escutados(bruno)
verificar(
  "o Bruno volta a ouvir a confirmação",
  conta(brunoOutraVez, "ligada") === 1,
  brunoOutraVez.join(" ") || "silêncio",
)

const falhas = resultados.filter((ok) => !ok).length
console.log(falhas === 0 ? "\nTudo o que devia soar soou, e nada mais." : `\n${falhas} verificações falhadas.`)

for (const bot of bots) await bot.ctx.close()
process.exit(falhas === 0 ? 0 : 1)
