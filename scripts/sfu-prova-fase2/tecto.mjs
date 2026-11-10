/**
 * The server's bandwidth limit: how far it reaches, and where it stops.
 *
 * `BANDA_DE_ENTRADA_POR_TRANSPORTE` is the only limit in the list that resists
 * a client that lies: it is applied with `setMaxIncomingBitrate` on the transport,
 * on the server side, and does not depend on the client declaring anything. Phase 1
 * left it unapplied; Phase 2 applied it and read it from inside the worker, which
 * proves it reached C++, and honestly wrote that "biting" was something else and
 * remained to be seen.
 *
 * This measures by difference: the number changes in `apps/server/src/media.ts`,
 * recompiles, everything starts up again, and you watch what changed on the client side.
 * A single run proves no limit, an `availableOutgoingBitrate` of 128 000 could be
 * either the server limit or a coincidence of the local network. Three runs with three
 * limits tell one from the other.
 *
 * **What was found, and is written out in full at the end of the script:** the limit
 * does cross all three processes and constrains the client's estimate, but it was NOT
 * seen refusing anything, the actual rate of an Opus track does not move with the
 * limit at 16 000, 128 000 or 512 000, because it never comes close. A limit you never
 * reach refuses nothing, and that half closes with Phase 3 video.
 *
 * ```
 * node scripts/sfu-prova-fase2/tecto.mjs
 * ```
 *
 * **Edits the SOURCE and recompiles**, not `dist`. What you want to prove is that the
 * constant written in `media.ts` is what moves the number; a patched `dist` would prove
 * that `dist` is what matters, which you already know. The source is restored at the end,
 * even if this breaks in the middle, and if for some reason it is not, the script itself
 * says out loud what was left unrestored.
 */
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { APP, FRASE, matarTudo, levantarServidor, levantarWeb, RAIZ } from "./bancada.mjs"
import { LER_ESTATISTICAS } from "./instrumento.mjs"
import { abrirCanal, abrirConta, assentar, criarCanal, entrarNaChamada } from "./montagem.mjs"

const FONTE = join(RAIZ, "apps/server/src/media.ts")
const ORIGINAL = readFileSync(FONTE, "utf8")
const DECLARACAO = /export const BANDA_DE_ENTRADA_POR_TRANSPORTE = [\d_]+/

/*
 * The three limits, and what each one is for.
 *
 * 128 000 is the app's setting. 512 000 is way above what an Opus track wants:
 * if the client's estimate goes higher, it is coming from here. And 16 000 is
 * BELOW the codec's 32 kbps target, it is the only one of the three that would
 * ask the sender for something it was not doing, and that is why it is here.
 */
const TECTOS = [128_000, 512_000, 16_000]

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const resultados = []
const verificar = (etiqueta, ok, detalhe = "") => {
  resultados.push({ etiqueta, ok })
  console.log(`${ok ? "PASS" : "FALHA"}  ${etiqueta}${detalhe ? ` -- ${detalhe}` : ""}`)
}

/** A two-person call, and what the sender achieves and reports. */
async function medirCom(tecto) {
  if (!DECLARACAO.test(ORIGINAL)) throw new Error("a declaração do tecto mudou de forma; este guião não a encontra")
  writeFileSync(FONTE, ORIGINAL.replace(DECLARACAO, `export const BANDA_DE_ENTRADA_POR_TRANSPORTE = ${tecto}`))
  execFileSync("npx", ["tsc", "-b"], { cwd: RAIZ, stdio: "pipe" })

  const dados = mkdtempSync(join(tmpdir(), "orwell-tecto-dados-"))
  const perfis = mkdtempSync(join(tmpdir(), "orwell-tecto-perfis-"))
  const clientes = []
  try {
    if (!(await levantarServidor(dados))) throw new Error("o homeserver não subiu")
    if (!(await levantarWeb())) throw new Error("o vite não subiu")

    const sala = `tecto ${Date.now().toString(36)}`
    for (const indice of [0, 1]) {
      clientes.push(await abrirConta(APP, { nome: `tecto ${indice}`, frase: FRASE, indice, perfil: perfis }))
    }
    await criarCanal(clientes[0].page, sala)
    if (!(await assentar(clientes[0], clientes[1], sala))) throw new Error("o convidado ficou à porta")
    for (const cliente of clientes) {
      await abrirCanal(cliente.page, sala)
      await entrarNaChamada(cliente.page)
      await cliente.page.waitForTimeout(1500)
    }

    // Ten seconds to settle, and ten to measure. Congestion control needs
    // to see traffic before it has an opinion about it.
    await dormir(10_000)
    const antes = await clientes[0].page.evaluate(LER_ESTATISTICAS)
    const t0 = Date.now()
    await dormir(10_000)
    const depois = await clientes[0].page.evaluate(LER_ESTATISTICAS)
    const segundos = (Date.now() - t0) / 1000

    // The send transport is the one that HAS output; the receive transport only has input. That is
    // how you tell them apart, not by the order they were created.
    const envio = (lista) => lista.find((pc) => pc.dtls === "connected" && pc.saida.length > 0)
    const recepcao = (lista) => lista.find((pc) => pc.dtls === "connected" && pc.saida.length === 0)
    const bytes = (pc) => pc?.saida.reduce((total, linha) => total + linha.bytes, 0) ?? 0

    return {
      tecto,
      bandaAnunciadaNoEnvio: envio(depois)?.bandaDeSaida ?? null,
      bandaAnunciadaNaRecepcao: recepcao(depois)?.bandaDeSaida ?? null,
      ritmoReal: Math.round(((bytes(envio(depois)) - bytes(envio(antes))) * 8) / segundos),
    }
  } finally {
    for (const cliente of clientes) await cliente.ctx.close().catch(() => {})
    matarTudo()
    rmSync(dados, { recursive: true, force: true })
    rmSync(perfis, { recursive: true, force: true })
  }
}

const medidas = []
try {
  for (const tecto of TECTOS) {
    console.log(`\n== tecto do servidor: ${tecto} bit/s`)
    const medida = await medirCom(tecto)
    medidas.push(medida)
    console.log(
      `   anunciado ao emissor ${medida.bandaAnunciadaNoEnvio}` +
        `  ·  ao receptor ${medida.bandaAnunciadaNaRecepcao}` +
        `  ·  ritmo real ${medida.ritmoReal} bit/s`,
    )
  }
} finally {
  writeFileSync(FONTE, ORIGINAL)
  try {
    execFileSync("npx", ["tsc", "-b"], { cwd: RAIZ, stdio: "pipe" })
  } catch {
    console.error("ATENÇÃO: o `media.ts` foi reposto mas o `tsc -b` falhou. Compilar à mão antes de mais nada.")
  }
}

console.log("")
const [base, alto, baixo] = medidas

/*
 * 1. The limit is a MAXIMUM, and behaves like one.
 *
 * The temptation was to require monotony, higher limit, higher estimate, and
 * it does not hold up: with the limit at 512 000 the client is not constrained
 * by anything and ends up where its own estimate happens to be, which in two runs
 * gave 141 538 and 121 600. A check written around that number passes once and
 * fails next time, and what you learn from it is about Chrome, not the app.
 *
 * What repeats, and is what a maximum promises:
 *
 *   limit 128 000 → 128 000 at the bit          estimate STUCK to the limit
 *   limit  16 000 →  54 400                     drops far below where it would be
 *   limit 512 000 → 121 600 / 141 538           constrains nothing, not even close
 *
 * The three together say the same thing three ways: the number written in
 * `media.ts` is the upper bound of what the client allows itself, not a
 * coincidence of the local network.
 */
verificar(
  "com o tecto do produto, a estimativa do cliente fica PRESA nele, ao bit",
  base?.bandaAnunciadaNoEnvio === base?.tecto,
  `${base?.tecto} → ${base?.bandaAnunciadaNoEnvio}`,
)
verificar(
  "apertar o tecto empurra a estimativa para baixo",
  baixo !== undefined && base !== undefined && baixo.bandaAnunciadaNoEnvio < base.bandaAnunciadaNoEnvio,
  `${baixo?.tecto} → ${baixo?.bandaAnunciadaNoEnvio}  (contra ${base?.bandaAnunciadaNoEnvio} com ${base?.tecto})`,
)
verificar(
  "e um tecto muito alto não prende nada: a estimativa fica longe dele",
  alto !== undefined && alto.bandaAnunciadaNoEnvio < alto.tecto * 0.5,
  `${alto?.tecto} → ${alto?.bandaAnunciadaNoEnvio}`,
)

/*
 * 2. And only on the SEND transport.
 *
 * `setMaxIncomingBitrate` applies to what ENTERS the server, which is what leaves
 * the client. The receive transport does not carry it, and you see it: it stays
 * at Chrome's default value, unmoved while the other one changes three times.
 */
verificar(
  "o transporte de recepção não leva tecto nenhum, e não se mexe",
  new Set(medidas.map((m) => m.bandaAnunciadaNaRecepcao)).size === 1 &&
    medidas.every((m) => m.bandaAnunciadaNaRecepcao !== m.tecto),
  medidas.map((m) => m.bandaAnunciadaNaRecepcao).join(", "),
)

/*
 * 3. And what was NOT proved, stated as a measurement and not as a caveat.
 *
 * "Biting" is the server refusing something to whoever tries to send too much, and
 * that remains to be seen, not because the measurement failed, but because there
 * is no sender in this path that wants more. The Phase 1 router negotiates Opus
 * and nothing else, the client asks for 32 kbps, and the real rate stays at ~34.5 kbps
 * with the limit at 128 000, 512 000 or 16 000: even the tightest limit of the
 * three leaves Chrome with a floor of 54 400, which is still above what the track uses.
 * A limit you never reach refuses nothing.
 *
 * This is NOT a check, it is a reading, and so it does not count toward the
 * result. Counting it as PASS would mean you proved the missing half: anyone
 * reading "3/3 passed" has to be able to believe the limit was seen refusing
 * something, and it was not. The question closes in Phase 3, with video, a
 * sender that WANTS more than 128 kbps, and that is where this script comes back.
 */
const ritmos = medidas.map((m) => m.ritmoReal)
const variacao = (Math.max(...ritmos) - Math.min(...ritmos)) / Math.max(...ritmos)
console.log(
  `NOTA   o tecto NÃO foi visto a morder: o ritmo real não se mexe (${ritmos.join(", ")} bit/s, ` +
    `${(variacao * 100).toFixed(1)}% de diferença entre o tecto mais largo e o mais apertado).`,
)
console.log("       Uma faixa de Opus a 32 kbps nunca chega ao tecto, e um tecto que não se atinge não recusa nada.")
console.log("       Falta um emissor que queira mais do que 128 kbps, e isso é o vídeo da Fase 3.")

const passou = resultados.filter((r) => r.ok).length
console.log(`\n${passou}/${resultados.length} verificações passaram`)
process.exit(passou === resultados.length ? 0 : 1)
