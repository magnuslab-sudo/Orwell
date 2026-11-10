import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import {
  CHAVES_DAS_RECUSAS_DO_SFU,
  CHAVES_DOS_ERROS_DO_BROWSER,
  RECUSA_DO_SFU_GENERICA,
} from "@enclave/client-core"
import { beforeAll, describe, expect, it } from "vitest"
import { CHAVES_DO_EMPARELHAMENTO, CHAVES_DO_SERVIDOR, CODIGOS_DE_ERRO } from "./codigosDeErro.js"

/**
 * Proof that "Error 900" is gone (phase 5, block C).
 *
 * Sweeps the server, both bridges and the interface, and collects every error
 * message written in the code: `new Error("…")`, `` new Error(`…`) ``, and
 * the `detail` of each `emit("error", …)` call. Any message that can reach the
 * screen must have a code in the table. Those that do not go in `TOLERADAS`,
 * each with the reason.
 *
 * Three rules, and what each catches:
 *   1. A literal message with no code and no reason: a new error someone wrote
 *      without giving it a number. Would be tomorrow's "Error 900".
 *   2. A template with `${…}`: data goes in `cause`, never in the key. A key
 *      with the channel in it is a different key for each channel.
 *   3. A tolerance that no longer exists in the code: the list cannot keep
 *      reasons for errors that have been removed, or it stops telling the truth.
 */

/**
 * The repository root, from the path of this test.
 *
 * By `testPath` not by `import.meta.url`: in jsdom the module address is not
 * a `file:`. Same trick as in `botoesEmFormulario.test.ts`.
 */
function raiz(): string {
  const meu = expect.getState().testPath
  if (!meu) throw new Error("sem caminho do teste: não há o que varrer")
  return join(dirname(meu), "../../../..")
}
const PASTAS = ["packages/client-core/src", "packages/ui/src", "apps/web/src", "apps/client/src"]

/** Files that are not product: tests, test doubles, third-party code. */
function foraDoProduto(caminho: string): boolean {
  return (
    /\.test\.tsx?$/.test(caminho) ||
    caminho.includes("/vendor/") ||
    caminho.includes("/testes/") ||
    caminho.endsWith("/electronFalso.ts")
  )
}

/**
 * Messages that never reach the screen, or reach it through another path.
 *
 * The key is `ficheiro::mensagem` (or `ficheiro::expressão`, when the error is not a literal).
 * No line number on purpose: the file changes, the reason does not.
 */
const TOLERADAS: Readonly<Record<string, string>> = {
  // Windows update: startup catches both and logs "instalador-falhou"; the app runs the version it has.
  "apps/client/src/main/actualizacao-windows.ts::argumento recusado": "apanhado no arranque, vira diagnóstico",
  "apps/client/src/main/actualizacao-windows.ts::powershell saiu sem sucesso": "apanhado no arranque, vira diagnóstico",
  // Voice chain: the engine fails inside the worklet or on load, and the chain continues with the native suppressor.
  "packages/client-core/src/audio/cadeia.ts::noise-suppressor-fetch-failed": "apanhado na cadeia, vira diagnóstico",
  "packages/client-core/src/audio/processador-de-voz.ts::noise-suppressor-alloc-failed": "apanhado na cadeia, vira diagnóstico",
  "packages/client-core/src/audio/processador-de-voz.ts::noise-suppressor-sample-rate": "apanhado na cadeia, vira diagnóstico",
  "packages/client-core/src/audio/processador-de-voz.ts::noise-suppressor-assert": "apanhado na cadeia, vira diagnóstico",
  "packages/client-core/src/audio/processador-de-voz.ts::noise-suppressor-exports-changed": "apanhado na cadeia, vira diagnóstico",
  "packages/client-core/src/audio/processador-de-voz.ts::noise-suppressor-delay-mismatch": "apanhado na cadeia, vira diagnóstico",
  // Server.
  "packages/client-core/src/session.ts::uma operação com mais de um commit não sabe ainda esperar pelos veredictos":
    "erro de programação: nenhuma operação faz dois commits",
  "packages/client-core/src/session.ts::archive time is invalid":
    "guarda do contrato: a interface só passa horas válidas (`migrar` passa `max(0, at)` de `readClosedDirects`, que só deixa números finitos)",
  "packages/client-core/src/session.ts::preference time is invalid":
    "guarda do contrato: a interface só passa a constante `MARCA_DE_SEMENTE` (1)",
  "packages/client-core/src/session.ts::too late to repeat":
    "só rejeita a promessa de um acto do livro quando a sessão já acabou (`#vida` mudou, troca de conta): o ecrã dessa conta já não existe para o mostrar",
  "packages/client-core/src/session.ts::account-channel-untrusted":
    'interno: lançado e apanhado dentro do núcleo pela guarda do canal da conta; ao ecrã chega o status "account-channel-foreign" (726)',
  "packages/client-core/src/session.ts::not an account":
    'apanhado logo a seguir em `block` e trocado por "that is not an account address" (605)',
  "packages/client-core/src/session.ts::manifesto":
    'apanhado em `emparelhar.ts` (`#assinar`) e trocado pela razão `PairFalha` "manifesto" (716)',
  "packages/client-core/src/session.ts::manifesto-cheio":
    'apanhado em `emparelhar.ts` (`#assinar`) e trocado pela razão `PairFalha` "manifesto-cheio" (717)',
  "packages/client-core/src/session.ts::manifesto por ler":
    'apanhado em `emparelhar.ts` (`#concluir`) e trocado pela razão `PairFalha` "manifesto" (716)',
  "packages/client-core/src/session.ts::manifesto recusado":
    'apanhado em `emparelhar.ts` (`#concluir`) e trocado pela razão `PairFalha` "manifesto" (716)',
  "packages/client-core/src/session.ts::hello.message":
    "as razões do `#failPending` (206, 208, 209); uma frase do servidor no `hello` é o imprevisto, e é o 900",
  "packages/client-core/src/session.ts::recusa":
    "a saída de `#porqueNaoSeElimina`: só chaves com código (301, 336, 337, 338, 339)",
  "packages/client-core/src/session.ts::motivo":
    "as razões de `#falharConfirmacoes`: 206, 208, 209, 345",
  "packages/client-core/src/session.ts::reason": "as razões do `#failPending`: 206, 208, 209",
  "packages/client-core/src/session.ts::evento.razao":
    "uma razão `PairFalha`, que a interface traduz por `translatePairingError` (`CHAVES_DO_EMPARELHAMENTO`)",
  "packages/client-core/src/emparelhar.ts::razao":
    "uma razão `PairFalha`, que a interface traduz por `translatePairingError` (`CHAVES_DO_EMPARELHAMENTO`)",
  "packages/client-core/src/erros-do-browser.ts::chave": "é a chave da tabela dos erros do browser, que este teste verifica à parte",
  "packages/client-core/src/call.ts::erro.message": "re-atira a chave de uma `RecusaDoSfu`, que este teste verifica à parte",
  // Pontes.
  "apps/web/src/kdf.ts::kdf worker failed": "apanhado em `derivarNoWorker`, que cai na derivação local",
  "apps/web/src/kdf.ts::kdf worker timed out": "apanhado em `derivarNoWorker`, que cai na derivação local",
  "apps/web/src/kdf.ts::resposta.erro": "apanhado em `derivarNoWorker`, que cai na derivação local",
  "apps/web/src/main.tsx::missing #root": "erro de programação: o HTML traz sempre o #root",
  "apps/client/src/renderer/main.tsx::missing #root": "erro de programação: o HTML traz sempre o #root",
  "apps/client/src/renderer/envelope.ts::resposta.chave":
    "refaz o erro do processo principal; a chave é a que lá foi atirada (ver `envelope.codigos.test.ts`)",
  "apps/client/src/main/link-preview.ts::o oEmbed respondeu ${resposta.status}":
    "apanhado dentro de `link-preview.ts`; a interface mostra uma frase fixa",
  "apps/client/src/main/link-preview.ts::a página respondeu ${resposta.status}":
    "apanhado dentro de `link-preview.ts`; a interface mostra uma frase fixa",
  // Interface.
  "packages/ui/src/App.tsx::App must be rendered inside a bridge provider": "erro de programação",
  "packages/ui/src/components/Toast.tsx::useToast must be used inside a ToastContext provider": "erro de programação",
  "packages/ui/src/hooks/useConfirmar.tsx::useConfirmar precisa de um ConfirmarProvider por cima": "erro de programação",
  "packages/ui/src/lib/qr.ts::o QR só leva até ${QR_MAX_BYTES} bytes; este texto tem ${payload.length}":
    "erro de programação: quem chama mede o texto antes",
  "packages/ui/src/lib/colar.ts::não foi possível ler o que foi colado": "apanhado em `colar.ts`; a imagem é recusada sem erro",
  "packages/ui/src/lib/colar.ts::os bytes colados não vieram como bytes": "apanhado em `colar.ts`; a imagem é recusada sem erro",
  "packages/ui/src/lib/ficheiros.ts::data URL sem corpo": "erro de programação: a data URL é feita aqui",
  "packages/ui/src/lib/ficheiros.ts::não foi possível ler o ficheiro":
    'apanhado em `Composer` e `Social`, que mostram "fileUnreadable"',
  "packages/ui/src/lib/ficheiros.ts::o ficheiro não veio como data URL":
    'apanhado em `Composer` e `Social`, que mostram "fileUnreadable"',
  "packages/ui/src/screens/social/fetchPreview.ts::sem endereço":
    'apanhado em `LinkAttach` e `LinkDraft`, que mostram "fetchFailed"',
  "packages/ui/src/screens/social/fetchPreview.ts::a página respondeu ${response.status}":
    'apanhado em `LinkAttach` e `LinkDraft`, que mostram "fetchFailed"',
  "packages/ui/src/screens/social/fetchPreview.ts::não é uma data URL":
    "apanhado em `fetchPreview.ts`; a miniatura fica de fora",
  "packages/ui/src/screens/gate/Setup.tsx::__vault_exists__": "sentinela interna, comparada no `catch` do próprio ecrã",
}


interface Achado {
  ficheiro: string
  linha: number
  /** The message text, or the expression when it is not literal. */
  mensagem: string
  tipo: "literal" | "template" | "expressao"
}

function ficheirosDoProduto(RAIZ: string): string[] {
  const lista: string[] = []
  const andar = (pasta: string): void => {
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome)
      if (statSync(caminho).isDirectory()) andar(caminho)
      else if (/\.tsx?$/.test(nome)) {
        const rel = relative(RAIZ, caminho)
        if (!foraDoProduto(`/${rel}`)) lista.push(rel)
      }
    }
  }
  for (const pasta of PASTAS) andar(join(RAIZ, pasta))
  return lista
}

/**
 * The code without comments, with lines in the same place.
 *
 * Comments in this repository cite old errors (`new Error(message)`), and
 * those are not errors. Texts stay intact: a `//` inside a text is not a comment.
 */
function semComentarios(codigo: string): string {
  let saida = ""
  let i = 0
  let texto: string | null = null
  while (i < codigo.length) {
    const c = codigo[i]!
    const seguinte = codigo[i + 1]
    if (texto !== null) {
      saida += c
      if (c === "\\") {
        saida += seguinte ?? ""
        i += 2
        continue
      }
      if (c === texto) texto = null
      i++
      continue
    }
    if (c === "/" && seguinte === "/") {
      while (i < codigo.length && codigo[i] !== "\n") i++
      continue
    }
    if (c === "/" && seguinte === "*") {
      const fim = codigo.indexOf("*/", i + 2)
      const bloco = codigo.slice(i, fim < 0 ? codigo.length : fim + 2)
      saida += bloco.replace(/[^\n]/g, " ")
      i += bloco.length
      continue
    }
    if (c === '"' || c === "'" || c === "`") texto = c
    saida += c
    i++
  }
  return saida
}

const LITERAL = /^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/

function lerArgumento(resto: string): Omit<Achado, "ficheiro" | "linha"> | null {
  const literal = LITERAL.exec(resto)
  if (literal) {
    const template = literal[3]
    if (template !== undefined) {
      return { mensagem: template, tipo: template.includes("${") ? "template" : "literal" }
    }
    return { mensagem: (literal[1] ?? literal[2])!, tipo: "literal" }
  }
  const expressao = /^\s*([\w.?]+)\s*[,)]/.exec(resto)
  return expressao ? { mensagem: expressao[1]!, tipo: "expressao" } : null
}

/** Text constants in a file (`const NOME = "…"`), to resolve `new Error(NOME)`. */
function constantes(codigo: string): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const m of codigo.matchAll(/\bconst ([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*"((?:[^"\\]|\\.)*)"/g)) {
    mapa.set(m[1]!, m[2]!)
  }
  return mapa
}

function recolher(): Achado[] {
  const RAIZ = raiz()
  const achados: Achado[] = []
  for (const ficheiro of ficheirosDoProduto(RAIZ)) {
    const codigo = semComentarios(readFileSync(join(RAIZ, ficheiro), "utf8"))
    const consts = constantes(codigo)
    const linhaDe = (indice: number): number => codigo.slice(0, indice).split("\n").length

    for (const m of codigo.matchAll(/new (?:Error|TypeError|RangeError|DOMException)\(/g)) {
      const fim = m.index + m[0].length
      const argumento = lerArgumento(codigo.slice(fim, fim + 400))
      if (!argumento) continue
      // A constant from the same file counts as the literal it holds.
      if (argumento.tipo === "expressao" && consts.has(argumento.mensagem)) {
        achados.push({ ficheiro, linha: linhaDe(m.index), mensagem: consts.get(argumento.mensagem)!, tipo: "literal" })
        continue
      }
      achados.push({ ficheiro, linha: linhaDe(m.index), ...argumento })
    }

    // The `detail` of an `emit("error", { detail: … })`: a literal, or a ternary
    // of literals. An `emit("error", erroDaChamada(…))` has no literal here; its
    // resource key is the second argument, and we read it next.
    for (const m of codigo.matchAll(/emit\("error",\s*\{\s*detail:\s*/g)) {
      const inicio = m.index + m[0].length
      let profundidade = 0
      let fim = inicio
      for (; fim < codigo.length; fim++) {
        const c = codigo[fim]
        if (c === "(" || c === "{" || c === "[") profundidade++
        else if (c === ")" || c === "]" || (c === "}" && profundidade > 0)) profundidade--
        else if ((c === "," || c === "}") && profundidade === 0) break
      }
      const expressao = codigo.slice(inicio, fim)
      const literais = [...expressao.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
      if (literais.length === 0) {
        achados.push({ ficheiro, linha: linhaDe(m.index), mensagem: expressao.trim(), tipo: "expressao" })
      }
      for (const l of literais) {
        const texto = (l[1] ?? l[2])!
        achados.push({ ficheiro, linha: linhaDe(m.index), mensagem: texto, tipo: texto.includes("${") ? "template" : "literal" })
      }
    }
    for (const m of codigo.matchAll(/erroDaChamada\([^,()]+(?:\([^()]*\))?,\s*"([^"]+)"\)/g)) {
      achados.push({ ficheiro, linha: linhaDe(m.index), mensagem: m[1]!, tipo: "literal" })
    }
  }
  return achados
}

const tem = (chave: string): boolean => Object.hasOwn(CODIGOS_DE_ERRO, chave)
const chaveDe = (a: Achado): string => `${a.ficheiro}::${a.mensagem}`
const onde = (a: Achado): string => `${a.ficheiro}:${a.linha} "${a.mensagem}"`

describe("cada erro que pode chegar ao ecrã tem código", () => {
  let achados: Achado[] = []
  beforeAll(() => {
    achados = recolher()
  })

  it("a varredura encontra os erros (se não encontrar nada, a prova é vazia)", () => {
    expect(achados.length).toBeGreaterThan(150)
    expect(achados.some((a) => a.ficheiro.endsWith("vault.ts") && a.mensagem === "vault is locked")).toBe(true)
    expect(achados.some((a) => a.ficheiro.endsWith("call.ts") && a.mensagem === "the call is too large to share a screen")).toBe(true)
  })

  it("nenhuma mensagem literal fica sem código, a não ser com razão escrita", () => {
    const semCodigo = achados
      .filter((a) => a.tipo === "literal" && !tem(a.mensagem))
      .filter((a) => !Object.hasOwn(TOLERADAS, chaveDe(a)))
      .map(onde)
    expect(semCodigo).toEqual([])
  })

  it("nenhuma chave leva dados dentro: um `${…}` vai no `cause`", () => {
    const comDados = achados
      .filter((a) => a.tipo === "template")
      .filter((a) => !Object.hasOwn(TOLERADAS, chaveDe(a)))
      .map(onde)
    expect(comDados).toEqual([])
  })

  it("um erro que não é literal tem razão escrita", () => {
    const semRazao = achados
      .filter((a) => a.tipo === "expressao" && !Object.hasOwn(TOLERADAS, chaveDe(a)))
      .map(onde)
    expect(semRazao).toEqual([])
  })

  it("cada tolerância ainda existe no código", () => {
    const vistas = new Set(achados.map(chaveDe))
    const velhas = Object.keys(TOLERADAS).filter((chave) => !vistas.has(chave))
    expect(velhas).toEqual([])
  })

  it("cada tolerância é mesmo de uma mensagem sem código (uma com código não precisa de razão)", () => {
    const desnecessarias = Object.keys(TOLERADAS).filter((chave) => tem(chave.split("::")[1]!))
    expect(desnecessarias).toEqual([])
  })

})

describe("as tabelas de chaves do núcleo e da interface só apontam para chaves com código", () => {
  it("as recusas do SFU", () => {
    for (const [codigo, chave] of Object.entries(CHAVES_DAS_RECUSAS_DO_SFU)) expect(tem(chave), `${codigo} → ${chave}`).toBe(true)
    expect(tem(RECUSA_DO_SFU_GENERICA)).toBe(true)
  })

  it("os erros do browser", () => {
    for (const [nome, chave] of Object.entries(CHAVES_DOS_ERROS_DO_BROWSER)) expect(tem(chave), `${nome} → ${chave}`).toBe(true)
  })

  it("os erros fatais do servidor e o emparelhamento", () => {
    for (const [codigo, chave] of Object.entries(CHAVES_DO_SERVIDOR)) expect(tem(chave), `${codigo} → ${chave}`).toBe(true)
    expect(tem("the server closed the connection")).toBe(true)
    for (const [razao, chave] of Object.entries(CHAVES_DO_EMPARELHAMENTO)) expect(tem(chave), `${razao} → ${chave}`).toBe(true)
  })
})
