/**
 * Phase 2 of the SFU: audio passing through the engine, measured in the product.
 *
 * Phase 0 proved the component works on a test page. Phase 1 put the engine on the server. Phase 2 connected the client, and left one thing to prove:
 * **no RTP packet passed through the engine from the client**. Everything else was call order, types and
 * parameters.
 *
 * This measures what was missing, and measures it like Phase 0 did: frames counted, not
 * impressions. The difference is the subject, here there is no test page. There is the product: `apps/web` served by `vite`, the homeserver with the
 * Phase 1 engine running, accounts created from the UI, an invite accepted from the
 * UI, and the call open by clicking the voice room. If any of those pieces
 * break, this fails, and that is the point.
 *
 * ```
 * node scripts/sfu-prova-fase2/prova.mjs
 * SABOTAGEM=<nome> node scripts/sfu-prova-fase2/prova.mjs
 * ```
 *
 * **Sabotages are not optional.** A check that never failed is not a check, it is a sentence. Each one breaks a different link and MUST
 * make this exit with 1:
 *
 *   sem-sfu       the server starts without the engine. No SFU means no path to
 *                 measure, and SFU counts must stay zero.
 *   sem-cifra     the sender's cipher is disabled in the browser. What goes on the
 *                 wire has no SFrame header and nothing opens on the other side.
 *   chave-errada  the receiver gets a different key. Frames all arrive and
 *                 none open: rejected = received.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BANDA_DE_ENTRADA_POR_TRANSPORTE } from "../../apps/server/dist/media.js"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb, PORTA_SFU, PORTA_WEB, SERVIDOR } from "./bancada.mjs"
import { LER_CAIXAS, LER_ESTATISTICAS, LER_SFRAME } from "./instrumento.mjs"
import { abrirCanal, abrirConta, assentar, criarCanal, entrarNaChamada } from "./montagem.mjs"

const SABOTAGEM = process.env.SABOTAGEM ?? ""
const SALA = `sfu ${Date.now().toString(36)}`

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------------- measurements

/** SFrame counts from a page, split by role. */
const lerSframe = (page) => page.evaluate(LER_SFRAME)
const lerEstatisticas = (page) => page.evaluate(LER_ESTATISTICAS)
const marcar = (page, nome) => page.evaluate((n) => window.__marcar?.(n), nome)
const lerCaixas = (page) => page.evaluate(LER_CAIXAS)

const somaEntradas = (estatisticas, campo) =>
  estatisticas.reduce((total, pc) => total + pc.entrada.reduce((s, linha) => s + (linha[campo] ?? 0), 0), 0)

// ------------------------------------------------------------------- a corrida

const dados = mkdtempSync(join(tmpdir(), "orwell-sfu-fase2-"))
const perfis = mkdtempSync(join(tmpdir(), "orwell-sfu-perfis-"))
let clientes = []

try {
  console.log(`== Fase 2: o áudio a atravessar o SFU${SABOTAGEM ? `  [SABOTAGEM=${SABOTAGEM}]` : ""}`)

  if (!(await levantarServidor(dados, { comSfu: SABOTAGEM !== "sem-sfu" }))) {
    console.error("FALHA  o homeserver não subiu")
    process.exit(1)
  }
  if (!(await levantarWeb())) {
    console.error("FALHA  o vite não subiu")
    process.exit(1)
  }
  console.log(`   homeserver ${SERVIDOR}  ·  sfu ${SABOTAGEM === "sem-sfu" ? "DESLIGADO" : PORTA_SFU}  ·  app ${PORTA_WEB}`)

  // --------------------------------------------------------------- montagem

  // Three accounts: two for the call, and a third to enter the CHANNEL mid-call.
  // The third entering is what makes the epoch roll, and that is what the
  // two-key window exists to hold.
  for (const indice of [0, 1, 2]) {
    clientes.push(
      await abrirConta(APP, { nome: `sfu ${indice}`, frase: FRASE, indice, perfil: perfis, sabotagem: SABOTAGEM }),
    )
  }
  const [a, b, c] = clientes

  await criarCanal(a.page, SALA)
  const entrou = await assentar(a, b, SALA)
  verificar("o convidado ACEITA e fica mesmo no canal", entrou, entrou ? "2 no canal" : "ficou à porta")
  if (!entrou) {
    console.error("\nSem segunda ponta não há nada a medir. O resto da corrida mediria o vazio.")
    process.exit(1)
  }

  const naChamada = []
  for (const cliente of [a, b]) {
    await abrirCanal(cliente.page, SALA)
    naChamada.push(await entrarNaChamada(cliente.page))
    await cliente.page.waitForTimeout(1500)
  }
  verificar("os dois entram na sala de voz", naChamada.every(Boolean), `${naChamada.filter(Boolean).length}/2`)

  console.log("   a falar 15 s...")
  await dormir(15_000)
  for (const cliente of [a, b]) await marcar(cliente.page, "antes-da-entrada")

  // ------------------------------------------------------- 1. audio flowing through

  const sframe = []
  const stats = []
  for (const cliente of [a, b]) {
    sframe.push(await lerSframe(cliente.page))
    stats.push(await lerEstatisticas(cliente.page))
  }

  for (const [indice, registos] of sframe.entries()) {
    const emissores = registos.filter((r) => r.papel === "emissor")
    const receptores = registos.filter((r) => r.papel === "receptor")
    console.log(
      `   cliente ${indice}: ` +
        emissores.map((e) => `cifrados ${e.saida}`).join("") +
        receptores.map((r) => `  ·  recebidos ${r.entrada}, decifrados ${r.saida}, recusados ${r.recusados}`).join(""),
    )
  }

  /*
   * The path is through the SFU, not the mesh.
   *
   * Counting connections is not enough, and raw count is misleading: `mediasoup-client`
   * opens and CLOSES two `RTCPeerConnection` probes before negotiating
   * ("getNativeRtpCapabilities", "getNativeSctpCapabilities"), so you see
   * four where only two carry traffic. The ones that matter are the ones that closed
   * DTLS: two per client, send and receive. With mesh it would be connections per
   * pair, and with two people it would be one.
   */
  const vivos = stats.map((pcs) => pcs.filter((pc) => pc.dtls === "connected"))
  verificar(
    "cada cliente tem dois transportes com DTLS fechado — envio e recepção",
    vivos.length === 2 && vivos.every((pcs) => pcs.length === 2),
    stats.map((pcs) => `${pcs.filter((p) => p.dtls === "connected").length}/${pcs.length}`).join(", "),
  )

  // What goes on the wire is SFrame, byte for byte.
  const emissores = sframe.flat().filter((r) => r.papel === "emissor")
  /*
   * This metric was called "has an encrypter", but it measured no encryption at all-
   * it counted frames going out, which go out the same way with encryption off. It
   * was renamed to match what it actually measures. The job of "encrypt" belongs to
   * the next check, which reads the header in the bytes.
   */
  verificar(
    "há emissor a pôr frames no fio dos dois lados",
    emissores.length === 2 && emissores.every((e) => e.saida > 0),
    emissores.map((e) => e.saida).join(", ") || "nenhum",
  )
  verificar(
    "tudo o que sai para o fio traz cabeçalho SFrame",
    emissores.length > 0 && emissores.every((e) => e.saida > 0 && e.semCabecalho === 0),
    emissores.map((e) => `${e.saida - e.semCabecalho}/${e.saida}`).join(", "),
  )

  // And on the other side it opens.
  const receptores = sframe.flat().filter((r) => r.papel === "receptor")
  verificar(
    "há receptor dos dois lados: o SFU encaminhou",
    receptores.length === 2 && receptores.every((r) => r.entrada > 0),
    receptores.map((r) => r.entrada).join(", ") || "nenhum",
  )
  verificar(
    "os frames que chegam DECIFRAM",
    receptores.length > 0 && receptores.every((r) => r.entrada > 0 && r.saida > 0),
    receptores.map((r) => `${r.saida}/${r.entrada}`).join(", "),
  )
  verificar(
    "e não há frames recusados",
    receptores.length > 0 && receptores.every((r) => r.recusados === 0),
    receptores.map((r) => r.recusados).join(", "),
  )

  // The second measurement, independent of the first: this is sound, not bytes.
  const pacotes = stats.map((pcs) => somaEntradas(pcs, "pacotes"))
  verificar("chegaram pacotes RTP", pacotes.length > 0 && pacotes.every((n) => n > 0), pacotes.join(", "))

  /*
   * And this is SOUND, not bytes.
   *
   * What comes out of decryption goes to a `AudioDecoder` from WebCodecs: if it
   * decodes, it is real Opus; if it has energy, it is sound and not encoded silence.
   * It proves more than `getStats()`, which proves nothing here, because Chrome
   * without audio output never pulls the track, and it proves more than "it arrived":
   * a packet that crosses the SFU proves transport, a frame that DECODES proves
   * transport, key and format.
   */
  verificar(
    "o que sai da decifra é Opus a sério, e descodifica",
    receptores.length === 2 && receptores.every((r) => r.amostrasDescodificadas > 0 && !r.erroDoDescodificador),
    receptores
      .map((r) => r.erroDoDescodificador ?? `${r.amostrasDescodificadas} amostras (${r.vaziosDescartados} vazios)`)
      .join(", "),
  )
  verificar(
    "e traz som, e não silêncio",
    receptores.length === 2 && receptores.every((r) => r.rms > 0.01),
    receptores.map((r) => r.rms.toFixed(4)).join(", "),
  )

  // The other half of "can you hear it": the app took the stream and played it.
  const caixas = []
  for (const cliente of [a, b]) caixas.push(await lerCaixas(cliente.page))
  const alheias = caixas.map((lista) => lista.filter((caixa) => !caixa.nossa))
  verificar(
    "o produto pôs a voz do outro numa caixa, e a caixa está a tocar",
    alheias.length === 2 &&
      alheias.every((lista) => lista.length === 1 && lista[0].aTocar && lista[0].faixas?.[0] === "live:true"),
    caixas.map((lista) => lista.map((c) => `${c.nossa ? "nossa" : "dele"}:${c.aTocar ? "toca" : "parada"}`).join("+")).join("  ·  "),
  )

  // ----------------------------------- 2. the third joins, and the epoch advances

  console.log("\n   a terceira entra no CANAL, com a chamada a decorrer...")
  const chavesAntes = receptores.map((r) => r.ordemDasChaves)
  const terceira = await assentar(a, c, SALA)
  verificar("a terceira entra mesmo no canal, a meio da chamada", terceira)

  await dormir(15_000)
  for (const cliente of [a, b]) await marcar(cliente.page, "depois-da-entrada")

  const sframeDepois = []
  for (const cliente of [a, b]) sframeDepois.push(await lerSframe(cliente.page))
  const receptoresDepois = sframeDepois.flat().filter((r) => r.papel === "receptor")
  const emissoresDepois = sframeDepois.flat().filter((r) => r.papel === "emissor")

  for (const [indice, r] of receptoresDepois.entries()) {
    console.log(
      `   receptor ${indice}: cifrados ${JSON.stringify(r.cifradosPorChave)} · abertos ${JSON.stringify(r.abertosPorChave)}` +
        `  atrasados da chave anterior ${r.atrasadosDaChaveAnterior}  maior silêncio ${r.maiorIntervaloDeSaida} ms`,
    )
  }

  /*
   * Without two keys there is no window to prove.
   *
   * This check exists to prevent the next one from passing by accident: if
   * the third's entry had not advanced the epoch, receivers would see ONE
   * `keyId` from start to finish, the audio would never interrupt, and "it
   * didn't cut" would be true about something that never happened.
   */
  /*
   * Both require `semCabecalho === 0`, and for the usual reason.
   *
   * In a race with encryption off, the `keyId` values read from clear Opus are
   * noise, and noise changes: both checks started saying "the epoch advanced"
   * and "moved to the new key" about a call that had no key at all. A reading
   * of form that is not backed by "everything that passed had this form" asserts
   * nothing.
   */
  const chavesDepois = receptoresDepois.map((r) => r.ordemDasChaves)
  verificar(
    "a epoch avançou: cada receptor viu DUAS chaves no fio",
    chavesDepois.length === 2 &&
      chavesDepois.every((chaves) => chaves.length === 2) &&
      receptoresDepois.every((r) => r.semCabecalho === 0),
    chavesDepois.map((chaves, i) => `${chavesAntes[i]?.join("+") ?? "?"} → ${chaves.join("+")}`).join("  ·  "),
  )
  verificar(
    "e os emissores passaram à chave nova",
    emissoresDepois.length === 2 &&
      emissoresDepois.every((e) => e.ordemDasChaves.length === 2 && e.semCabecalho === 0),
    emissoresDepois.map((e) => `${e.ordemDasChaves.join("+")} (${e.semCabecalho} sem cabeçalho)`).join("  ·  "),
  )

  /*
   * THE WINDOW, measured where it exists.
   *
   * The two-key window only matters when frames from the OLD key arrive after
   * the new one is already running, both sides rotate when each one receives
   * the commit, never at the same instant. If no old frame arrived late, "decoded
   * everything" would be true about a clean rotation, which is not the hard case
   * and not what the window exists to hold.
   *
   * So these are two statements, not one: that old frames arrived, and that they
   * OPENED. The mark on the frame object is what enables the second, without it,
   * you only knew how many opened in total.
   */
  /*
   * `semCabecalho === 0` is part of the question, not just caution.
   *
   * Without it, this check passed in a race with encryption OFF: the first eleven
   * bytes of a clear Opus frame sometimes look like a header, and the invented
   * `keyId` values that come out of it change frame to frame, read as "the epoch
   * keeps rotating" and as "there are late frames". A reading of form never decides
   * anything on its own; what decides is the AES-GCM tag, and the next check asks it.
   */
  verificar(
    "chegaram frames da chave ANTERIOR depois de NÓS rodarmos — a janela foi exercida",
    receptoresDepois.length === 2 &&
      receptoresDepois.every((r) => r.atrasadosDaChaveAnterior > 0 && r.semCabecalho === 0),
    receptoresDepois.map((r) => `${r.atrasadosDaChaveAnterior} (${r.semCabecalho} sem cabeçalho)`).join(", "),
  )
  verificar(
    "e as DUAS chaves abriram: nenhuma ficou por decifrar",
    receptoresDepois.length === 2 &&
      receptoresDepois.every((r) => {
        const chaves = Object.keys(r.cifradosPorChave)
        return chaves.length === 2 && chaves.every((chave) => (r.abertosPorChave[chave] ?? 0) > 0)
      }),
    receptoresDepois
      .map((r) =>
        Object.keys(r.cifradosPorChave)
          .map((chave) => `${chave}: ${r.abertosPorChave[chave] ?? 0}/${r.cifradosPorChave[chave]}`)
          .join(" "),
      )
      .join("  ·  "),
  )

  /*
   * And the audio did not cut.
   *
   * The final count does not respond to this: it goes up the same way after two seconds
   * of silence. What does respond is the longest gap between two consecutive outputs.
   * Opus frames leave 20 em 20 ms; half a second is twenty-five
   * frames, which sounds like a cut. The cap is 500 ms.
   */
  /*
   * And it requires that there WAS audio AFTER the entry.
   *
   * "Longest silence: 0 ms" is what this check said in a race where the receiver
   * never opened a single frame, without two outputs there is no gap between them,
   * and zero passes below any limit. It is the same family as `every()` on an empty
   * list that already cost three checks in this repository: a measurement that
   * measured nothing cannot assert anything.
   *
   * Fifteen seconds at 20 ms per frame is 750; we require half, which is slack
   * for startup and for what the network ate.
   */
  const saidaDepoisDaEntrada = receptoresDepois.map(
    (r) => r.saida - (r.marcas.find((m) => m.nome === "antes-da-entrada")?.saida ?? 0),
  )
  verificar(
    "o áudio NÃO CORTOU na rotação",
    receptoresDepois.length === 2 &&
      saidaDepoisDaEntrada.every((n) => n > 350) &&
      receptoresDepois.every((r) => r.maiorIntervaloDeSaida < 500),
    receptoresDepois.map((r, i) => `${saidaDepoisDaEntrada[i]} frames, maior silêncio ${r.maiorIntervaloDeSaida} ms`).join("  ·  "),
  )

  // ------------------------------------------- 3. the server's bandwidth limit
  //
  // The number comes from the server and reaches the client via congestion control: the
  // `BANDA_DE_ENTRADA_POR_TRANSPORTE` from `media.ts` is applied with
  // `setMaxIncomingBitrate` on the SEND transport, not the receive transport. Whether
  // it BITES, whether it slows down whoever tries to send too much, is another
  // question, and is measured in `tecto.mjs`.
  /*
   * The number comes from the SERVER MODULE, not written here.
   *
   * It was 128 000 by hand, and Phase 3 raised it to cover the screen and the camera, and this
   * check started to fail with the whole app working, saying the limit was not reaching
   * the client when what had changed was the limit. A number copied is a number that diverges.
   */
  const bandas = stats.map((pcs) => pcs.filter((pc) => pc.dtls === "connected").map((pc) => pc.bandaDeSaida))
  verificar(
    "o tecto do servidor chegou ao cliente, e só ao transporte de envio",
    bandas.length === 2 &&
      bandas.every(
        (par) => par.includes(BANDA_DE_ENTRADA_POR_TRANSPORTE) && !par.every((n) => n === BANDA_DE_ENTRADA_POR_TRANSPORTE),
      ),
    bandas.map((par) => par.join("/")).join("  ·  "),
  )
} finally {
  for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
  matarTudo()
  rmSync(dados, { recursive: true, force: true })
  rmSync(perfis, { recursive: true, force: true })
}

const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length ? 0 : 1)
