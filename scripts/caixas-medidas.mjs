/**
 * Where the checkmark of a checkbox sits, measured in pixels.
 *
 *   medirCaixa(page, caixa)   the checkmark center against the box center, in
 *                             device pixels, in a full-screen capture
 *
 * jsdom draws nothing, and the `::before` `getBoundingClientRect` does not
 * exist: the only measurement that says what the owner sees is the capture. The
 * full-screen capture is read (not the element capture, which Playwright rounds
 * to whole pixels and shifts when the box is at a fractional position) and each
 * pixel is classified by color:
 *
 *   caixa   the accent (`background-color` of the checked box), against the background
 *   visto   the ink (`background-color` of the `::before`), against the accent
 *
 * A pixel counts when it is more than halfway between the two colors (anti-aliasing
 * goes with the closer one). Each center is the center of its bounding rectangle,
 * and the difference is `dx`/`dy`, in device pixels: at 125%, 1 CSS px is 1.25 px.
 *
 * Born on 4 November 2026, for the "Remember session" checkbox, which the owner
 * saw with the checkmark low on Windows (see `docs/planos/checkbox-centro-relatorio.md`).
 */
import { writeFileSync } from "node:fs"
import { chromium } from "playwright"

/*
  Captures are read in a separate Chromium, on a blank tab: the app's CSP does
  not have to accept `data:` images, and the desktop window (Electron) does not
  open new tabs.
*/
let decodificador = null
async function folhaEmBranco() {
  decodificador ??= await chromium.launch({ headless: true })
  return decodificador.newPage()
}

/** Close the Chromium that reads the captures. Call at the end of the script. */
export async function fecharMedidas() {
  await decodificador?.close()
  decodificador = null
}

/**
 * Wait for the checkmark to finish growing and the page to settle (the gate
 * comes with an opacity transition, and a semi-transparent box has different
 * colors). With reduced motion this is slower and does not stop; endless
 * animations (the aurora, the startup ring) do not count.
 */
async function vistoParado(caixa) {
  await caixa.evaluate(
    (el) =>
      new Promise((resolve, reject) => {
        const limite = performance.now() + 10_000
        // Any animation with an end, anywhere: the startup ("Opening…") floats above
        // the gate, not catching the mouse, while its veil fades, and
        // `elementFromPoint` does not see it.
        const aMexer = () =>
          document.getAnimations().some((animacao) => animacao.playState === "running" && animacao.effect?.getComputedTiming().endTime !== Infinity)
        const aVista = () => {
          const r = el.getBoundingClientRect()
          return !document.querySelector(".abertura") && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el
        }
        const ver = () => {
          if (getComputedStyle(el, "::before").transform === "matrix(1, 0, 0, 1, 0, 0)" && !aMexer() && aVista()) resolve()
          else if (performance.now() > limite) reject(new Error("a caixa não assentou: o visto a crescer, uma entrada a meio, ou algo por cima"))
          else requestAnimationFrame(ver)
        }
        ver()
      }),
  )
}

/** A CSS color `rgb(r, g, b)` as numbers. */
function rgb(texto) {
  const numeros = texto.match(/[\d.]+/g)?.map(Number)
  if (!numeros || numeros.length < 3) throw new Error(`cor que não se lê: ${texto}`)
  return numeros.slice(0, 3)
}

/** What fraction of the path from `de` to `para` is pixel `p` at (0 to 1). */
function fraccao(p, de, para) {
  let cima = 0
  let baixo = 0
  for (let i = 0; i < 3; i++) {
    cima += (p[i] - de[i]) * (para[i] - de[i])
    baixo += (para[i] - de[i]) ** 2
  }
  return baixo ? Math.max(0, Math.min(1, cima / baixo)) : 0
}

/**
 * Measure a CHECKED box. Return `{ dx, dy, caixa, visto, dpr }`: `dx`/`dy` in
 * device pixels (positive = checkmark right / down), `caixa` and `visto` as
 * rectangles in device pixels within the capture.
 */
export async function medirCaixa(page, caixa) {
  await caixa.scrollIntoViewIfNeeded()
  if (!(await caixa.isChecked())) throw new Error("medirCaixa mede caixas marcadas")
  await vistoParado(caixa)
  // The mouse is off: `:hover` changes the outline.
  await page.mouse.move(0, 0)
  await page.waitForTimeout(150)

  const { rect, dpr, acento, tinta } = await caixa.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      dpr: devicePixelRatio,
      acento: getComputedStyle(el).backgroundColor,
      tinta: getComputedStyle(el, "::before").backgroundColor,
    }
  })
  const captura = await page.screenshot({ animations: "allow", caret: "initial" })

  const folha = await folhaEmBranco()
  // One CSS pixel around, no more: the label text is at `--space-3`.
  const margem = 1
  const regiao = {
    x: Math.max(0, Math.floor((rect.x - margem) * dpr)),
    y: Math.max(0, Math.floor((rect.y - margem) * dpr)),
    w: Math.ceil((rect.width + 2 * margem) * dpr),
    h: Math.ceil((rect.height + 2 * margem) * dpr),
  }
  const pixeis = await folha.evaluate(
    async ({ b64, regiao }) => {
      const imagem = new Image()
      imagem.src = `data:image/png;base64,${b64}`
      await imagem.decode()
      const tela = document.createElement("canvas")
      tela.width = imagem.width
      tela.height = imagem.height
      const ctx = tela.getContext("2d", { willReadFrequently: true })
      ctx.drawImage(imagem, 0, 0)
      return Array.from(ctx.getImageData(regiao.x, regiao.y, regiao.w, regiao.h).data)
    },
    { b64: captura.toString("base64"), regiao },
  )
  await folha.close()

  const corDoAcento = rgb(acento)
  const corDaTinta = rgb(tinta)
  const pixel = (x, y) => {
    const i = (y * regiao.w + x) * 4
    return [pixeis[i], pixeis[i + 1], pixeis[i + 2]]
  }
  // The background is the corner of the region, outside the box.
  const fundo = pixel(0, 0)

  const envolvente = (dentro) => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let y = 0; y < regiao.h; y++) {
      for (let x = 0; x < regiao.w; x++) {
        if (!dentro(x, y)) continue
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    }
    return { x0, y0, x1, y1 }
  }

  const daCaixa = envolvente((x, y) => fraccao(pixel(x, y), fundo, corDoAcento) > 0.5)
  if (!Number.isFinite(daCaixa.x0)) {
    if (process.env.CAIXAS_DEBUG) writeFileSync(process.env.CAIXAS_DEBUG, captura)
    throw new Error(`não se encontrou a caixa na captura (acento ${acento}, fundo ${fundo}, em ${JSON.stringify(rect)})`)
  }
  // Search for the checkmark only inside the box, away from the outline and
  // rounded corners, which are also dark (the background is there).
  const recuo = Math.round(1.5 * dpr)
  const doVisto = envolvente(
    (x, y) =>
      x >= daCaixa.x0 + recuo &&
      x <= daCaixa.x1 - recuo &&
      y >= daCaixa.y0 + recuo &&
      y <= daCaixa.y1 - recuo &&
      fraccao(pixel(x, y), corDoAcento, corDaTinta) > 0.5,
  )
  if (!Number.isFinite(doVisto.x0)) throw new Error("não se encontrou o visto na captura")

  const centro = (r) => ({ x: (r.x0 + r.x1 + 1) / 2, y: (r.y0 + r.y1 + 1) / 2 })
  const cc = centro(daCaixa)
  const cv = centro(doVisto)
  return {
    dpr,
    dx: cv.x - cc.x,
    dy: cv.y - cc.y,
    caixa: { x: daCaixa.x0, y: daCaixa.y0, w: daCaixa.x1 - daCaixa.x0 + 1, h: daCaixa.y1 - daCaixa.y0 + 1 },
    visto: { x: doVisto.x0, y: doVisto.y0, w: doVisto.x1 - doVisto.x0 + 1, h: doVisto.y1 - doVisto.y0 + 1 },
    posicaoCss: { x: rect.x, y: rect.y },
    ...(process.env.CAIXAS_DEBUG
      ? {
          mapa: Array.from({ length: regiao.h }, (_, y) =>
            Array.from({ length: regiao.w }, (_, x) => {
              const p = pixel(x, y)
              if (fraccao(p, fundo, corDoAcento) > 0.5) return "#"
              return x > daCaixa.x0 && x < daCaixa.x1 && y > daCaixa.y0 && y < daCaixa.y1 ? "v" : "."
            }).join(""),
          ).join("\n"),
        }
      : {}),
  }
}

/**
 * Capture of `alvo` (the box and label), enlarged `vezes` times without
 * smoothing: each screen pixel becomes a square, and a crooked checkmark shows
 * at a glance. In device pixels, from the full-screen capture (like the
 * measurement).
 */
export async function recorteAmpliado(page, alvo, vezes = 8, margem = 3) {
  await alvo.scrollIntoViewIfNeeded()
  const { rect, dpr } = await alvo.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, dpr: devicePixelRatio }
  })
  const captura = await page.screenshot({ animations: "allow", caret: "initial" })
  const regiao = {
    x: Math.max(0, Math.floor((rect.x - margem) * dpr)),
    y: Math.max(0, Math.floor((rect.y - margem) * dpr)),
    w: Math.ceil((rect.width + 2 * margem) * dpr),
    h: Math.ceil((rect.height + 2 * margem) * dpr),
  }
  const folha = await folhaEmBranco()
  const dataUrl = await folha.evaluate(
    async ({ b64, regiao, vezes }) => {
      const imagem = new Image()
      imagem.src = `data:image/png;base64,${b64}`
      await imagem.decode()
      const tela = document.createElement("canvas")
      tela.width = regiao.w * vezes
      tela.height = regiao.h * vezes
      const ctx = tela.getContext("2d")
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(imagem, regiao.x, regiao.y, regiao.w, regiao.h, 0, 0, tela.width, tela.height)
      return tela.toDataURL("image/png")
    },
    { b64: captura.toString("base64"), regiao, vezes },
  )
  await folha.close()
  return Buffer.from(dataUrl.split(",")[1], "base64")
}
