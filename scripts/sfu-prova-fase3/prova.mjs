/**
 * Phase 3 of the SFU: VIDEO passing through the engine, encrypted, measured in the product.
 *
 * Phase 2 proved audio passes through this path, 823 frames received,
 * 823 decrypted, and left written what remained: "screen share
 * and camera do not exist in this path; `#anunciarPorSfu` returns `screen:
 * null` on purpose". This measures what now exists, with the same rigor and the
 * same subject: the product. `apps/web` on `vite`, the homeserver with the
 * media engine, accounts created from the UI, an invite accepted from the
 * UI, the voice room clicked in the sidebar, and the share button pressed like a person presses it.
 *
 * ```
 * node scripts/sfu-prova-fase3/prova.mjs
 * SABOTAGEM=<nome> node scripts/sfu-prova-fase3/prova.mjs
 * ```
 *
 * **Sabotages are not optional.** A check that never failed is not a check, it is a sentence. Each one breaks a different link and MUST
 * make this exit with 1:
 *
 *   sem-cifra       the VIDEO sender's cipher is disabled in the browser. VP8
 *                   goes clear on the wire: nothing opens on the other side and what comes out
 *                   has no SFrame header.
 *   bytes-trocados  one payload byte swapped at arrival, AFTER the header.
 *                   The frame still looks like an SFrame; the AES-GCM
 *                   tag no longer checks. Separates "looks like" from "opens".
 *   sem-fonte       the product stops saying the stream is a screen. The server
 *                   reads the `kind` and calls it camera, and on the other side the image goes
 *                   to the person's card instead of the main panel, which is the
 *                   entire feature of this phase failing silently.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb, PORTA_SFU, PORTA_WEB, RAIZ, SERVIDOR } from "../sfu-prova-fase2/bancada.mjs"
import { LER_ESTATISTICAS, LER_PALCO, LER_SFRAME } from "./instrumento.mjs"
import { abrirCanal, abrirConta, assentar, criarCanal, entrarNaChamada, partilharEcra, pararEcra } from "./montagem.mjs"

const SABOTAGEM = process.env.SABOTAGEM ?? ""
const SALA = `sfu3 ${Date.now().toString(36)}`
const MOTOR = join(RAIZ, "packages/client-core/src/call-sfu.ts")

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const lerSframe = (page) => page.evaluate(LER_SFRAME)
const lerEstatisticas = (page) => page.evaluate(LER_ESTATISTICAS)
const lerPalco = (page) => page.evaluate(LER_PALCO)
const marcar = (page, nome) => page.evaluate((n) => window.__marcar?.(n), nome)

const soma = (estatisticas, lado, campo) =>
  estatisticas.reduce((total, pc) => total + pc[lado].reduce((s, linha) => s + (linha[campo] ?? 0), 0), 0)

/**
 * The sabotage that lives in the SOURCE, not in the browser.
 *
 * The other two break from outside, on the side of the cipher pipes. This is
 * about what the product TELLS the server, and the only place to break that
 * without faking it is the line that says it. Applied, recompiled, and restored
 * in the `finally`-like the mutation test suites do.
 */
let fonteOriginal = null
function sabotarAFonte() {
  fonteOriginal = readFileSync(MOTOR, "utf8")
  const alvo = "      appData: { fonte },"
  if (!fonteOriginal.includes(alvo)) {
    console.error("FALHA  a sabotagem `sem-fonte` não encontrou o alvo — o motor mudou por baixo dela")
    process.exit(1)
  }
  writeFileSync(MOTOR, fonteOriginal.replace(alvo, "      appData: {},"))
  if (spawnSync("npx", ["tsc", "-b"], { cwd: RAIZ, encoding: "utf8" }).status !== 0) {
    console.error("FALHA  a sabotagem não compila, e por isso não se mede nada")
    process.exit(1)
  }
}

function reporAFonte() {
  if (fonteOriginal === null) return
  writeFileSync(MOTOR, fonteOriginal)
  spawnSync("npx", ["tsc", "-b"], { cwd: RAIZ, encoding: "utf8" })
}

const dados = mkdtempSync(join(tmpdir(), "orwell-sfu-fase3-"))
const perfis = mkdtempSync(join(tmpdir(), "orwell-sfu3-perfis-"))
let clientes = []

try {
  console.log(`== Fase 3: a imagem a atravessar o SFU${SABOTAGEM ? `  [SABOTAGEM=${SABOTAGEM}]` : ""}`)

  if (SABOTAGEM === "sem-fonte") sabotarAFonte()

  if (!(await levantarServidor(dados))) {
    console.error("FALHA  o homeserver não subiu")
    process.exit(1)
  }
  if (!(await levantarWeb())) {
    console.error("FALHA  o vite não subiu")
    process.exit(1)
  }
  console.log(`   homeserver ${SERVIDOR}  ·  sfu ${PORTA_SFU}  ·  app ${PORTA_WEB}`)

  // --------------------------------------------------------------- montagem

  for (const indice of [0, 1]) {
    clientes.push(
      await abrirConta(APP, { nome: `ecra ${indice}`, frase: FRASE, indice, perfil: perfis, sabotagem: SABOTAGEM }),
    )
  }
  const [a, b] = clientes

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

  await dormir(3000)
  for (const cliente of [a, b]) await marcar(cliente.page, "antes-da-partilha")

  // ------------------------------------------------- 1. partilhar, e ver

  const carregou = await partilharEcra(a.page)
  verificar("o botão de partilhar EXISTE numa chamada por SFU, e carrega-se", carregou)
  if (!carregou) {
    console.error("\nSem partilha não há imagem a medir. O resto da corrida mediria o vazio.")
    process.exit(1)
  }

  console.log("   a partilhar 15 s...")
  await dormir(15_000)

  const sframe = []
  const stats = []
  for (const cliente of [a, b]) {
    sframe.push(await lerSframe(cliente.page))
    stats.push(await lerEstatisticas(cliente.page))
  }

  const emissorDeVideo = sframe[0].filter((r) => r.papel === "emissor" && r.tipo === "video")
  const receptorDeVideo = sframe[1].filter((r) => r.papel === "receptor" && r.tipo === "video")
  const receptorDeAudio = sframe[1].filter((r) => r.papel === "receptor" && r.tipo === "audio")

  for (const [nome, lista] of [
    ["emissor de vídeo (quem partilha)", emissorDeVideo],
    ["receptor de vídeo (quem vê)", receptorDeVideo],
  ]) {
    for (const r of lista) {
      console.log(
        `   ${nome}: entrada ${r.entrada}, saída ${r.saida}, recusados ${r.recusados}` +
          `  ·  keyframes ${r.keyframes}  ·  imagens ${r.imagens} (${r.largura}x${r.altura})` +
          `  ·  sem cabeçalho ${r.semCabecalho}  ·  maior intervalo ${r.maiorIntervaloDeSaida} ms`,
      )
    }
  }

  /*
   * The path is the SFU's, and the image goes through it.
   *
   * Counting connections is not enough: `mediasoup-client` opens and CLOSES two
   * probing `RTCPeerConnection`s before negotiating. The ones that matter are the
   * ones that closed DTLS-two per client, send and receive-and they stay at two
   * with the share passing, which is the half that only a renegotiation on an
   * existing transport can give. With mesh, sharing to two was two connections;
   * with SFU it is the same.
   */
  const vivos = stats.map((pcs) => pcs.filter((pc) => pc.dtls === "connected"))
  verificar(
    "a partilha não abriu ligação nenhuma: continuam dois transportes por cliente",
    vivos.length === 2 && vivos.every((pcs) => pcs.length === 2),
    stats.map((pcs) => `${pcs.filter((p) => p.dtls === "connected").length}/${pcs.length}`).join(", "),
  )

  verificar(
    "há emissor de VÍDEO a pôr frames no fio",
    emissorDeVideo.length === 1 && emissorDeVideo[0].saida > 0,
    emissorDeVideo.map((e) => e.saida).join(", ") || "nenhum",
  )
  verificar(
    "tudo o que sai do ecrã para o fio traz cabeçalho SFrame",
    emissorDeVideo.length === 1 && emissorDeVideo[0].saida > 0 && emissorDeVideo[0].semCabecalho === 0,
    emissorDeVideo.map((e) => `${e.saida - e.semCabecalho}/${e.saida}`).join(", "),
  )
  verificar(
    "e o que se cifra são imagens a sério: há keyframes entre os frames",
    emissorDeVideo.length === 1 && emissorDeVideo[0].keyframes > 0,
    emissorDeVideo.map((e) => `${e.keyframes} keyframes em ${e.saida}`).join(", "),
  )

  verificar(
    "do outro lado chega vídeo: o SFU encaminhou a imagem",
    receptorDeVideo.length === 1 && receptorDeVideo[0].entrada > 0,
    receptorDeVideo.map((r) => r.entrada).join(", ") || "nenhum",
  )
  verificar(
    "os frames de vídeo que chegam DECIFRAM",
    receptorDeVideo.length === 1 && receptorDeVideo[0].entrada > 0 && receptorDeVideo[0].saida > 0,
    receptorDeVideo.map((r) => `${r.saida}/${r.entrada}`).join(", "),
  )
  verificar(
    "e não há frames de vídeo recusados",
    receptorDeVideo.length === 1 && receptorDeVideo[0].recusados === 0,
    receptorDeVideo.map((r) => r.recusados).join(", "),
  )

  /*
   * And this is IMAGE, not bytes.
   *
   * What comes out of decryption goes to a VP8 `VideoDecoder`: if it decodes to
   * `VideoFrame`s with width and height, it is real video encrypted with the
   * epoch key and opened with it. It is the same ladder as Phase 2-a packet
   * proves transport, a frame that decodes proves transport, key, and format.
   */
  verificar(
    "o que sai da decifra é VP8 a sério, e descodifica em imagens",
    receptorDeVideo.length === 1 && receptorDeVideo[0].imagens > 0 && !receptorDeVideo[0].erroDoDescodificador,
    receptorDeVideo
      .map((r) => r.erroDoDescodificador ?? `${r.imagens} imagens de ${r.largura}x${r.altura}`)
      .join(", "),
  )
  verificar(
    "e as imagens têm o tamanho de um ecrã, e não de um ícone",
    receptorDeVideo.length === 1 && receptorDeVideo[0].largura >= 640 && receptorDeVideo[0].altura >= 360,
    receptorDeVideo.map((r) => `${r.largura}x${r.altura}`).join(", "),
  )

  // The second measurement, independent of the first: what Chrome counted.
  const pacotes = soma(stats[1], "entrada", "pacotes")
  const descodificados = soma(stats[1], "entrada", "frames")
  verificar("o `getStats()` de quem vê contou pacotes e frames de vídeo", pacotes > 0 && descodificados > 0, `${pacotes} pacotes, ${descodificados} frames`)

  // Voice did not stop because of the image: sharing is not hanging up the call.
  verificar(
    "a voz continuou a passar durante a partilha",
    receptorDeAudio.length === 1 && receptorDeAudio[0].saida > 200,
    receptorDeAudio.map((r) => `${r.saida} frames`).join(", "),
  )

  // ------------------------------------------------- 2. o produto desenha-o

  const palco = await lerPalco(b.page)
  verificar(
    "o produto pôs o ecrã no PALCO, e não no cartão da pessoa",
    palco.length === 1 && palco[0].aTocar && palco[0].faixas?.[0] === "live:true",
    palco.length === 0 ? "palco vazio" : palco.map((p) => `${p.largura}x${p.altura} ${p.aTocar ? "toca" : "parado"}`).join(", "),
  )
  verificar(
    "e o elemento do palco tem imagem com dimensão, e não um rectângulo preto",
    palco.length === 1 && palco[0].largura > 0 && palco[0].altura > 0,
    palco.map((p) => `${p.largura}x${p.altura}`).join(", "),
  )

  // -------------------------------------------- 3. parar, e o palco esvazia

  const parou = await pararEcra(a.page)
  verificar("o botão de parar existe e carrega-se", parou)
  await dormir(3000)

  const palcoDepois = await lerPalco(b.page)
  verificar(
    "parar de partilhar TIRA o ecrã do palco de quem estava a ver",
    palcoDepois.length === 0,
    `${palcoDepois.length} elementos no palco`,
  )

  /*
   * Voice after sharing, and the defensive read is not over-caution.
   *
   * In a sabotaged run there is no video receiver at all, and reading `[0].entrada`
   * from an empty list breaks the script halfway-erasing the final count and making
   * a sabotage that worked look like a broken script.
   */
  const sframeDepois = await lerSframe(b.page)
  const audioDepois = sframeDepois.filter((r) => r.papel === "receptor" && r.tipo === "audio")
  const vozAntes = receptorDeAudio[0]?.saida ?? 0
  verificar(
    "e a chamada continua: a voz não parou com o ecrã",
    audioDepois.length === 1 && audioDepois[0].saida > vozAntes,
    `${vozAntes} → ${audioDepois[0]?.saida ?? 0} frames de voz`,
  )

  // ------------------------------- 4. the server has no key, and did not ask for it

  /*
   * The same read that Phase 0 did to its lab server, now to the product engine.
   * It is not a cryptographic proof-what proves the server opens nothing is the
   * decryption working on the other side, with the key that only clients derive-
   * but it is the audit that keeps a key from entering here by distraction, and
   * it is cheap: the file has fewer than a thousand lines.
   */
  const motorDoServidor = readFileSync(join(RAIZ, "apps/server/src/media.ts"), "utf8")
  const palavrasDeChave = ["sframe", "exporter", "mediaKey", "decrypt", "importKey", "SframeReceiver"]
  const encontradas = palavrasDeChave.filter((palavra) =>
    new RegExp(`\\b${palavra}\\b`, "i").test(motorDoServidor.replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "")),
  )
  verificar(
    "o motor de media do servidor não tem uma linha de código sobre chaves",
    encontradas.length === 0,
    encontradas.length === 0 ? "nenhuma das seis palavras, fora dos comentários" : `encontradas: ${encontradas.join(", ")}`,
  )
} catch (erro) {
  // Said, and never swallowed: a script that dies silently sends you looking for
  // the fault in the product when it is here.
  console.error(`\nFALHA  a corrida rebentou: ${erro?.stack ?? erro}`)
  resultados.push({ etiqueta: "a corrida chegou ao fim", ok: false })
} finally {
  for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
  matarTudo()
  reporAFonte()
  /*
   * `maxRetries` because Chromium is still writing to the profile when the
   * context closes, and an ENOTEMPTY here would erase the real error message
   * under a cleanup error. It happened on the first run.
   */
  const limpar = (pasta) => rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  limpar(dados)
  limpar(perfis)
}

const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length ? 0 : 1)
