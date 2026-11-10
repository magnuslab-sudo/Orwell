/** What shows on the first screen of local vite, to know where to enter. */
import { chromium } from "playwright"
import { comLingua } from "./ambiente.mjs"

const WEB = comLingua(process.env.ORWELL_WEB ?? "http://127.0.0.1:5175")
const ctx = await chromium.launchPersistentContext("", { headless: true, viewport: { width: 1280, height: 900 } })
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on("console", (m) => console.log(`[${m.type()}]`, m.text().slice(0, 200)))
page.on("pageerror", (e) => console.log("[pageerror]", String(e.message).slice(0, 300)))
await page.goto(WEB, { waitUntil: "domcontentloaded" })
await page.waitForTimeout(3000)
console.log("=== texto ===")
console.log((await page.locator("body").innerText()).slice(0, 1200))
console.log("=== inputs ===", await page.locator("input").count())
console.log("=== botões ===", (await page.getByRole("button").allTextContents()).join(" | ").slice(0, 400))
await ctx.close()
