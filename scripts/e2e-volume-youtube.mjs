/**
 * Two changes the owner requested on 2 November 2026, live.
 *
 *   node scripts/e2e-volume-youtube.mjs      (needs `npm run build` first)
 *
 * 1. **Volume slider** in the menu of a person on a call. Dragging changes the
 *    volume as you drag (read from `localStorage` before releasing), the menu
 *    stays open, arrow keys and double-click work, the "100 %" button resets to
 *    normal. With a finger (touch emulated at 390 px) the cursor and button are
 *    44 px tall and dragging with a finger also changes volume.
 * 2. **YouTube thumbnail** opens the video outside. In Chromium: a new tab with
 *    the video URL, nothing inside the page. In the desktop app: `shell.openExternal`
 *    with the URL, no new window. Reading the conversation cold makes no requests
 *    to Google, and both policies deny a YouTube `iframe` (`frame-src 'none'`).
 *
 * Ana is in the desktop app (the real `apps/client/out`, see `secretaria.mjs`),
 * Bruno in Chromium. Disposable homeserver on ports 8496 and 8497
 * (`servidor-descartavel.mjs`). Bruno posts the video: title and thumbnail come
 * from the homeserver, which needs Internet for oEmbed.
 *
 * Screenshots in `capturas/volume-barra-*.png` and `capturas/youtube-miniatura-*.png`.
 */
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar } from "./convite.mjs"
import { abrirCanal, ate, contasDoServidor, criarCanal, dentro, entrarNaVoz, espera, portaoPronto, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor, RAIZ } from "./servidor-descartavel.mjs"

const FRASE = "frase-de-verificacao-2026"
// Big Buck Bunny: a video with thumbnail and oEmbed always available.
const VIDEO_ID = "aqz-KE-bpKQ"
const VIDEO = `https://www.youtube.com/watch?v=${VIDEO_ID}`
const CAPTURAS = join(RAIZ, "capturas")
mkdirSync(CAPTURAS, { recursive: true })
mkdirSync(join(RAIZ, ".verify-data"), { recursive: true })

const { check, resumo } = verificador()

const CASA_DO_GOOGLE =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|google\.com|gstatic\.com|googleapis\.com|doubleclick\.net)$/i
const paraGoogle = (url) => {
  try {
    return CASA_DO_GOOGLE.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Volume stored per URL, 0 to 2; `1` when there's no value. */
const volumeGuardado = (page, endereco) =>
  page.evaluate((quem) => {
    const lista = JSON.parse(localStorage.getItem("enclave.volumes") ?? "[]")
    const par = lista.find(([e]) => e === quem)
    return par ? par[1] : 1
  }, endereco)

/** Put a YouTube `iframe` on the page and say if policy blocked it. */
const politicaRecusaIframe = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const quando = (evento) => {
          if (/frame-src|child-src/.test(evento.violatedDirective)) {
            document.removeEventListener("securitypolicyviolation", quando)
            resolve(evento.violatedDirective)
          }
        }
        document.addEventListener("securitypolicyviolation", quando)
        const moldura = document.createElement("iframe")
        moldura.src = "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ"
        moldura.style.display = "none"
        document.body.appendChild(moldura)
        setTimeout(() => {
          moldura.remove()
          resolve(null)
        }, 3000)
      }),
  )

const srv = await levantarServidor({ frente: 8496, servidor: 8497, etiqueta: "volume-youtube" })
console.log(`servidor ${srv.NOME}`)
let browser
let sec
async function arrumar(codigo) {
  await sec?.fechar().catch(() => {})
  await browser?.close().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

try {
  // ---------------------------------------------------------------- as contas
  sec = await abrirSecretaria({ rotulo: "secretaria" })
  const ana = sec.page
  await portaoPronto(ana)
  await criarConta(ana, { nome: "Ana", frase: FRASE, servidor: srv.NOME })
  await dentro(ana)
  check("a Ana cria conta na app de secretária", true)

  browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  })
  const ctxB = await browser.newContext({ locale: "pt-PT", permissions: ["microphone", "camera"], viewport: { width: 1280, height: 860 } })
  // The tab the thumbnail opens doesn't go to the Internet: the script just wants
  // to know where it goes.
  await ctxB.route(/^https:\/\/(www\.)?youtube\.com\//, (rota) =>
    rota.fulfill({ status: 200, contentType: "text/html", body: "<title>YouTube (guião)</title>" }),
  )
  const bruno = await ctxB.newPage()
  const errosBruno = []
  bruno.on("pageerror", (e) => errosBruno.push(String(e)))
  await bruno.goto(srv.APP, { waitUntil: "domcontentloaded" })
  await criarConta(bruno, { nome: "Bruno", frase: FRASE, servidor: srv.NOME })
  await dentro(bruno)
  check("o Bruno cria conta no Chromium", true)
  const [enderecoAna, enderecoBruno] = contasDoServidor(srv.base)

  await criarCanal(ana, "adega")
  check("a Ana convida o Bruno para o canal adega", await convidar(ana, "adega", enderecoBruno))
  check("o Bruno aceita", await aceitarConvite(bruno, "adega", { espera: 60_000 }))
  await abrirCanal(ana, "adega")
  await abrirCanal(bruno, "adega")
  await espera(1500)

  // ======================================================= 2. a miniatura
  check("a política da web recusa um iframe do YouTube", (await politicaRecusaIframe(bruno)) !== null)
  check("a política da app de secretária também", (await politicaRecusaIframe(ana)) !== null)

  const escrita = bruno.locator('input[placeholder="Escreve uma mensagem"]')
  await escrita.click()
  await escrita.fill(`olha isto ${VIDEO}`)
  const titulado = await bruno
    .locator(".link-attach .link-title")
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false)
  check("escrever o link traz o título, pelo homeserver", titulado)
  await escrita.press("Enter")

  const naAna = ana.locator(".message-body .video-facade").first()
  // `ate` returns milliseconds, or -1 if time ran out: `>= 0` means "arrived".
  // Check the thumbnail on the next line, by `src`.
  check("a mensagem chega à app de secretária com a fachada do vídeo", (await ate(async () => (await naAna.count()) > 0, 60_000)) >= 0)
  const srcAna = await naAna.locator(".facade-thumb").getAttribute("src").catch(() => null)
  check("a miniatura são bytes que vieram na mensagem", String(srcAna).startsWith("data:image/"), String(srcAna).slice(0, 24))
  check("com o sinal de play e o título", (await naAna.locator(".facade-play svg").count()) === 1 && (await naAna.locator(".link-title").count()) === 1)

  // On desktop: the click goes to `shell.openExternal`, no other window.
  await sec.app.evaluate(({ shell }) => {
    globalThis.__abertos = []
    shell.openExternal = async (url) => {
      globalThis.__abertos.push(url)
    }
  })
  const janelasAntes = sec.app.windows().length
  await ana.locator(".message-body .video-facade").first().scrollIntoViewIfNeeded()
  await ana.screenshot({ path: join(CAPTURAS, "youtube-miniatura-secretaria.png") })
  await naAna.click()
  await espera(1500)
  const abertos = await sec.app.evaluate(() => globalThis.__abertos)
  check("secretária: o clique abre o vídeo no browser do sistema", abertos.length === 1 && abertos[0] === VIDEO, JSON.stringify(abertos))
  check("secretária: e não nasce janela nenhuma", sec.app.windows().length === janelasAntes, `${sec.app.windows().length} janelas`)
  check("secretária: nem leitor dentro da app", (await ana.locator("iframe").count()) === 0)
  // And a scheme that isn't web never reaches the system.
  await ana.evaluate(() => window.open("file:///etc/passwd", "_blank"))
  await espera(500)
  const depois = await sec.app.evaluate(() => globalThis.__abertos)
  check("secretária: um link file: não se entrega ao sistema", depois.length === 1, JSON.stringify(depois))

  // In the browser, as READER: the page freshly reloaded.
  await bruno.reload({ waitUntil: "domcontentloaded" })
  const campoFrase = bruno.getByPlaceholder("Palavra-passe")
  await campoFrase.waitFor({ timeout: 30_000 }).catch(() => {})
  if (await campoFrase.count()) {
    await campoFrase.fill(FRASE)
    await bruno.getByRole("button", { name: "Entrar", exact: true }).click()
  }
  await dentro(bruno)
  let pedidos = []
  bruno.on("request", (r) => {
    if (paraGoogle(r.url())) pedidos.push(r.url())
  })
  // Right after reload, the channel name might not have arrived yet and the
  // line shows the URL: opens a line that isn't the common channel.
  const linhaDoCanal = bruno.locator(".channel-name").filter({ hasNotText: "Orwell" }).first()
  await linhaDoCanal.waitFor({ timeout: 60_000 })
  await linhaDoCanal.click()
  await bruno.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
  const noBruno = bruno.locator(".message-body .video-facade").first()
  await noBruno.waitFor({ timeout: 30_000 })
  await espera(2000)
  check("browser: a conversa mostra a miniatura", (await noBruno.count()) === 1)
  check("browser: ler a conversa não pede nada à Google", pedidos.length === 0, pedidos.slice(0, 3).join(" | "))
  check("browser: e não há leitor nenhum", (await bruno.locator("iframe").count()) === 0)
  await noBruno.scrollIntoViewIfNeeded()
  await bruno.screenshot({ path: join(CAPTURAS, "youtube-miniatura-1280.png") })

  const enderecoDaConversa = bruno.url()
  const [separador] = await Promise.all([ctxB.waitForEvent("page", { timeout: 10_000 }), noBruno.click()])
  await separador.waitForLoadState("domcontentloaded").catch(() => {})
  check("browser: o clique abre um separador novo com o vídeo", separador.url() === VIDEO, separador.url())
  check("browser: sem `window.opener` do outro lado", (await separador.evaluate(() => window.opener === null).catch(() => false)) === true)
  check("browser: a conversa fica onde estava, sem leitor", bruno.url() === enderecoDaConversa && (await bruno.locator("iframe").count()) === 0)
  await separador.close()

  await bruno.setViewportSize({ width: 390, height: 844 })
  await espera(1200)
  const medida = await bruno.evaluate(() => {
    const cartao = document.querySelector(".message-body .video-facade")
    return { documento: document.documentElement.scrollWidth, cartao: cartao ? Math.ceil(cartao.getBoundingClientRect().right) : 0 }
  })
  check("a 390 px o documento não anda de lado", medida.documento <= 390, `${medida.documento}px`)
  check("nem a miniatura transborda", medida.cartao > 0 && medida.cartao <= 390, `${medida.cartao}px`)
  await bruno.locator(".message-body .video-facade").first().scrollIntoViewIfNeeded().catch(() => {})
  await bruno.screenshot({ path: join(CAPTURAS, "youtube-miniatura-390.png") })
  await bruno.setViewportSize({ width: 1280, height: 860 })
  await espera(800)

  // ======================================================= 1. the volume bar
  check("a Ana entra na sala de voz", await entrarNaVoz(ana))
  await espera(1000)
  check("o Bruno entra na sala de voz", await entrarNaVoz(bruno))
  const botaoDaAna = bruno.getByRole("button", { name: /^Mais acções sobre Ana$/ }).first()
  check("o Bruno vê o cartão da Ana", (await ate(async () => (await botaoDaAna.count()) > 0, 60_000)) >= 0)

  await botaoDaAna.click()
  const menu = bruno.locator(".context-menu")
  const cursor = menu.getByRole("slider", { name: /^Volume de Ana$/ })
  check("o menu tem a barra do volume com o nome da pessoa", (await cursor.count()) === 1)
  const niveis = await menu.getByRole("menuitem", { name: /Volume \d+ %/ }).count()
  check("e já não tem a fila de níveis fixos", niveis === 0, `${niveis} entradas`)
  check("começa nos 100 %", (await cursor.inputValue()) === "100" && (await menu.locator("output").innerText()) === "100 %")

  // Drag with mouse, read the stored volume BEFORE releasing.
  const caixa = await cursor.boundingBox()
  const meio = { x: caixa.x + caixa.width / 2, y: caixa.y + caixa.height / 2 }
  await bruno.mouse.move(meio.x, meio.y)
  await bruno.mouse.down()
  await bruno.mouse.move(meio.x + caixa.width * 0.15, meio.y, { steps: 6 })
  const aMeio = await volumeGuardado(bruno, enderecoAna)
  await bruno.mouse.move(meio.x + caixa.width * 0.25, meio.y, { steps: 6 })
  const antesDeLargar = await volumeGuardado(bruno, enderecoAna)
  await bruno.mouse.up()
  check("o volume muda enquanto se arrasta, antes de largar", aMeio > 1 && antesDeLargar > aMeio, `${aMeio} e depois ${antesDeLargar}`)
  check("o menu continua aberto depois de arrastar", (await menu.count()) === 1)
  const mostrado = await menu.locator("output").innerText()
  check("o valor ao lado acompanha", mostrado === `${Math.round(antesDeLargar * 100)} %`, mostrado)
  await bruno.screenshot({ path: join(CAPTURAS, "volume-barra-1280.png") })

  await cursor.focus()
  const antesDaSeta = Number(await cursor.inputValue())
  await bruno.keyboard.press("ArrowRight")
  check("a seta para a direita sobe 5 %", Number(await cursor.inputValue()) === antesDaSeta + 5, await cursor.inputValue())
  await bruno.keyboard.press("ArrowLeft")
  check("e a da esquerda desce 5 %", Number(await cursor.inputValue()) === antesDaSeta)

  await cursor.dblclick()
  check("o duplo clique repõe os 100 %", (await cursor.inputValue()) === "100" && (await volumeGuardado(bruno, enderecoAna)) === 1)
  check("sem fechar o menu", (await menu.count()) === 1)

  await cursor.fill("150")
  check("o volume vai aos 150 %", (await volumeGuardado(bruno, enderecoAna)) === 1.5)
  await menu.getByRole("button", { name: "Repor o volume normal, 100 %" }).click()
  check('o botão "100 %" repõe o normal', (await cursor.inputValue()) === "100" && (await volumeGuardado(bruno, enderecoAna)) === 1)
  check("também sem fechar o menu", (await menu.count()) === 1)
  await bruno.keyboard.press("Escape")

  // With a finger, at 390 px.
  await bruno.setViewportSize({ width: 390, height: 844 })
  const cdp = await ctxB.newCDPSession(bruno)
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 })
  await espera(1200)
  check("o ponteiro passa a ser um dedo", await bruno.evaluate(() => matchMedia("(pointer: coarse)").matches))
  const botaoMovel = bruno.getByRole("button", { name: /^Mais acções sobre Ana$/ }).first()
  await botaoMovel.scrollIntoViewIfNeeded().catch(() => {})
  await botaoMovel.click()
  const cursorMovel = bruno.locator(".context-menu").getByRole("slider", { name: /^Volume de Ana$/ })
  await cursorMovel.waitFor({ timeout: 5000 }).catch(() => {})
  // Menu grows on open (`menu-in`): measure the box (`offsetHeight`), which the
  // animation scale doesn't touch, then after the animation ends.
  await espera(500)
  const alturas = await bruno.evaluate(() => {
    const input = document.querySelector(".menu-deslizante input")
    const repor = document.querySelector(".menu-deslizante-repor")
    const menuBox = document.querySelector(".context-menu")?.getBoundingClientRect()
    return {
      cursor: input?.offsetHeight ?? 0,
      repor: repor?.offsetHeight ?? 0,
      direita: menuBox ? Math.ceil(menuBox.right) : 0,
      documento: document.documentElement.scrollWidth,
    }
  })
  check("com o dedo o cursor tem 44 px de altura", alturas.cursor >= 44, `${alturas.cursor}px`)
  check('e o botão "100 %" também', alturas.repor >= 44, `${alturas.repor}px`)
  check("o menu cabe nos 390 px, sem rolar de lado", alturas.direita <= 390 && alturas.documento <= 390, `${alturas.direita}px, ${alturas.documento}px`)

  const caixaMovel = await cursorMovel.boundingBox()
  const y = caixaMovel.y + caixaMovel.height / 2
  const x0 = caixaMovel.x + caixaMovel.width / 2
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] })
  for (let passo = 1; passo <= 8; passo++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 - (caixaMovel.width * 0.3 * passo) / 8, y }] })
    await espera(40)
  }
  const comODedo = await volumeGuardado(bruno, enderecoAna)
  await bruno.screenshot({ path: join(CAPTURAS, "volume-barra-390.png") })
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await espera(300)
  check("com o dedo, arrastar baixa o volume antes de levantar", comODedo < 1, String(comODedo))
  check("e o menu fica aberto", (await bruno.locator(".context-menu").count()) === 1)
  await bruno.keyboard.press("Escape")
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false })
  await bruno.setViewportSize({ width: 1280, height: 860 })

  // And in the desktop app.
  const botaoDoBruno = ana.getByRole("button", { name: /^Mais acções sobre Bruno$/ }).first()
  check("a Ana vê o cartão do Bruno", (await ate(async () => (await botaoDoBruno.count()) > 0, 30_000)) >= 0)
  await botaoDoBruno.click({ force: true })
  const cursorAna = ana.locator(".context-menu").getByRole("slider", { name: /^Volume de Bruno$/ })
  check("secretária: o menu tem a barra do volume", (await cursorAna.count()) === 1)
  await cursorAna.focus()
  for (let i = 0; i < 4; i++) await ana.keyboard.press("ArrowLeft")
  check("secretária: as setas mudam o volume guardado", (await volumeGuardado(ana, enderecoBruno)) === 0.8, String(await volumeGuardado(ana, enderecoBruno)))
  await ana.screenshot({ path: join(CAPTURAS, "volume-barra-secretaria.png") })

  check("sem erros na página do Bruno", errosBruno.length === 0, errosBruno.slice(0, 2).join(" | "))
  const ok = resumo()
  await arrumar(ok ? 0 : 1)
} catch (erro) {
  console.error(erro)
  for (const page of browser?.contexts().flatMap((c) => c.pages()) ?? []) {
    await page.screenshot({ path: join(RAIZ, ".verify-data", `volume-youtube-falha-${Date.now()}.png`) }).catch(() => {})
  }
  console.log(sec?.registo.slice(-20).join("\n"))
  await arrumar(1)
}
