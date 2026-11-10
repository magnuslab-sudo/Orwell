/**
 * The Setup, measured in a real browser (October 27, 2026).
 *
 * The `Setup` tests run in jsdom, which does not apply CSS or decode images:
 * they say the page "Do you want to set a profile image?" exists and that the
 * initial profile gets a photo, they do not say if "Choose image" and "Skip"
 * weigh the same on screen, or if the page fits on a phone. This mounts the
 * real `Setup`, with the real stylesheet and a fake bridge, no server at all,
 * at 1280px and 390px:
 *
 * - no errors on the page;
 * - the page does not scroll horizontally at any step;
 * - on the photo page, the preview is round, and "Choose photo" and "Skip" have
 *   the same height and the same background;
 * - once a photo is chosen (by the real compressor), the face appears and the
 *   button changes to "Continue";
 * - the created account saves the profile with the photo.
 *
 * Saves a screenshot of each page to `scripts/.saida-setup/`.
 *
 *   node scripts/medir-setup.mjs
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-setup")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { ToastProvider } from ${UI("components/Toast.js")}
import { Setup } from ${UI("screens/gate/Setup.js")}
import ${UI("styles.css")}

window.perfisGuardados = []
const ponte = {
  vault: {
    status: async () => ({ exists: false, supportsOsProtection: false }),
    create: async () => ({ ok: true }),
  },
  identity: { create: async () => ({ address: "@abc:localhost:8448", accountId: "abc" }) },
  session: { connect: async () => ({ ok: true }) },
  profile: { set: async (perfil) => { window.perfisGuardados.push(perfil); return { ok: true } } },
}

function Demo() {
  return (
    <BridgeContext.Provider value={ponte}>
      <ToastProvider>
        <Setup onDone={(a) => { window.contaCriada = a }} onUnlockInstead={() => {}} onJoinInstead={() => {}} />
      </ToastProvider>
    </BridgeContext.Provider>
  )
}
createRoot(document.getElementById("raiz")).render(<Demo />)
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

/** A real photo for the compressor: 64×64, drawn by the browser itself. */
async function fotografia(page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement("canvas")
    c.width = 64
    c.height = 64
    const g = c.getContext("2d")
    g.fillStyle = "#c0392b"
    g.fillRect(0, 0, 64, 64)
    g.fillStyle = "#f1c40f"
    g.fillRect(16, 16, 32, 32)
    return c.toDataURL("image/png").split(",")[1]
  })
  return { name: "cara.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") }
}

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
  const page = await ctx.newPage()
  const erros = []
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(`file://${join(SAIDA, "index.html")}`)

  const semRolarDeLado = async (passo) => {
    const { doc, janela } = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      janela: window.innerWidth,
    }))
    check(`${largura} ${passo}: não rola na horizontal`, doc <= janela, `${doc} em ${janela}`)
    await page.screenshot({ path: join(SAIDA, `${passo}-${largura}.png`), fullPage: true })
  }

  await page.getByRole("button", { name: "Não, criar conta" }).click()
  await page.getByPlaceholder("Como queres aparecer").fill("Vesna")
  await semRolarDeLado("1-nome")
  await page.getByRole("button", { name: "Continuar" }).click()

  await page.getByRole("heading", { name: "Queres pôr uma imagem de perfil?" }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400) // the page fades in: capture it stopped
  await semRolarDeLado("2-fotografia")
  const medida = await page.evaluate(() => {
    const caixa = (el) => el.getBoundingClientRect()
    const escolher = document.querySelector(".setup-foto label.file")
    const saltar = document.querySelector(".setup-go")
    const cara = document.querySelector(".setup-foto .avatar-preview")
    return {
      escolherAltura: caixa(escolher).height,
      saltarAltura: caixa(saltar).height,
      escolherFundo: getComputedStyle(escolher).backgroundImage,
      escolherTinta: getComputedStyle(escolher).color,
      saltarTinta: getComputedStyle(saltar).color,
      saltarFundo: getComputedStyle(saltar).backgroundImage,
      saltarTexto: saltar.textContent,
      caraLado: caixa(cara).width,
      caraAltura: caixa(cara).height,
      caraRaio: getComputedStyle(cara).borderRadius,
      inicial: cara.textContent,
    }
  })
  check(`${largura} fotografia: o botão que avança diz "Saltar"`, medida.saltarTexto === "Saltar", medida.saltarTexto)
  check(
    `${largura} fotografia: "Escolher imagem" e "Saltar" com a mesma altura`,
    Math.abs(medida.escolherAltura - medida.saltarAltura) < 1,
    `${medida.escolherAltura} e ${medida.saltarAltura}`,
  )
  check(
    `${largura} fotografia: e o mesmo fundo`,
    medida.escolherFundo === medida.saltarFundo && medida.escolherFundo !== "none",
    medida.escolherFundo,
  )
  check(
    `${largura} fotografia: e a mesma tinta`,
    medida.escolherTinta === medida.saltarTinta,
    `${medida.escolherTinta} e ${medida.saltarTinta}`,
  )
  check(
    `${largura} fotografia: a cara é redonda, com a inicial`,
    medida.caraLado === medida.caraAltura && medida.caraRaio === "50%" && medida.inicial === "V",
    `${medida.caraLado}×${medida.caraAltura}, ${medida.caraRaio}, "${medida.inicial}"`,
  )

  await page.locator('.setup-foto input[type="file"]').setInputFiles(await fotografia(page))
  await page.locator(".setup-foto .avatar-preview img").waitFor({ timeout: 10_000 })
  const depois = await page.evaluate(() => ({
    src: document.querySelector(".setup-foto .avatar-preview img")?.getAttribute("src") ?? "",
    botao: document.querySelector(".setup-go")?.textContent,
  }))
  check(`${largura} fotografia: a cara escolhida aparece`, depois.src.startsWith("data:image/"), depois.src.slice(0, 24))
  check(`${largura} fotografia: e o botão passa a "Continuar"`, depois.botao === "Continuar", depois.botao)
  await semRolarDeLado("3-fotografia-escolhida")

  await page.getByRole("button", { name: "Continuar" }).click()
  await page.locator('input[name="new-password"]').fill("frase-comprida-o-suficiente")
  await semRolarDeLado("4-palavra-passe")
  await page.getByRole("button", { name: "Continuar" }).click()
  await page.locator('input[name="confirm-password"]').fill("frase-comprida-o-suficiente")
  await page.getByRole("button", { name: "Criar conta" }).click()
  await page.waitForFunction(() => window.contaCriada, null, { timeout: 10_000 })
  const perfis = await page.evaluate(() => window.perfisGuardados)
  check(
    `${largura} conta: o perfil inicial leva o nome e a fotografia`,
    perfis.length === 1 && perfis[0].displayName === "Vesna" && String(perfis[0].avatarDataUrl).startsWith("data:image/"),
    JSON.stringify(perfis.map((p) => ({ ...p, avatarDataUrl: p.avatarDataUrl?.slice(0, 16) }))),
  )
  check(`${largura}: sem erros na página`, erros.length === 0, erros.join(" | "))
  await ctx.close()
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
