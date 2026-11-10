// @vitest-environment node
// (esbuild does not run in jsdom: its `TextEncoder` does not return `Uint8Array`.)
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { aberturaEmHtml } from "../../../packages/ui/src/screens/gate/abertura-marcacao.js"
import { aberturaNoHtml } from "../abertura-no-html.js"

/**
 * The splash in `index.html`: the plugin that writes it at build time.
 *
 * Runs the hooks by hand, with no Vite: what matters is what comes out in the
 * HTML. The proof that the first render is already the opening, with no blank
 * frame, is with the browser for real: `scripts/abertura-prova.mjs`.
 */
interface Etiqueta {
  tag: string
  attrs?: Record<string, string>
  children?: string
  injectTo?: string
}

async function correr(): Promise<{ html: string; tags: Etiqueta[]; guiao: string }> {
  const plugin = aberturaNoHtml()
  ;(plugin.configResolved as (c: { base: string }) => void)({ base: "/app/" })
  await (plugin.buildStart as () => Promise<void>)()
  const fonte = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8")
  const saida = (plugin.transformIndexHtml as (h: string) => { html: string; tags: Etiqueta[] })(fonte)
  let guiao = ""
  ;(plugin.generateBundle as unknown as (this: { emitFile: (f: { source: string }) => void }) => void).call({
    emitFile: (f) => {
      guiao = f.source
    },
  })
  return { ...saida, guiao }
}

describe("o splash no index.html", () => {
  it("o #root sai com a abertura, em todas as línguas", async () => {
    const { html } = await correr()
    expect(html).toContain(
      `<div id="root">${aberturaEmHtml([
        { lingua: "pt", texto: "A abrir…" },
        { lingua: "en", texto: "Opening…" },
      ])}</div>`,
    )
  })

  it("a língua marca-se por um ficheiro, nunca por um guião inline (a política não o deixa)", async () => {
    const { tags, guiao } = await correr()
    const guioes = tags.filter((t) => t.tag === "script")
    expect(guioes).toHaveLength(1)
    expect(guioes[0]?.children).toBeUndefined()
    expect(guioes[0]?.injectTo).toBe("head")
    // Classic and synchronous: no `type="module"`, no `defer`, no `async`.
    expect(Object.keys(guioes[0]?.attrs ?? {})).toEqual(["src"])
    expect(guiao).toContain("document.documentElement.lang=")
    expect(guiao.length).toBeLessThan(2_000)
  })

  it("o nome do guião tem hash e não tem 'index-', que é o que o version-watch procura", async () => {
    const { tags } = await correr()
    const src = tags.find((t) => t.tag === "script")?.attrs?.["src"] ?? ""
    expect(src).toMatch(/^\/app\/assets\/lingua-cedo-[0-9a-f]{8}\.js$/)
    expect(src).not.toMatch(/index-[A-Za-z0-9_-]+\.js/)
  })

  it("a folha das línguas vai no head, ao lado do guião", async () => {
    const { tags } = await correr()
    const folha = tags.find((t) => t.tag === "style")
    expect(folha?.injectTo).toBe("head")
    expect(folha?.children).toContain('html[lang="en"] .abertura-texto>[lang="en"]')
  })

  it("o guião marca a língua pela regra do arranque: o endereço, a escolha guardada, o sistema", async () => {
    const { guiao } = await correr()
    const marcar = (o: { href: string; guardada?: string; sistema: string[] }): string => {
      const html = { lang: "pt" }
      const correrGuiao = new Function("document", "navigator", "localStorage", "window", guiao) as (...a: unknown[]) => void
      correrGuiao(
        { documentElement: html },
        { languages: o.sistema, language: o.sistema[0] },
        { getItem: () => o.guardada ?? null },
        { location: { href: o.href } },
      )
      return html.lang
    }
    expect(marcar({ href: "https://orwell.pt/app/", sistema: ["en-GB", "pt"] })).toBe("en")
    // 1.3.6: a system that only names languages that do not exist here gets English.
    expect(marcar({ href: "https://orwell.pt/app/", sistema: ["fr-FR"] })).toBe("en")
    expect(marcar({ href: "https://orwell.pt/app/", sistema: [] })).toBe("pt")
    expect(marcar({ href: "https://orwell.pt/app/", guardada: "pt", sistema: ["en-US"] })).toBe("pt")
    expect(marcar({ href: "https://orwell.pt/app/?lingua=en", guardada: "pt", sistema: ["pt-PT"] })).toBe("en")
  })
})
