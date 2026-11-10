import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
import { desenharTributo, desenharTributoEmLinha } from "./src/tributo.js"

/**
 * Version comes from the root `package.json`, and nowhere else.
 *
 * There were three matching numbers in three files waiting to diverge, and the
 * day they diverged would be the day the page announced a version not being
 * served. The root is the source of truth; a test in `testes/` rejects
 * anything else.
 */
const raiz = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as {
  version: string
  nomeDaVersao: string
}

/** "0.1.0" displays as "0.1": the patch does not matter to page readers. */
const versaoCurta = raiz.version.split(".").slice(0, 2).join(".")

function injectarVersao(): Plugin {
  return {
    name: "orwell-versao",
    transformIndexHtml(html) {
      return html.replaceAll("%VERSAO%", versaoCurta).replaceAll("%NOME_DA_VERSAO%", raiz.nomeDaVersao)
    },
  }
}

/**
 * The ambassador tribute zone, written at build time.
 *
 * It reads the file on each page, not once at startup: in `vite dev` the owner
 * adds a name and sees it on reload, without restarting anything. See
 * `src/tributo.ts`. The landing page uses the inline version
 * (`%TRIBUTO_LINHA%`), which stays empty until there are names.
 */
function injectarTributo(): Plugin {
  return {
    name: "orwell-tributo",
    transformIndexHtml(html) {
      // `%TRIBUTO_LINHA%` first: the `%TRIBUTO%` is its start.
      if (!html.includes("%TRIBUTO")) return html
      const dados = JSON.parse(readFileSync(fileURLToPath(new URL("./src/embaixadores.json", import.meta.url)), "utf8"))
      // The phrase around the names uses the page's language, read from `<html lang>`.
      const lingua = /<html lang="en"/.test(html) ? "en" : "pt"
      return html
        .replaceAll("%TRIBUTO_LINHA%", desenharTributoEmLinha(dados, lingua))
        .replaceAll("%TRIBUTO%", desenharTributo(dados, lingua))
    },
  }
}

export default defineConfig({
  plugins: [injectarVersao(), injectarTributo()],
  server: {
    port: 5174,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    /**
     * Eight pages, not one: four in English at the root and four in Portuguese
     * in `pt/` (English first since November 3, 2026). Vite preserves the
     * relative path, so `pt/index.html` lands in `dist/pt/index.html`.
     *
     * Without this, Vite builds only `index.html` and the others would link to
     * nothing, with a twist: the unbuilt one also skips version substitution
     * and would serve raw markers.
     *
     * Anyone adding a page must add it HERE. A test in `testes/` counts files
     * in the folder and fails if any are missing from this list, because the
     * silent failure is always the same: the page exists in the repo, the link
     * exists, and in production it gives 404.
     */
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        privacy: resolve(__dirname, "privacy.html"),
        terms: resolve(__dirname, "terms.html"),
        ambassadors: resolve(__dirname, "ambassadors.html"),
        pt_index: resolve(__dirname, "pt/index.html"),
        pt_privacidade: resolve(__dirname, "pt/privacidade.html"),
        pt_termos: resolve(__dirname, "pt/termos.html"),
        pt_embaixadores: resolve(__dirname, "pt/embaixadores.html"),
      },
    },
    target: "es2023",
    // The only script is `src/sistema.ts`, with no imports. The `modulepreload`
    // polyfill had nothing to preload and only added weight.
    modulePreload: { polyfill: false },
    // No map: the only script runs to a dozen lines and reads from the built file
    // itself.
    sourcemap: false,
    // CSS lives in its own file with a hash, so it caches forever; the HTML
    // revalidates every time. It is the same split that the Caddyfile makes.
    assetsInlineLimit: 0,
  },
})
