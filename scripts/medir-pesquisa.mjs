// The question is whether search needs an index, and the answer gets measured.
//
// An encrypted index is serious work: it must be built, maintained on every
// message that arrives, and stored somewhere, and "somewhere" is either the
// vault (more encrypted writes for each message) or disk in the clear, which is
// the one thing this product cannot do. None of that pays off without
// measurement.
//
// What gets measured is the real path, end to end:
//
//   1. `session.history(canal)`, which is a `structuredClone` of what's in the
//      open vault. Happens once, when the search panel opens.
//   2. Convert to screen format, and `procurar` across it. Happens on EVERY
//      keystroke, and that's the number that decides.
//
// And measure against the alternative: an in-memory inverted index, with the
// cost to build it and the cost to query it. If a simple scan is already
// imperceptible, the index buys nothing and costs everything.
//
//   npx tsx scripts/medir-pesquisa.mjs
import { procurar } from "../packages/ui/src/lib/procura.ts"

/** The vault cap, per channel. See `HISTORY_MAX_PER_CHANNEL` in `vault.ts`. */
const TECTO = 400
/** How many recent entries the vault lets stay with media bytes. */
const COM_MEDIA = 40
/** The media budget the vault tolerates, in bytes. */
const ORCAMENTO_MEDIA = 4_000_000

const PALAVRAS = (
  "o a de que e do da em para com uma os no se na por mais as dos como mas foi ao ele das tem à seu " +
  "sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem " +
  "mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha " +
  "orçamento estaleiro betão andaime alvenaria empreitada vistoria licença câmara projecto medição " +
  "reunião segunda terça quarta quinta sexta manhã tarde obra cliente factura recibo prazo entrega"
).split(" ")

let semente = 20260819
/** Reproducible random: two runs measure the same body. */
function sorte() {
  semente = (semente * 1103515245 + 12345) & 0x7fffffff
  return semente / 0x7fffffff
}

function frase() {
  const quantas = 4 + Math.floor(sorte() * 24)
  const palavras = []
  for (let i = 0; i < quantas; i++) palavras.push(PALAVRAS[Math.floor(sorte() * PALAVRAS.length)])
  return palavras.join(" ")
}

/**
 * A history as the vault stores it: at the cap, with media in the newest.
 *
 * Images are here because they're what weighs in cloning, not text. Without
 * them you'd measure a vault that doesn't exist.
 */
function historico(quantas) {
  const entradas = []
  const bytesPorImagem = Math.floor(ORCAMENTO_MEDIA / COM_MEDIA)
  for (let i = 0; i < quantas; i++) {
    const payload = {
      t: "message",
      id: `m-${i}`,
      sentAt: 1_700_000_000_000 + i * 60_000,
      body: frase(),
      room: i % 3 === 0 ? "" : `sala-${i % 3}`,
    }
    if (i >= quantas - COM_MEDIA) {
      payload.attachments = [{ inline: "A".repeat(bytesPorImagem), name: `foto-${i}.jpg`, mediaType: "image/jpeg" }]
    }
    entradas.push({ seq: i, sender: `@pessoa${i % 7}:exemplo`, at: payload.sentAt, payload })
  }
  return entradas
}

function paraEcra(canal, entradas) {
  return entradas.map((entrada) => ({
    channel: canal,
    seq: entrada.seq,
    sender: entrada.sender,
    payload: entrada.payload,
  }))
}

/** Median of `voltas` runs, in milliseconds. Average lies with a spike. */
function medir(voltas, trabalho) {
  const tempos = []
  for (let i = 0; i < voltas; i++) {
    const antes = performance.now()
    trabalho(i)
    tempos.push(performance.now() - antes)
  }
  tempos.sort((a, b) => a - b)
  return {
    mediana: tempos[Math.floor(tempos.length / 2)],
    pior: tempos[tempos.length - 1],
  }
}

const ms = (n) => `${n.toFixed(3).replace(".", ",")} ms`

// ------------------------------------------------------------- the alternative
//
// An inverted index, the kind you'd write if measurement demanded it: folded
// word → message ids where it appears.

function dobrarSimples(texto) {
  let saida = ""
  for (const c of texto) {
    const base = [...c.normalize("NFD")][0] ?? c
    const baixa = base.toLowerCase()
    saida += baixa.length === c.length ? baixa : c
  }
  return saida
}

function construirIndice(messages) {
  const indice = new Map()
  for (const message of messages) {
    const id = message.payload.id
    for (const palavra of dobrarSimples(message.payload.body ?? "").split(/[^\p{L}\p{N}]+/u)) {
      if (palavra === "") continue
      let lista = indice.get(palavra)
      if (!lista) indice.set(palavra, (lista = []))
      lista.push(id)
    }
  }
  return indice
}

console.log("Bancada da procura, em", process.version)
console.log("")

for (const quantas of [TECTO, TECTO * 10]) {
  const entradas = historico(quantas)
  const messages = paraEcra("!canal:exemplo", entradas)
  const bytes = JSON.stringify(entradas).length

  console.log(`=== ${quantas} mensagens guardadas (${(bytes / 1e6).toFixed(1)} MB de JSON) ===`)

  // 1. Reading the vault: a `structuredClone` of what is already open.
  const leitura = medir(20, () => structuredClone(entradas))
  console.log(`  ler do cofre (structuredClone)  mediana ${ms(leitura.mediana)}  pior ${ms(leitura.pior)}`)

  // 2. Scanning by key. Terms that exist and terms that do not: a term with no
  //    results is the worst case, because there is no way to exit early.
  const termos = ["orçamento", "estaleiro", "quinta-feira", "zzz", "a", "reunião de obra"]
  const varrer = medir(200, (i) => procurar(messages, termos[i % termos.length]))
  console.log(`  varrer por tecla               mediana ${ms(varrer.mediana)}  pior ${ms(varrer.pior)}`)

  // 3. The index: build it, and query it.
  const construir = medir(20, () => construirIndice(messages))
  const indice = construirIndice(messages)
  const consultar = medir(200, (i) => indice.get(dobrarSimples(termos[i % termos.length])) ?? [])
  console.log(`  construir o índice             mediana ${ms(construir.mediana)}  pior ${ms(construir.pior)}`)
  console.log(`  consultar o índice             mediana ${ms(consultar.mediana)}  pior ${ms(consultar.pior)}`)
  console.log("")
}

// What the index does NOT do, and what scanning does for free. It is written
// beside the numbers because the decision is not just about time.
console.log("O que um índice por palavras perderia:")
const amostra = paraEcra("!c:s", historico(TECTO))
const indice = construirIndice(amostra)
const parcial = "ment"
console.log(`  procura por pedaço de palavra ("${parcial}"):`)
console.log(`    varredura ${procurar(amostra, parcial).length} achados`)
console.log(`    índice    ${(indice.get(parcial) ?? []).length} achados`)
