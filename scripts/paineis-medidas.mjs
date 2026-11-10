/**
 * The dimensions of surfaces above the aurora (`paineis.css`), for the scripts
 * that start the app for real (`retratar-midnight.mjs`). Three questions that
 * jsdom cannot answer:
 *
 *   medirFps(page)               frames per second the page achieves, with the
 *                                aurora moving behind the surfaces
 *   medirContraste(page, sel)    the contrast of text against what sits DIRECTLY
 *                                beneath it: the tint, with the aurora wherever
 *                                it is at that moment
 *   verificarPaineis(page, sels) each surface is almost solid tint, no blur, and
 *                                no opaque ancestor hides the aurora
 *
 * Until 0.8.3 (liquid glass) it was called `vidro-medidas.mjs` and checked that
 * the layer blurred. The owner removed the glass on 26 October 2026.
 */

/**
 * Counts `requestAnimationFrame` calls during `ms`. Returns the mean and the worst
 * interval at the 95th percentile, in milliseconds.
 */
export async function medirFps(page, ms = 2000) {
  return page.evaluate(
    (duracao) =>
      new Promise((resolve) => {
        const tempos = []
        const passo = (agora) => {
          tempos.push(agora)
          if (agora - tempos[0] < duracao) requestAnimationFrame(passo)
          else {
            const intervalos = tempos
              .slice(1)
              .map((t, i) => t - tempos[i])
              .sort((a, b) => a - b)
            const total = tempos[tempos.length - 1] - tempos[0]
            resolve({
              fps: Math.round(((tempos.length - 1) * 1000) / total),
              p95: Math.round(intervalos[Math.floor(intervalos.length * 0.95)] ?? 0),
            })
          }
        }
        requestAnimationFrame(passo)
      }),
    ms,
  )
}

/**
 * The contrast of text inside `seletor`, measured in pixels.
 *
 * 1. Combines the boxes of each visible text piece and its color.
 * 2. Makes ALL text transparent and takes a screenshot: what lies under each box
 *    is the real background (tint, aurora, rain).
 * 3. In each box, the background is the pixel at the 95th percentile of luminance
 *    (the brightest spot, without letting a stray pixel decide), and contrast is
 *    WCAG.
 *
 * The limit is 4.5:1, and 3:1 for large type (24 px, or 18.66 px bold). Returns
 * the worst case and the list of failures.
 */
export async function medirContraste(page, seletor) {
  const caixas = await page.evaluate((sel) => {
    const lista = []
    for (const raiz of document.querySelectorAll(sel)) {
      const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
      for (let no = andar.nextNode(); no; no = andar.nextNode()) {
        const texto = no.textContent?.trim() ?? ""
        const dono = no.parentElement
        if (!texto || !dono) continue
        const estilo = getComputedStyle(dono)
        if (estilo.visibility === "hidden" || Number(estilo.opacity) === 0) continue
        // A disabled control does not count (WCAG 1.4.3 exempts it), nor does one in the
        // middle of an opacity transition.
        if (dono.closest(":disabled, [aria-disabled='true']")) continue
        // Nor does screen-reader-only text: it overflows the 1 px box, and `clip-path`
        // hides it.
        if (dono.closest(".sr-only, .visually-hidden")) continue
        let recortado = false
        for (let pai = dono; pai && !recortado; pai = pai.parentElement) recortado = getComputedStyle(pai).clipPath !== "none"
        if (recortado) continue
        const intervalo = document.createRange()
        intervalo.selectNodeContents(no)
        for (const r of intervalo.getClientRects()) {
          if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue
          // Only visible text: what sits at the center of the box must be the owner of the
          // text (or a parent). Catches text cut off by `overflow` and text hidden by a
          // layer.
          const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          if (!topo || !(dono.contains(topo) || topo.contains(dono))) continue
          lista.push({
            texto: texto.slice(0, 32),
            cor: estilo.color,
            tamanho: Number.parseFloat(estilo.fontSize),
            peso: Number.parseInt(estilo.fontWeight, 10),
            x: Math.max(0, r.left),
            y: Math.max(0, r.top),
            w: Math.min(innerWidth, r.right) - Math.max(0, r.left),
            h: Math.min(innerHeight, r.bottom) - Math.max(0, r.top),
          })
        }
      }
    }
    return lista
  }, seletor)
  if (caixas.length === 0) return { pior: null, falhas: [], medidas: 0 }

  const estilo = await page.addStyleTag({
    content: "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }",
  })
  // Two frames, so the screenshot already has the text erased.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const png = await page.screenshot({ type: "png" })
  await estilo.evaluate((no) => no.remove())

  return page.evaluate(
    async ({ b64, caixas }) => {
      const imagem = new Image()
      imagem.src = `data:image/png;base64,${b64}`
      await imagem.decode()
      const tela = document.createElement("canvas")
      tela.width = imagem.naturalWidth
      tela.height = imagem.naturalHeight
      const ctx = tela.getContext("2d", { willReadFrequently: true })
      ctx.drawImage(imagem, 0, 0)
      const escala = imagem.naturalWidth / innerWidth

      const linear = (c) => {
        const v = c / 255
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      }
      const luminancia = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
      const contraste = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      const rgba = (cor) => {
        const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(cor)
        return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : [255, 255, 255, 1]
      }

      const medidas = []
      for (const caixa of caixas) {
        const x = Math.floor(caixa.x * escala)
        const y = Math.floor(caixa.y * escala)
        const w = Math.max(1, Math.floor(caixa.w * escala))
        const h = Math.max(1, Math.floor(caixa.h * escala))
        const { data } = ctx.getImageData(x, y, w, h)
        const pixeis = []
        for (let i = 0; i < data.length; i += 4) pixeis.push([data[i], data[i + 1], data[i + 2], luminancia(data[i], data[i + 1], data[i + 2])])
        pixeis.sort((a, b) => a[3] - b[3])
        const fundo = pixeis[Math.floor(pixeis.length * 0.95)] ?? pixeis[pixeis.length - 1]
        const [r, g, b, a] = rgba(caixa.cor)
        // A text color with alpha composes over the background beneath it.
        const texto = [r * a + fundo[0] * (1 - a), g * a + fundo[1] * (1 - a), b * a + fundo[2] * (1 - a)]
        const valor = contraste(luminancia(...texto), fundo[3])
        const grande = caixa.tamanho >= 24 || (caixa.tamanho >= 18.66 && caixa.peso >= 700)
        medidas.push({
          texto: caixa.texto,
          valor: Math.round(valor * 100) / 100,
          limite: grande ? 3 : 4.5,
          fundo: `rgb(${fundo.slice(0, 3).join(",")})`,
          cor: caixa.cor,
        })
      }
      medidas.sort((a, b) => a.valor / a.limite - b.valor / b.limite)
      return { pior: medidas[0], falhas: medidas.filter((m) => m.valor < m.limite), medidas: medidas.length }
    },
    { b64: png.toString("base64"), caixas },
  )
}

/**
 * Each of these visible selectors is almost solid tint (alpha 0.88 to 0.96), or
 * solid on purpose (the drawers, in `solidos`); neither the surface nor a layer
 * of it blurs; and no ancestor up to `body` has an opaque background hiding the
 * aurora. Returns the problems, one per line; empty is good.
 */
export async function verificarPaineis(page, seletores, { solidos = [] } = {}) {
  return page.evaluate(
    ({ seletores, solidos }) => {
      const problemas = []
      const alfa = (cor) => {
        if (!cor || cor === "transparent") return 0
        const m = /rgba?\([^)]*?(?:,\s*([\d.]+))?\)$/.exec(cor)
        return !m ? 0 : m[1] === undefined ? 1 : Number(m[1])
      }
      const desfoca = (estilo) => {
        const f = estilo.backdropFilter || estilo.webkitBackdropFilter
        return Boolean(f) && f !== "none"
      }
      for (const sel of seletores) {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0)
        if (!el) {
          problemas.push(`${sel}: não está à vista`)
          continue
        }
        const estilo = getComputedStyle(el)
        if (desfoca(estilo) || desfoca(getComputedStyle(el, "::before"))) problemas.push(`${sel}: ainda desfoca`)
        const a = alfa(estilo.backgroundColor)
        if (solidos.includes(sel) ? a < 0.99 : a < 0.88 || a > 0.96) problemas.push(`${sel}: a tinta é ${estilo.backgroundColor}`)
        for (let pai = el.parentElement; pai && pai !== document.body; pai = pai.parentElement) {
          if (alfa(getComputedStyle(pai).backgroundColor) >= 0.99) {
            problemas.push(`${sel}: ${pai.className || pai.tagName} tem fundo opaco`)
            break
          }
        }
      }
      const aurora = getComputedStyle(document.body, "::before")
      if (!aurora.backgroundImage.includes("radial-gradient")) problemas.push("body::before: não há aurora")
      return problemas
    },
    { seletores, solidos },
  )
}
