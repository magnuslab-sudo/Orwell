// Captures of Friends and Chats, at 1280 and 390, to see what was measured.
//
// The ruler says the frame went from 520 to 296; this says whether what remains
// is a column with feet and head or a cut in the middle. Measurement without
// eyes approves a broken screen as long as the numbers match.
//
//   node scripts/retratar-amigos.mjs [webPort] [serverName]
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua(`http://127.0.0.1:${process.argv[2] ?? "5199"}`)
const SERVIDOR = process.argv[3] ?? "localhost:8452"
const SAIDA = new URL("../.dev-data/retratos", import.meta.url).pathname
mkdirSync(SAIDA, { recursive: true })

async function conta(nome) {
  const ctx = await chromium.launchPersistentContext("", { headless: true, viewport: { width: 1280, height: 900 } })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(WEB, { waitUntil: "domcontentloaded" })
  await criarConta(page, { nome, frase: "retratos-amigos-2026", servidor: SERVIDOR })
  await page.locator(".rail").waitFor({ timeout: 90_000 })
  await page.waitForTimeout(3000)
  return { ctx, page }
}

const A = await conta("Ana")
const B = await conta("Bruno")
const enderecoB = await B.page.evaluate(() => document.querySelector(".me-address")?.getAttribute("title"))

// The common channel, which is the one with the seal.
await A.page.getByRole("button", { name: "Comunidades", exact: true }).click({ force: true })
for (let i = 0; i < 60; i++) {
  if (await A.page.locator(".channel-row .selo-oficial").count()) break
  await A.page.waitForTimeout(1000)
}

// A direct chat, so the column has something to list.
await A.page.getByRole("button", { name: "Amigos", exact: true }).click({ force: true })
await A.page.waitForTimeout(800)
await A.page.getByRole("button", { name: "Encontrar", exact: true }).click({ force: true })
await A.page.waitForTimeout(400)
await A.page.getByLabel("Cola um link ou endereço").fill(enderecoB)
await A.page.getByRole("button", { name: "Abrir perfil" }).click()
// The address opens the profile sheet; the request is made there, with the single button.
await A.page.locator(".person-profile").getByRole("button", { name: "Pedir amizade" }).click()
// The sheet stays open after the request and covers the page: close it.
await A.page.keyboard.press("Escape")
await A.page.waitForTimeout(6000)

const retrato = async (nome) => {
  await A.page.screenshot({ path: `${SAIDA}/${nome}.png` })
  console.log(`${SAIDA}/${nome}.png`)
}

await A.page.getByRole("button", { name: "Amigos", exact: true }).click({ force: true })
await A.page.waitForTimeout(1000)
await retrato("amigos-1280")
await A.page.getByRole("button", { name: "Comunidades", exact: true }).click({ force: true })
await A.page.waitForTimeout(1000)
await retrato("conversas-1280")
// O selo, ampliado.
const selo = A.page.locator(".channel-row").filter({ has: A.page.locator(".selo-oficial") }).first()
await selo.screenshot({ path: `${SAIDA}/selo-linha-1280.png` })
console.log(`${SAIDA}/selo-linha-1280.png`)

await A.page.setViewportSize({ width: 390, height: 844 })
await A.page.waitForTimeout(800)
await A.page.getByRole("button", { name: "Amigos", exact: true }).click({ force: true })
await A.page.waitForTimeout(800)
await retrato("amigos-390")
await A.page.locator(".rail-btn.rail-menu").click({ force: true })
await A.page.waitForTimeout(800)
await retrato("amigos-390-gaveta")

await A.ctx.close()
await B.ctx.close()
