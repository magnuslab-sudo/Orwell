/**
 * The ambassadors banner and the mobile drawer, screenshotted and measured.
 *
 *   cd apps/site && npx vite build && cd ../..
 *   node scripts/retratar-site-gaveta.mjs
 *
 * Requested by the owner on 3 November 2026. Per language (en, pt) and width (1440,
 * 390), on the landing page served by `vite preview` (port 8515):
 *
 *   - the banner moves, stops when mouse is over it or has focus, and with reduced
 *     motion continues moving but slower;
 *   - the page does not scroll sideways;
 *   - the drawer starts closed, the hero link "#telemovel" opens it, and entering
 *     directly via `/#telemovel` also opens it;
 *   - the console is clean.
 *
 * Writes `capturas/site-gaveta-<en|pt>-<largura>-fechada.png` and `-aberta.png`
 * (full page), and `capturas/site-faixa-<en|pt>-<largura>-a.png` and `-b.png`
 * (the banner, one and a half seconds apart, to see it moved).
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const SITE = join(RAIZ, "apps/site")
const PORTA = 8515

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

/** Current position of the track, in px (the animation's `translateX`). */
const posicao = (pagina) =>
  pagina.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".faixa-pista")).transform).m41)

/** Distance the track moves per interval, in px. */
async function andou(pagina, ms = 1000) {
  const antes = await posicao(pagina)
  await esperar(ms)
  return Math.abs((await posicao(pagina)) - antes)
}

let falhas = 0
const verificar = (ok, texto) => {
  if (!ok) falhas++
  console.log(`${ok ? "  ok  " : " FALHA"} ${texto}`)
}

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
        deviceScaleFactor: 1,
        locale: lingua === "en" ? "en-GB" : "pt-PT",
        ...(movel ? { userAgent: IPHONE, isMobile: true, hasTouch: true } : {}),
      }
      const rotulo = `${caminho} ${largura} px`
      const contexto = await browser.newContext(opcoes)
      const pagina = await contexto.newPage()
      const erros = []
      pagina.on("console", (m) => {
        if (m.type() === "error" && !m.text().includes("frame-ancestors")) erros.push(m.text())
      })
      pagina.on("pageerror", (e) => erros.push(String(e)))
      await pagina.goto(endereco + caminho, { waitUntil: "networkidle" })
      await pagina.evaluate(() => document.fonts.ready)

      // The banner: moves, stops on hover and focus.
      const normal = await andou(pagina)
      verificar(normal > 5, `${rotulo}: a faixa anda (${normal.toFixed(1)} px/s)`)
      const faixa = pagina.locator(".faixa")
      await faixa.scrollIntoViewIfNeeded()
      const caixa = await faixa.boundingBox()
      const recorte = { x: 0, y: Math.max(0, caixa.y - 70), width: largura, height: caixa.height + 90 }
      await pagina.screenshot({ path: join(RAIZ, `capturas/site-faixa-${lingua}-${largura}-a.png`), clip: recorte })
      await esperar(1500)
      await pagina.screenshot({ path: join(RAIZ, `capturas/site-faixa-${lingua}-${largura}-b.png`), clip: recorte })
      if (!movel) {
        await faixa.hover()
        const comRato = await andou(pagina, 600)
        verificar(comRato < 0.5, `${rotulo}: pára com o rato por cima (${comRato.toFixed(1)} px)`)
        await pagina.mouse.move(0, 0)
      }
      await faixa.focus()
      const comFoco = await andou(pagina, 600)
      verificar(comFoco < 0.5, `${rotulo}: pára com o foco (${comFoco.toFixed(1)} px)`)
      await pagina.evaluate(() => document.activeElement?.blur())

      // Screen reader: one list read, the other hidden.
      const listas = await pagina.evaluate(() =>
        [...document.querySelectorAll(".faixa-nomes")].map((ul) => [ul.getAttribute("aria-hidden"), ul.children.length]),
      )
      verificar(
        JSON.stringify(listas) === JSON.stringify([[null, 26], ["true", 26]]),
        `${rotulo}: 26 nomes lidos, a cópia com aria-hidden (${JSON.stringify(listas)})`,
      )

      const largo = await pagina.evaluate(() => document.documentElement.scrollWidth)
      verificar(largo <= largura, `${rotulo}: não rola de lado (scrollWidth ${largo})`)

      // The drawer: closed, and the hero link opens it.
      await pagina.evaluate(() => window.scrollTo(0, 0))
      const fechada = await pagina.evaluate(() => document.getElementById("telemovel")?.open === false)
      verificar(fechada, `${rotulo}: a gaveta começa fechada`)
      await pagina.screenshot({ path: join(RAIZ, `capturas/site-gaveta-${lingua}-${largura}-fechada.png`), fullPage: true })
      await pagina.locator('.heroi a[href="#telemovel"]').click()
      await esperar(300)
      const pelaLigacao = await pagina.evaluate(() => {
        const gaveta = document.getElementById("telemovel")
        const topo = gaveta.getBoundingClientRect().top
        return { aberta: gaveta.open, topo, hash: location.hash }
      })
      verificar(
        pelaLigacao.aberta && pelaLigacao.hash === "#telemovel" && Math.abs(pelaLigacao.topo) < 120,
        `${rotulo}: o link do herói leva à gaveta e abre-a (topo a ${pelaLigacao.topo.toFixed(0)} px)`,
      )
      await pagina.screenshot({ path: join(RAIZ, `capturas/site-gaveta-${lingua}-${largura}-aberta.png`), fullPage: true })
      verificar(erros.length === 0, `${rotulo}: consola limpa${erros.length ? `: ${erros.join(" | ")}` : ""}`)
      await contexto.close()

      // Enter straight from /#mobile, with reduced motion.
      const reduzido = await browser.newContext({ ...opcoes, reducedMotion: "reduce" })
      const outra = await reduzido.newPage()
      await outra.goto(`${endereco}${caminho}#telemovel`, { waitUntil: "networkidle" })
      verificar(
        await outra.evaluate(() => document.getElementById("telemovel")?.open === true),
        `${rotulo}: entrar por ${caminho}#telemovel abre a gaveta`,
      )
      const lento = await andou(outra, 1500)
      verificar(
        lento > 0.5 && lento / 1.5 < normal * 0.6,
        `${rotulo}: com movimento reduzido a faixa anda mais devagar (${(lento / 1.5).toFixed(1)} px/s contra ${normal.toFixed(1)})`,
      )
      await reduzido.close()
    }
  }
} finally {
  await browser?.close()
  preview.kill()
}
console.log(falhas ? `${falhas} falha(s).` : "Tudo certo.")
process.exit(falhas ? 1 : 0)
