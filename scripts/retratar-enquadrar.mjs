/**
 * The crop sheet (1.0.6, requested 2 November 2026), in a real layout engine
 * with real pixels.
 *
 * The sheet tests run in jsdom, which does not draw or measure: they prove that
 * the gestures reach the account, not that the output image has the right area.
 * This mounts the real `ProfileEditor`, with the real stylesheet, in Chromium:
 *
 * - selects a four-color image (red, green, blue, yellow, one quadrant each)
 *   from the file field, like a person would;
 * - drags with the mouse to the left edge and zooms with the wheel, then clicks
 *   "Save";
 * - reads the pixels of the face that ended up in the preview: size, and the color
 *   of each area against the hand calculation;
 * - also crops the 16:10 banner and the icon using `cortarImagem`, and checks;
 * - saves the sheet at 1280 and 390 px to `capturas/enquadrar-*.png`.
 *
 *   node scripts/retratar-enquadrar.mjs
 *
 * Based on: `retratar-painel-de-controlo.mjs`.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-enquadrar")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { ConfirmarProvider } from ${UI("hooks/useConfirmar.js")}
import { ProfileEditor } from ${UI("screens/profile/ProfileEditor.js")}
import { cortarImagem, recorteDe, enquadramentoInicial, ampliar, PROPORCAO_DA_FORMA } from ${UI("lib/enquadrar.js")}
import { IMAGE_BUDGETS } from ${UI("lib/images.js")}
import ${UI("styles.css")}

/* Para o guião: cortar sem a folha, e ler os pixels de uma data URL. */
window.__cortar = async (bytes, tipo, forma, zoom, foco) => {
  const ficheiro = new Blob([new Uint8Array(bytes)], { type: tipo })
  const bitmap = await createImageBitmap(ficheiro)
  const medidas = { largura: bitmap.width, altura: bitmap.height }
  const proporcao = PROPORCAO_DA_FORMA[forma]
  const estado = ampliar(enquadramentoInicial(medidas), zoom, foco, medidas, proporcao)
  const budget = forma === "capa" ? IMAGE_BUDGETS.post : IMAGE_BUDGETS.icon
  const imagem = await cortarImagem(ficheiro, recorteDe(estado, medidas, proporcao), forma, budget)
  return { ...imagem, recorte: recorteDe(estado, medidas, proporcao) }
}
window.__pixels = async (dataUrl, pontos) => {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const contexto = canvas.getContext("2d")
  contexto.drawImage(bitmap, 0, 0)
  return {
    largura: bitmap.width,
    altura: bitmap.height,
    cores: pontos.map(([x, y]) => [...contexto.getImageData(x, y, 1, 1).data].slice(0, 3)),
  }
}

createRoot(document.getElementById("raiz")).render(
  <BridgeContext.Provider value={{ social: {}, profile: { set: async () => {} } }}>
    <ConfirmarProvider>
      <ProfileEditor
        initial={{ displayName: "Vesna", donations: [], updatedAt: 1 }}
        address="@garbicis-xapsensis:casa.exemplo"
        onSaved={() => {}}
        onClose={() => {}}
      />
    </ConfirmarProvider>
  </BridgeContext.Provider>,
)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

/** Two images drawn on a canvas: the four-color one, and a "landscape" for the screenshots. */
async function imagens(page) {
  return page.evaluate(async () => {
    const png = async (largura, altura, desenhar) => {
      const canvas = document.createElement("canvas")
      canvas.width = largura
      canvas.height = altura
      desenhar(canvas.getContext("2d"))
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
      return [...new Uint8Array(await blob.arrayBuffer())]
    }
    // 1200 × 750, one quadrant per color, with the boundary at x = 600 and y = 375.
    const quatro = await png(1200, 750, (c) => {
      c.fillStyle = "#ff0000"; c.fillRect(0, 0, 600, 375)
      c.fillStyle = "#00ff00"; c.fillRect(600, 0, 600, 375)
      c.fillStyle = "#0000ff"; c.fillRect(0, 375, 600, 375)
      c.fillStyle = "#ffff00"; c.fillRect(600, 375, 600, 375)
    })
    const paisagem = await png(1600, 1000, (c) => {
      const ceu = c.createLinearGradient(0, 0, 0, 1000)
      ceu.addColorStop(0, "#f7b267"); ceu.addColorStop(0.55, "#f4845f"); ceu.addColorStop(1, "#4b3f72")
      c.fillStyle = ceu; c.fillRect(0, 0, 1600, 1000)
      c.fillStyle = "#ffe8a3"; c.beginPath(); c.arc(1050, 420, 130, 0, Math.PI * 2); c.fill()
      c.fillStyle = "#2c2a4a"; c.beginPath(); c.moveTo(0, 760)
      for (let x = 0; x <= 1600; x += 80) c.lineTo(x, 700 + Math.sin(x / 140) * 60)
      c.lineTo(1600, 1000); c.lineTo(0, 1000); c.fill()
      c.fillStyle = "#1b1931"; c.beginPath(); c.moveTo(0, 880)
      for (let x = 0; x <= 1600; x += 80) c.lineTo(x, 850 + Math.cos(x / 110) * 40)
      c.lineTo(1600, 1000); c.lineTo(0, 1000); c.fill()
    })
    return { quatro, paisagem }
  })
}

const perto = (cor, alvo) => cor.every((v, i) => Math.abs(v - alvo[i]) <= 40)
const VERMELHO = [255, 0, 0]
const VERDE = [0, 255, 0]
const AZUL = [0, 0, 255]
const AMARELO = [255, 255, 0]

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  const id = String(largura)
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)
  await page.waitForSelector(".avatar-row")
  const { quatro, paisagem } = await imagens(page)

  // 1. The four-color face, through the sheet, with the mouse.
  await page.setInputFiles('input[type="file"]', { name: "quatro.png", mimeType: "image/png", buffer: Buffer.from(quatro) })
  await page.waitForSelector(".enquadrar-moldura img[style*='transform']")
  const moldura = await page.locator(".enquadrar-moldura").boundingBox()
  check(`${id}: a moldura é um círculo inteiro dentro da folha`, moldura && Math.abs(moldura.width - moldura.height) < 1 && moldura.x >= 0 && moldura.x + moldura.width <= largura, JSON.stringify(moldura))
  // Drag far to the right: the crop touches the left edge of the image.
  const meio = { x: moldura.x + moldura.width / 2, y: moldura.y + moldura.height / 2 }
  await page.mouse.move(meio.x, meio.y)
  await page.mouse.down()
  await page.mouse.move(meio.x + 600, meio.y, { steps: 6 })
  await page.mouse.up()
  // The wheel zooms with focus on the top-left corner of the frame.
  await page.mouse.move(moldura.x + 2, moldura.y + 2)
  // exp(526 × 0.0015) ≈ 2.2. Chromium delivers deltaY in CSS pixels, and the
  // context has density 2: 1052 is needed to reach 526. Well above 2: at zoom 2
  // the crop ended 9 px from the blue boundary, at the mercy of exactly where
  // the mouse was released.
  await page.mouse.wheel(0, -1052)
  await page.waitForTimeout(100)
  const zoom = Number(await page.locator(".enquadrar-palco").getAttribute("data-zoom"))
  check(`${id}: a roda ampliou para perto de 2,2`, Math.abs(zoom - 2.2) < 0.05, String(zoom))
  const pagina = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${id}: a página não rola de lado`, pagina <= 0, String(pagina))
  await page.locator(".enquadrar-palco").screenshot({ path: join(SAIDA, `palco-${id}.png`) })
  await page.screenshot({ path: join(SAIDA, `enquadrar-quatro-cores-${id}.png`) })

  await page.locator(".enquadrar").getByRole("button", { name: "Guardar" }).click()
  await page.waitForSelector(".enquadrar", { state: "detached" })
  const cara = await page.locator(".avatar-preview img").getAttribute("src")
  // Zoom 2.2 from the corner: 341 × 341 crop at (0, 0), only red (the boundary
  // is at 375 in both directions), at 256 px.
  const lida = await page.evaluate(([url]) => window.__pixels(url, [[8, 8], [128, 128], [248, 248]]), [cara])
  check(`${id}: a cara sai com 256 × 256`, lida.largura === 256 && lida.altura === 256, `${lida.largura}×${lida.altura}`)
  check(`${id}: e é o canto vermelho, de ponta a ponta`, lida.cores.every((cor) => perto(cor, VERMELHO)), JSON.stringify(lida.cores))

  // 2. The banner and icon through cropping, without the sheet.
  const capa = await page.evaluate(([bytes]) => window.__cortar(bytes, "image/png", "capa", 1, { fx: 0.5, fy: 0.5 }), [quatro])
  check(`${id}: a capa de uma imagem já 16:10 passa inteira`, capa.width === 1200 && capa.height === 750 && capa.recoded === false, `${capa.width}×${capa.height} ${capa.recoded}`)
  const icone = await page.evaluate(([bytes]) => window.__cortar(bytes, "image/png", "quadrado", 1, { fx: 0.5, fy: 0.5 }), [quatro])
  const lidoIcone = await page.evaluate(([url]) => window.__pixels(url, [[64, 64], [192, 64], [64, 192], [192, 192]]), [icone.dataUrl])
  check(
    `${id}: o ícone ao centro tem os quatro quadrantes nos sítios`,
    lidoIcone.largura === 256 && lidoIcone.altura === 256 &&
      perto(lidoIcone.cores[0], VERMELHO) && perto(lidoIcone.cores[1], VERDE) && perto(lidoIcone.cores[2], AZUL) && perto(lidoIcone.cores[3], AMARELO),
    JSON.stringify(lidoIcone),
  )
  const capaPerto = await page.evaluate(([bytes]) => window.__cortar(bytes, "image/png", "capa", 4, { fx: 1, fy: 1 }), [quatro])
  const lidaCapa = await page.evaluate(([url]) => window.__pixels(url, [[10, 10], [290, 177]]), [capaPerto.dataUrl])
  check(
    `${id}: a capa a zoom 4 no canto de baixo à direita é 300 × 188 de amarelo`,
    lidaCapa.largura === 300 && lidaCapa.altura === 188 && lidaCapa.cores.every((cor) => perto(cor, AMARELO)),
    JSON.stringify(lidaCapa),
  )

  // 3. The screenshot that matters: the sheet with a real image, zoomed slightly.
  await page.setInputFiles('input[type="file"]', { name: "paisagem.png", mimeType: "image/png", buffer: Buffer.from(paisagem) })
  await page.waitForSelector(".enquadrar-moldura img[style*='transform']")
  await page.locator(".enquadrar-palco").focus()
  for (const tecla of ["+", "+", "+", "ArrowLeft", "ArrowLeft", "ArrowUp"]) await page.keyboard.press(tecla)
  await page.waitForTimeout(300)
  check(`${id}: o teclado ampliou (três vezes "+")`, (await page.locator(".enquadrar-palco").getAttribute("data-zoom")) === "1.33")
  await page.screenshot({ path: join(CAPTURAS, `enquadrar-${id}.png`) })
  await page.locator(".enquadrar").getByRole("button", { name: "Cancelar" }).click()
  await page.waitForSelector(".enquadrar", { state: "detached" })
  check(`${id}: "Cancelar" deixa a cara vermelha`, (await page.locator(".avatar-preview img").getAttribute("src")) === cara)

  check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
