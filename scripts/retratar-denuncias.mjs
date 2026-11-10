/**
 * The "Reports" section of the channel properties (the founder's box),
 * captured in a real layout engine, at 1280 and 390 px.
 *
 * Sets up the real properties (`RoomProperties`) with the real section
 * (`SeccaoDenuncias`) and the real stylesheet, opened at "Moderation", over
 * three mock boxes: two reports (a message with context, note, attachment and
 * one item that does not check; a person, without note), the empty box, and
 * the empty box with copies waiting for the device with the account key.
 *
 *   capturas/denuncias-acabamento-<tag>-<box>-<width>.png
 *
 *   node scripts/retratar-denuncias.mjs                    (current code, "after")
 *   ORWELL_UI_SRC=<folder>/packages/ui/src ORWELL_ETIQUETA=antes \
 *     node scripts/retratar-denuncias.mjs                  (another tree, unchecked)
 *
 * Like `retratar-pedidos-26-10.mjs`: with `ORWELL_UI_SRC` pointing to an old
 * copy of `packages/ui/src` (for example
 * `git archive 8861466d packages/ui packages/protocol/src packages/crypto/src packages/client-core/src`),
 * it gives the "before" capture. An old tree ignores properties it does not
 * know (`nomeDoCanal`, `carregarPorAbrir`).
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const ETIQUETA = process.env.ORWELL_ETIQUETA ?? "depois"
const FONTE = process.env.ORWELL_UI_SRC ?? join(RAIZ, "packages/ui/src")
/** Only the code from this tree gets checked: the "before" capture shows what was there. */
const VERIFICAR = process.env.ORWELL_UI_SRC === undefined
const SAIDA = join(AQUI, `.saida-denuncias-${ETIQUETA}`)
const CAPTURAS = join(RAIZ, "capturas")
const UI = (caminho) => JSON.stringify(join(FONTE, caminho))
const PACOTES = VERIFICAR
  ? {}
  : Object.fromEntries(
      ["protocol", "crypto", "client-core"].map((p) => [`@enclave/${p}`, join(FONTE, "../../", p, "src/index.ts")]),
    )

mkdirSync(SAIDA, { recursive: true })
mkdirSync(CAPTURAS, { recursive: true })

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { RoomProperties } from ${UI("screens/overlays/RoomProperties.js")}
import { SeccaoDenuncias } from ${UI("screens/overlays/SeccaoDenuncias.js")}
import { ConfirmarProvider } from ${UI("hooks/useConfirmar.js")}
import ${UI("styles.css")}

const CANAL = "!praca:casa.pt"
const ANA = "@ana:casa.pt"
const BRUNO = "@bruno:casa.pt"
const CARLA = "@carla:casa.pt"
const NOMES = { [ANA]: "Ana", [BRUNO]: "Bruno", [CARLA]: "Carla" }
const nomeDe = (endereco) => NOMES[endereco] ?? endereco

const MENSAGEM = {
  id: "c-2",
  canal: CANAL,
  sala: "geral",
  dia: "2026-11-04",
  motivo: 3,
  nota: "Escreve-me isto todos os dias, há duas semanas. Já o bloqueei, mas continua nos canais onde estou.",
  denunciado: CARLA,
  alvo: { tipo: "mensagem", id: "m-2" },
  itens: [
    { autor: ANA, dia: "2026-11-04", hora: "09:58", texto: "Bom dia a todos. A reunião é às 18h.", anexos: [], verificada: true, denunciada: false },
    {
      autor: CARLA,
      dia: "2026-11-04",
      hora: "10:01",
      texto: "Sei onde moras. Da próxima vez não é só uma mensagem.",
      anexos: [{ name: "porta.jpg", mediaType: "image/jpeg", byteLength: 245760 }],
      verificada: true,
      denunciada: true,
    },
    { autor: CARLA, dia: "2026-11-04", hora: "10:03", texto: "Foi só uma piada, calma.", anexos: [], verificada: false, denunciada: false },
  ],
  lida: false,
}

const PESSOA = {
  id: "c-1",
  canal: CANAL,
  dia: "2026-11-03",
  motivo: 5,
  nota: "",
  denunciado: CARLA,
  alvo: { tipo: "pessoa" },
  itens: [
    { autor: CARLA, dia: "2026-11-03", hora: "21:14", texto: "Ganha 500 € por dia: orwell-premio.example", anexos: [], verificada: true, denunciada: false },
    { autor: CARLA, dia: "2026-11-03", hora: "21:15", texto: "Só hoje. Envia o teu código de entrada.", anexos: [], verificada: true, denunciada: false },
  ],
  lida: true,
}

const CAIXAS = {
  duas: { lista: [MENSAGEM, PESSOA], porAbrir: 0 },
  vazia: { lista: [], porAbrir: 0 },
  "a-espera": { lista: [], porAbrir: 2 },
}
const caixa = CAIXAS[new URLSearchParams(location.search).get("caixa") ?? "duas"]

createRoot(document.getElementById("raiz")).render(
  <ConfirmarProvider>
    <RoomProperties
      channel={CANAL}
      initial={{ name: "praca" }}
      founder={ANA}
      souFundador
      mayEdit
      seccaoInicial="moderacao"
      onSubmit={async () => {}}
      onCancel={() => {}}
      seccaoDenuncias={
        <SeccaoDenuncias
          carregar={async () => caixa.lista}
          carregarPorAbrir={async () => caixa.porAbrir}
          nomeDe={nomeDe}
          nomeDoCanal="praca"
          nomeDaSala={(sala) => sala}
        />
      }
    />
  </ConfirmarProvider>,
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
  alias: PACOTES,
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? `: ${detalhe}` : ""}`)
}

const LARGURAS = [
  { largura: 1280, altura: 800 },
  { largura: 390, altura: 844 },
]

for (const { largura, altura } of LARGURAS) {
  for (const nome of ["duas", "vazia", "a-espera"]) {
    for (const reduzido of [false, true]) {
      // Reduced motion is only captured in the box with reports: that is where there is something to move.
      if (reduzido && nome !== "duas") continue
      const ctx = await browser.newContext({
        viewport: { width: largura, height: altura },
        deviceScaleFactor: 2,
        reducedMotion: reduzido ? "reduce" : "no-preference",
      })
      const page = await ctx.newPage()
      const erros = []
      page.on("pageerror", (e) => erros.push(String(e)))
      await page.goto(`file://${join(SAIDA, "index.html")}?caixa=${nome}`)
      await page.waitForSelector(".seccao-denuncias", { timeout: 15_000 })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(150)
      const etiqueta = `${largura}${reduzido ? "-reduzido" : ""}`

      if (VERIFICAR) {
        check(`[${nome} ${etiqueta}] sem erros na página`, erros.length === 0, erros.join(" | "))
        const m = await page.evaluate(() => {
          const corpo = document.querySelector(".propriedades-conteudo")
          const cartoes = [...document.querySelectorAll(".seccao-denuncias .denuncia")]
          const estilo = cartoes[0] ? getComputedStyle(cartoes[0]) : null
          const animacao = cartoes[0]?.getAnimations?.()[0]
          return {
            transborda: corpo ? corpo.scrollWidth - corpo.clientWidth : 0,
            cartoes: cartoes.length,
            marcadores: cartoes.length > 0 ? getComputedStyle(cartoes[0]).listStyleType : "none",
            fundo: estilo?.backgroundColor ?? "",
            raio: estilo?.borderTopLeftRadius ?? "",
            duracao: animacao ? Number(animacao.effect?.getTiming().duration ?? 0) : 0,
            texto: document.querySelector(".seccao-denuncias")?.textContent ?? "",
          }
        })
        check(`[${nome} ${etiqueta}] nada transborda de lado`, m.transborda <= 0, `${m.transborda} px`)
        if (nome === "duas") {
          check(`[${nome} ${etiqueta}] dois cartões, sem marcadores do browser`, m.cartoes === 2 && m.marcadores === "none", `${m.cartoes}, ${m.marcadores}`)
          check(`[${nome} ${etiqueta}] o cartão tem fundo e canto`, m.fundo !== "rgba(0, 0, 0, 0)" && m.raio !== "0px", `${m.fundo}, ${m.raio}`)
          check(
            `[${nome} ${etiqueta}] motivo, dia, prova, denunciado, canal, sala, nota e mensagens`,
            ["Assédio ou perseguição", "4 de novembro de 2026", "Verificada", "Não verificada", "Carla", "praca", "geral", "duas semanas", "Sei onde moras", "Mensagem denunciada"].every((s) => m.texto.includes(s)),
          )
          check(
            `[${nome} ${etiqueta}] a entrada anima${reduzido ? ", mais devagar" : ""}`,
            reduzido ? m.duracao >= 400 : m.duracao > 0 && m.duracao < 400,
            `${m.duracao} ms`,
          )
        }
        if (nome === "vazia") check(`[${nome} ${etiqueta}] a frase do vazio`, m.texto.includes("Ninguém denunciou nada neste canal."))
        if (nome === "a-espera") {
          check(`[${nome} ${etiqueta}] não diz que ninguém denunciou`, !m.texto.includes("Ninguém denunciou nada"))
          check(`[${nome} ${etiqueta}] diz que há 2 à espera`, /2 denúncias/.test(m.texto), m.texto.slice(0, 160))
        }
      }

      // The entire sheet, and the entire section (the 390 one scrolls inside the sheet).
      await page.screenshot({ path: join(CAPTURAS, `denuncias-acabamento-${ETIQUETA}-${nome}-${etiqueta}.png`) })
      if (nome === "duas" && !reduzido) {
        // The sheet has fixed height and scrolls inside. Release the height for the entire section.
        await page.addStyleTag({
          content: ".sheet.propriedades-do-canal{height:auto!important;max-height:none!important}.propriedades-conteudo,.sheet-body{overflow:visible!important;max-height:none!important}",
        })
        const altura = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewportSize({ width: largura, height: Math.max(altura, altura) + 40 })
        await page.waitForTimeout(100)
        await page.locator(".seccao-denuncias").screenshot({ path: join(CAPTURAS, `denuncias-acabamento-${ETIQUETA}-${nome}-${etiqueta}-seccao.png`) })
      }
      await ctx.close()
    }
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
if (VERIFICAR) console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
