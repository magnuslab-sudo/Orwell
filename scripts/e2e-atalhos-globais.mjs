/**
 * Global shortcuts (1.0.6, points 5 and 8 of `docs/planos/depois-da-1-0.md`)
 * in the built desktop app, with the real main process.
 *
 *   npm run build && node scripts/e2e-atalhos-globais.mjs
 *
 * What is verified:
 *  1. outside a call the key is NOT registered in the system;
 *  2. when entering the voice room it becomes registered (`globalShortcut.isRegistered`);
 *  3. with the window MINIMIZED, pressing the key mutes the mic. The key is
 *     pressed as the keyboard would press it: a system event (CGEventPost,
 *     via JXA), not a DOM event, which a minimized window does not receive.
 *     macOS only. If the terminal lacks Accessibility permission, macOS
 *     silently discards the event: the script says so and does not count as
 *     proof;
 *  4. when leaving the call the key becomes a system key again.
 *
 * The key is F19: it does nothing on macOS or in common apps, and the
 * synthetic event is harmless if it reaches another window. All local and
 * disposable (`secretaria.mjs`, `servidor-descartavel.mjs`).
 */
import { execFileSync } from "node:child_process"
import { criarConta } from "./conta.mjs"
import { criarCanal, dentro, entrarNaVoz, espera, portaoPronto, verificador } from "./fase7-comum.mjs"
import { abrirSecretaria } from "./secretaria.mjs"
import { levantarServidor } from "./servidor-descartavel.mjs"

const TECLA = "F19"
/** `kVK_F19` in `HIToolbox/Events.h`. */
const CODIGO_F19 = 80
const { check, resumo } = verificador()

const srv = await levantarServidor({ frente: 8578, servidor: 8579, sfu: 0, etiqueta: "atalhos-globais" })
let sec
async function arrumar(codigo) {
  await sec?.fechar().catch(() => {})
  srv.fechar()
  process.exit(codigo)
}

const registada = () => sec.app.evaluate(({ globalShortcut }, tecla) => globalShortcut.isRegistered(tecla), TECLA)
const microfoneCalado = () =>
  sec.page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}").micMuted === true
    } catch {
      return null
    }
  })
async function ate(pergunta, ms = 15_000) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if (await pergunta()) return true
    await espera(250)
  }
  return false
}

/** Press F19 via the system, as the keyboard would. Returns the error if any. */
function carregarPeloSistema() {
  const jxa = `ObjC.import("CoreGraphics");
    for (const desce of [true, false]) $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateKeyboardEvent(null, ${CODIGO_F19}, desce));`
  try {
    execFileSync("osascript", ["-l", "JavaScript", "-e", jxa], { stdio: "pipe" })
    return null
  } catch (erro) {
    return String(erro.stderr ?? erro.message).trim()
  }
}

try {
  sec = await abrirSecretaria({ rotulo: "atalhos" })
  const page = sec.page
  await portaoPronto(page)
  await criarConta(page, { nome: "Ana", frase: "frase-de-verificacao-2026", servidor: srv.NOME })
  await dentro(page)

  // The microphone is bound to F19, via the same path as Settings (disk and alert).
  await page.evaluate((tecla) => {
    const prefs = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}")
    prefs.atalhosDeVoz = { ...(prefs.atalhosDeVoz ?? {}), microfone: tecla }
    localStorage.setItem("enclave.prefs", JSON.stringify({ ...prefs, chosen: true }))
    window.dispatchEvent(new Event("enclave:prefs"))
  }, TECLA)
  await espera(500)
  check("1. fora de uma chamada, a F19 não está registada no sistema", !(await registada()))

  await criarCanal(page, "atalhos")
  check("a Ana entra na sala de voz", await entrarNaVoz(page))
  check("2. dentro da chamada, a F19 fica registada como global", await ate(registada), TECLA)

  await sec.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
  check(
    "a janela está minimizada",
    await ate(() => sec.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized() === true)),
  )

  if (process.platform !== "darwin") {
    console.log("  ..  fora do macOS o guião não sabe carregar na tecla pelo sistema; o passo 3 fica por provar aqui")
  } else {
    const antes = await microfoneCalado()
    const erro = carregarPeloSistema()
    const mudou = erro === null && (await ate(async () => (await microfoneCalado()) === !antes, 5000))
    if (!mudou && erro === null) {
      console.log(
        "  ..  o evento do sistema não chegou: o macOS deita fora eventos sintéticos de um terminal sem a permissão de Acessibilidade",
      )
    }
    check(
      "3. com a janela minimizada, a F19 muda o microfone",
      mudou,
      erro ?? `micMuted ${antes} → ${await microfoneCalado()}`,
    )
    if (mudou) {
      carregarPeloSistema()
      check("   e carregar outra vez devolve-o", await ate(async () => (await microfoneCalado()) === antes, 5000))
    }
  }

  await sec.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore())
  await page.getByRole("button", { name: "Sair da chamada" }).first().click()
  check("4. ao sair da chamada, a F19 volta a ser do sistema", await ate(async () => !(await registada())))

  await arrumar(resumo() ? 0 : 1)
} catch (erro) {
  console.error(erro)
  console.error(sec?.registo.slice(-30).join("\n"))
  await arrumar(1)
}
