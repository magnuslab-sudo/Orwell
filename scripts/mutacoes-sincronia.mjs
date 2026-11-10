/**
 * The mutations of absolute synchrony (§8.4 of the plan
 * `docs/planos/2026-10-20-sincronia-absoluta.md`), recorded in one place.
 *
 *   node scripts/mutacoes-sincronia.mjs              (all)
 *   node scripts/mutacoes-sincronia.mjs lugar piso   (only these)
 *
 * Each mutation disables ONE guard in production code, runs the test that
 * pins it, and restores the file, come what may (including Ctrl-C).
 * A mutation passes when the test turns RED: the guard has a test watching it.
 * A green test with the guard off is a guard with no proof, and the script
 * exits with 1.
 *
 * The text to swap must appear exactly once in the file: if the code changed
 * and the mutation lost its target, the script says so and fails, instead of
 * measuring nothing (lesson from "Two Phase 1 mutations lost their target",
 * `docs/PENDENTES.md`).
 *
 * Mutations touching `packages/` and proved in `apps/server` need `dist`
 * rebuilt: the script runs `npx tsc -b` before and after them.
 *
 * Does not touch git: reads the file, writes the mutation, writes the original
 * back. Run with a clean tree, so a `git diff` at the end shows nothing.
 * WATCH OUT: a hook that auto-commits "wip" can catch the file mid-mutation
 * (happened 21/10/2026). The file on disk stays right; the "wip" commit doesn't,
 * and won't integrate.
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))

const MUTACOES = [
  {
    nome: "supressao",
    guarda: "quem vê um resumo igual ao que ia mandar cala-se (§4.4)",
    ficheiro: "packages/client-core/src/sincronia/pedido.ts",
    de: `      if (agendada && agendada.d === corpo.d) {
        this.#cancelar(agendada.temporizador)`,
    para: `      if (false && agendada && agendada.d === corpo.d) {
        this.#cancelar(agendada.temporizador)`,
    teste: ["packages/client-core", "src/sincronia/pedido.test.ts"],
  },
  {
    nome: "autoria",
    guarda: "um relato sem autoria válida é recusado (§4.1)",
    ficheiro: "packages/client-core/src/sincronia/relato.ts",
    de: `  if (!autoria.ok) return { ok: false, razao: "autoria" }`,
    para: `  if (false && !autoria.ok) return { ok: false, razao: "autoria" }`,
    teste: ["packages/client-core", "src/sincronia/relato.test.ts"],
  },
  {
    nome: "lugar",
    guarda: "conversa anterior ao lugar de quem recebe não entra (§5.3)",
    ficheiro: "packages/client-core/src/sincronia/relato.ts",
    de: `(item.s < 0 || item.s < contexto.lugar)) return { ok: false, razao: "lugar" }`,
    para: `(false && (item.s < 0 || item.s < contexto.lugar))) return { ok: false, razao: "lugar" }`,
    teste: ["packages/client-core", "src/sincronia/relato.test.ts"],
  },
  {
    nome: "ja-temos",
    guarda: "o que já temos ganha ao relato (§7.4)",
    ficheiro: "packages/client-core/src/sincronia/relato.ts",
    de: `  if (contexto.jaTemos(doResumo.chave)) return { ok: false, razao: "ja-temos" }`,
    para: `  if (false && contexto.jaTemos(doResumo.chave)) return { ok: false, razao: "ja-temos" }`,
    teste: ["packages/client-core", "src/sincronia/relato.test.ts"],
  },
  {
    nome: "lapide",
    guarda: "a lápide é absorvente: o que está apagado não volta por relato (§7.6)",
    ficheiro: "packages/client-core/src/sincronia/relato.ts",
    de: `  if (contexto.apagado(doResumo, item.a, normal as StoredPayload)) return { ok: false, razao: "lapide" }`,
    para: `  if (false && contexto.apagado(doResumo, item.a, normal as StoredPayload)) return { ok: false, razao: "lapide" }`,
    teste: ["packages/client-core", "src/sincronia/relato.test.ts"],
  },
  {
    nome: "piso",
    guarda: "o piso sobe em cada Welcome, e não só quando não existe (decisão 2a)",
    ficheiro: "packages/client-core/src/sincronia/pedido.ts",
    de: `  async aoWelcome(canal: string): Promise<void> {
    this.#porPiso(canal, this.#porta.lugar(canal))`,
    para: `  async aoWelcome(canal: string): Promise<void> {
    if (this.#cofre().piso?.[canal] === undefined) this.#porPiso(canal, this.#porta.lugar(canal))`,
    teste: ["packages/client-core", "src/sincronia/pedido.test.ts"],
  },
  {
    nome: "tecto-de-bytes",
    guarda: "o sinal conta as cópias contra o tecto de bytes por canal (§4.4, revisão de S4)",
    ficheiro: "packages/client-core/src/sincronia/pedido.ts",
    de: "    const custo = sinal.length * this.#copias(canal)",
    para: "    const custo = sinal.length",
    teste: ["packages/client-core", "src/sincronia/pedido.test.ts"],
  },
  {
    nome: "ritmo-servidor",
    guarda: "o servidor recusa com código o envio acima do tecto, nunca calado (S6)",
    ficheiro: "apps/server/src/gateway.ts",
    de: `          this.#recusarEnvioPorRitmo(connection, frame, balde, tecto)
          return`,
    para: `          return`,
    teste: ["apps/server", "src/sincronia-ritmo.test.ts"],
  },
  {
    nome: "ritmo-cliente",
    guarda: "o cliente pára, espera e repete o envio recusado por ritmo (S6)",
    ficheiro: "packages/client-core/src/session.ts",
    de: `      this.#aoRecusaPorRitmo(frame.channel, frame.ref, frame.retryAfterMs)
      return`,
    para: `      return`,
    teste: ["apps/server", "src/sincronia-ritmo.test.ts"],
    reconstruir: true,
  },
]

const pedidas = process.argv.slice(2)
const escolhidas = pedidas.length ? MUTACOES.filter((m) => pedidas.includes(m.nome)) : MUTACOES
if (pedidas.length && escolhidas.length !== pedidas.length) {
  console.error(`Mutação desconhecida. Há: ${MUTACOES.map((m) => m.nome).join(", ")}`)
  process.exit(2)
}

const originais = new Map()
function repor() {
  for (const [caminho, texto] of originais) writeFileSync(caminho, texto)
  originais.clear()
}
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    repor()
    process.exit(130)
  })
}

const correr = (comando, argumentos) => spawnSync(comando, argumentos, { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
const reconstruir = () => correr("npx", ["tsc", "-b"]).status === 0

const linhas = []
let falhou = false
for (const mutacao of escolhidas) {
  const caminho = join(RAIZ, mutacao.ficheiro)
  const original = readFileSync(caminho, "utf8")
  const { de, para } = mutacao
  const vezes = de ? original.split(de).length - 1 : 0
  if (vezes !== 1) {
    linhas.push({ nome: mutacao.nome, resultado: `ALVO PERDIDO (${vezes} ocorrências)`, guarda: mutacao.guarda })
    falhou = true
    continue
  }
  originais.set(caminho, original)
  writeFileSync(caminho, original.replace(de, para))
  try {
    if (mutacao.reconstruir && !reconstruir()) {
      linhas.push({ nome: mutacao.nome, resultado: "NÃO COMPILA com a mutação", guarda: mutacao.guarda })
      falhou = true
      continue
    }
    const [raiz, ficheiro] = mutacao.teste
    const corrida = correr("npx", ["vitest", "run", "--root", raiz, ficheiro])
    const saida = `${corrida.stdout}\n${corrida.stderr}`
    const vermelhos = saida.match(/Tests\s+(\d+) failed/)?.[1] ?? "0"
    const vermelho = corrida.status !== 0
    linhas.push({
      nome: mutacao.nome,
      resultado: vermelho ? `vermelho (${vermelhos} testes)` : "VERDE: a guarda não tem teste",
      guarda: mutacao.guarda,
      teste: `${raiz}/${ficheiro}`,
    })
    if (!vermelho) falhou = true
  } finally {
    repor()
    if (mutacao.reconstruir) reconstruir()
  }
}

console.log("\n| Mutação | Guarda | Teste | Resultado |")
console.log("|---|---|---|---|")
for (const l of linhas) console.log(`| ${l.nome} | ${l.guarda} | ${l.teste ?? ""} | ${l.resultado} |`)
process.exit(falhou ? 1 : 0)
