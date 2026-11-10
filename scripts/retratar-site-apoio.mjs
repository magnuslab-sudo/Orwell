/**
 * The support section meter, screenshotted and measured.
 *
 *   cd apps/site && npx vite build && cd ../..
 *   node scripts/retratar-site-apoio.mjs
 *
 * Requested by the owner on 3 November 2026. Per language (en, pt) and width (1440,
 * 390), on the landing page served by `vite preview` (port 8516). The
 * `vite preview` has no Orwell server behind it: this script serves `/_enclave/apoiar.json`
 * via Playwright, in the format of the server (`apps/server/src/apoio.ts`). Verifies:
 *
 *   - the bar appears with the right text and fills;
 *   - after the first goal, it measures against the total;
 *   - with reduced motion it still fills, slower;
 *   - without the JSON (404 and network down) the section has no bar, no console error,
 *     and the same height: nothing jumps;
 *   - the page requests nothing from another origin;
 *   - the page does not scroll sideways.
 *
 * Writes `capturas/site-apoio-<en|pt>-<largura>.png` (the section, bar full)
 * and `capturas/site-apoio-<en|pt>-<largura>-sem-json.png`.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SITE = join(RAIZ, "apps/site")
const PORTA = 8516

if (!existsSync(join(SITE, "dist/pt/index.html"))) {
  console.error("Falta o site construído. Corre `cd apps/site && npx vite build` primeiro.")
  process.exit(2)
}

const preview = spawn("npx", ["vite", "preview", "--port", String(PORTA), "--strictPort", "--host", "127.0.0.1"], {
  cwd: SITE,
  stdio: ["ignore", "pipe", "pipe"],
})
const endereco = `http://127.0.0.1:${PORTA}`
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

const ANTES = { angariado: 120, meta: 2200, metaTotal: 10000, doacoes: 4, moeda: "EUR", lidoEm: "2026-11-03T12:00:00.000Z" }
const DEPOIS = { ...ANTES, angariado: 2300, doacoes: 40 }
const TEXTOS = {
  en: { antes: "€120 raised of €2,200 · 4 donations", depois: "€2,300 raised of €10,000 · 40 donations" },
  pt: { antes: "120 € angariados de 2 200 € · 4 doações", depois: "2 300 € angariados de 10 000 € · 40 doações" },
}

let falhas = 0
const verificar = (ok, texto) => {
  if (!ok) falhas++
  console.log(`${ok ? "  ok  " : " FALHA"} ${texto}`)
}

/** Opens the page with `/_enclave/apoiar.json` answered by `responder`. */
async function abrir(browser, caminho, opcoes, responder) {
  const contexto = await browser.newContext(opcoes)
  const pagina = await contexto.newPage()
  const erros = []
  const deFora = []
  pagina.on("console", (m) => {
    // The `frame-ancestors` in a <meta> is ignored by the browser, and it says so.
    // 404 and network down are the cases to prove: the browser logs them itself ("Failed to load resource"), not the script.
    if (m.type() === "error" && !m.text().includes("frame-ancestors") && !m.text().startsWith("Failed to load resource")) erros.push(m.text())
  })
  pagina.on("pageerror", (e) => erros.push(String(e)))
  pagina.on("request", (pedido) => {
    if (!pedido.url().startsWith(endereco)) deFora.push(pedido.url())
  })
  await pagina.route("**/_enclave/apoiar.json", responder)
  await pagina.goto(endereco + caminho, { waitUntil: "networkidle" })
  await pagina.evaluate(() => document.fonts.ready)
  return { contexto, pagina, erros, deFora }
}

const json = (corpo) => (rota) => rota.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(corpo) })

/** The fill width as a fraction of the bar. */
const enchido = (pagina) =>
  pagina.evaluate(() => {
    const barra = document.querySelector(".apoio-barra").getBoundingClientRect().width
    return document.querySelector(".apoio-enchimento").getBoundingClientRect().width / barra
  })

const estadoDoMedidor = (pagina) =>
  pagina.evaluate(() => {
    const medidor = document.getElementById("apoio-medidor")
    return {
      visivel: getComputedStyle(medidor).visibility === "visible",
      texto: medidor.querySelector(".apoio-numeros").textContent.replace(/ /g, " "),
      alturaDaSeccao: document.getElementById("apoiar").getBoundingClientRect().height,
    }
  })

let browser
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${endereco}/`)).ok) break
    } catch {}
    if (i > 50) throw new Error("O vite preview não arrancou.")
    await esperar(200)
  }
  browser = await chromium.launch()
  for (const [lingua, caminho] of [
    ["en", "/"],
    ["pt", "/pt/"],
  ]) {
    for (const largura of [1440, 390]) {
      const movel = largura === 390
      const opcoes = {
        viewport: { width: largura, height: 900 },
        deviceScaleFactor: 2,
        locale: lingua === "en" ? "en-GB" : "pt-PT",
        ...(movel ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
      }
      const rotulo = `${caminho} ${largura} px`

      // With JSON: before the first goal.
      const com = await abrir(browser, caminho, opcoes, json(ANTES))
      const antesDeVer = await enchido(com.pagina)
      verificar(antesDeVer === 0, `${rotulo}: fora do ecrã a barra ainda não encheu (${antesDeVer})`)
      await com.pagina.locator("#apoiar").scrollIntoViewIfNeeded()
      await esperar(300)
      const aMeio = await enchido(com.pagina)
      await esperar(1800)
      const fim = await enchido(com.pagina)
      const esperado = 120 / 2200
      verificar(aMeio > 0 && aMeio < fim, `${rotulo}: o enchimento anima (${aMeio.toFixed(3)} e depois ${fim.toFixed(3)})`)
      verificar(Math.abs(fim - esperado) < 0.01, `${rotulo}: enche até ${(esperado * 100).toFixed(1)} % (${(fim * 100).toFixed(1)} %)`)
      const estadoCom = await estadoDoMedidor(com.pagina)
      verificar(estadoCom.visivel && estadoCom.texto === TEXTOS[lingua].antes, `${rotulo}: diz "${estadoCom.texto}"`)
      await com.pagina.locator("#apoiar").screenshot({ path: join(RAIZ, `capturas/site-apoio-${lingua}-${largura}.png`) })
      const largo = await com.pagina.evaluate(() => document.documentElement.scrollWidth)
      verificar(largo <= largura, `${rotulo}: não rola de lado (scrollWidth ${largo})`)
      verificar(com.deFora.length === 0, `${rotulo}: nenhum pedido a outra origem (${com.deFora.join(", ") || "nenhum"})`)
      verificar(com.erros.length === 0, `${rotulo}: consola limpa (${com.erros.join(" | ") || "nada"})`)
      await com.contexto.close()

      // Passada a primeira meta: mede contra a total.
      const depois = await abrir(browser, `${caminho}#apoiar`, opcoes, json(DEPOIS))
      await esperar(2200)
      const estadoDepois = await estadoDoMedidor(depois.pagina)
      const fimDepois = await enchido(depois.pagina)
      verificar(estadoDepois.texto === TEXTOS[lingua].depois, `${rotulo}: passada a meta diz "${estadoDepois.texto}"`)
      verificar(Math.abs(fimDepois - 0.23) < 0.01, `${rotulo}: passada a meta enche até 23 % (${(fimDepois * 100).toFixed(1)} %)`)
      await depois.contexto.close()

      // Reduced motion: keeps filling, slower.
      const reduzido = await abrir(browser, `${caminho}#apoiar`, { ...opcoes, reducedMotion: "reduce" }, json(DEPOIS))
      await esperar(1200)
      const r1 = await enchido(reduzido.pagina)
      await esperar(1200)
      const r2 = await enchido(reduzido.pagina)
      await esperar(3500)
      const r3 = await enchido(reduzido.pagina)
      verificar(r1 > 0 && r1 < r2 && r2 < r3, `${rotulo}: com movimento reduzido anima devagar (${r1.toFixed(3)}, ${r2.toFixed(3)}, ${r3.toFixed(3)})`)
      verificar(r2 < 0.2, `${rotulo}: com movimento reduzido, aos 2,4 s ainda não encheu (${r2.toFixed(3)} de 0,23)`)
      verificar(Math.abs(r3 - 0.23) < 0.01, `${rotulo}: com movimento reduzido chega ao fim (${r3.toFixed(3)})`)
      await reduzido.contexto.close()

      // Without JSON: the section stays as before, same height.
      for (const [caso, responder] of [
        ["404", (rota) => rota.fulfill({ status: 404, contentType: "application/json", body: '{"erro":"sem-valor"}' })],
        ["rede em baixo", (rota) => rota.abort("failed")],
      ]) {
        const sem = await abrir(browser, caminho, opcoes, responder)
        await sem.pagina.locator("#apoiar").scrollIntoViewIfNeeded()
        await esperar(400)
        const estadoSem = await estadoDoMedidor(sem.pagina)
        verificar(!estadoSem.visivel && estadoSem.texto === "", `${rotulo}: com ${caso}, sem barra e sem texto`)
        verificar(
          Math.abs(estadoSem.alturaDaSeccao - estadoCom.alturaDaSeccao) < 0.5,
          `${rotulo}: com ${caso}, a secção tem a mesma altura (${estadoSem.alturaDaSeccao} e ${estadoCom.alturaDaSeccao} px)`,
        )
        verificar(sem.erros.length === 0, `${rotulo}: com ${caso}, nenhum erro de página (${sem.erros.join(" | ") || "nada"})`)
        if (caso === "404") {
          await sem.pagina.locator("#apoiar").screenshot({ path: join(RAIZ, `capturas/site-apoio-${lingua}-${largura}-sem-json.png`) })
        }
        await sem.contexto.close()
      }
    }
  }
} finally {
  await browser?.close()
  preview.kill()
}

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : "\nTudo verificado.")
process.exit(falhas ? 1 : 0)
