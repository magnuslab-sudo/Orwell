/**
 * The list of members in the common channel, before and after the name from
 * the URL (owner's order on 4 November 2026), in a real Chromium.
 *
 *   node scripts/capturar-nome-do-endereco.mjs [commit-before]
 *
 * Draws the `MemberPanel` with `useDirectory` true and the full style sheet
 * of the interface, no server: five accounts with no name (two with the same
 * first word, one from another server) and two with a chosen name. The
 * "before" is the same drawing with the interface from the given commit (by
 * default the base of 1.3.0, 8861466d), pulled by `git archive` to a temp
 * folder.
 *
 * Output in `capturas/nome-do-endereco-{antes,depois}-{1280,390}.png`.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import { chromium } from "playwright"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const CAPTURAS = join(RAIZ, "capturas")
const ANTES = process.argv[2] ?? "8861466d"

const entrada = (ui) => `
import { createRoot } from "react-dom/client"
import "${ui}/styles.css"
import { useDirectory } from "${ui}/hooks/useDirectory.js"
import { MemberPanel } from "${ui}/screens/chat/MemberPanel.js"

const membros = [
  "@ana-rocha-faril-quelmo:ensaio.pt",
  "@ginvodra-sastybis-dirgybus-boblytum:ensaio.pt",
  "@ginvodra-pelmara-sostrin-quavely:outro.pt",
  "@milsinda-odreto-viddyvox-pofletum:ensaio.pt",
  "@garbicis-xapsensis-giprete-birmyris:ensaio.pt",
  "@tulvane-merdosa-pabrinco-sesvilo:ensaio.pt",
  "@pelvoro-castel-mornedo-plinva:ensaio.pt",
]
const semente = new Map([
  ["@ana-rocha-faril-quelmo:ensaio.pt", { displayName: "Ana Silva", donations: [] }],
  ["@pelvoro-castel-mornedo-plinva:ensaio.pt", { displayName: "Rui", donations: [] }],
])
const nada = () => {}

function Lista() {
  const { directory, nameFor } = useDirectory([], semente, undefined, membros)
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", height: "100vh" }}>
      <MemberPanel
        channel="!orwell:ensaio.pt"
        members={membros}
        state="ready"
        open
        onRetry={nada}
        me={null}
        directory={directory}
        nameFor={nameFor}
        onInvite={nada}
        onUserMenu={nada}
        onOpenProfile={nada}
      />
    </div>
  )
}
createRoot(document.getElementById("raiz")).render(<Lista />)
`

async function montar(pasta, ui) {
  const ficheiro = join(pasta, "entrada.jsx")
  writeFileSync(ficheiro, entrada(ui))
  await build({
    entryPoints: [ficheiro],
    bundle: true,
    outdir: pasta,
    jsx: "automatic",
    loader: { ".woff2": "dataurl", ".png": "dataurl", ".svg": "dataurl" },
    nodePaths: [join(RAIZ, "node_modules")],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    logLevel: "error",
    // Vite suffixes (\`?url\`, \`?worker\`…) are from audio and cipher, which this list does not use.
    plugins: [
      {
        name: "sufixos-do-vite",
        setup(construcao) {
          construcao.onResolve({ filter: /\?(url|worker|raw|inline)$/ }, (pedido) => ({ path: pedido.path, namespace: "vazio" }))
          construcao.onLoad({ filter: /.*/, namespace: "vazio" }, () => ({ contents: "export default ''", loader: "js" }))
        },
      },
    ],
  })
  writeFileSync(
    join(pasta, "index.html"),
    `<!doctype html><html lang="pt"><head><meta charset="utf-8"><link rel="stylesheet" href="entrada.css"></head><body><div id="raiz"></div><script src="entrada.js"></script></body></html>`,
  )
  return join(pasta, "index.html")
}

const temporaria = mkdtempSync(join(tmpdir(), "orwell-nome-do-endereco-"))
try {
  // The "before": the interface from the given commit, full, alongside today's.
  const antes = join(temporaria, "antes")
  mkdirSync(antes)
  execFileSync("sh", ["-c", `git -C "${RAIZ}" archive ${ANTES} packages/ui | tar -x -C "${antes}"`])
  const paginas = {
    antes: await montar(antes, join(antes, "packages/ui/src")),
    depois: await montar(mkdtempSync(join(temporaria, "depois-")), join(RAIZ, "packages/ui/src")),
  }
  mkdirSync(CAPTURAS, { recursive: true })
  const browser = await chromium.launch()
  for (const [quando, pagina] of Object.entries(paginas)) {
    for (const largura of [1280, 390]) {
      const separador = await browser.newPage({ viewport: { width: largura, height: 640 }, deviceScaleFactor: 2 })
      await separador.goto(`file://${pagina}`)
      await separador.waitForSelector(".member-name", { state: "attached" })
      await separador.evaluate(() => document.fonts.ready)
      const saida = join(CAPTURAS, `nome-do-endereco-${quando}-${largura}.png`)
      await separador.screenshot({ path: saida })
      const nomes = await separador.$$eval(".member-name", (todos) => todos.map((nome) => nome.textContent))
      console.log(`${quando} ${largura}: ${nomes.join(" | ")}  -> ${saida}`)
      await separador.close()
    }
  }
  await browser.close()
} finally {
  rmSync(temporaria, { recursive: true, force: true })
}
