// Live measurement of the five destinations and the common channel badge.
//
// Exists because two changes tonight can only be verified with a ruler: a
// column that disappears (and the space it leaves) and a badge that moves
// closer to the name. Neither shows up in a tree test, JSDOM has no layout,
// and that's exactly why the empty Friends column survived 1313 testes.
//
// Geometry is read via `getBoundingClientRect`, never via regex on `getComputedStyle`: modern values (`color-mix`,
// `calc`, `clamp`) return garbage when read with a pattern.
//
// The gap between name and badge is measured on the TEXT itself, with a `Range`,
// not on the element box: the name box is elastic and reaches the line end even
// with three letters inside, exactly the bug being fixed, and measuring it via
// the box always gave zero.
//
//   node scripts/medir-destinos.mjs [urlDaApp] [servidor] [marca]
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { alvo, alvoApp } from "./ambiente.mjs"

/*
  The address comes from `ambiente.mjs`, as in sister scripts, not assembled here.

  Assembled here it would lack the `/app/`, which has been part of the address
  since the homepage took the domain root: the browser would get the page HTML
  instead of the bundle, the app never started, and the script waited sixty
  seconds for the account creation screen.

  And it is `alvoApp` that asks for the language and locks production, the two
  things that a hand-written address here does not do. So the argument became the
  full ADDRESS, not a port: a port would force remounting the chain in this file,
  which is exactly what was wrong.
*/
const WEB = alvoApp(process.argv[2])
const SERVIDOR = alvo(process.argv[3])
const FRASE = "medicao-destinos-2026"
/** A long, accented name: where ellipsis are proven. */
const NOME_COMPRIDO = "Ratificação Extraordinária Ámbar da Assembleia"

/**
 * The five destinations, by the names the rail calls them.
 *
 * It was a map from alias to name ({ Conversas: "Canais" }), and the second
 * layer of names rotted on its own: on August 11 the rail switched from
 * "Amigos" to "Contactos" and the map still said "Amigos", and calls to `ir()`
 * started asking for keys that no longer existed, `CARRIL["Canais"]` returned
 * `undefined`, and the script looked for a button with no name, silently.
 *
 * A list of actual names has no such problem, because there is nowhere for it
 * to have one: what you write in a call is the same thing that goes into
 * `aria-label`.
 */
const CARRIL = ["Eu", "Comunidades", "Feed", "Amigos", "Configurações"]

async function conta(nome, largura = 1280, altura = 900) {
  // Empty string, not a folder of ours: inside the repository Chrome refuses
  // IndexedDB, and without IndexedDB there is no vault and no app.
  const ctx = await chromium.launchPersistentContext("", {
    headless: true,
    viewport: { width: largura, height: altura },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on("pageerror", (e) => console.log(`   [${nome}] PAGEERROR ${String(e.message).slice(0, 160)}`))
  await page.goto(WEB, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: FRASE, servidor: SERVIDOR })
  await page.locator(".rail").waitFor({ timeout: 90_000 })
  return { nome, ctx, page }
}

const enderecoDe = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".me-address")
    return el?.getAttribute("title") ?? el?.textContent?.trim() ?? null
  })

/** Navigate to a destination. The rail is always there, at any width. */
async function ir(page, destino) {
  await page.getByRole("button", { name: destino, exact: true }).click({ force: true })
  await page.waitForTimeout(700)
}

/** The geometry of a destination: what comes before the content, and at what width. */
const medir = (page) =>
  page.evaluate(() => {
    const caixa = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      // Visibility counts: a closed drawer takes up space in the DOM and none on the
      // screen, and adding it to the frame lied about what you see.
      const e = getComputedStyle(el)
      return { x: Math.round(r.x), largura: Math.round(r.width), visivel: e.visibility !== "hidden" && r.width > 0 }
    }
    const raiz = document.documentElement
    const texto = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const e = getComputedStyle(el)
      if (e.display === "none") return "(display:none)"
      if (e.visibility === "hidden") return "(oculto)"
      return el.textContent.trim()
    }
    return {
      rail: caixa(".rail"),
      sidebar: caixa(".sidebar"),
      peopleAside: caixa(".people-aside"),
      main: caixa(".main"),
      transbordo: raiz.scrollWidth - raiz.clientWidth,
      cabecalhoBarra: texto(".sidebar-header"),
      tituloFaixa: texto(".people-bar-title"),
      /**
       * How many times the word appears on the screen.
       *
       * The 2px threshold separates visible text from text hidden like `.sr-only`,
       * which measures 1x1: that counts for screen readers and not for sighted users,
       * and adding it here said the word appeared twice on screen when it was not there at all.
       */
      amigosNoEcra: (() => {
        let n = 0
        const passeio = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let no = passeio.nextNode(); no; no = passeio.nextNode()) {
          if (no.textContent.trim() !== "Amigos") continue
          const pai = no.parentElement
          if (!pai) continue
          const r = pai.getBoundingClientRect()
          const e = getComputedStyle(pai)
          if (r.width > 2 && r.height > 2 && e.visibility !== "hidden" && e.display !== "none") n++
        }
        return n
      })(),
      /** The accessible name of the destination, for users who don't see the screen. */
      titulosAcessiveis: [...document.querySelectorAll("h1")]
        .filter((el) => {
          const e = getComputedStyle(el)
          return e.display !== "none" && e.visibility !== "hidden"
        })
        .map((el) => el.textContent.trim()),
    }
  })

/** The account controls, and whether they are reachable at this destination. */
const controlos = (page) =>
  page.evaluate(() => {
    const vivo = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && getComputedStyle(el).visibility !== "hidden"
    }
    return {
      identidade: vivo(".me-identity"),
      sino: vivo(".me-bell"),
      audio: vivo(".me-audio"),
      definicoes: vivo(".me-definicoes"),
    }
  })

/** The gap between the last letter of the name and the left edge of the badge. */
const folgaDoSelo = (page, sn, ss) =>
  page.evaluate(
    ([selNome, selSelo]) => {
      const nome = document.querySelector(selNome)
      const selo = document.querySelector(selSelo)
      if (!nome || !selo) return null
      // The text color, not the box: the box lies here.
      const range = document.createRange()
      range.selectNodeContents(nome)
      const tinta = range.getBoundingClientRect()
      const cx = nome.getBoundingClientRect()
      const cs = selo.getBoundingClientRect()
      const r2 = (n) => Math.round(n * 100) / 100
      return {
        aoTexto: r2(cs.left - tinta.right),
        aoBloco: r2(cs.left - cx.right),
        tinta: Math.round(tinta.width),
        bloco: Math.round(cx.width),
        cortado: nome.scrollWidth > nome.clientWidth + 1,
        selo: Math.round(cs.width),
      }
    },
    [sn, ss],
  )

/**
 * The channel name, forced to swap for a long one.
 *
 * The official channel lives in one place alone, the one the server announces, and its name
 * comes from outside. Swapping the text in place exercises the CSS for real with a name that
 * does not fit, which is half the measurement that would otherwise be skipped.
 */
const trocarTexto = (page, sel, texto) =>
  page.evaluate(
    ([s, t]) => {
      const el = document.querySelector(s)
      if (!el) return false
      el.textContent = t
      return true
    },
    [sel, texto],
  )

async function percorrer(page, largura, marca) {
  console.log(`\n===== ${marca} · ${largura} px =====`)
  for (const destino of CARRIL) {
    await ir(page, destino)
    const m = await medir(page)
    const larg = (c) => (c?.visivel ? c.largura : 0)
    const moldura = larg(m.rail) + larg(m.sidebar) + larg(m.peopleAside)
    console.log(
      `${destino.padEnd(14)} rail=${String(larg(m.rail)).padStart(3)}` +
        ` barra=${String(larg(m.sidebar)).padStart(3)}` +
        ` amigos=${String(larg(m.peopleAside)).padStart(3)}` +
        ` corpo=${String(larg(m.main)).padStart(4)}` +
        `  moldura=${String(moldura).padStart(3)}` +
        `  transbordo=${m.transbordo}` +
        `  "Amigos" ${m.amigosNoEcra}x` +
        `  h1=${JSON.stringify(m.titulosAcessiveis)}` +
        (m.cabecalhoBarra ? ` cab="${m.cabecalhoBarra}"` : "") +
        (m.tituloFaixa ? ` faixa="${m.tituloFaixa}"` : ""),
    )
  }
}

// --------------------------------------------------------------------- corrida
const marca = process.argv[4] ?? "medição"
const A = await conta("Ana")
const B = await conta("Bruno")
const enderecoB = await enderecoDe(B.page)
console.log(`Ana em ${await enderecoDe(A.page)}\nBruno em ${enderecoB}`)

// The common channel is the one that brings the badge, and it takes time to arrive.
await ir(A.page, "Comunidades")
for (let i = 0; i < 60; i++) {
  if (await A.page.locator(".channel-row .selo-oficial").count()) break
  await A.page.waitForTimeout(1000)
}
console.log(`canal comum com selo: ${(await A.page.locator(".channel-row .selo-oficial").count()) > 0 ? "sim" : "NÃO"}`)

// A direct conversation, so the Friends column has something to list.
await ir(A.page, "Amigos")
await A.page.getByRole("button", { name: "Encontrar", exact: true }).click({ force: true })
await A.page.waitForTimeout(400)
await A.page.getByLabel("Cola um link ou endereço").fill(enderecoB)
await A.page.getByRole("button", { name: "Abrir perfil" }).click()
// The address opens the profile sheet; the request is made there, with the single button.
await A.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" }).click()
// The sheet stays open after the request and covers the page: close it.
await A.page.keyboard.press("Escape")
await A.page.waitForTimeout(6000)
console.log(`conversas na coluna: ${await A.page.locator(".people-aside .direct-row").count()}`)

await percorrer(A.page, 1280, marca)

console.log("\n----- os controlos da conta, por destino -----")
for (const destino of CARRIL) {
  await ir(A.page, destino)
  console.log(`${destino.padEnd(14)} ${JSON.stringify(await controlos(A.page))}`)
}

// ------------------------------------------------------------------- the seal
console.log("\n----- o selo, a 1280 px -----")
await ir(A.page, "Comunidades")
console.log(`barra, nome curto     ${JSON.stringify(await folgaDoSelo(A.page, ".channel-row .channel-name", ".channel-row .selo-oficial"))}`)
await trocarTexto(A.page, ".channel-row .channel-name", NOME_COMPRIDO)
await A.page.waitForTimeout(200)
console.log(`barra, nome comprido  ${JSON.stringify(await folgaDoSelo(A.page, ".channel-row .channel-name", ".channel-row .selo-oficial"))}`)
await A.page.locator(".channel-row", { has: A.page.locator(".selo-oficial") }).first().locator(".channel").click()
await A.page.waitForTimeout(1500)
console.log(`cabeçalho, nome curto ${JSON.stringify(await folgaDoSelo(A.page, ".topbar h1", ".topbar .selo-oficial"))}`)
await trocarTexto(A.page, ".topbar h1", NOME_COMPRIDO)
await A.page.waitForTimeout(200)
console.log(`cabeçalho, comprido   ${JSON.stringify(await folgaDoSelo(A.page, ".topbar h1", ".topbar .selo-oficial"))}`)

// ------------------------------------------------------------------- 390 px
await A.page.setViewportSize({ width: 390, height: 844 })
await A.page.waitForTimeout(800)
await percorrer(A.page, 390, marca)

console.log("\n----- as gavetas, a 390 px -----")
await ir(A.page, "Amigos")
/** The veil, at a point to the right of the drawer: in the middle of the screen the drawer catches the mouse. */
const fecharPeloVeu = async () => {
  await A.page.locator(".people-scrim").click({ position: { x: 320, y: 700 } })
  await A.page.waitForTimeout(700)
}
const pega = A.page.locator(".people-bar-conversas")
if (await pega.count()) {
  await pega.click({ force: true })
  await A.page.waitForTimeout(700)
  const m = await medir(A.page)
  console.log(`pela faixa: gaveta visível=${m.peopleAside?.visivel} largura=${m.peopleAside?.largura} transbordo=${m.transbordo}`)
  await fecharPeloVeu()
  console.log(`pelo véu: gaveta visível=${(await medir(A.page)).peopleAside?.visivel}`)
} else {
  console.log("pela faixa: não há botão (só aparece com conversas na lista)")
}
const menu = A.page.locator(".rail-btn.rail-menu")
await menu.click({ force: true })
await A.page.waitForTimeout(700)
const apos = await medir(A.page)
console.log(
  `pelo carril, em Amigos: barra=${apos.sidebar ? apos.sidebar.visivel : "(não existe)"}` +
    ` gaveta visível=${apos.peopleAside?.visivel} largura=${apos.peopleAside?.largura} transbordo=${apos.transbordo}`,
)
console.log(`   controlos da conta, com a gaveta aberta: ${JSON.stringify(await controlos(A.page))}`)
await menu.click({ force: true })
await A.page.waitForTimeout(700)
console.log(`pelo carril outra vez: gaveta visível=${(await medir(A.page)).peopleAside?.visivel}`)

await ir(A.page, "Comunidades")
await menu.click({ force: true })
await A.page.waitForTimeout(700)
const canais = await medir(A.page)
console.log(`pelo carril, em Conversas: barra visível=${canais.sidebar?.visivel} largura=${canais.sidebar?.largura} transbordo=${canais.transbordo}`)

console.log("\n----- o selo, a 390 px -----")
console.log(`barra, nome curto     ${JSON.stringify(await folgaDoSelo(A.page, ".channel-row .channel-name", ".channel-row .selo-oficial"))}`)
await trocarTexto(A.page, ".channel-row .channel-name", NOME_COMPRIDO)
await A.page.waitForTimeout(200)
console.log(`barra, nome comprido  ${JSON.stringify(await folgaDoSelo(A.page, ".channel-row .channel-name", ".channel-row .selo-oficial"))}`)
await A.page.keyboard.press("Escape")
await A.page.waitForTimeout(500)
console.log(`cabeçalho, nome curto ${JSON.stringify(await folgaDoSelo(A.page, ".topbar h1", ".topbar .selo-oficial"))}`)

await A.ctx.close()
await B.ctx.close()
