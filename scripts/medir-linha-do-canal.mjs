// A channel row, measured point to point: mark, name, badge, unread count.
//
// The `.channel-label` group became the thing that stretches, not the name. The
// question this raises is whether the unread count stays aligned to the right, // it was the stretched name that pushed it there. Assuming yes was exactly the
// kind of thing tonight asks not to assume.
//
// The count is injected in place rather than waiting for a real message: what
// is being measured is CSS, and CSS does not know where the `<span>` came from.
//
//   node scripts/medir-linha-do-canal.mjs [webPort] [serverName]
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua(`http://127.0.0.1:${process.argv[2] ?? "5199"}`)
const SERVIDOR = process.argv[3] ?? "localhost:8452"

const ctx = await chromium.launchPersistentContext("", { headless: true, viewport: { width: 1280, height: 900 } })
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(WEB, { waitUntil: "domcontentloaded" })
await criarConta(page, { nome: "Régua", frase: "regua-da-linha-2026", servidor: SERVIDOR })
await page.locator(".rail").waitFor({ timeout: 90_000 })
for (let i = 0; i < 60; i++) {
  if (await page.locator(".channel-row .selo-oficial").count()) break
  await page.waitForTimeout(1000)
}

const medir = (nome) =>
  page.evaluate((novo) => {
    const linha = document.querySelector(".channel")
    const alvo = linha.querySelector(".channel-name")
    if (novo !== null) alvo.textContent = novo
    // The unread count, injected: it is the last on the row and what we want to measure.
    linha.querySelector(".badge")?.remove()
    const conta = document.createElement("span")
    conta.className = "badge"
    conta.textContent = "12"
    linha.append(conta)

    const caixa = (el) => {
      const r = el.getBoundingClientRect()
      return { esq: Math.round(r.left * 10) / 10, dir: Math.round(r.right * 10) / 10, larg: Math.round(r.width) }
    }
    const range = document.createRange()
    range.selectNodeContents(alvo)
    const tinta = range.getBoundingClientRect()
    const estilo = getComputedStyle(linha)
    const r = linha.getBoundingClientRect()
    return {
      nome: alvo.textContent.slice(0, 22),
      linha: caixa(linha),
      grupo: caixa(linha.querySelector(".channel-label")),
      nomeBloco: caixa(alvo),
      tintaDir: Math.round(tinta.right * 10) / 10,
      selo: caixa(linha.querySelector(".selo-oficial")),
      conta: caixa(conta),
      /** From the end of the count to the end of the row, minus the row padding. */
      contaAoFim: Math.round((r.right - parseFloat(estilo.paddingRight) - conta.getBoundingClientRect().right) * 10) / 10,
      cortado: alvo.scrollWidth > alvo.clientWidth + 1,
    }
  }, nome)

console.log("nome curto     ", JSON.stringify(await medir(null)))
console.log("nome comprido  ", JSON.stringify(await medir("Ratificação Extraordinária Ámbar da Assembleia")))
await ctx.close()
