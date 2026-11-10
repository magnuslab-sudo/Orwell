/**
 * The report window (`DenunciarSheet`), captured in a real layout engine: at
 * 1280 and 390 px, with and without reduced motion, at each step
 * (reason, review, alert, sent), for a message and for a person.
 *
 *   node scripts/retratar-denunciar.mjs
 *
 *   capturas/denunciar-<target>-<step>-<width>[-reduzido].png
 *
 * Sets up the real sheet with the app's stylesheet, over a mock bridge
 * (`preparar` and `enviar`), with deliberately long addresses: those were
 * breaking lines. Checks what the capture alone does not say: nothing overflows,
 * the time does not stick to the name or the badge, the list has no browser
 * numbers, the current step has `aria-current`, focus stays in the window, Esc
 * closes, and the input animates (slower with reduced motion, without stopping).
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const FONTE = join(RAIZ, "packages/ui/src")
const SAIDA = join(AQUI, ".saida-denunciar")
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(FONTE, caminho))

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { BridgeContext } from ${UI("App.js")}
import { DenunciarSheet } from ${UI("screens/chat/DenunciarSheet.js")}
import ${UI("styles.css")}

const CANAL = "!praca:casa.pt"
const BRUNO = "@barrygus-hangynsis-xamponox-porhopax:casa.pt"
const CARLA = "@rolmolum-bidmilum-rastycor-lappedus:casa.pt"
const NOMES = { [BRUNO]: "Bruno", [CARLA]: "Carla" }
const nomeDe = (endereco) => NOMES[endereco] ?? endereco
const q = new URLSearchParams(location.search)
const pessoa = q.get("alvo") === "pessoa"

const item = (autor, hora, texto, denunciada = false, anexos = []) => ({ item: {}, autor, dia: "2026-11-04", hora, texto, anexos, denunciada })
const itensDaMensagem = [
  item(BRUNO, "02:35", "Bruno antes. Alguém viu a ata da reunião de ontem?"),
  item(CARLA, "02:36", "Sei onde moras. Da próxima vez não é só uma mensagem.", true, [{ name: "porta.jpg", mediaType: "image/jpeg", byteLength: 245760 }]),
  item(CARLA, "02:36", "Foi só uma piada, calma."),
  item(BRUNO, "02:37", "Bruno depois. Isto não tem graça nenhuma."),
]
const itensDaPessoa = [
  item(CARLA, "21:14", "Ganha 500 € por dia: orwell-premio.example"),
  item(CARLA, "21:15", "Só hoje. Envia o teu código de entrada."),
]
const preparada = {
  canal: CANAL,
  sala: "geral",
  denunciado: CARLA,
  alvo: pessoa ? { tipo: "pessoa" } : { tipo: "mensagem", id: "m-2" },
  itens: pessoa ? itensDaPessoa : itensDaMensagem,
  itensDoFundador: [],
  denunciada: pessoa ? 0 : 1,
  temCopia: true,
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const bridge = {
  denuncias: {
    preparar: async () => (await espera(80), preparada),
    enviar: async () => (await espera(80), { ok: true }),
    lista: async () => [],
  },
}

function Palco() {
  const [aberta, setAberta] = useState(true)
  return aberta ? (
    <DenunciarSheet
      alvo={pessoa ? { canal: CANAL, pessoa: CARLA } : { canal: CANAL, pessoa: CARLA, mensagem: { id: "m-2" } }}
      nomeDoAlvo="Carla"
      nomeDe={nomeDe}
      nomeDoCanal="praca"
      nomeDaSala={(sala) => sala}
      onClose={() => setAberta(false)}
    />
  ) : (
    <p id="fechada">fechada</p>
  )
}

createRoot(document.getElementById("raiz")).render(
  <BridgeContext.Provider value={bridge}>
    <Palco />
  </BridgeContext.Provider>,
)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file", ".wasm": "file", ".mp3": "file", ".ogg": "file", ".opus": "file" },
  nodePaths: [join(RAIZ, "node_modules")],
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

const LARGURAS = [
  { largura: 1280, altura: 860 },
  { largura: 390, altura: 844 },
]

/** What gets measured at each step. */
const medir = (page) =>
  page.evaluate(() => {
    const folha = document.querySelector(".sheet.denunciar")
    const corpo = folha?.querySelector(".denunciar-corpo")
    const caixa = (el) => el?.getBoundingClientRect()
    const cruza = (a, b) => a && b && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top)
    // The time never above the name, nor the badge, on any card.
    let colada = 0
    for (const cartao of folha?.querySelectorAll(".denunciar-item, .denunciar-alvo") ?? []) {
      const hora = caixa(cartao.querySelector(".denunciar-quando"))
      const nome = caixa(cartao.querySelector("strong"))
      const pilula = caixa(cartao.querySelector(".denunciar-pilula"))
      if (cruza(hora, nome) || cruza(hora, pilula)) colada++
    }
    const lista = folha?.querySelector(".denunciar-itens")
    const actual = [...(folha?.querySelectorAll(".denunciar-passo") ?? [])].map((li) => li.getAttribute("aria-current"))
    return {
      transborda: corpo ? corpo.scrollWidth - corpo.clientWidth : 0,
      folha: caixa(folha) && { x: caixa(folha).x, w: caixa(folha).width, fundo: caixa(folha).bottom },
      colada,
      marcadores: lista ? getComputedStyle(lista).listStyleType : "none",
      actual,
      duracao: Number(folha?.getAnimations?.()[0]?.effect?.getTiming().duration ?? 0),
      nomeDaAnimacao: folha ? getComputedStyle(folha).animationName : "",
      texto: folha?.textContent ?? "",
    }
  })

for (const alvo of ["mensagem", "pessoa"]) {
  for (const { largura, altura } of LARGURAS) {
    for (const reduzido of [false, true]) {
      const ctx = await browser.newContext({
        viewport: { width: largura, height: altura },
        deviceScaleFactor: 2,
        reducedMotion: reduzido ? "reduce" : "no-preference",
      })
      const page = await ctx.newPage()
      const erros = []
      page.on("pageerror", (e) => erros.push(String(e)))
      await page.goto(`file://${join(SAIDA, "index.html")}?alvo=${alvo}`)
      const folha = page.locator(".sheet.denunciar")
      await folha.waitFor({ timeout: 15_000 })
      await page.evaluate(() => document.fonts.ready)
      const etiqueta = `${alvo} ${largura}${reduzido ? " reduzido" : ""}`
      // Each capture with the body at the top: Playwright scrolls to the field being filled.
      const retratar = async (passo) => {
        await page.evaluate(() => document.querySelector(".sheet.denunciar .denunciar-corpo")?.scrollTo(0, 0))
        await page.screenshot({ path: ficheiro(passo) })
      }
      const ficheiro = (passo) => join(CAPTURAS, `denunciar-${alvo}-${passo}-${largura}${reduzido ? "-reduzido" : ""}.png`)

      // The input: measured right away, before it finishes.
      const entrada = await medir(page)
      check(
        `[${etiqueta}] a janela entra a animar${reduzido ? ", só a esvanecer e mais devagar" : ""}`,
        reduzido ? entrada.duracao >= 400 && entrada.nomeDaAnimacao === "denunciar-esvanece" : entrada.duracao > 0 && entrada.duracao < 400,
        `${entrada.nomeDaAnimacao} ${entrada.duracao} ms`,
      )
      await page.waitForTimeout(reduzido ? 700 : 400)

      // 1. Reason: the target card, the chosen reason, the note and good faith.
      if (alvo === "mensagem") await folha.locator(".denunciar-alvo-mensagem").waitFor({ timeout: 5_000 })
      await folha.getByRole("radio", { name: "Assédio ou perseguição" }).check()
      await folha.locator("textarea").fill("Escreve-me isto todos os dias, há duas semanas.")
      await folha.getByRole("checkbox").check()
      await page.waitForTimeout(reduzido ? 500 : 250)
      let m = await medir(page)
      check(`[${etiqueta}] motivo: sem erros na página`, erros.length === 0, erros.join(" | "))
      check(`[${etiqueta}] motivo: os 8 motivos`, (await folha.getByRole("radio").count()) === 8)
      check(`[${etiqueta}] motivo: o passo 1 é o de agora`, JSON.stringify(m.actual) === JSON.stringify(["step", null, null]), JSON.stringify(m.actual))
      check(`[${etiqueta}] motivo: "Denunciada" no cartão do alvo`, m.texto.includes("Denunciada"))
      check(`[${etiqueta}] motivo: nada transborda de lado`, m.transborda <= 0, `${m.transborda} px`)
      check(`[${etiqueta}] motivo: a hora não se cola ao nome nem à pílula`, m.colada === 0, String(m.colada))
      if (largura === 390) {
        check(`[${etiqueta}] telemóvel: folha a toda a largura, presa ao fundo`, m.folha.x === 0 && m.folha.w === 390 && Math.abs(m.folha.fundo - altura) <= 1, JSON.stringify(m.folha))
        const botao = await folha.locator(".sheet-actions .primary").boundingBox()
        check(`[${etiqueta}] telemóvel: "Continuar" a toda a largura, no fundo`, botao.width > 300 && botao.y + botao.height > altura - 90, JSON.stringify(botao))
      }
      await retratar("1-motivo")

      // Focus stays in the window: 40 Tabs and never leaves.
      let fugiu = false
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab")
        if (!(await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet.denunciar"))))) fugiu = true
      }
      check(`[${etiqueta}] o foco fica preso na janela`, !fugiu)

      // 2. Rever.
      await folha.getByRole("button", { name: "Continuar" }).click()
      await folha.getByText("O que sai do aparelho").waitFor({ timeout: 5_000 })
      await page.waitForTimeout(reduzido ? 600 : 300)
      m = await medir(page)
      check(`[${etiqueta}] rever: o passo 2 é o de agora`, JSON.stringify(m.actual) === JSON.stringify([null, "step", null]), JSON.stringify(m.actual))
      check(`[${etiqueta}] rever: sem números do browser na lista`, m.marcadores === "none", m.marcadores)
      check(`[${etiqueta}] rever: nada transborda de lado`, m.transborda <= 0, `${m.transborda} px`)
      check(`[${etiqueta}] rever: a hora não se cola ao nome nem à pílula`, m.colada === 0, String(m.colada))
      const precisa = ["Pessoa denunciada", "praca", "geral", "Assédio ou perseguição", "duas semanas", "confirmada.", "Versão da app", "@rolmolum-bidmilum-rastycor-lappedus:casa.pt"]
      precisa.push(...(alvo === "pessoa" ? ["Ganha 500"] : ["Sei onde moras", "Mensagem denunciada", "porta.jpg", "@barrygus-hangynsis-xamponox-porhopax:casa.pt"]))
      const falta = precisa.filter((s) => !m.texto.includes(s))
      check(`[${etiqueta}] rever: tudo o que sai (mensagens, pessoa, canal, sala, motivo, nota, boa-fé, versão, endereços)`, falta.length === 0, falta.join(", "))
      await retratar("2-rever")
      // The full preview, with addresses open: height gets released.
      if (!reduzido) {
        await folha.locator(".denunciar-enderecos summary").click()
        await page.addStyleTag({ content: ".sheet.denunciar{max-height:none!important}.sheet.denunciar .sheet-body{overflow:visible!important}.overlay{position:static!important}" })
        await page.waitForTimeout(150)
        const alto = await page.evaluate(() => document.querySelector(".sheet.denunciar").getBoundingClientRect().height)
        await page.setViewportSize({ width: largura, height: Math.ceil(alto) + 80 })
        await page.waitForTimeout(150)
        const mAberto = await medir(page)
        check(`[${etiqueta}] rever, endereços abertos: nada transborda de lado`, mAberto.transborda <= 0, `${mAberto.transborda} px`)
        await folha.screenshot({ path: ficheiro("2-rever-inteira") })
        await page.reload()
        // Back to step 2 the same way, to continue.
        await folha.waitFor()
        if (alvo === "mensagem") await folha.locator(".denunciar-alvo-mensagem").waitFor({ timeout: 5_000 })
        await page.setViewportSize({ width: largura, height: altura })
        await folha.getByRole("radio", { name: "Assédio ou perseguição" }).check()
        await folha.locator("textarea").fill("Escreve-me isto todos os dias, há duas semanas.")
        await folha.getByRole("checkbox").check()
        await folha.getByRole("button", { name: "Continuar" }).click()
        await folha.getByText("O que sai do aparelho").waitFor({ timeout: 5_000 })
        await page.waitForTimeout(300)
      }

      // 3. Send: the founder's alert (copy goes).
      await folha.getByRole("button", { name: "Continuar" }).click()
      await folha.locator(".denunciar-aviso").waitFor({ timeout: 5_000 })
      await page.waitForTimeout(reduzido ? 600 : 300)
      m = await medir(page)
      check(`[${etiqueta}] aviso: o passo 3 é o de agora`, JSON.stringify(m.actual) === JSON.stringify([null, null, "step"]), JSON.stringify(m.actual))
      check(`[${etiqueta}] aviso: a frase de hoje`, m.texto.includes("O fundador do canal recebe uma cópia sem o teu nome. Numa conversa pequena, pode adivinhar quem foste."))
      await retratar("3-aviso")

      // 4. Enviada.
      await folha.getByRole("button", { name: "Enviar denúncia" }).click()
      await folha.getByText("Denúncia enviada.").waitFor({ timeout: 5_000 })
      await page.waitForTimeout(reduzido ? 600 : 300)
      await retratar("4-enviada")

      // Esc closes.
      await page.keyboard.press("Escape")
      check(`[${etiqueta}] Esc fecha a janela`, await page.locator("#fechada").isVisible())
      check(`[${etiqueta}] sem erros na página no fim`, erros.length === 0, erros.join(" | "))
      await ctx.close()
    }
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
