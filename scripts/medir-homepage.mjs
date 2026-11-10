/**
 * How much each page weighs, for real and compressed.
 *
 * The page promises in the footer that it calls nobody and that it is light. Both
 * are verifiable, and a verifiable promise nobody checks lasts until the day
 * someone adds a font "just this once".
 *
 * Build and measure what ships, not what is written: it is the `dist` that gets
 * served. Fail above the cap, with a list of what weighs the most, a number
 * alone says it got heavier and says nothing about what made it heavier.
 *
 *   node scripts/medir-homepage.mjs
 *   node scripts/medir-homepage.mjs --tecto=150
 *
 * PER PAGE, not the sum of the folder. Decision of August 14, 2026, when the
 * site went from three pages to five.
 *
 * What the sum used to measure was a number nobody pays: whoever opens the login
 * page does not download the donate page photo, and whoever opens the donate
 * page does not download the four screenshots from the login page. Summed, the
 * five gave 60 kB and the cap failed a site where no single page comes close to
 * it. Summing had the added flaw of punishing whoever adds a page, which is
 * exactly the opposite of what this file exists to do: protect who VISITS.
 *
 * What gets measured now is what the browser will fetch to draw ONE page: the
 * HTML, the stylesheet it imports, and the images it names. The cap is the same,
 * and applies to each one.
 */
import { execFile } from "node:child_process"
import { gzipSync } from "node:zlib"
import { readdir, readFile, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const correr = promisify(execFile)
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..")
const SITE = join(RAIZ, "apps/site")
const DIST = join(SITE, "dist")

/**
 * Fifty kilobytes per page, owner's decision.
 *
 * For scale: the Discord homepage runs several megabytes. The argument of this
 * page is itself, and that is why the cap is checked and not wished for. The
 * 150 KB clause exists for the day he approves a large art piece; pass
 * `--tecto=150` and write here why.
 */
// 70 not 50 as of October 26, 2026: the four homepage screenshots moved to the
// midnight skin (background with gradient and rain), which WebP does not
// compress as well as the flat background before. At 2× and quality 82 they sum
// to 44.7 kB; the full page comes in at 66.5 kB. Dropping to 1.5× or quality 50
// would save about 15 kB at the cost of soft images on retina screens.
// 100 not 70 as of November 2, 2026: point 02 went from a 10 kB screenshot to a
// drawn diagram of the post-quantum cipher (owner's choice), with labels that
// only read at 720 px width. At 1200 px and quality 50 it weighs 29.3 kB, and
// the page runs close to 88 kB. This is the "large art piece" the clause above
// foresaw, in a lower cap than the 150.
const TECTO_KB = Number(process.argv.find((a) => a.startsWith("--tecto="))?.split("=")[1] ?? 100)

/** The share card never loads: only link scrapers request it, and the browser
 *  of someone visiting the page does not download it. */
const FORA = ["cartao.png"]

/** Compressed, because that is how it travels: Caddy serves with zstd or gzip.
 *  A cap measured raw would be a cap that no one pays for. Images already come
 *  compressed; compressing them again would lie in the wrong direction. */
async function pesar(caminho) {
  const bytes = await readFile(caminho)
  return /\.(png|webp|avif|jpg|jpeg|woff2?)$/.test(caminho) ? bytes.length : gzipSync(bytes).length
}

async function todos(pasta) {
  const encontrados = []
  for (const entrada of await readdir(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, entrada.name)
    if (entrada.isDirectory()) encontrados.push(...(await todos(caminho)))
    else encontrados.push(caminho)
  }
  return encontrados
}

/**
 * What a page tells the browser to fetch.
 *
 * Only `src` and `<link href>`: it is the distinction that the third-party
 * test already makes, and for the same reason. An `<a href>` is a person
 * deciding to follow a link, and a link is not a request, the next page has
 * its own cap.
 */
function dependencias(html) {
  const caminhos = new Set()
  for (const m of html.matchAll(/\bsrc\s*=\s*"(\/[^"]+)"/g)) caminhos.add(m[1])
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*"(\/[^"]+)"/g)) caminhos.add(m[1])
  return [...caminhos].map((c) => c.replace(/^\//, ""))
}

console.log("a construir...")
await correr("npx", ["vite", "build"], { cwd: SITE })

const naPasta = (await todos(DIST)).map((c) => relative(DIST, c))
const paginas = naPasta.filter((nome) => nome.endsWith(".html")).sort()

let estourou = false
let maior = 0

for (const pagina of paginas) {
  const html = await readFile(join(DIST, pagina), "utf8")
  const partes = [pagina, ...dependencias(html)].filter((nome) => !FORA.includes(nome))

  const ficheiros = []
  for (const nome of partes) {
    if (!naPasta.includes(nome)) {
      // A `src` pointing to a file that does not exist in `dist` is a 404 waiting to
      // happen, and no unit test catches it: the HTML is correct, the file just did
      // not make it there.
      console.error(`\n${pagina} aponta para ${nome}, que não existe no dist.`)
      process.exitCode = 1
      continue
    }
    ficheiros.push({ nome, bytes: await pesar(join(DIST, nome)) })
  }

  ficheiros.sort((a, b) => b.bytes - a.bytes)
  const total = ficheiros.reduce((soma, f) => soma + f.bytes, 0)
  maior = Math.max(maior, total)

  console.log(`\n  ${pagina}`)
  for (const f of ficheiros) console.log(`  ${String((f.bytes / 1024).toFixed(1)).padStart(7)} kB   ${f.nome}`)
  console.log(`  ${"─".repeat(7)}`)
  console.log(`  ${String((total / 1024).toFixed(1)).padStart(7)} kB   ${pagina} (tecto ${TECTO_KB} kB)`)

  if (total > TECTO_KB * 1024) {
    console.error(`  ${pagina} passou o tecto em ${((total - TECTO_KB * 1024) / 1024).toFixed(1)} kB.`)
    estourou = true
  }
}

/* The entire folder is still reported, and it is the only thing it is: a count
   of how much the entire site weighs on disk. It is not what anyone downloads. */
let pasta = 0
for (const nome of naPasta) if (!FORA.includes(nome)) pasta += await pesar(join(DIST, nome))

console.log("")
console.log(`  ${"═".repeat(7)}`)
console.log(`  ${String((maior / 1024).toFixed(1)).padStart(7)} kB   a página mais pesada (tecto ${TECTO_KB} kB)`)
console.log(`  ${String((pasta / 1024).toFixed(1)).padStart(7)} kB   o dist inteiro, que ninguém descarrega de uma vez`)

if (estourou) {
  console.error("\nOu se corta, ou se muda o tecto com uma razão escrita. Não se ignora.")
  process.exit(1)
}
console.log(`\nCabem todas, com ${((TECTO_KB * 1024 - maior) / 1024).toFixed(1)} kB de folga na pior.`)
