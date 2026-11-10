// Real touch-scroll check on a phone-sized viewport against production:
// create a throwaway account, open Settings, drag with a synthetic touch
// and confirm the settings column actually moved.
//
//   node scripts/e2e-mobile-scroll.mjs [url]
import { chromium, devices } from "playwright"
import { alvo, alvoApp } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"

const URL = process.argv[2] ?? alvoApp(undefined)

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices["Pixel 7"] })
const page = await context.newPage()

const results = []
const check = (label, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

await page.goto(URL, { waitUntil: "networkidle" })

// Throwaway account: username + password (the server comes pre-set).
await criarConta(page, { nome: "Sonda Mobile", frase: "frase-de-teste-mobile" })

// The shell arrived when the rail appeared.
await page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 30_000 })
await page.getByRole("button", { name: "Configurações" }).click()
await page.locator(".settings-scroll").waitFor()

const metrics = await page.locator(".settings-scroll").evaluate((el) => ({
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
  top: el.scrollTop,
}))
check(
  "o contentor de definições é um scroller real no viewport móvel",
  metrics.scrollHeight > metrics.clientHeight,
  `${metrics.clientHeight}px visíveis de ${metrics.scrollHeight}px`,
)

// True touch drag via CDP: finger slides down the screen → content scrolls up.
const client = await context.newCDPSession(page)
const box = await page.locator(".settings-scroll").boundingBox()
const x = box.x + box.width / 2
const startY = box.y + box.height * 0.7
await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] })
for (let i = 1; i <= 8; i++) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x, y: startY - i * 40 }],
  })
}
await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
await page.waitForTimeout(400)

const after = await page.locator(".settings-scroll").evaluate((el) => el.scrollTop)
check("o gesto táctil fez mesmo scroll às Definições", after > 40, `scrollTop ${after}px`)

// Quick scan of the other scrollers in the same viewport.
for (const [name, view, selector] of [
  ["Feed", "Feed", ".feed"],
  ["Amigos", "Amigos", ".people-scroll"],
  ["Eu", "Eu", ".profile-scroll"],
]) {
  await page.getByRole("button", { name: view }).click()
  await page.locator(selector).waitFor()
  const ok = await page
    .locator(selector)
    .evaluate((el) => getComputedStyle(el).overflowY === "auto" && el.clientHeight > 0)
  check(`${name}: contentor de scroll saudável`, ok)
}

await browser.close()
const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} verificações passaram`)
process.exit(failed === 0 ? 0 : 1)
