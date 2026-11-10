/**
 * Time until summaries match, by scenario (§8.2 of the plan
 * `docs/planos/2026-10-20-sincronia-absoluta.md`).
 *
 *   npx tsc -b && npm run build -w @enclave/server
 *   node scripts/medir-sincronia.mjs            # 3 runs
 *   CORRIDAS=10 MEDIR_PRAZO_MS=120000 node scripts/medir-sincronia.mjs
 *
 * Runs `apps/server/src/sincronia-absoluta.test.ts` (S0 scenarios, now with
 * anti-entropy on) and `apps/server/src/sincronia-s4.test.ts` (S4 scenarios)
 * and `apps/server/src/sincronia-s5.test.ts` (snapshot and attachments, with
 * the cost from §5.5 at plan scale) and from S6 onwards,
 * `apps/server/src/sincronia-ritmo.test.ts` (a burst above the server send cap,
 * line `MEDIDA-S6`) N times, each in a new process and new server, and combines
 * the `MEDIDA-S0`, `MEDIDA-S4` and `MEDIDA-S5` lines that each scenario writes.
 * From S4 on, compares each scenario to the goal in §2.3: 30 s with accounts
 * connected, 2 min after returning. Writes per scenario: p50 and p95 of time to
 * match, how many runs did not match within the timeout, and what types stayed
 * different.
 *
 * The scenarios live in one place, the test, so the script and the suite measure
 * the same thing. Today they are `Session` accounts in Node against a local
 * server. Real browsers (three engines, two devices) are in
 * `scripts/e2e-sincronia.mjs` (S6), which writes its own table.
 *
 * Output goes to `scripts/.saida-sincronia/`: raw lines and the summary. Each
 * next phase runs this and compares to the S0 baseline.
 */
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, "..")
const SAIDA = join(AQUI, ".saida-sincronia")
const CORRIDAS = Number(process.env.CORRIDAS ?? 3)
const BRUTO = join(SAIDA, "medidas.jsonl")

if (!existsSync(join(RAIZ, "packages/client-core/dist/sincronia/resumo.js"))) {
  console.error("Falta o build do núcleo. Corre primeiro: npx tsc -b && npm run build -w @enclave/server")
  process.exit(1)
}

mkdirSync(SAIDA, { recursive: true })
rmSync(BRUTO, { force: true })

for (let corrida = 1; corrida <= CORRIDAS; corrida++) {
  const inicio = Date.now()
  try {
    execFileSync(
      "npx",
      ["vitest", "run", "--root", "apps/server", "src/sincronia-absoluta.test.ts", "src/sincronia-s4.test.ts", "src/sincronia-s5.test.ts", "src/sincronia-ritmo.test.ts", "--reporter=dot"],
      // S5: the full-scale snapshot from §5.5 only runs here (slow), with MEDIR_S5_GRANDE.
      { cwd: RAIZ, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, MEDIR_SINCRONIA_SAIDA: BRUTO, MEDIR_S5_GRANDE: "1" } },
    )
    console.log(`corrida ${corrida}/${CORRIDAS}: ${((Date.now() - inicio) / 1000).toFixed(0)} s`)
  } catch {
    console.log(`corrida ${corrida}/${CORRIDAS}: a suite FALHOU (as medidas que saíram contam na mesma)`)
  }
}

const linhas = existsSync(BRUTO)
  ? readFileSync(BRUTO, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : []

function percentil(valores, p) {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)]
}

const porCenario = {}
for (const linha of linhas) (porCenario[`${linha.fase ?? "S0"}:${linha.cenario}`] ??= []).push(linha)

/** The target from §2.3 of each scenario: after returning, 2 min; with accounts linked, 30 s. */
// The S6 burst is not a target from §2.3: 30 sends against a cap of 20 per
// minute take at least 60 s. What we measure is that it finishes, and that it finishes the same way.
const META_MS = { desligada: 120_000, "servidor-perde": 120_000, "rajada-acima-do-tecto": 90_000 }
const metaDe = (cenario) => META_MS[cenario.split(":")[1]] ?? 30_000

const resumo = {}
for (const [cenario, medidas] of Object.entries(porCenario)) {
  const iguais = medidas.map((m) => m.ateIgualarMs).filter((ms) => typeof ms === "number")
  const tipos = {}
  for (const m of medidas) for (const tipo of Object.keys(m.diferentes ?? {})) tipos[tipo] = (tipos[tipo] ?? 0) + 1
  resumo[cenario] = {
    corridas: medidas.length,
    igualaram: iguais.length,
    p50Ms: percentil(iguais, 50),
    p95Ms: percentil(iguais, 95),
    metaMs: metaDe(cenario),
    cumpre: iguais.length === medidas.length && (percentil(iguais, 95) ?? Infinity) <= metaDe(cenario),
    tiposQueNaoIgualaram: tipos,
    ultima: medidas.at(-1),
  }
}

writeFileSync(join(SAIDA, "resumo.json"), `${JSON.stringify({ quando: new Date().toISOString(), CORRIDAS, resumo }, null, 2)}\n`)
console.log("\ncenário                  igualou   p50 ms   p95 ms   meta     cumpre   tipos que não igualaram (corridas)")
for (const [cenario, r] of Object.entries(resumo)) {
  const tipos = Object.entries(r.tiposQueNaoIgualaram).map(([t, n]) => `${t}(${n})`).join(" ") || "-"
  console.log(
    `${cenario.padEnd(24)} ${`${r.igualaram}/${r.corridas}`.padEnd(9)} ${String(r.p50Ms ?? "-").padEnd(8)} ${String(r.p95Ms ?? "-").padEnd(8)} ${String(r.metaMs).padEnd(8)} ${(r.cumpre ? "sim" : "NÃO").padEnd(8)} ${tipos}`,
  )
}
console.log(`\nResumo em ${join(SAIDA, "resumo.json")}`)
