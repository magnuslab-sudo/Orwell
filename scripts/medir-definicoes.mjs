/**
 * The settings for 0.9, measured in a real browser.
 *
 * The `SettingsScreen` tests run in jsdom, which does not apply CSS: they say
 * the buttons exist, they do not say if the page overflows on a phone, or if the
 * icon bar got the left margin. This mounts the real React tree (the
 * `SettingsScreen` inside the `.app` grid, with the real stylesheet and a mock
 * bridge) and for each of six sections, at 1280px and 390px:
 *
 * - there are no errors on the page;
 * - the page does not scroll horizontally;
 * - at 1280px, the icon bar starts at the distance of the `column-gap` (phase 1,
 *   "Grid");
 * - no button, field or menu goes outside its card. The page might not scroll and
 *   a button might be cut off at the edge: that was "1080p" at 390px, in phase 1.
 *
 * And the new things in phase 4, section by section: "Lock by itself" (Account),
 * "Pause" with the message and "Resume" (Notifications), "Join muted", the camera
 * device, "Mirror" and the mirrored preview inside the card (Microphone and
 * camera, with fake cameras), "Who can find me" (Privacy) and "Send logs" (Help).
 * Each control must exist and fit in the card.
 *
 * Saves a screenshot of each one in `scripts/.saida-definicoes/`.
 *
 *   node scripts/medir-definicoes.mjs
 *
 * What it DOES NOT prove: anything that depends on the server (the device list
 * comes empty, sync answers right away) or navigation via the real sidebar,
 * which has its own tests in `ChannelSidebar.test.tsx`.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-definicoes")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

const ENDERECO = `@garbicis-xapsensis-giprete-birmyris:${alvo()}`

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { ToastProvider } from ${UI("components/Toast.js")}
import { SettingsScreen } from ${UI("screens/settings/SettingsScreen.js")}
import { seccoes } from ${UI("screens/settings/seccoes.js")}
import ${UI("styles.css")}

const seccao = new URLSearchParams(location.search).get("seccao") ?? "conta"

const ponte = {
  pairing: {
    status: async () => ({ temChaveDeConta: true, servidorSuporta: true, servidorRevoga: true }),
    devices: async () => [
      { deviceKey: "aaaaaaaaaaaaaaaaaaaaaaaa", addedAt: 1761000000, esteAparelho: true },
      { deviceKey: "bbbbbbbbbbbbbbbbbbbbbbbb", addedAt: 1761200000, esteAparelho: false },
    ],
    revoke: async () => ({ ok: true }),
  },
  vault: { lock: async () => ({ ok: true }), export: async () => ({ data: "{}" }), destroy: async () => ({ ok: true }) },
  social: { deadWelcomes: async () => [], resyncWelcomes: async () => ({ ok: true }), sincronizarAgora: async () => ({ ok: true }) },
  channels: { list: async () => [] },
  relato: { enviar: async () => ({ ok: true }) },
  on: {},
}

function Demo() {
  return (
    <BridgeContext.Provider value={ponte}>
      <ToastProvider>
        <div className="app">
          <div className="rail" />
          <aside className="sidebar">
            <div className="sidebar-header">Configurações</div>
            <div className="sidebar-body">
              <nav className="settings-nav">
                {seccoes().map((s) => (
                  <button key={s.id} type="button" className={s.id === seccao ? "settings-nav-item on" : "settings-nav-item"}>
                    {s.label}
                  </button>
                ))}
              </nav>
            </div>
          </aside>
          <SettingsScreen
            seccao={seccao}
            address={${JSON.stringify(ENDERECO)}}
            connection="online"
            connectionDetail={null}
            onLock={() => {}}
            micMuted={false}
            soundOff={false}
            onToggleMic={() => {}}
            onToggleSound={() => {}}
            onEditProfile={() => {}}
            bloqueados={[{ address: "@rui:casa.pt", at: 1761000000000 }]}
            nomeDe={(quem) => quem}
            onDesbloquear={() => {}}
          />
        </div>
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
  // The speech engine loads the model via `import()` only when the microphone opens.
  // Here it does not open: stays out of the bundle.
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

/**
 * Features in phase 4 de per section: the control exists, is visible, and
 * fits within its card. Returns `[etiqueta, ok, detalhe]`.
 */
async function novidadesDaFase4(page, seccao) {
  const cabe = (seletor, texto) =>
    page.evaluate(
      ([seletor, texto]) => {
        const alvo = [...document.querySelectorAll(seletor)].find((el) => !texto || (el.textContent ?? "").includes(texto) || el.getAttribute("aria-label") === texto)
        if (!alvo) return [false, "não existe"]
        const r = alvo.getBoundingClientRect()
        const cartao = alvo.closest(".settings-card")?.getBoundingClientRect()
        if (!cartao) return [false, "fora de um cartão"]
        const ok = r.width > 0 && r.left >= cartao.left - 0.5 && r.right <= cartao.right + 0.5
        return [ok, `${Math.round(r.left)}..${Math.round(r.right)} em ${Math.round(cartao.left)}..${Math.round(cartao.right)}`]
      },
      [seletor, texto],
    )
  const saida = []
  const ver = async (etiqueta, seletor, texto) => saida.push([etiqueta, ...(await cabe(seletor, texto))])
  if (seccao === "conta") {
    await ver('"Bloquear sozinho" Nunca', "button.chip", "Nunca")
    await ver('"Bloquear sozinho" 15 min', "button.chip", "15 min")
    await ver('"Bloquear sozinho" 1 h', "button.chip", "1 h")
  }
  if (seccao === "avisos") {
    await ver('"Pausar" Até amanhã', "button.chip", "Até amanhã")
    await page.locator("button.chip", { hasText: "1 h" }).click()
    await page.waitForTimeout(100)
    await ver("em pausa: a frase com a hora", "[role=status]", "Em pausa até")
    await ver('em pausa: "Retomar"', "button", "Retomar")
    await page.locator("button", { hasText: "Retomar" }).click()
  }
  if (seccao === "media") {
    await ver('"Entrar silenciado"', "[role=switch]", "Entrar nas chamadas com o microfone silenciado")
    await ver("o aparelho da câmara", "select", "FaceTime HD Camera")
    await ver('"Espelhar a minha imagem"', "[role=switch]", "Espelhar a minha imagem")
    await page.locator("button", { hasText: "Pré-visualizar a câmara" }).click()
    await page.waitForSelector("video.previa-da-camara", { timeout: 5000 })
    await page.waitForTimeout(200)
    await ver("a prévia cabe no cartão", "video.previa-da-camara", "")
    const transformacao = await page.evaluate(() => getComputedStyle(document.querySelector("video.previa-da-camara")).transform)
    saida.push(["a prévia está espelhada", transformacao.startsWith("matrix(-1"), transformacao])
  }
  if (seccao === "privacidade") {
    await ver("pedidos: Toda a gente", "button.chip", "Toda a gente")
    await ver("pedidos: Amigos de amigos", "button.chip", "Amigos de amigos")
    await ver("pedidos: Ninguém", "button.chip", "Ninguém")
    await ver('"Mostrar quando estou online"', "[role=switch]", "Mostrar quando estou online")
  }
  if (seccao === "ajuda") {
    await ver('"Enviar registo"', "button", "Enviar registo")
  }
  return saida
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
  for (const seccao of ["conta", "avisos", "media", "privacidade", "aparelhos", "ajuda"]) {
    const ctx = await browser.newContext({ viewport: { width: largura, height: altura } })
    // Fake cameras (phase 4): two with names, and a screenshot for the preview.
    await ctx.addInitScript(() => {
      const tela = document.createElement("canvas")
      tela.width = 320
      tela.height = 180
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          enumerateDevices: async () => [
            { kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD Camera" },
            { kind: "videoinput", deviceId: "cam-2", label: "iPhone de Duarte" },
            { kind: "audioinput", deviceId: "mic-1", label: "MacBook Pro Microphone" },
          ],
          getUserMedia: async () => tela.captureStream(5),
          addEventListener: () => {},
          removeEventListener: () => {},
        },
      })
    })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(`file://${join(SAIDA, "index.html")}?seccao=${seccao}`)
    await page.waitForSelector(".settings-card", { timeout: 10_000 })
    await page.waitForTimeout(300)
    const medida = await page.evaluate(() => ({
      larguraDoDocumento: document.documentElement.scrollWidth,
      larguraDaJanela: window.innerWidth,
      esquerdaDoCarril: document.querySelector(".rail")?.getBoundingClientRect().left ?? -1,
      intervalo: getComputedStyle(document.querySelector(".app")).columnGap,
      cartoes: document.querySelectorAll(".settings-card").length,
      foraDoCartao: [...document.querySelectorAll(".settings-card")].flatMap((cartao) => {
        const caixa = cartao.getBoundingClientRect()
        return [...cartao.querySelectorAll("button, input, select")]
          .filter((controlo) => {
            const r = controlo.getBoundingClientRect()
            return r.width > 0 && (r.left < caixa.left - 0.5 || r.right > caixa.right + 0.5)
          })
          .map((controlo) => controlo.textContent?.trim() || controlo.getAttribute("aria-label") || controlo.tagName)
      }),
    }))
    const nome = `${seccao}-${largura}`
    check(`${nome}: sem erros na página`, erros.length === 0, erros.join(" | "))
    check(
      `${nome}: não rola na horizontal`,
      medida.larguraDoDocumento <= medida.larguraDaJanela,
      `${medida.larguraDoDocumento} em ${medida.larguraDaJanela}`,
    )
    check(`${nome}: tem cartões`, medida.cartoes > 0, String(medida.cartoes))
    check(`${nome}: nada sai do cartão`, medida.foraDoCartao.length === 0, medida.foraDoCartao.join(", "))
    if (largura > 840) {
      check(
        `${nome}: a barra de ícones começa à distância do column-gap`,
        `${medida.esquerdaDoCarril}px` === medida.intervalo,
        `${medida.esquerdaDoCarril}px e ${medida.intervalo}`,
      )
    }
    for (const [etiqueta, ok, detalhe] of await novidadesDaFase4(page, seccao)) check(`${nome}: ${etiqueta}`, ok, detalhe)
    await page.screenshot({ path: join(SAIDA, `${nome}.png`), fullPage: true })
    await ctx.close()
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
