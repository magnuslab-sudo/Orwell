/**
 * The desktop app (Electron) and a browser (Chromium), different accounts,
 * the same local server. This is line 1 of phase 7, the one the owner saw fail:
 * "last time the desktop app was not communicating with browser users".
 *
 *   npm run build && node scripts/e2e-secretaria-browser.mjs           (called in mesh)
 *   npm run build && node scripts/e2e-secretaria-browser.mjs --sfu     (called via SFU, as in production)
 *
 * What is proved, always via the interface:
 *  1. Ana creates an account ON THE DESKTOP APP (the vault in the keychain, as in
 *     the installed app); Bruno creates an account in Chromium;
 *  2. Bruno friend-requests Ana, Ana accepts on the desktop;
 *  3. direct conversation in both directions;
 *  4. Ana creates a channel on the desktop, invites Bruno, Bruno accepts, and the
 *     channel talks in both directions;
 *  5. both join the channel voice room and synthetic audio (Chromium's mock microphone,
 *     on both sides) CROSSES THE DECRYPTION in both directions: SFrame frames that
 *     arrive and those that open are counted, and the Opus that comes out is decoded
 *     (`sfu-prova-fase2/instrumento.mjs`).
 *
 * The desktop app runs from `apps/client/out`, in a hidden window and in a
 * temporary data folder (`secretaria.mjs`). Everything local and disposable.
 */
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, abrirDirecta, aceitarAmizade, ate, contasDoServidor, criarCanal, dentro, dizer, entrarNaVoz, escutar, espera, ouviu, pedirAmizade, portaoPronto, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"
import { INSTRUMENTAR, LER_SFRAME } from "./sfu-prova-fase2/instrumento.mjs"

const COM_SFU = process.argv.includes("--sfu")
const FRASE = "frase-de-verificacao-2026"
const { check, resumo } = verificador()
const registo = []

const srv = await levantarServidor({ frente: 8478, servidor: 8479, sfu: COM_SFU ? 8480 : 0, etiqueta: "secretaria-browser" })
console.log(`servidor ${srv.NOME}, chamada ${COM_SFU ? "pelo SFU" : "em malha"}`)
let browser
let sec
async function arrumar(codigo) {
  await sec?.fechar().catch(() => {})
  await browser?.close().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

try {
  // -------
  // 1. Two accounts: Ana on desktop, Bruno in Chromium.
  // -------
  sec = await abrirSecretaria({ rotulo: "secretaria" })
  const ana = sec.page
  // The instrument joins by reloading, AFTER the first load finishes: reloading
  // mid-`loadFile` aborts it, and the main process exits
  // (`enclave failed to start: ERR_ABORTED`).
  await portaoPronto(ana)
  await ana.addInitScript(INSTRUMENTAR, "")
  await ana.reload()
  let t0 = Date.now()
  await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana)
  check("a Ana cria conta na app de secretária", true, `${Date.now() - t0} ms`)

  browser = await chromium.launch({ headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] })
  const ctxB = await browser.newContext({ locale: "pt-PT", permissions: ["microphone", "camera"] })
  escutar(ctxB, registo, "BRUNO")
  const bruno = await ctxB.newPage()
  await bruno.addInitScript(INSTRUMENTAR, "")
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  t0 = Date.now()
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno)
  check("o Bruno cria conta no Chromium", true, `${Date.now() - t0} ms`)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)
  check("o servidor tem as duas contas", Boolean(enderecoAna && enderecoBruno), `${enderecoAna} · ${enderecoBruno}`)

  // -------
  // 2. Friendship: the browser requests, the desktop accepts.
  // -------
  await pedirAmizade(bruno, enderecoAna)
  const msPedido = await aceitarAmizade(ana)
  check("o pedido de amizade do browser chega à secretária, e a Ana aceita", msPedido >= 0, `${msPedido} ms até aparecer`)
  const msAmigos = await ate(async () => (await bruno.locator('input[placeholder="Escreve uma mensagem"]').count()) > 0 || (await bruno.locator(".people-bar-title").innerText().catch(() => "")).includes("(1)"), 60_000, 1000)
  check("o Bruno vê a aceitação", msAmigos >= 0, `${msAmigos} ms`)

  // -------
  // 3. The direct conversation, in both directions.
  // -------
  await abrirDirecta(bruno)
  await abrirDirecta(ana)
  const doBruno = `do browser para a secretária ${Date.now().toString(36)}`
  await dizer(bruno, doBruno)
  const ms1 = await ouviu(ana, doBruno)
  check("directa: o browser fala e a secretária lê", ms1 >= 0, `${ms1} ms`)
  const daAna = `da secretária para o browser ${Date.now().toString(36)}`
  await dizer(ana, daAna)
  const ms2 = await ouviu(bruno, daAna)
  check("directa: a secretária fala e o browser lê", ms2 >= 0, `${ms2} ms`)

  // -------
  // 4. A channel from the desktop, with the browser invited.
  // -------
  await criarCanal(ana, "adega")
  check("a Ana cria o canal adega na secretária", true)
  const convidou = await convidar(ana, "adega", enderecoBruno)
  check("a secretária convida o browser para o canal", convidou)
  const entrou = await aceitarConvite(bruno, "adega", { espera: 60_000 })
  check("o browser aceita e o canal aparece-lhe", entrou)
  await abrirCanal(ana, "adega")
  await abrirCanal(bruno, "adega")
  await espera(1500)
  const noCanalA = `no canal, da secretária ${Date.now().toString(36)}`
  await dizer(ana, noCanalA)
  const ms3 = await ouviu(bruno, noCanalA)
  check("canal: a secretária fala e o browser lê", ms3 >= 0, `${ms3} ms`)
  const noCanalB = `no canal, do browser ${Date.now().toString(36)}`
  await dizer(bruno, noCanalB)
  const ms4 = await ouviu(ana, noCanalB)
  check("canal: o browser fala e a secretária lê", ms4 >= 0, `${ms4} ms`)

  // -------
  // 5. The voice room, with audio in both directions.
  // -------
  check("a Ana entra na sala de voz (secretária)", await entrarNaVoz(ana))
  await espera(1000)
  check("o Bruno entra na sala de voz (browser)", await entrarNaVoz(bruno))
  console.log("  ..  os dois na sala de voz; 20 s de áudio sintético")
  await espera(20_000)
  const medir = async (page) => {
    const linhas = await page.evaluate(LER_SFRAME).catch((e) => [{ erro: String(e) }])
    const receptores = linhas.filter((l) => l.papel === "receptor")
    const emissores = linhas.filter((l) => l.papel === "emissor")
    const soma = (lista, campo) => lista.reduce((t, l) => t + (l[campo] ?? 0), 0)
    return {
      linhas,
      chegaram: soma(receptores, "entrada"),
      abriram: soma(receptores, "saida"),
      amostras: soma(receptores, "amostrasDescodificadas"),
      enviados: soma(emissores, "saida"),
    }
  }
  const mA = await medir(ana)
  const mB = await medir(bruno)
  const resumoDe = (m) => `enviados ${m.enviados}, chegaram ${m.chegaram}, abriram ${m.abriram}, ${m.amostras} amostras descodificadas`
  check("secretária: envia frames cifrados", mA.enviados > 100, resumoDe(mA))
  check("browser: envia frames cifrados", mB.enviados > 100, resumoDe(mB))
  check("áudio do browser chega à secretária E ABRE", mA.abriram > 100 && mA.amostras > 0, `${mA.abriram}/${mA.chegaram} frames, ${mA.amostras} amostras`)
  check("áudio da secretária chega ao browser E ABRE", mB.abriram > 100 && mB.amostras > 0, `${mB.abriram}/${mB.chegaram} frames, ${mB.amostras} amostras`)
  if (!(mA.abriram > 100 && mB.abriram > 100)) {
    console.log("  ..  instrumento da secretária: " + JSON.stringify(mA.linhas).slice(0, 1500))
    console.log("  ..  instrumento do browser: " + JSON.stringify(mB.linhas).slice(0, 1500))
  }
  // The media path that ran, not the one requested: the browser only speaks
  // `sfu.produce`/`sfu.consumed` if the call entered via the SFU.
  const tramasSfu = registo.filter((l) => l.includes("TRAMA") && /"sfu\.(produce|consumed)"/.test(l)).length
  check(COM_SFU ? "a chamada correu pelo SFU (o browser trocou sfu.produce/sfu.consumed)" : "a chamada correu em malha (nenhuma trama sfu.*)", COM_SFU ? tramasSfu >= 2 : tramasSfu === 0, `${tramasSfu} tramas sfu`)
  const erros = [...registo, ...sec.registo].filter((l) => l.includes("PAGEERROR"))
  check("nenhum erro de página nos dois lados", erros.length === 0, erros[0]?.slice(0, 160) ?? "")
} catch (erro) {
  check("o guião chegou ao fim", false, String(erro?.message ?? erro).split("\n")[0])
  console.log("--- registo da secretária (fim) ---\n" + sec?.registo.slice(-40).join("\n"))
  console.log("--- registo do browser (fim) ---\n" + registo.filter((l) => !l.includes("TRAMA")).slice(-25).join("\n"))
  console.log("--- servidor (fim) ---\n" + srv.registo.texto.slice(-1500))
}

await arrumar(resumo() ? 0 : 1)
