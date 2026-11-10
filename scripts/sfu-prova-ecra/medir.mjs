/**
 * Screen sharing pixelation, measured: two browsers and a local SFU.
 *
 *   node scripts/sfu-prova-ecra/medir.mjs
 *   CIFRAS=antiga,nova EPOCAS=41,300 PERDA=0.02 SEGUNDOS=20 node scripts/sfu-prova-ecra/medir.mjs
 *
 * One browser shares a "screen" drawn on a canvas, with the product cipher;
 * the other starts seeing DELAY seconds later, like someone joining the room
 * or clicking "view". Never talks to production. Own ports (8464, 44340).
 *
 * Each run outputs a line with:
 *  - SFU keyframes: how many packets mediasoup judged as keyframe start
 *    on consume, after resuming (trace `keyframe`), against frames that
 *    actually were keyframes;
 *  - 1st keyframe: how long after resuming the first TRUE keyframe reached the
 *    decoder, and how many differential frames passed it (each applied to a
 *    frame that does not exist);
 *  - Chrome gets it wrong: frames where Chrome's unpacker `type` disagrees
 *    with the VP8 bit;
 *  - PLI: keyframe requests sent by the receiver and received by the sender;
 *    keyframes encoded by the sender during the run;
 *  - error: average difference (0 to 255) between the fixed zone received and
 *    the original, at the end. A good image stays close to zero.
 */
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright"

const AQUI = fileURLToPath(new URL(".", import.meta.url))
const REPO = fileURLToPath(new URL("../..", import.meta.url))
const PORTO_HTTP = Number(process.env.PROVA_PORTO_HTTP ?? 8464)
const PORTO_MEDIA = Number(process.env.PROVA_PORTO_MEDIA ?? 44340)
const SEGUNDOS = Number(process.env.SEGUNDOS ?? 15)
const ATRASO = Number(process.env.ATRASO ?? 5)
const PERDA = Number(process.env.PERDA ?? 0)
const CIFRAS = (process.env.CIFRAS ?? "nenhuma,antiga,nova").split(",")
const EPOCAS = (process.env.EPOCAS ?? "41,300").split(",").map(Number)
const CHAVE_MS = Number(process.env.CHAVE_MS ?? 0)
const CAPTURAS = `${REPO}.verify-data/sfu-prova-ecra`
mkdirSync(CAPTURAS, { recursive: true })

await build({
  entryPoints: [`${AQUI}pagina.js`],
  outfile: `${CAPTURAS}/pagina.bundle.js`,
  bundle: true,
  format: "esm",
  target: "chrome120",
  logLevel: "error",
})

const bancada = spawn(process.execPath, [`${AQUI}bancada.mjs`], {
  env: { ...process.env, PROVA_PACOTE: `${CAPTURAS}/pagina.bundle.js`, PROVA_CHAVE_MS: String(CHAVE_MS), PROVA_PORTO_HTTP: String(PORTO_HTTP), PROVA_PORTO_MEDIA: String(PORTO_MEDIA) },
  stdio: ["ignore", "pipe", "pipe"],
})
// An orphaned testbed from a crashed run keeps the port and answers in place of
// the new one, with different options: the measurement would measure the wrong
// testbed.
process.on("exit", () => bancada.kill("SIGTERM"))
bancada.on("exit", (codigo) => {
  if (codigo) console.log(`a bancada saiu com ${codigo} (porto ${PORTO_HTTP} ocupado?)\n${registoDaBancada.join("")}`)
})
const registoDaBancada = []
bancada.stdout.on("data", (d) => registoDaBancada.push(String(d)))
bancada.stderr.on("data", (d) => registoDaBancada.push(String(d)))

async function esperarPorHttp(url, limite = 20_000) {
  const fim = Date.now() + limite
  while (Date.now() < fim) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not yet
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`a bancada não abriu: ${url}\n${registoDaBancada.join("")}`)
}
await esperarPorHttp(`http://127.0.0.1:${PORTO_HTTP}/pagina.html`)

const FLAGS = ["--autoplay-policy=no-user-gesture-required"]

async function abrir(papel, cifra, epoca) {
  const browser = await chromium.launch({ headless: true, args: FLAGS })
  const pagina = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const url = new URL(`http://127.0.0.1:${PORTO_HTTP}/pagina.html`)
  for (const [k, v] of Object.entries({ papel, cifra, epoca, perda: PERDA, atraso: ATRASO })) url.searchParams.set(k, String(v))
  pagina.on("pageerror", (erro) => console.log(`[${papel}] ${erro.message}`))
  await pagina.goto(url.href, { waitUntil: "domcontentloaded" })
  return { browser, pagina }
}

const linhas = []
for (const cifra of CIFRAS) {
  for (const epoca of cifra === "nenhuma" ? [EPOCAS[0]] : EPOCAS) {
    const emissor = await abrir("emissor", cifra, epoca)
    await emissor.pagina.waitForFunction(() => window.__medida?.pronto || window.__medida?.erro, null, { timeout: 30_000 })
    const receptor = await abrir("receptor", cifra, epoca)
    await receptor.pagina.waitForFunction(() => window.__medida?.pronto || window.__medida?.erro, null, {
      timeout: 30_000 + ATRASO * 1000,
    })
    await receptor.pagina.waitForTimeout(SEGUNDOS * 1000)

    const r = await receptor.pagina.evaluate(() => window.__medida)
    const e = await emissor.pagina.evaluate(() => window.__medida)
    const { rasto } = await receptor.pagina.evaluate(() => window.__pedir("rasto"))
    await receptor.pagina.screenshot({ path: `${CAPTURAS}/${cifra}-${epoca}-perda${PERDA}-chave${CHAVE_MS}.png` })
    await receptor.browser.close()
    await emissor.browser.close()

    if (r.erro || e.erro) {
      console.log(`ERRO ${cifra}/${epoca}: ${r.erro ?? e.erro}`)
      continue
    }
    const depois = (lista) => lista.filter((x) => x.t >= r.retomadoNoServidor)
    const chavesNoSfu = depois(rasto.consumo).filter((x) => x.tipo === "keyframe").length
    const plisNoSfu = depois(rasto.consumo).filter((x) => x.tipo === "pli" || x.tipo === "fir").length
    const plisParaOEmissor = depois(rasto.produtor).filter((x) => (x.tipo === "pli" || x.tipo === "fir") && x.sentido === "out").length
    const recebidos = r.fotogramas.filter((f) => f.eChave !== undefined && f.t >= r.retomado)
    const primeira = recebidos.findIndex((f) => f.eChave)
    const engano = recebidos.filter((f) => f.chromeJulgaChave !== f.eChave).length
    const fimR = r.amostras.at(-1) ?? {}
    const enviadosDurante = e.fotogramas.filter((f) => f.t >= r.retomado)
    const chavesEnviadas = enviadosDurante.filter((f) => f.chave)
    const erros = r.amostras.filter((a) => a.erro !== null).map((a) => a.erro)
    const linha = {
      cifra,
      epoca,
      perda: PERDA,
      chaveMs: CHAVE_MS,
      segundos: SEGUNDOS,
      chavesNoSfu,
      chavesVerdadeirasRecebidas: recebidos.filter((f) => f.eChave).length,
      fotogramasRecebidos: recebidos.length,
      primeiraChaveMs: primeira >= 0 ? recebidos[primeira].t - r.retomado : null,
      diferenciaisAntes: primeira >= 0 ? primeira : recebidos.length,
      chromeEngana: engano,
      plisEnviadosPeloReceptor: fimR.plisEnviados,
      plisNoConsumoSfu: plisNoSfu,
      plisDoSfuAoEmissor: plisParaOEmissor,
      plisRecebidosPeloEmissor: e.amostras.at(-1)?.plisRecebidos,
      chavesCodificadasNaCorrida: chavesEnviadas.length,
      tamanhoMedioDaChave: chavesEnviadas.length ? Math.round(chavesEnviadas.reduce((s, f) => s + f.bytes, 0) / chavesEnviadas.length) : null,
      chavesDescodificadas: fimR.chavesDescodificadas,
      descodificados: fimR.descodificados,
      resolucao: fimR.resolucao,
      envio: `${e.amostras.at(-1)?.resolucao} ${e.amostras.at(-1)?.limite}`,
      erroNoFim: erros.at(-1) ?? null,
      erroMaximo: erros.length ? Math.max(...erros) : null,
      erros: erros.join(" "),
    }
    if (process.env.RASTO) console.log(JSON.stringify(rasto.produtor.filter((x) => x.tipo !== "keyframe").map((x) => ({ ...x, t: x.t - r.retomadoNoServidor }))))
    linhas.push(linha)
    console.log(JSON.stringify(linha))
  }
}

bancada.kill("SIGTERM")
console.log(`\ncapturas em ${CAPTURAS}`)
