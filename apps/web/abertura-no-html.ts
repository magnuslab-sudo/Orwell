import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import type { Plugin } from "vite"
import { LINGUAS } from "../../packages/ui/src/escolha-da-lingua.js"
import { en } from "../../packages/ui/src/linguas/en.js"
import { pt } from "../../packages/ui/src/linguas/pt.js"
import { aberturaEmHtml, folhaDasLinguas } from "../../packages/ui/src/screens/gate/abertura-marcacao.js"

/**
 * The splash inside `index.html`, written at build time.
 *
 * Until 3 November 2026 the first render was just the background: the `<Splash />`
 * only entered when the two megabytes of the bundle finished loading (around
 * 1.5 s on orwell.pt, measured in Chrome), and the gate removed it 8 to 17 ms
 * later. The opening flickered for a frame or two.
 *
 * Now `#root` already brings the opening, drawn with the main sheet, which
 * blocks rendering and arrives before the first paint. React takes its place
 * with the same markup (`abertura-marcacao.ts`, bound to `Splash` by test) and
 * at the same point in the loop (`abertura-viva.ts`).
 *
 * Three things, all within the page policy (no inline scripts):
 *
 * - the markup in `#root`, with text in all languages;
 * - an inline sheet (`style-src 'unsafe-inline'` is already in the policy) that
 *   hides all languages except the page language;
 * - the `lingua-cedo.ts`, built as an IIFE and served as a hashed file
 *   (`script-src 'self'`), which sets the `<html lang>` before `<body>`.
 *
 * The script name cannot contain "index-": `version-watch.ts` finds the main
 * module in `index.html` by that word.
 */
export function aberturaNoHtml(): Plugin {
  const entrada = fileURLToPath(new URL("./src/lingua-cedo.ts", import.meta.url))
  const textos = LINGUAS.map(({ codigo }) => ({
    lingua: codigo,
    texto: (codigo === "en" ? en.gate?.splashBody : undefined) ?? pt.gate.splashBody,
  }))
  let guiao = ""
  let ficheiro = ""
  let base = "/"

  return {
    name: "orwell-abertura-no-html",
    configResolved(config) {
      base = config.base
    },
    async buildStart() {
      const saida = await build({
        entryPoints: [entrada],
        bundle: true,
        format: "iife",
        minify: true,
        target: "es2019",
        platform: "browser",
        legalComments: "none",
        write: false,
      })
      guiao = saida.outputFiles[0]?.text ?? ""
      if (!guiao) throw new Error("lingua-cedo: o esbuild não devolveu nada")
      const impressao = createHash("sha256").update(guiao).digest("hex").slice(0, 8)
      ficheiro = `assets/lingua-cedo-${impressao}.js`
    },
    configureServer(servidor) {
      servidor.middlewares.use((pedido, resposta, seguinte) => {
        if (!pedido.url?.endsWith(`/${ficheiro}`)) return seguinte()
        resposta.setHeader("Content-Type", "text/javascript; charset=utf-8")
        resposta.end(guiao)
      })
    },
    transformIndexHtml(html) {
      const vazio = '<div id="root"></div>'
      if (!html.includes(vazio)) throw new Error(`abertura: o index.html já não tem ${vazio}`)
      return {
        html: html.replace(vazio, `<div id="root">${aberturaEmHtml(textos)}</div>`),
        tags: [
          { tag: "style", children: folhaDasLinguas(textos.map((t) => t.lingua)), injectTo: "head" },
          { tag: "script", attrs: { src: `${base}${ficheiro}` }, injectTo: "head" },
        ],
      }
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: ficheiro, source: guiao })
    },
  }
}
