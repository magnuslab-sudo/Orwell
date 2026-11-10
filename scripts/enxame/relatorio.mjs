/**
 * The diagnosis. This is what makes the harness different from a test.
 *
 * A test says "passed". This answers a different question: what happened,
 * where, and with what evidence. That's why these are the sections-
 *
 *   what failed, grouped by CLASS with the step that triggered it, because
 *   "12 errors" doesn't get fixed and "9 times the same timeout waiting for
 *   the member panel" does;
 *
 *   console errors, all of them, by bot, because zero is the target and
 *   anything above is a finding even if nothing looked broken;
 *
 *   invariants, checked one by one, because silence is not proof-the costly
 *   bugs in this app were all silent;
 *
 *   timings in DISTRIBUTION not average, because average hides exactly the tail
 *   that makes someone close the tab;
 *
 *   and what the run didn't exercise, the most valuable section and the one
 *   most often missing. Without it, a twenty-page report reads as complete
 *   coverage.
 */
import { writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"

/** Percentiles by position, no interpolation: with thirty samples it's not worth it. */
export function distribuicao(valores) {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => a - b)
  const em = (fraccao) => ordenados[Math.min(ordenados.length - 1, Math.floor(fraccao * ordenados.length))]
  return {
    n: ordenados.length,
    p50: em(0.5),
    p90: em(0.9),
    p99: em(0.99),
    max: ordenados[ordenados.length - 1],
    min: ordenados[0],
  }
}

/**
 * Classify an error by what it is, not by the whole text.
 *
 * Playwright text includes the selector, the timeout, and a piece of the DOM;
 * grouping by raw text gave thirty groups of one. What matters is the family:
 * a timeout and a modal on top need different fixes.
 */
export function classificar(erro) {
  const texto = String(erro?.message ?? erro)
  if (/Timeout .* exceeded|waiting for/i.test(texto)) return "espera-esgotada"
  if (/intercepts pointer events|not visible|not stable/i.test(texto)) return "elemento-inalcançável"
  if (/strict mode violation/i.test(texto)) return "selector-ambíguo"
  if (/Target (page|closed)|Execution context was destroyed|has been closed/i.test(texto)) return "página-fechou"
  if (/net::|WebSocket|ECONNREFUSED/i.test(texto)) return "rede"
  return "erro"
}

/** The first line, without the concrete selector: this is what makes two equal errors group. */
export function resumirErro(erro) {
  return String(erro?.message ?? erro)
    .split("\n")[0]
    .replace(/\d{2,}/g, "N")
    .slice(0, 160)
}

const chaveDoAchado = (achado) => `${achado.classe} · ${achado.accao} · ${achado.resumo}`

export function agrupar(achados) {
  const grupos = new Map()
  for (const achado of achados) {
    const chave = chaveDoAchado(achado)
    const grupo = grupos.get(chave) ?? { ...achado, quantos: 0, bots: new Set(), provas: [] }
    grupo.quantos++
    grupo.bots.add(achado.bot)
    if (achado.prova && grupo.provas.length < 3) grupo.provas.push(achado.prova)
    grupos.set(chave, grupo)
  }
  return [...grupos.values()].sort((a, b) => b.quantos - a.quantos)
}

const ms = (valor) => (valor === undefined || valor === null ? "—" : `${(valor / 1000).toFixed(1)} s`)

function tabelaDeTempos(tempos) {
  const porPasso = new Map()
  for (const { passo, ms: duracao } of tempos) {
    porPasso.set(passo, [...(porPasso.get(passo) ?? []), duracao])
  }
  const linhas = ["| passo | n | p50 | p90 | p99 | máx |", "| --- | ---: | ---: | ---: | ---: | ---: |"]
  for (const [passo, valores] of [...porPasso.entries()].sort()) {
    const d = distribuicao(valores)
    linhas.push(`| ${passo} | ${d.n} | ${ms(d.p50)} | ${ms(d.p90)} | ${ms(d.p99)} | ${ms(d.max)} |`)
  }
  return porPasso.size === 0 ? "_Nenhum passo chegou a ser medido._" : linhas.join("\n")
}

/**
 * Write the report and raw evidence.
 *
 * Markdown is for reading; `.ndjson` is to come back to this run in two weeks
 * without relying on what the report summarized. Both go in the run folder,
 * which is outside version control: screenshots and databases don't get
 * committed-1.3 MB of Chrome profiles already made it to the repo once.
 */
export async function escrever({ dirCorrida, corrida, relatorio }) {
  await mkdir(dirCorrida, { recursive: true })
  const caminhoMd = join(dirCorrida, "relatorio.md")
  const caminhoNdjson = join(dirCorrida, "eventos.ndjson")
  await writeFile(caminhoMd, relatorio, "utf8")
  await writeFile(
    caminhoNdjson,
    corrida.map((linha) => JSON.stringify(linha)).join("\n") + "\n",
    "utf8",
  )
  return { caminhoMd, caminhoNdjson }
}

/** The full report, in markdown. */
export function compor({
  identificacao,
  valida,
  motivoInvalidez,
  invariantes,
  achados,
  consola,
  tempos,
  catalogo,
  naoExercitado,
  registoServidor,
}) {
  const partes = []
  const grave = achados.filter((a) => a.classe === "invariante")
  const outros = achados.filter((a) => a.classe !== "invariante")

  partes.push(`# Enxame — corrida ${identificacao.id}`)
  partes.push("")
  partes.push(
    [
      `- **semente** \`${identificacao.semente}\` (repete a corrida com \`--semente=${identificacao.semente}\`)`,
      `- **bots** ${identificacao.bots} · **duração pedida** ${identificacao.minutos} min · **duração real** ${(identificacao.duracaoMs / 60000).toFixed(1)} min`,
      `- **alvo** ${identificacao.urlWeb} → homeserver \`${identificacao.servidor}\` (ambos efémeros, nascidos e mortos com esta corrida)`,
      `- **máquina** carga ${identificacao.carga} · ${identificacao.cpus} núcleos`,
      `- **começou** ${new Date(identificacao.comecouEm).toISOString()}`,
    ].join("\n"),
  )
  partes.push("")

  partes.push("## Veredicto")
  partes.push("")
  if (!valida) {
    partes.push(
      `**CORRIDA INVÁLIDA.** ${motivoInvalidez}`,
      "",
      "Não há métricas para ler abaixo: o cenário não chegou a montar-se, e uma corrida que mede zero",
      "porque ninguém entrou lê-se como a pior avaria de sempre. Nada nesta página conta como prova de",
      "que a aplicação está bem nem mal.",
    )
  } else {
    // Counted by class, not summed into one number: "5 failures" meant the same
    // thing for a scenario that didn't mount and a click that didn't stick.
    const montagem = outros.filter((a) => a.classe === "montagem").length
    partes.push(
      `Corrida válida. ${grave.length} violação(ões) de invariante, ` +
        `${montagem} achado(s) na montagem, ${outros.length - montagem} falha(s) de acção, ` +
        `${consola.total} erro(s) de consola.`,
    )
  }
  partes.push("")

  partes.push("## 1. Invariantes")
  partes.push("")
  partes.push("Cada uma foi verificada, e não inferida da ausência de estrondo.")
  partes.push("")
  partes.push("| invariante | verificações | violações | veredicto |")
  partes.push("| --- | ---: | ---: | --- |")
  for (const inv of invariantes) {
    const veredicto = inv.verificacoes === 0 ? "**não exercitada**" : inv.violacoes === 0 ? "cumprida" : "**VIOLADA**"
    partes.push(`| ${inv.nome} | ${inv.verificacoes} | ${inv.violacoes} | ${veredicto} |`)
  }
  partes.push("")
  for (const inv of invariantes.filter((i) => i.violacoes > 0)) {
    partes.push(`### ${inv.nome} — VIOLADA`)
    partes.push("")
    partes.push(inv.porque)
    partes.push("")
    for (const prova of inv.provas.slice(0, 8)) {
      partes.push(`- ${prova}`)
    }
    partes.push("")
  }

  partes.push("## 2. O que falhou, classificado")
  partes.push("")
  if (achados.length === 0) {
    partes.push("_Nada falhou._")
  } else {
    partes.push("| classe | acção | quantos | bots | o quê |")
    partes.push("| --- | --- | ---: | ---: | --- |")
    for (const grupo of agrupar(achados)) {
      partes.push(
        `| ${grupo.classe} | \`${grupo.accao}\` | ${grupo.quantos} | ${grupo.bots.size} | ${grupo.resumo.replace(/\|/g, "/")} |`,
      )
    }
    partes.push("")
    partes.push("### Provas")
    partes.push("")
    for (const grupo of agrupar(achados).filter((g) => g.provas.length > 0)) {
      partes.push(`- \`${grupo.accao}\` / ${grupo.classe}: ${grupo.provas.map((p) => `\`${p}\``).join(", ")}`)
    }
  }
  partes.push("")

  partes.push("## 3. Erros de consola")
  partes.push("")
  partes.push("Zero é a expectativa. Qualquer coisa acima disso é achado, mesmo sem sintoma visível.")
  partes.push("")
  partes.push(`Total: **${consola.total}** em ${identificacao.bots} bots.`)
  partes.push("")
  if (consola.total > 0) {
    partes.push("| tipo | texto | ocorrências | bots |")
    partes.push("| --- | --- | ---: | ---: |")
    for (const linha of consola.grupos) {
      partes.push(`| ${linha.tipo} | ${linha.texto.replace(/\|/g, "/")} | ${linha.quantos} | ${linha.bots} |`)
    }
    partes.push("")
    partes.push("Por bot: " + consola.porBot.map((n, i) => `bot${i}:${n}`).join(" · "))
  }
  partes.push("")

  partes.push("## 4. Tempos")
  partes.push("")
  partes.push("Distribuição, não média: o que faz alguém fechar o separador é a cauda.")
  partes.push("")
  partes.push(tabelaDeTempos(tempos))
  partes.push("")

  partes.push("## 5. O que a corrida exercitou")
  partes.push("")
  partes.push("| acção | tentativas | ok | saltada | falhou |")
  partes.push("| --- | ---: | ---: | ---: | ---: |")
  for (const linha of catalogo) {
    partes.push(`| ${linha.nome} | ${linha.tentativas} | ${linha.ok} | ${linha.saltada} | ${linha.falhou} |`)
  }
  partes.push("")

  partes.push("## 6. O que a corrida NÃO exercitou")
  partes.push("")
  partes.push("A secção que mais vezes falta. Nada aqui foi medido, e portanto nada aqui está provado bom.")
  partes.push("")
  for (const linha of naoExercitado) partes.push(`- ${linha}`)
  partes.push("")

  if (registoServidor.length > 0) {
    partes.push("## 7. O que o servidor disse")
    partes.push("")
    partes.push("```")
    partes.push(registoServidor.slice(-40).join("\n"))
    partes.push("```")
    partes.push("")
  }

  return partes.join("\n")
}
