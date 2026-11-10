/**
 * The vault bench: file size and ms per write, with 400, 1,000 and 2,000
 * messages per channel (§6.3 of the absolute sync plan, and the PENDING
 * measurement, point 4a, which until now was not stored anywhere).
 *
 *   npx tsc -b
 *   node scripts/medir-cofre.mjs
 *   CANAIS=20 ESCRITAS=15 node scripts/medir-cofre.mjs
 *
 * The vault is the real `Vault`, with the backend in memory and the real KDF once
 * (derivation does not enter the write). Each line sets up the vault by hand, then
 * measures `vault.update()`, which is the write that `flush` does: `JSON.stringify`
 * of the whole vault, XChaCha20 and the envelope. Measures the MEDIAN of WRITES
 * writes, after two warmups.
 *
 * Text messages with the size of a real message: the median production event is
 * 703 bytes of ciphertext (measured on 10/20), so the plaintext payload is around
 * 300 to 400 bytes in the vault, with the entry envelope.
 *
 * Also measures the state book with the S2 cap (1,000 posts, 5,000 comments per
 * channel), just for order of magnitude: the worst case, not the typical one.
 * And, since S2, the cost of `appendHistory` with a full book and the cost of
 * migrating vault version 1.
 *
 * ⚠️ PENDING 4a: an absurd number is for repeating, not for publishing. Machine
 * load comes out at the end (`loadavg`); with other agents running suites, repeat.
 */
import { Vault, appendHistory, migrarParaLivroDeEstado, newVaultContents } from "@enclave/client-core"
import { loadavg } from "node:os"
import { webcrypto } from "node:crypto"
if (!globalThis.crypto) globalThis.crypto = webcrypto

const CANAIS = Number(process.env.CANAIS ?? 20)
const ESCRITAS = Number(process.env.ESCRITAS ?? 9)
const LINHAS = [400, 1_000, 2_000]

class Contador {
  bytes = null
  supportsOsProtection = false
  async read() {
    return this.bytes
  }
  async write(b) {
    this.bytes = b
  }
  async clear() {
    this.bytes = null
  }
}

const FRASES = [
  "Amanhã às nove no lagar, quem puder leva a chave do portão de baixo.",
  "Vi agora a mensagem. Concordo, mas convém confirmar com a Câmara antes de avançar.",
  "Ok",
  "Mandei o orçamento por email. Diz-me se chegou, que o anexo era grande e às vezes fica preso.",
]

function mensagem(canal, i) {
  const at = Date.UTC(2026, 9, 1) + i * 60_000
  return {
    seq: i,
    sender: `@pessoa${i % 7}:casa.test`,
    at,
    payload: {
      t: "message",
      id: `${canal.slice(1, 9)}-${String(i).padStart(8, "0")}-0000-0000-000000000000`,
      sentAt: at,
      body: FRASES[i % FRASES.length],
      attachments: [],
      links: [],
      mentions: [],
    },
  }
}

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

async function medir(preencher) {
  const backend = new Contador()
  const vault = new Vault(backend)
  await vault.create("frase-da-bancada")
  await vault.update(preencher)
  const tempos = []
  for (let i = 0; i < ESCRITAS + 2; i++) {
    const inicio = performance.now()
    // The change a new message makes: a timestamp, and the whole vault rewritten.
    await vault.update((c) => {
      c.lastSeq["!marca:casa.test"] = i
    })
    if (i >= 2) tempos.push(performance.now() - inicio)
  }
  return { mb: backend.bytes.length / 1e6, ms: mediana(tempos) }
}

console.log(`Bancada do cofre: ${CANAIS} canais, mediana de ${ESCRITAS} escritas.\n`)
console.log("mensagens/canal   ficheiro   ms/escrita   escritas/min a FLUSH_MS 1500 (MB/min)")
const resultados = []
for (const porCanal of LINHAS) {
  const { mb, ms } = await medir((c) => {
    for (let k = 0; k < CANAIS; k++) {
      const canal = `!canal${String(k).padStart(3, "0")}:casa.test`
      c.history[canal] = Array.from({ length: porCanal }, (_, i) => mensagem(canal, i))
    }
  })
  resultados.push({ porCanal, mb, ms })
  console.log(
    `${String(porCanal).padEnd(17)} ${`${mb.toFixed(1)} MB`.padEnd(10)} ${`${ms.toFixed(0)} ms`.padEnd(12)} ${(mb * 40).toFixed(0)} MB/min no pior caso`,
  )
}

// The S2 state book at the cap, in one channel, over 400 messages in 20 channels.
// Since S2 with the real field (`estadoDoCanal`), not a mock.
function comLivroNoTecto(c) {
  for (let k = 0; k < CANAIS; k++) {
    const canal = `!canal${String(k).padStart(3, "0")}:casa.test`
    c.history[canal] = Array.from({ length: 400 }, (_, i) => mensagem(canal, i))
  }
  c.estadoDoCanal["!canal000:casa.test"] = [
    ...Array.from({ length: 1_000 }, (_, i) => ({
      seq: 10_000 + i,
      sender: "@dona:casa.test",
      at: i,
      payload: { t: "post", id: `p-${i}-0000-0000-0000-000000000000`, postedAt: i, caption: FRASES[i % 4].repeat(2), media: [], links: [], tags: [] },
    })),
    ...Array.from({ length: 5_000 }, (_, i) => ({
      seq: 20_000 + i,
      sender: `@pessoa${i % 7}:casa.test`,
      at: i,
      payload: { t: "post.comment", id: `c-${i}-0000-0000-0000-000000000000`, target: `p-${i % 1000}`, postedAt: i, body: FRASES[i % 4] },
    })),
  ]
}
const livro = await medir(comLivroNoTecto)
console.log(`\nlivro de estado no tecto (1.000 publicações, 5.000 comentários) + 400 × ${CANAIS}: ${livro.mb.toFixed(1)} MB, ${livro.ms.toFixed(0)} ms`)

// The cost of `appendHistory` (S1 and S2: deduplication by seq and key, and type
// caps) in a channel with a full book: one message and one comment.
{
  const c = newVaultContents()
  comLivroNoTecto(c)
  const tempos = { mensagem: [], comentario: [] }
  for (let i = 0; i < ESCRITAS + 2; i++) {
    let inicio = performance.now()
    appendHistory(c, "!canal000:casa.test", mensagem("!canal000:casa.test", 50_000 + i))
    if (i >= 2) tempos.mensagem.push(performance.now() - inicio)
    inicio = performance.now()
    appendHistory(c, "!canal000:casa.test", {
      seq: 60_000 + i,
      sender: "@pessoa1:casa.test",
      at: i,
      payload: { t: "post.comment", id: `n-${i}-0000-0000-0000-000000000000`, target: "p-1", postedAt: i, body: "novo" },
    })
    if (i >= 2) tempos.comentario.push(performance.now() - inicio)
  }
  console.log(`appendHistory com o livro cheio: mensagem ${mediana(tempos.mensagem).toFixed(2)} ms, comentário ${mediana(tempos.comentario).toFixed(2)} ms`)
}

// The migration of version 1 (the book comes out of `history`), once, on open:
// 20 channels of 400, with half of each channel being state.
{
  const c = newVaultContents()
  for (let k = 0; k < CANAIS; k++) {
    const canal = `!canal${String(k).padStart(3, "0")}:casa.test`
    c.history[canal] = Array.from({ length: 400 }, (_, i) =>
      i % 2 ? mensagem(canal, i) : { seq: i, sender: "@dona:casa.test", at: i, payload: { t: "post", id: `p-${k}-${i}`, postedAt: i, caption: "x", media: [], links: [], tags: [] } },
    )
  }
  const inicio = performance.now()
  migrarParaLivroDeEstado(c)
  console.log(`migração da versão 1, ${CANAIS} × 400 entradas: ${(performance.now() - inicio).toFixed(1)} ms`)
}

const vazio = newVaultContents()
console.log(`(cofre vazio: ${JSON.stringify(vazio).length} bytes em claro)`)
console.log(`carga da máquina (1, 5, 15 min): ${loadavg().map((x) => x.toFixed(1)).join(", ")}`)
console.log(JSON.stringify({ CANAIS, ESCRITAS, resultados, livro }))
