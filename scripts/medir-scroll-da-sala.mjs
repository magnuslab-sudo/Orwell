// Measure what conversation scrolling does when a room opens (scroll-room branch).
//
// Two accounts, a clean local server (`scripts/dev-servidor-scroll.sh`, 8481)
// and development web (5281). Alice fills the "conversation" room with text,
// images and YouTube links; Bob is in another room and clicks on it. From the
// click until 3 s later, record frame by frame the `scrollTop` of `.timeline`.
//
//   ./scripts/dev-servidor-scroll.sh &   (and web: npx vite --port 5281, in apps/web)
//   node scripts/medir-scroll-da-sala.mjs [output] [--dpr=1.25] [--movimento=reduce|no-preference]
//
// SONDA=1 writes frame by frame which conversation children changed height
// after the click: that is how the image and the thumbnail without box were found.
//
// Also measures horizontal overflow of the conversation area (the "slider" above
// the input box) at 1920, 1280 and 390 width.
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { criarContaEEntrar } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const argumentos = process.argv.slice(2)
const opcao = (nome, omissao) => argumentos.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1] ?? omissao
const SAIDA = argumentos.find((a) => !a.startsWith("--")) ?? "capturas/scroll-sala/antes"
const DPR = Number(opcao("dpr", "1"))
const MOVIMENTO = opcao("movimento", "reduce")
const URL = comLingua(process.env.ORWELL_APP ?? "http://127.0.0.1:5281/app/")
const SERVIDOR = process.env.ORWELL_SERVIDOR ?? "localhost:8481"
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

mkdirSync(SAIDA, { recursive: true })
// Without `--hide-scrollbars` (Playwright passes it by default): the bars must
// exist to be visible in the screenshot.
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] })
const relatorio = { dpr: DPR, movimento: MOVIMENTO, cenarios: {} }

async function conta(nome, frase) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: DPR,
    reducedMotion: MOVIMENTO,
  })
  const page = await context.newPage()
  page.on("pageerror", (e) => console.log(`[${nome}] pageerror`, String(e)))
  await page.goto(URL, { waitUntil: "domcontentloaded" })
  await criarContaEEntrar(page, { nome, frase, servidor: SERVIDOR, entrada: 90_000, memorizar: true })
  return { context, page }
}

const linhaDoCanal = (page) => page.locator(".channel-row").first()
const sala = (page, nome) => page.locator(`.room-tree .room-name:text-is("${nome}")`).first()

async function enviar(page, texto, imagens = []) {
  if (imagens.length) {
    await page.locator('.chat-composer input[type=file][accept*="image"]').setInputFiles(imagens)
    // Wait for compression to finish: the send button stays busy until then.
    await page.waitForFunction(() => !document.querySelector(".chat-composer .field-note"), undefined, { timeout: 20_000 }).catch(() => {})
    await espera(400)
  }
  const caixa = page.locator(".chat-composer textarea, .chat-composer input:not([type=file])").first()
  await caixa.fill(texto)
  if (/youtu/.test(texto)) {
    // The preview is composed by the sender: give it time to arrive.
    await page.locator(".chat-composer .link-draft, .chat-composer .link-card").first().waitFor({ timeout: 15_000 }).catch(() => {})
    await espera(2500)
  }
  await page.getByRole("button", { name: "Enviar", exact: true }).click()
  await espera(250)
}

/** Real images, drawn on a canvas: large, so compression can rewrite them. */
async function fazerImagens(page) {
  const dados = await page.evaluate(async () => {
    const out = []
    for (const [w, h, tipo] of [
      [1600, 1200, "image/jpeg"],
      [900, 1400, "image/jpeg"],
      [640, 360, "image/png"],
      [1200, 800, "image/png"],
    ]) {
      const c = document.createElement("canvas")
      c.width = w
      c.height = h
      const g = c.getContext("2d")
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 40)}%)`
        g.fillRect(Math.random() * w, Math.random() * h, 40 + Math.random() * 200, 40 + Math.random() * 200)
      }
      const blob = await new Promise((r) => c.toBlob(r, tipo, 0.92))
      const buf = new Uint8Array(await blob.arrayBuffer())
      let s = ""
      for (const b of buf) s += String.fromCharCode(b)
      out.push({ nome: `img-${w}x${h}.${tipo === "image/png" ? "png" : "jpg"}`, b64: btoa(s) })
    }
    return out
  })
  const pasta = join(SAIDA, "imagens")
  mkdirSync(pasta, { recursive: true })
  return dados.map(({ nome, b64 }) => {
    const caminho = join(pasta, nome)
    writeFileSync(caminho, Buffer.from(b64, "base64"))
    return caminho
  })
}

/** Start recording the conversation scrollTop every frame. */
async function gravar(page) {
  await page.evaluate(() => {
    const amostras = []
    const t0 = performance.now()
    window.__amostras = amostras
    window.__gravar = true
    const quadro = () => {
      const el = document.querySelector(".timeline")
      amostras.push(
        el
          ? { t: Math.round(performance.now() - t0), top: Math.round(el.scrollTop), altura: el.scrollHeight, vista: el.clientHeight }
          : { t: Math.round(performance.now() - t0), top: null },
      )
      if (window.__gravar) requestAnimationFrame(quadro)
    }
    requestAnimationFrame(quadro)
  })
}

async function parar(page) {
  return page.evaluate(() => {
    window.__gravar = false
    return window.__amostras
  })
}

/** What the samples say: how many times it moved, and whether it ended at the bottom. */
function resumir(amostras) {
  const validas = amostras.filter((a) => a.top !== null)
  let mexidas = 0
  const saltos = []
  for (let i = 1; i < validas.length; i++) {
    const antes = validas[i - 1]
    const agora = validas[i]
    if (agora.top !== antes.top) {
      mexidas++
      saltos.push({ t: agora.t, de: antes.top, para: agora.top, altura: agora.altura })
    }
  }
  const fim = validas[validas.length - 1]
  const distanciaAoFundo = fim ? fim.altura - fim.top - fim.vista : null
  // Frames AFTER the first render of the conversation with content: the first
  // positioning is correct, what comes after is what you see sliding.
  const primeiroComConteudo = validas.findIndex((a) => a.altura > a.vista)
  const mexidasDepoisDeAssentar = saltos.filter((s) => primeiroComConteudo >= 0 && s.t > validas[primeiroComConteudo].t).length
  return { quadros: validas.length, mexidas, mexidasDepoisDeAssentar, distanciaAoFundo, saltos: saltos.slice(0, 40) }
}

async function voltarAEntrar(page) {
  const cadeado = page.locator('input[type="password"]').first()
  await page.getByRole("button", { name: "Configurações", exact: true }).first().or(cadeado).first().waitFor({ timeout: 90_000 })
  if (await cadeado.isVisible().catch(() => false)) {
    await cadeado.fill("frase-de-teste-bob-rolagem")
    await cadeado.press("Enter")
  }
  await linhaDoCanal(page).waitFor({ timeout: 90_000 })
  if (!(await sala(page, "conversa").isVisible().catch(() => false))) await linhaDoCanal(page).click()
  await sala(page, "conversa").waitFor({ timeout: 90_000 })
}

async function medirAbertura(page, nome, antes) {
  await antes()
  if (process.env.SONDA) {
    await page.evaluate(() => {
      window.__sonda = []
      let n = 0
      let anterior = ""
      const quadro = () => {
        const t = document.querySelector(".timeline")
        if (t) {
          const filhos = [...t.children].map((el) => Math.round(el.getBoundingClientRect().height))
          const chave = filhos.join(",") + "|" + t.clientHeight + "|" + t.scrollHeight
          if (chave !== anterior) {
            const mudou = anterior ? filhos.map((h, i) => (h !== Number(anterior.split(",")[i]) ? `${i}:${anterior.split(",")[i]}->${h} ${t.children[i].className} ${[...t.children[i].querySelectorAll("img")].map((im) => `${im.complete ? "c" : "nc"}${im.getAttribute("width") ?? "-"}`).join("/")}` : null)).filter(Boolean) : [`${filhos.length} filhos`]
            window.__sonda.push({ n, sh: t.scrollHeight, top: Math.round(t.scrollTop), vista: t.clientHeight, main: [...(document.querySelector(".main")?.children ?? [])].map((c) => `${c.className.split(" ")[0]}:${Math.round(c.getBoundingClientRect().height)}`).join(" "), mudou: mudou.slice(0, 3) })
            anterior = chave
          }
        }
        if (n++ < 400) requestAnimationFrame(quadro)
      }
      requestAnimationFrame(quadro)
    })
  }
  await gravar(page)
  await sala(page, "conversa").click()
  if (process.env.SONDA) {
    await espera(400)
    const quadros = await page.evaluate(() => window.__sonda)
    for (const q of quadros.slice(0, 12)) console.log("   ", JSON.stringify(q))
  }
  await espera(3000)
  const amostras = await parar(page)
  const resumo = resumir(amostras)
  relatorio.cenarios[nome] = resumo
  console.log(`${nome}: ${resumo.mexidas} mudanças de scrollTop (${resumo.mexidasDepoisDeAssentar} depois de haver conteúdo), fim a ${resumo.distanciaAoFundo}px do fundo`)
  for (const s of resumo.saltos.slice(0, 12)) console.log(`   t=${s.t}ms ${s.de} -> ${s.para} (altura ${s.altura})`)
  await page.screenshot({ path: join(SAIDA, `${nome}-dpr${DPR}.png`) })
  return resumo
}

/** All elements in the conversation area wider than its box. */
async function transbordos(page) {
  return page.evaluate(() => {
    const raiz = document.querySelector(".main") ?? document.body
    const fora = []
    for (const el of raiz.querySelectorAll("*")) {
      const estilo = getComputedStyle(el)
      if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(estilo.overflowX)) {
        fora.push({
          el: `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          overflowX: estilo.overflowX,
        })
      }
    }
    return fora
  })
}

try {
  const alice = await conta("Alice Rolagem", "frase-de-teste-alice-rolagem")
  await linhaDoCanal(alice.page).waitFor({ timeout: 90_000 })
  await linhaDoCanal(alice.page).click()
  for (const nome of ["conversa", "outra"]) {
    await linhaDoCanal(alice.page).click({ button: "right" })
    await alice.page.getByRole("menuitem", { name: "Nova sala" }).click()
    await alice.page.locator(".sheet input").first().fill(nome)
    await alice.page.locator(".sheet-actions button.primary").first().click()
    await sala(alice.page, nome).waitFor({ timeout: 30_000 })
  }
  const bob = await conta("Bob Rolagem", "frase-de-teste-bob-rolagem")
  await linhaDoCanal(bob.page).waitFor({ timeout: 90_000 })
  await linhaDoCanal(bob.page).click()
  await sala(bob.page, "outra").waitFor({ timeout: 90_000 })
  await sala(bob.page, "outra").click()

  const imagens = await fazerImagens(alice.page)
  await sala(alice.page, "conversa").click()
  await espera(500)
  for (let i = 1; i <= 50; i++) {
    if (i % 9 === 0) await enviar(alice.page, `imagem ${i}`, [imagens[(i / 9) % imagens.length]])
    else if (i % 13 === 0) await enviar(alice.page, `vê isto https://www.youtube.com/watch?v=dQw4w9WgXcQ ${i}`)
    else await enviar(alice.page, `mensagem ${i}: ${"palavra ".repeat(1 + (i % 7) * 3)}`)
  }
  await enviar(alice.page, "duas de uma vez", [imagens[0], imagens[3]])
  await enviar(alice.page, "última https://youtu.be/jNQXAC9IVRw")
  await espera(3000)

  // 1. Bob is connected in another room and clicks on the conversation.
  await medirAbertura(bob.page, "ao-vivo-primeira-abertura", async () => {})
  // 2. Goes back to another and returns: the saved position.
  await medirAbertura(bob.page, "ao-vivo-regresso", async () => {
    await sala(bob.page, "outra").click()
    await espera(800)
  })
  // 3. Reloads the app (the vault opens itself with "remember"), and opens.
  await medirAbertura(bob.page, "depois-de-recarregar", async () => {
    await sala(bob.page, "outra").click()
    await espera(500)
    await bob.page.reload({ waitUntil: "domcontentloaded" })
    await voltarAEntrar(bob.page)
    await sala(bob.page, "outra").click()
    await espera(1500)
  })
  // 4. The app was CLOSED while Alice was writing: on return, recovery brings
  //    what was missing, and Bob opens the room as soon as he sees it.
  await medirAbertura(bob.page, "depois-de-fechar", async () => {
    await sala(bob.page, "outra").click()
    await espera(500)
    await bob.page.goto("about:blank")
    for (let i = 1; i <= 14; i++) {
      if (i % 5 === 0) await enviar(alice.page, `enquanto estavas fora ${i}`, [imagens[i % imagens.length]])
      else await enviar(alice.page, `enquanto estavas fora ${i}: ${"texto ".repeat(i)}`)
    }
    await bob.page.goto(URL, { waitUntil: "domcontentloaded" })
    await voltarAEntrar(bob.page)
  })

  // 4. Follow the bottom: Bob is at the bottom and a message with an image arrives.
  await gravar(bob.page)
  await enviar(alice.page, "nova no fundo", [imagens[1]])
  await espera(2500)
  const seguir = resumir(await parar(bob.page))
  relatorio.cenarios["chega-estando-no-fundo"] = seguir
  console.log(`chega-estando-no-fundo: fim a ${seguir.distanciaAoFundo}px do fundo`)

  // 5. Do not pull up readers above.
  await bob.page.evaluate(() => {
    const el = document.querySelector(".timeline")
    if (el) el.scrollTop = 300
  })
  await espera(300)
  await gravar(bob.page)
  await enviar(alice.page, "nova enquanto leio acima", [imagens[2]])
  await enviar(alice.page, "e outra só texto")
  await espera(2500)
  const ler = resumir(await parar(bob.page))
  relatorio.cenarios["chega-a-ler-acima"] = ler
  console.log(`chega-a-ler-acima: ${ler.mexidas} mudanças, ${JSON.stringify(ler.saltos.slice(0, 5))}`)

  // Horizontal overflow, at three widths.
  await bob.page.evaluate(() => {
    const el = document.querySelector(".timeline")
    if (el) el.scrollTop = el.scrollHeight
  })
  // Classic scrollbars, always visible with their own width, like on Windows: this
  // is what makes the horizontal bar visible in the screenshot.
  await bob.page.addStyleTag({
    // Normal properties (`scrollbar-width: thin` in `base.css`) override the
    // `::-webkit-scrollbar`; set to `auto`, the bars always render and take 17 px,
    // like Windows classic bars. On Mac they are overlaid.
    content:
      "*{scrollbar-width:auto!important;scrollbar-color:auto!important}::-webkit-scrollbar{width:17px;height:17px;background:#e8e8e8}::-webkit-scrollbar-thumb{background:#9a9a9a;border:4px solid #e8e8e8}",
  })
  // The input box in its most loaded state: an image to send and a link with a card.
  await bob.page.locator('.chat-composer input[type=file][accept*="image"]').setInputFiles([imagens[0], imagens[3]])
  await espera(1500)
  await bob.page.locator(".chat-composer input:not([type=file])").first().fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ e mais texto")
  await espera(3500)
  relatorio.transbordos = {}
  for (const [w, h] of [
    [1920, 1080],
    [1280, 800],
    [390, 844],
  ]) {
    await bob.page.setViewportSize({ width: w, height: h })
    await espera(700)
    const lista = await transbordos(bob.page)
    relatorio.transbordos[w] = lista
    console.log(`transbordo a ${w}: ${lista.length ? JSON.stringify(lista) : "nenhum"}`)
    await bob.page.screenshot({ path: join(SAIDA, `composer-${w}-dpr${DPR}.png`) })
  }
  await bob.page.setViewportSize({ width: 1920, height: 1080 })
} finally {
  writeFileSync(join(SAIDA, `relatorio-dpr${DPR}-${MOVIMENTO}.json`), JSON.stringify(relatorio, null, 2))
  await browser.close()
}
