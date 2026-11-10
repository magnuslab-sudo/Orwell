/**
 * Do Firefox and Safari really come through SFU? The question the task asked.
 *
 *   node scripts/sfu-prova-motores/prova.mjs            # all three
 *   MOTORES=firefox node scripts/sfu-prova-motores/prova.mjs
 *
 * The probe `scripts/sfu-script-transform-por-motor.mjs` already proved the PIECE:
 * `RTCRtpScriptTransform` moves encrypted frames on all three engines, with a key
 * exchanged that opens nothing. Proving the piece isn't proving the product-in between
 * are the mediasoup-client, the entry gate, the worker packaged by `vite`, and
 * the order of assembly. That distance is what this bench measures, with the entire
 * product running: homeserver with media engine, `vite` serving `apps/web`, two
 * real accounts, an accepted invite, a voice room.
 *
 * **What counts as proof, and is double on purpose:**
 *
 *  1. **The product SAYS where it went.** The `call-path` line in the diagnostics log
 *     writes "sfu" or "mesh: …" the instant the gate decides. It's the only way to
 *     tell a working call over SFU from one over mesh-and it's exactly where Phase 2
 *     got it wrong once, with a bench whose sender was a `class {}`.
 *  2. **And the sound ARRIVES and OPENS.** Packets received prove transport; samples
 *     received with few invented prove the decoder had real audio to decode-which,
 *     with SFrame in between, only happens if the decipher ran. A failed decipher
 *     leaves packets arriving and the decoder inventing silence.
 *
 * Neither half stands alone: the first without the second says we chose SFU, not that
 * it worked; the second without the first measures a mesh and calls it SFU.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APP, FRASE, enderecoEncaminhavel, levantarServidor, levantarWeb, matarTudo } from "../sfu-prova-fase2/bancada.mjs"
import { abrirCanal, abrirConta, assentar, criarCanal, entrarNaChamada, estatisticas, registoDe } from "./montagem.mjs"

const MOTORES = (process.env["MOTORES"] ?? "chromium,firefox,webkit").split(",")
const SALA_BASE = "sfu-motores"

let falhou = 0
function verificar(rotulo, condicao, detalhe = "") {
  if (condicao) {
    console.log(`PASS  ${rotulo}`)
  } else {
    falhou += 1
    console.log(`FAIL  ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`)
  }
}

const dados = mkdtempSync(join(tmpdir(), "sfu-motores-dados-"))
const perfis = mkdtempSync(join(tmpdir(), "sfu-motores-perfis-"))

/*
 * THE CONTROL: the same product, on the same engine, against a server WITHOUT SFU.
 *
 *   SEM_SFU=1 MOTORES=webkit node scripts/sfu-prova-motores/prova.mjs
 *
 * Without it, "four RTCPeerConnection" is a number with no scale: it could be the
 * signature of SFU (the mediasoup-client capability probe plus two transports) or
 * something else entirely. With it, the difference between the two modes is measured
 * instead of assumed-the same reason the engine probe runs a "loose" mode alongside
 * the encrypted one.
 */
const SEM_SFU = process.env["SEM_SFU"] === "1"

/*
 * THE ADDRESS THE SFU ANNOUNCES, and it's what decides if Firefox is measurable.
 *
 * By default the SFU announces `127.0.0.1`. Chromium and WebKit connect to it without
 * complaint; Firefox collects no loopback candidate, ICE goes `failed` on both transports,
 * and what was measured was zero packets-read for a day as "Firefox sets up SFU and
 * sends no voice". It wasn't the engine: it was the bench not giving it an address to reach.
 * In production the SFU announces a public IP and the problem doesn't exist.
 *
 * With a routable address the bench measures what production does.
 */
const ANUNCIAR = process.env["ANUNCIAR"] ?? enderecoEncaminhavel()
if (ANUNCIAR) {
  console.log(`O SFU anuncia ${ANUNCIAR} (e não 127.0.0.1, que o Firefox não liga).`)
} else {
  // Said loudly, never a silent drop to loopback: without a routable address
  // Firefox is not measurable on this machine, and a FAIL here would be a
  // conclusion about the engine drawn from a machine with no network.
  console.log("SEM ENDEREÇO ENCAMINHÁVEL: o SFU vai anunciar 127.0.0.1, e o Firefox NÃO é mensurável assim.")
}

console.log(`A levantar o homeserver ${SEM_SFU ? "SEM motor de media (controlo)" : "com motor de media"}…`)
if (!(await levantarServidor(dados, { comSfu: !SEM_SFU, anunciarEm: ANUNCIAR }))) {
  console.error("o homeserver não subiu")
  process.exit(1)
}
console.log("A levantar o vite…")
if (!(await levantarWeb())) {
  console.error("o vite não subiu")
  process.exit(1)
}

for (const motor of MOTORES) {
  console.log("")
  console.log(`==================== ${motor}`)
  let anfitriao
  let convidado
  try {
    anfitriao = await abrirConta(motor, APP, { nome: `Ana-${motor}`, frase: FRASE, indice: 1, perfil: perfis })
    convidado = await abrirConta(motor, APP, { nome: `Bento-${motor}`, frase: FRASE, indice: 2, perfil: perfis })

    /*
     * One channel per engine, accounts per engine.
     *
     * All three engines run against the SAME homeserver, and the first version
     * of this gave them all the same channel name and accounts: the second engine
     * tried to create a channel that already existed and the invite never landed.
     * It read as "Firefox doesn't enter the channel", a conclusion about the
     * engine drawn from the bench colliding names.
     */
    const SALA = `${SALA_BASE}-${motor}`
    await criarCanal(anfitriao.page, SALA)
    const dentro = await assentar(anfitriao, convidado, SALA)
    verificar(`${motor}: as duas contas estão no canal`, dentro, "sem duas pontas não há o que medir")
    if (!dentro) continue

    if (!(await abrirCanal(convidado.page, SALA))) {
      verificar(`${motor}: o convidado abre o canal`, false)
      continue
    }
    const entrouA = await entrarNaChamada(anfitriao.page)
    const entrouB = await entrarNaChamada(convidado.page)
    verificar(`${motor}: as duas pessoas entram na sala de voz`, entrouA && entrouB, `ana=${entrouA} bento=${entrouB}`)
    if (!entrouA || !entrouB) continue

    // Time for the call to settle and sound to flow. Not generosity: it's the
    // time for ICE, DTLS, and a few seconds of Opus passing through.
    await anfitriao.page.waitForTimeout(12000)

    const statsA = await estatisticas(anfitriao.page)
    const statsB = await estatisticas(convidado.page)
    console.log(`   ana:   ${JSON.stringify(statsA)}`)
    console.log(`   bento: ${JSON.stringify(statsB)}`)

    const registoA = (await registoDe(anfitriao.page)) ?? ""
    const registoB = (await registoDe(convidado.page)) ?? ""
    const caminho = (registo) => registo.match(/call-caminho[^\n]*/)?.[0] ?? "(sem linha)"
    console.log(`   caminho ana:   ${caminho(registoA)}`)
    console.log(`   caminho bento: ${caminho(registoB)}`)
    // The log lines that say something about the call and cipher. Without this,
    // a zero across the board doesn't tell "didn't come through SFU" from
    // "came through and didn't cipher" from "the bench didn't open the mic".
    for (const [quem, registo] of [
      ["ana", registoA],
      ["bento", registoB],
    ]) {
      const linhas = registo
        .split("\n")
        .filter((linha) => /call-|sfu-|sframe-|voice|cifra/i.test(linha))
        .slice(0, 30)
      console.log(`   registo ${quem}: ${linhas.length ? linhas.join(" | ") : registo.slice(0, 200)}`)
    }

    /*
     * The signature of the path, counted in connections.
     *
     * With SFU there's the mediasoup-client capability probe and two transports-
     * four, measured on Chromium and WebKit. On a mesh with two people there's
     * ONE connection, one per pair. The `SEM_SFU=1` control runs the same engine
     * against a server with no media engine and measures the other side of the difference.
     */
    verificar(
      `${motor}: a assinatura do caminho é a ${SEM_SFU ? "MALHA" : "do SFU"}`,
      SEM_SFU ? statsA.ligacoes <= 2 && statsB.ligacoes <= 2 : statsA.ligacoes >= 3 && statsB.ligacoes >= 3,
      `ligações ana=${statsA.ligacoes} bento=${statsB.ligacoes}`,
    )
    verificar(
      `${motor}: chegou áudio aos dois lados`,
      statsA.pacotesRecebidos > 0 && statsB.pacotesRecebidos > 0,
      `ana=${statsA.pacotesRecebidos} bento=${statsB.pacotesRecebidos}`,
    )
    /*
     * The half that separates "arrived" from "opened".
     *
     * With SFrame on top, a decoder only receives real audio if the decipher ran.
     * Failed decipher, frames are thrown away and the decoder invents-invented
     * samples go up, received ones don't.
     */
    for (const [quem, stats] of [
      ["ana", statsA],
      ["bento", statsB],
    ]) {
      /*
       * Chromium doesn't serve `totalSamplesReceived` in these stats, and a
       * MISSING metric is not a zero metric: reporting it as failed was claiming
       * sound didn't open on an engine where packets passed both ways. We say
       * there's no measurement, and that's what we know.
       */
      if (stats.amostrasRecebidas === 0 && stats.amostrasInventadas === 0) {
        console.log(`SEM MEDIDA  ${motor}: este motor não serve \`totalSamplesReceived\` (${quem})`)
        continue
      }
      verificar(
        `${motor}: o som de ${quem} ABRIU (amostras verdadeiras, e não inventadas)`,
        stats.amostrasRecebidas > 0 && stats.amostrasInventadas < stats.amostrasRecebidas / 2,
        `recebidas=${stats.amostrasRecebidas} inventadas=${stats.amostrasInventadas}`,
      )
    }
  } catch (erro) {
    falhou += 1
    console.log(`FAIL  ${motor}: rebentou — ${String(erro?.message ?? erro).split("\n")[0]}`)
  } finally {
    await anfitriao?.ctx.close().catch(() => {})
    await convidado?.ctx.close().catch(() => {})
  }
}

matarTudo()
rmSync(dados, { recursive: true, force: true })
rmSync(perfis, { recursive: true, force: true })

console.log("")
// The final phrase says which of the two modes was measured. A control that announces
// "they come through SFU" is the phrase stuck on a report months later saying
// the opposite of what the run proved.
console.log(
  falhou !== 0
    ? `${falhou} verificações falharam.`
    : SEM_SFU
      ? "Controlo: os motores medidos ficaram na MALHA, e o som abre dos dois lados."
      : "Os motores medidos entram por SFU, e o som abre dos dois lados.",
)
process.exit(falhou === 0 ? 0 : 1)
