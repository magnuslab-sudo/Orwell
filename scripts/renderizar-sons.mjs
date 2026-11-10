#!/usr/bin/env node
/**
 * Writes the sound family to WAV files so the owner can listen outside the app.
 *
 *   node scripts/renderizar-sons.mjs
 *
 * The SAME code the app uses (`packages/ui/src/sons/familia.ts`),
 * bundled by esbuild and run in headless Chromium (Playwright), with
 * the real `OfflineAudioContext`. Node has no Web Audio; a second
 * synthesizer written for Node could sound different from the app's.
 *
 * Output: `capturas/sons/<tipo>.wav` (48 kHz, 16 bits, stereo) and
 * `capturas/sons/sons.html`, a page with one button per sound, no CDN.
 */
import { build } from "esbuild"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..")
const destino = join(raiz, "capturas", "sons")

const pacote = await build({
  entryPoints: [join(raiz, "packages/ui/src/sons/familia.ts")],
  bundle: true,
  format: "iife",
  globalName: "Familia",
  write: false,
  target: "es2022",
})
const codigo = pacote.outputFiles[0].text

const browser = await chromium.launch()
try {
  const pagina = await browser.newPage()
  await pagina.setContent("<!doctype html><title>sons</title>")
  await pagina.addScriptTag({ content: codigo })
  const sons = await pagina.evaluate(async () => {
    const F = globalThis.Familia
    const saida = []
    for (const tipo of F.TIPOS_DE_SOM) {
      const buffer = await F.renderizar(tipo)
      const canais = []
      for (let c = 0; c < buffer.numberOfChannels; c += 1) canais.push(Array.from(buffer.getChannelData(c)))
      const som = F.SONS[tipo]
      saida.push({
        tipo,
        taxa: buffer.sampleRate,
        canais,
        notas: som.notas.map((n) => `${n.nota}@${Math.round(n.em * 1000)}ms/${Math.round(n.dur * 1000)}ms`),
        duracaoMs: Math.round(F.duracaoDasNotas(som) * 1000),
        presenca: som.presenca,
        periodo: som.periodo ?? null,
      })
    }
    return saida
  })

  await mkdir(destino, { recursive: true })
  for (const som of sons) {
    await writeFile(join(destino, `${som.tipo}.wav`), wav(som.canais, som.taxa))
    console.log(`${som.tipo.padEnd(22)} ${String(som.duracaoMs).padStart(4)} ms  ${som.notas.join("  ")}`)
  }
  await writeFile(join(destino, "sons.html"), pagina_(sons))
  console.log(`\n${sons.length} WAV em ${destino}`)
} finally {
  await browser.close()
}

/** 16-bit PCM, channels interleaved. */
function wav(canais, taxa) {
  const n = canais[0].length
  const k = canais.length
  const dados = Buffer.alloc(44 + n * k * 2)
  dados.write("RIFF", 0)
  dados.writeUInt32LE(36 + n * k * 2, 4)
  dados.write("WAVEfmt ", 8)
  dados.writeUInt32LE(16, 16)
  dados.writeUInt16LE(1, 20)
  dados.writeUInt16LE(k, 22)
  dados.writeUInt32LE(taxa, 24)
  dados.writeUInt32LE(taxa * k * 2, 28)
  dados.writeUInt16LE(k * 2, 32)
  dados.writeUInt16LE(16, 34)
  dados.write("data", 36)
  dados.writeUInt32LE(n * k * 2, 40)
  let o = 44
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < k; c += 1) {
      const v = Math.max(-1, Math.min(1, canais[c][i]))
      dados.writeInt16LE(Math.round(v * 32767), o)
      o += 2
    }
  }
  return dados
}

function pagina_(sons) {
  const linhas = sons
    .map(
      (s) => `    <li><button type="button" data-som="${s.tipo}">${s.tipo}</button>
      <span>${s.duracaoMs} ms · presença ${s.presenca}${s.periodo ? ` · repete de ${s.periodo} em ${s.periodo} s` : ""}</span>
      <code>${s.notas.join(" ")}</code></li>`,
    )
    .join("\n")
  return `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sons do Orwell</title>
<style>
  :root { color-scheme: dark; --fundo: #0f1020; --texto: #e6e6f0; --fraco: #9a9ab5; --acento: #8be9fd; }
  body { margin: 0; padding: 24px 16px; background: var(--fundo); color: var(--texto); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 640px; margin: 0 auto; }
  ul { list-style: none; padding: 0; display: grid; gap: 12px; }
  li { display: grid; grid-template-columns: 9rem 1fr; gap: 4px 12px; align-items: center; }
  button { min-height: 44px; border: 1px solid var(--acento); background: transparent; color: var(--acento); border-radius: 8px; font: inherit; cursor: pointer; }
  span { color: var(--fraco); }
  code { grid-column: 2; color: var(--fraco); font-size: 13px; overflow-wrap: anywhere; }
</style>
</head>
<body>
<main>
  <h1>Sons do Orwell</h1>
  <p>Uma família: a mesma marimba, a mesma escala (Ré maior pentatónica). Carregue num botão para ouvir.</p>
  <ul>
${linhas}
  </ul>
</main>
<script>
  for (const botao of document.querySelectorAll("button[data-som]")) {
    botao.addEventListener("click", () => new Audio(botao.dataset.som + ".wav").play())
  }
</script>
</body>
</html>
`
}
