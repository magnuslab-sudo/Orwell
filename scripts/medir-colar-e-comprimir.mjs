// Paste images and compress them, measured in a real browser.
//
// Why this exists instead of another test: jsdom has no clipboard. No
// `ClipboardEvent`, no `navigator.clipboard`, does not know what Chrome puts
// there when someone copies an image from a page, and does not paste anything
// when you press Cmd+V. All the tests in `Composer.test.tsx` and `Social.test.tsx`
// do is hand-deliver an object with the shape we BELIEVE the browser delivers, // and that belief is exactly the part that needs to be measured.
//
// And the compressor has the same hole on the other end: jsdom does not draw.
// The tests prove the arithmetic of budgets with a fake canvas; what only here
// we know is how many bytes a real 4K screenshot takes after passing through a
// real `canvas`.
//
// What this measures, in order:
//
//   1. Paste TEXT still pastes text, in both boxes. It is the regression worth
//      more than the whole feature.
//   2. Paste an image copied from a page puts it as an attachment, in both.
//   3. Paste a screenshot, just `image/png` on the clipboard, no name, does
//      the same.
//   4. Paste an SVG disguised as PNG is rejected with a message.
//   5. The compressor, with real images: how many bytes in, how many out, and
//      how long it takes.
//   6. EXIF orientation survives decoding, and the tag disappears from the
//      result, which is the good part.
//
// What it does NOT prove: that macOS or Windows put the same thing on the
// clipboard that Chrome does when you copy from inside it. That is operating
// system, and is measured separately.
//
//   node scripts/medir-colar-e-comprimir.mjs
import { build } from "esbuild"
import { chromium } from "playwright"
import { createServer } from "node:http"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-colar")

mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { Composer } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/chat/Composer.js"))}
import { Social } from ${JSON.stringify(join(RAIZ, "packages/ui/src/screens/social/Social.js"))}
import { BridgeContext } from ${JSON.stringify(join(RAIZ, "packages/ui/src/App.js"))}
import { ToastProvider } from ${JSON.stringify(join(RAIZ, "packages/ui/src/components/Toast.js"))}
import { compressImage, IMAGE_BUDGETS, resetFormatoDetectado } from ${JSON.stringify(join(RAIZ, "packages/ui/src/lib/images.js"))}
import ${JSON.stringify(join(RAIZ, "packages/ui/src/styles.css"))}
import { comLingua } from "./ambiente.mjs"

// A ponte, reduzida ao que estas duas caixas lhe pedem. Recusa por omissão: o
// que se está a medir é a composição, e nada aqui chega a sair para lado nenhum.
const bridge = {
  social: {
    linkPreview: () => Promise.reject(new Error("sem hospedeiro")),
    post: (...args) => { (window as any).ultimaPublicacao = args; return Promise.resolve({ ok: true }) },
    react: () => Promise.resolve({ ok: true }),
    comment: () => Promise.resolve({ ok: true }),
    remove: () => Promise.resolve({ ok: true }),
    removeComment: () => Promise.resolve({ ok: true }),
    edit: () => Promise.resolve({ ok: true }),
  },
} as any

function Bancada() {
  const [texto, setTexto] = useState("")
  const [enviado, setEnviado] = useState<any>(null)
  const [draft, setDraft] = useState<any>({ caption: "", images: [], links: [] })
  ;(window as any).ultimoEnvio = enviado
  ;(window as any).rascunho = draft
  return (
    <BridgeContext.Provider value={bridge}>
      <ToastProvider>
        <div className="bancada-conversa">
          <Composer
            connection="online"
            value={texto}
            onChange={setTexto}
            onSend={(corpo: string, extras: any) => setEnviado({ corpo, extras })}
          />
        </div>
        <div className="bancada-publicacoes">
          <Social
            feed={[]}
            messages={[]}
            me="@eu:s"
            connection="online"
            connectionDetail={null}
            nameFor={(quem: string) => quem}
            directory={new Map()}
            draft={draft}
            onDraft={(patch: any) => setDraft((atual: any) => ({ ...atual, ...patch }))}
          />
        </div>
      </ToastProvider>
    </BridgeContext.Provider>
  )
}

// O compressor, exposto para a parte das medições.
;(window as any).comprimir = compressImage
;(window as any).ORCAMENTOS = IMAGE_BUDGETS
;(window as any).esquecerFormato = resetFormatoDetectado

createRoot(document.getElementById("raiz")!).render(<Bancada />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts" },
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>colar</title><link rel="stylesheet" href="pagina.css">` +
    `<body><div id="raiz"></div>` +
    // The source box that we COPY FROM. Editable on purpose: this is how Chrome
    // produces a clipboard with both `text/html` and `image/png`, which is
    // exactly what it puts there when someone copies an image from a website.
    `<div id="fonte" contenteditable="true" style="position:fixed;left:-9999px;top:0"></div>` +
    `<script src="pagina.js"></script></body>`,
  "utf8",
)

// ------------------------------------------------------------- the server
//
// `http://localhost` not `file://`: clipboard permissions are tied to an origin,
// and a file on disk has no origin to name. Localhost is a secure context
// without any certificate in the way.
const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }
const servidor = createServer((pedido, resposta) => {
  const nome = pedido.url === "/" ? "/index.html" : (pedido.url ?? "/").split("?")[0]
  try {
    const corpo = readFileSync(join(SAIDA, nome))
    resposta.writeHead(200, { "content-type": tipos[nome.slice(nome.lastIndexOf("."))] ?? "text/plain" })
    resposta.end(corpo)
  } catch {
    resposta.writeHead(404).end("não há")
  }
})
await new Promise((pronto) => servidor.listen(0, "127.0.0.1", pronto))
const PORTA = servidor.address().port
const ENDERECO = `http://localhost:${PORTA}/`

// ------------------------------------------------------------- o browser
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ENDERECO })
const page = await ctx.newPage()
const erros = []
page.on("pageerror", (e) => erros.push(String(e)))
await page.goto(comLingua(ENDERECO))
await page.waitForSelector(".chat-composer")

const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}
const medida = (etiqueta, valor) => console.log(`      ${etiqueta}: ${valor}`)

/** Two text boxes, each with its own selector. */
const CAIXAS = [
  { nome: "conversa", campo: ".chat-composer input[placeholder]", miniaturas: ".composer-images img" },
  { nome: "publicações", campo: "textarea", miniaturas: ".draft-image img" },
]

/** Puts something on the clipboard for real, with a real gesture. */
async function copiar(comoFonte) {
  await page.evaluate((html) => {
    const fonte = document.getElementById("fonte")
    fonte.innerHTML = html
    const intervalo = document.createRange()
    intervalo.selectNodeContents(fonte)
    const seleccao = window.getSelection()
    seleccao.removeAllRanges()
    seleccao.addRange(intervalo)
    document.execCommand("copy")
    seleccao.removeAllRanges()
  }, comoFonte)
}

/** Actually triggers Cmd+V (or Ctrl+V) inside the requested box. */
async function colarEm(seletor) {
  await page.click(seletor)
  await page.keyboard.press("ControlOrMeta+v")
}

async function limparCaixas() {
  await page.evaluate(() => {
    for (const botao of document.querySelectorAll('.composer-images button, .draft-image button')) botao.click()
  })
  for (const { campo } of CAIXAS) {
    await page.click(campo)
    await page.keyboard.press("ControlOrMeta+a")
    await page.keyboard.press("Backspace")
  }
  await page.waitForTimeout(50)
}

console.log("\n=== 1. Colar texto continua a colar texto ===\n")

await copiar("uma frase copiada de uma página")
for (const { nome, campo, miniaturas } of CAIXAS) {
  await colarEm(campo)
  await page.waitForTimeout(150)
  const valor = await page.$eval(campo, (n) => n.value)
  check(`${nome}: a frase colada aterra na caixa`, valor.includes("uma frase copiada"), JSON.stringify(valor))
  check(`${nome}: e não aparece imagem nenhuma`, (await page.$$(miniaturas)).length === 0)
}
await limparCaixas()

console.log("\n=== 2. Colar uma imagem copiada de uma página ===\n")

const pngVermelho = await page.evaluate(async () => {
  const canvas = document.createElement("canvas")
  canvas.width = 240
  canvas.height = 160
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#c0392b"
  ctx.fillRect(0, 0, 240, 160)
  ctx.fillStyle = "#fff"
  ctx.font = "28px sans-serif"
  ctx.fillText("colado", 20, 90)
  return canvas.toDataURL("image/png")
})

// "Copy image" from the right-click menu puts TWO things on the clipboard: the
// `<img>` in HTML and the bytes in `image/png`. Neither is `text/plain`, and
// that absence is what makes paste choose the image.
//
// Measured, not assumed: copying a selection with an `<img>` in it via
// `execCommand("copy")`, the first attempt at this script, gives ONLY
// `text/html` in this engine, with no image bytes at all. Pasting that brings
// no image, and what we record here is that it also does no harm.
const tiposCopiados = await page.evaluate(async (dataUrl) => {
  const bytes = await (await fetch(dataUrl)).blob()
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": bytes,
      "text/html": new Blob([`<img src="${dataUrl}">`], { type: "text/html" }),
    }),
  ])
  return (await navigator.clipboard.read()).flatMap((item) => item.types)
}, pngVermelho)
medida("tipos na área de transferência", tiposCopiados.join(", "))
check("uma imagem copiada de uma página não traz `text/plain`", !tiposCopiados.includes("text/plain"))

for (const { nome, campo, miniaturas } of CAIXAS) {
  await colarEm(campo)
  await page.waitForSelector(miniaturas, { timeout: 5000 }).catch(() => null)
  const quantas = (await page.$$(miniaturas)).length
  check(`${nome}: a imagem colada aparece como anexo`, quantas === 1, `${quantas} miniatura(s)`)
  const fonte = quantas > 0 ? await page.$eval(miniaturas, (n) => n.src.slice(0, 30)) : ""
  check(`${nome}: a pré-visualização é a imagem, e não um vazio`, fonte.startsWith("data:image/"), fonte)
  const texto = await page.$eval(campo, (n) => n.value)
  check(`${nome}: e a caixa de texto continua vazia`, texto === "", JSON.stringify(texto))
}
await limparCaixas()

// And the case above, the `text/html` alone: there is no image to paste, and
// what must happen is NOTHING, no attachment, no error, no box movement.
await copiar(`<img src="${pngVermelho}">`)
for (const { nome, campo, miniaturas } of CAIXAS) {
  await colarEm(campo)
  await page.waitForTimeout(200)
  check(`${nome}: HTML sem bytes de imagem não inventa um anexo`, (await page.$$(miniaturas)).length === 0)
  const recusa = await page.$$(".field-note.warn")
  check(`${nome}: e não acusa nada a quem não fez nada de mal`, recusa.length === 0)
}
await limparCaixas()

console.log("\n=== 3. Colar uma captura de ecrã (só image/png, sem nome) ===\n")

const escreveuCaptura = await page.evaluate(async (dataUrl) => {
  try {
    const bytes = await (await fetch(dataUrl)).blob()
    await navigator.clipboard.write([new ClipboardItem({ "image/png": bytes })])
    return true
  } catch (erro) {
    return String(erro)
  }
}, pngVermelho)

if (escreveuCaptura === true) {
  for (const { nome, campo, miniaturas } of CAIXAS) {
    await colarEm(campo)
    await page.waitForSelector(miniaturas, { timeout: 5000 }).catch(() => null)
    check(`${nome}: a captura colada aparece como anexo`, (await page.$$(miniaturas)).length === 1)
  }
  const alternativo = await page.$eval(".composer-images img", (n) => n.alt).catch(() => "")
  check("a captura sem nome recebe um, com extensão", /\.(png|jpg|gif|webp|avif)$/.test(alternativo), alternativo)
  await limparCaixas()
} else {
  console.log(`      (o motor não deixou escrever na área de transferência: ${escreveuCaptura})`)
}

console.log("\n=== 4. Colar um SVG disfarçado de PNG ===\n")

// This one does not go through the system clipboard, and the reason is measured:
// Chrome REFUSES to write bytes that are not a real PNG to an `image/png`
// `ClipboardItem`, "Failed to read or decode ClipboardItemData". That is a
// defense we get for free, but only in this scope: a native application that
// puts the same lie on the operating system clipboard, or a file drag, pass no
// validation at all.
//
// So what we assemble here is a TRUE `DataTransfer`, with a true `File`,
// delivered in a true `ClipboardEvent` to the true element. Only the person's
// hand is missing, and that is proven in the sections above.
for (const { nome, campo, miniaturas } of CAIXAS) {
  await page.evaluate((seletor) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script/></svg>'
    const dados = new DataTransfer()
    dados.items.add(new File([svg], "truque.png", { type: "image/png" }))
    document.querySelector(seletor).dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dados, bubbles: true, cancelable: true }),
    )
  }, campo)
  await page.waitForTimeout(300)
  check(`${nome}: nada entra`, (await page.$$(miniaturas)).length === 0)
  const recusa = await page
    .$eval(`${nome === "conversa" ? ".chat-composer" : ".composer-card"} .field-note.warn`, (n) => n.textContent)
    .catch(() => "")
  check(`${nome}: e a caixa diz porquê`, recusa.length > 20, recusa)
}
await limparCaixas()

// And the reverse, by the same logic: a real PNG with the wrong name goes in,
// and goes in with the type that the BYTES say.
const tipoAceite = await page.evaluate(async (dataUrl) => {
  const bytes = await (await fetch(dataUrl)).blob()
  const dados = new DataTransfer()
  // Advertised as GIF, with PNG inside.
  dados.items.add(new File([bytes], "mentiroso.gif", { type: "image/gif" }))
  document.querySelector(".chat-composer input[placeholder]").dispatchEvent(
    new ClipboardEvent("paste", { clipboardData: dados, bubbles: true, cancelable: true }),
  )
  await new Promise((pronto) => setTimeout(pronto, 400))
  const miniatura = document.querySelector(".composer-images img")
  return miniatura ? miniatura.src.slice(0, 20) : "sem miniatura"
}, pngVermelho)
check("um PNG anunciado como GIF entra com o tipo dos bytes", tipoAceite.startsWith("data:image/png"), tipoAceite)
await limparCaixas()

console.log("\n=== 5. O compressor, com imagens verdadeiras ===\n")

const medicoes = await page.evaluate(async () => {
  const canvas = document.createElement("canvas")
  const ctx = () => canvas.getContext("2d")

  const paraBlob = (tipo, qualidade) =>
    new Promise((pronto) => canvas.toBlob(pronto, tipo, qualidade))

  /** A screen capture: flat background, lots of text, hard edges. */
  async function capturaDeEcra(largura, altura) {
    canvas.width = largura
    canvas.height = altura
    const c = ctx()
    c.fillStyle = "#ffffff"
    c.fillRect(0, 0, largura, altura)
    c.fillStyle = "#111111"
    c.font = "18px monospace"
    for (let y = 30; y < altura; y += 26) {
      c.fillText("const orcamento = bytesQueAindaCabem(gasto, mediaType) // linha " + y, 24, y)
    }
    return paraBlob("image/png")
  }

  /** A diagram: large in pixels, light in bytes. The case that should not get worse. */
  async function diagrama(largura, altura) {
    canvas.width = largura
    canvas.height = altura
    const c = ctx()
    c.fillStyle = "#f5f5f5"
    c.fillRect(0, 0, largura, altura)
    c.fillStyle = "#2b6cb0"
    for (let i = 0; i < 12; i++) c.fillRect(100 + i * 220, 200 + (i % 3) * 400, 180, 300)
    return paraBlob("image/png")
  }

  /**
   * A photograph. `amplitude` is how much fine detail it has: a landscape runs
   * around 40, and 96 is almost pure noise, the worst case for any compressor,
   * so it is worth measuring separately.
   */
  async function fotografia(largura, altura, amplitude) {
    canvas.width = largura
    canvas.height = altura
    const c = ctx()
    const dados = c.createImageData(largura, altura)
    let semente = 1234567
    for (let i = 0; i < dados.data.length; i += 4) {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff
      const ruido = semente % amplitude
      const x = (i / 4) % largura
      const y = Math.floor(i / 4 / largura)
      // Large structure, sky, horizon, shadows, plus fine detail.
      const forma = 60 + Math.sin(x / 240) * 40 + Math.cos(y / 180) * 35
      dados.data[i] = Math.max(0, Math.min(255, forma + ruido + (x / largura) * 90))
      dados.data[i + 1] = Math.max(0, Math.min(255, forma + ruido + (y / altura) * 70))
      dados.data[i + 2] = Math.max(0, Math.min(255, forma + ruido))
      dados.data[i + 3] = 255
    }
    c.putImageData(dados, 0, 0)
    return paraBlob("image/jpeg", 0.92)
  }

  /** An image that is already good: small and with transparency. */
  async function pequenaComTransparencia() {
    canvas.width = 320
    canvas.height = 240
    const c = ctx()
    c.clearRect(0, 0, 320, 240)
    c.fillStyle = "rgba(43,108,176,0.8)"
    c.beginPath()
    c.arc(160, 120, 90, 0, Math.PI * 2)
    c.fill()
    return paraBlob("image/png")
  }

  const casos = [
    ["captura de ecrã 4K (PNG, texto)", await capturaDeEcra(3840, 2160)],
    ["fotografia 12 MP (JPEG, detalhe normal)", await fotografia(4032, 3024, 40)],
    ["fotografia 12 MP (JPEG, ruído puro: o pior caso)", await fotografia(4032, 3024, 96)],
    ["diagrama 3000×2000 (PNG, liso)", await diagrama(3000, 2000)],
    ["imagem pequena com transparência", await pequenaComTransparencia()],
  ]

  const saida = []
  for (const [nome, blob] of casos) {
    const inicio = performance.now()
    let resultado, erro = null
    try {
      resultado = await window.comprimir(blob, window.ORCAMENTOS.chat)
    } catch (e) {
      erro = String(e.message ?? e)
    }
    saida.push({
      nome,
      entrada: blob.size,
      tipoEntrada: blob.type,
      saida: resultado?.bytes ?? 0,
      largura: resultado?.width ?? 0,
      altura: resultado?.height ?? 0,
      recodificada: resultado?.recoded ?? null,
      tipoSaida: resultado ? resultado.dataUrl.slice(5, resultado.dataUrl.indexOf(";")) : "",
      ms: Math.round(performance.now() - inicio),
      erro,
    })
  }
  return saida
})

const emKb = (bytes) => `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} kB`
for (const m of medicoes) {
  if (m.erro) {
    check(`${m.nome}: recusada com uma frase`, m.erro.length > 20, m.erro)
    continue
  }
  const razao = m.entrada > 0 ? (m.entrada / Math.max(1, m.saida)).toFixed(1) : "0"
  medida(
    m.nome,
    `${emKb(m.entrada)} (${m.tipoEntrada}) → ${emKb(m.saida)} (${m.tipoSaida}), ` +
      `${m.largura}×${m.altura}, ${m.recodificada ? "recodificada" : "intacta"}, ${razao}×, ${m.ms} ms`,
  )
  check(`${m.nome}: cabe no orçamento da conversa`, m.saida <= 400 * 1024, emKb(m.saida))
  check(`${m.nome}: não saiu maior do que entrou`, m.saida <= m.entrada, `${emKb(m.entrada)} → ${emKb(m.saida)}`)
}

const diagramaMedido = medicoes.find((m) => m.nome.startsWith("diagrama"))
if (diagramaMedido && !diagramaMedido.erro) {
  check(
    "o diagrama leve não é trocado por uma versão pior",
    diagramaMedido.recodificada === false || diagramaMedido.saida < diagramaMedido.entrada,
    `${emKb(diagramaMedido.entrada)} → ${emKb(diagramaMedido.saida)}, ${diagramaMedido.recodificada ? "recodificada" : "intacta"}`,
  )
}

const pequena = medicoes.find((m) => m.nome.startsWith("imagem pequena"))
if (pequena && !pequena.erro) {
  check("a imagem pequena passa intacta, com a transparência", pequena.recodificada === false, pequena.tipoSaida)
}

console.log("\n=== 5b. Quando a troca não compensa ===\n")

// The rule "do not return worse than you received" needs a real case, and the
// four above do not work: in all of them the output file is much smaller than
// the input. The case that justifies it is different, and is very common, a
// photograph that HAS ALREADY BEEN SQUEEZED by another application, resent a
// dozen times, and arrives here light in bytes and just a few pixels above the
// maximum side. Redrawing it to 1600 px at the original quality makes the file
// GROW, and what the person gains is a larger image with more artifacts than
// what they had. These numbers are measured in the engine, not guessed.
const casosSemGanho = await page.evaluate(async () => {
  const canvas = document.createElement("canvas")

  async function fotografiaEspremida(largura, altura, qualidade) {
    canvas.width = largura
    canvas.height = altura
    const c = canvas.getContext("2d")
    const dados = c.createImageData(largura, altura)
    let semente = 24680
    for (let i = 0; i < dados.data.length; i += 4) {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff
      const ruido = semente % 50
      const x = (i / 4) % largura
      dados.data[i] = Math.min(255, 70 + ruido + (x / largura) * 100)
      dados.data[i + 1] = Math.min(255, 90 + ruido)
      dados.data[i + 2] = Math.min(255, 120 + ruido)
      dados.data[i + 3] = 255
    }
    c.putImageData(dados, 0, 0)
    return new Promise((pronto) => canvas.toBlob(pronto, "image/jpeg", qualidade))
  }

  /** A poster: flat, huge in pixels, light in PNG. */
  async function cartaz(largura, altura) {
    canvas.width = largura
    canvas.height = altura
    const c = canvas.getContext("2d")
    c.fillStyle = "#ffffff"
    c.fillRect(0, 0, largura, altura)
    c.fillStyle = "#000000"
    c.font = "bold 260px sans-serif"
    for (let y = 400; y < altura; y += 420) c.fillText("ORWELL", 300, y)
    return new Promise((pronto) => canvas.toBlob(pronto, "image/png"))
  }

  const casos = [
    ["fotografia já espremida, 1920×1080 a q=0,3", await fotografiaEspremida(1920, 1080, 0.3)],
    ["fotografia já espremida, 1700×956 a q=0,2", await fotografiaEspremida(1700, 956, 0.2)],
    ["cartaz 4000×3000 (PNG liso)", await cartaz(4000, 3000)],
  ]

  /** What reencoding would have given, so the refusal number is not abstract. */
  async function seTivesseSidoRecodificada(blob) {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })
    const escala = Math.min(1, window.ORCAMENTOS.chat.maxSide / Math.max(bitmap.width, bitmap.height))
    const alvo = document.createElement("canvas")
    alvo.width = Math.round(bitmap.width * escala)
    alvo.height = Math.round(bitmap.height * escala)
    alvo.getContext("2d").drawImage(bitmap, 0, 0, alvo.width, alvo.height)
    const url = alvo.toDataURL("image/webp", 0.82)
    const base64 = url.slice(url.indexOf(",") + 1)
    const enchimento = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
    return Math.floor((base64.length * 3) / 4) - enchimento
  }

  const saida = []
  for (const [nome, blob] of casos) {
    const resultado = await window.comprimir(blob, window.ORCAMENTOS.chat)
    saida.push({
      nome,
      entrada: blob.size,
      saida: resultado.bytes,
      recodificada: resultado.recoded,
      tipo: resultado.dataUrl.slice(5, resultado.dataUrl.indexOf(";")),
      seRecodificada: await seTivesseSidoRecodificada(blob),
    })
  }
  return saida
})

for (const m of casosSemGanho) {
  medida(
    m.nome,
    `${emKb(m.entrada)} → ${emKb(m.saida)} (${m.tipo}), ${m.recodificada ? "recodificada" : "INTACTA"} ` +
      `— redesenhada a 1600 px dava ${emKb(m.seRecodificada)}`,
  )
  check(`${m.nome}: não sai maior do que entrou`, m.saida <= m.entrada, `${emKb(m.entrada)} → ${emKb(m.saida)}`)
}
check(
  "há pelo menos um caso real em que a regra é o que segura o resultado",
  casosSemGanho.some((m) => m.recodificada === false),
  casosSemGanho.map((m) => `${m.nome}: ${m.recodificada ? "recodificada" : "intacta"}`).join(" | "),
)

console.log("\n=== 6. A orientação EXIF ===\n")

const orientacao = await page.evaluate(async () => {
  /**
   * A JPEG with the tag that a phone camera writes.
   *
   * The pixels are stored lying down (width > height) and an APP1 block says
   * "Orientation = 6", meaning rotate 90 degrees right to see it. This is how
   * almost all photographs taken upright reach this code.
   */
  async function comEtiqueta(largura, altura, amplitude) {
    const canvas = document.createElement("canvas")
    canvas.width = largura
    canvas.height = altura
    const c = canvas.getContext("2d")
    const dados = c.createImageData(largura, altura)
    let semente = 987654
    for (let i = 0; i < dados.data.length; i += 4) {
      semente = (semente * 1103515245 + 12345) & 0x7fffffff
      const ruido = semente % amplitude
      dados.data[i] = Math.min(255, 90 + ruido)
      dados.data[i + 1] = Math.min(255, 110 + ruido)
      dados.data[i + 2] = Math.min(255, 140 + ruido)
      dados.data[i + 3] = 255
    }
    c.putImageData(dados, 0, 0)
    const semExif = await new Promise((pronto) => canvas.toBlob(pronto, "image/jpeg", 0.92))
    const bytes = new Uint8Array(await semExif.arrayBuffer())

    // Minimal APP1: little-endian TIFF header, one entry only, at 0x0112, of type
    // SHORT, with value 6.
    const app1 = new Uint8Array([
      0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ])
    const juntos = new Uint8Array(bytes.length + app1.length)
    juntos.set(bytes.slice(0, 2), 0)
    juntos.set(app1, 2)
    juntos.set(bytes.slice(2), 2 + app1.length)
    return new Blob([juntos], { type: "image/jpeg" })
  }

  /**
   * The dimensions STORED in the file, read from the SOF marker.
   *
   * This is the control measurement, and it had to be this: the
   * `imageOrientation: "none"` that served as a control is now obsolete and in
   * this engine behaves like `from-image`, so comparing the two proves nothing.
   * What the file says it measures does not lie.
   */
  function dimensoesGravadas(bytes) {
    for (let i = 2; i < bytes.length - 9; i++) {
      if (bytes[i] !== 0xff) continue
      const marcador = bytes[i + 1]
      if (marcador >= 0xc0 && marcador <= 0xc3) {
        return [(bytes[i + 7] << 8) | bytes[i + 8], (bytes[i + 5] << 8) | bytes[i + 6]]
      }
    }
    return [0, 0]
  }

  const bytesDe = async (blob) => new Uint8Array(await blob.arrayBuffer())
  const procuraExif = (bytes) => new TextDecoder("latin1").decode(bytes.slice(0, 4096)).includes("Exif")

  // A real photograph: large enough to be reencoded.
  const grande = await comEtiqueta(2400, 1200, 60)
  const gravadas = dimensoesGravadas(await bytesDe(grande))
  const decodificada = await createImageBitmap(grande, { imageOrientation: "from-image" })
  const comprimida = await window.comprimir(grande, window.ORCAMENTOS.chat)
  const saidaBytes = await bytesDe(await (await fetch(comprimida.dataUrl)).blob())

  // And a small one, which the compressor lets through unchanged on purpose.
  const pequena = await comEtiqueta(300, 200, 60)
  const pequenaComprimida = await window.comprimir(pequena, window.ORCAMENTOS.chat)
  const pequenaBytes = await bytesDe(await (await fetch(pequenaComprimida.dataUrl)).blob())

  return {
    gravadas,
    decodificada: [decodificada.width, decodificada.height],
    saida: [comprimida.width, comprimida.height],
    entrada: grande.size,
    bytesSaida: comprimida.bytes,
    exifNaEntrada: procuraExif(await bytesDe(grande)),
    exifNaSaida: procuraExif(saidaBytes),
    pequenaIntacta: pequenaComprimida.recoded === false,
    exifNaPequena: procuraExif(pequenaBytes),
  }
})

medida("dimensões gravadas no ficheiro", orientacao.gravadas.join("×"))
medida("dimensões depois de descodificar", orientacao.decodificada.join("×"))
medida("o que sai do compressor", `${orientacao.saida.join("×")}, ${emKb(orientacao.bytesSaida)}`)
check(
  "a etiqueta é obedecida: a fotografia sai de pé e não deitada",
  orientacao.decodificada[0] === orientacao.gravadas[1] && orientacao.decodificada[1] === orientacao.gravadas[0],
  `gravada ${orientacao.gravadas.join("×")}, descodificada ${orientacao.decodificada.join("×")}`,
)
check(
  "e o que o compressor devolve mantém-se de pé",
  orientacao.saida[1] > orientacao.saida[0],
  orientacao.saida.join("×"),
)
check("a entrada trazia EXIF", orientacao.exifNaEntrada)
check(
  "e a saída recodificada vai sem ele: a localização e a câmara ficam de fora",
  orientacao.exifNaSaida === false,
)
medida(
  "uma imagem pequena de mais para valer a pena recodificar",
  `${orientacao.pequenaIntacta ? "passa intacta" : "é recodificada"}, ` +
    `${orientacao.exifNaPequena ? "COM o EXIF que trazia" : "sem EXIF"}`,
)

console.log("")
check("a bancada desenhou sem erros de página", erros.length === 0, erros[0] ?? "")

await browser.close()
servidor.close()

const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} verificações passaram.`)
process.exit(falhas === 0 ? 0 : 1)
