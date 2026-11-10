/**
 * The gestures that phase 7 scripts repeat, written once.
 *
 * Each one is what a person does in the UI and returns a FACT (it arrived, it
 * didn't), never "I clicked the button". The same gestures work for the browser
 * and the desktop app: the UI is the same (`@enclave/ui`), and that's what we
 * want to prove, that both bridges take you there.
 */
import { DatabaseSync } from "node:sqlite"

export const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function verificador() {
  const resultados = []
  const check = (nome, ok, detalhe = "") => {
    resultados.push({ nome, ok: Boolean(ok), detalhe })
    console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? `  (${detalhe})` : ""}`)
    return Boolean(ok)
  }
  const resumo = () => {
    const passaram = resultados.filter((r) => r.ok).length
    console.log(`\n${passaram}/${resultados.length} verificações passaram`)
    return passaram === resultados.length
  }
  return { check, resumo, resultados }
}

/** Until the condition is true, or time runs out. Returns milliseconds, or -1. */
export async function ate(condicao, ms = 60_000, passo = 300) {
  const inicio = Date.now()
  while (Date.now() - inicio < ms) {
    if (await condicao().catch(() => false)) return Date.now() - inicio
    await espera(passo)
  }
  return -1
}

export const dentro = (page, timeout = 90_000) => page.getByRole("button", { name: "Configurações", exact: true }).first().waitFor({ timeout })

/** The server accounts, in the order they were born. Read from the database, read-only. */
export function contasDoServidor(base) {
  const db = new DatabaseSync(base, { readOnly: true })
  try {
    return db.prepare("SELECT address FROM accounts ORDER BY rowid ASC").all().map((l) => l.address)
  } finally {
    db.close()
  }
}

export function consultar(base, sql, ...args) {
  const db = new DatabaseSync(base, { readOnly: true })
  try {
    return db.prepare(sql).all(...args)
  } finally {
    db.close()
  }
}

/**
 * The addresses the server has seen debut (`channel_claims`).
 *
 * Since 1.0 "Arca" the app draws a room's address at random, and the name goes
 * encrypted inside it (slice 3): the script can't write it from the name
 * anymore. To find the address of a channel the app created, take this list
 * before creating it and ask `moradaNova` which appeared after.
 */
export function moradasEstreadas(base) {
  return new Set(consultar(base, "SELECT channel FROM channel_claims").map((l) => l.channel))
}

/** The only address that debuted since `before`; fails if there's none or more than one. */
export async function moradaNova(base, antes, ms = 15_000) {
  let novas = []
  await ate(() => {
    novas = [...moradasEstreadas(base)].filter((c) => !antes.has(c))
    return novas.length > 0
  }, ms)
  if (novas.length !== 1) throw new Error(`esperava uma morada nova no servidor, e há ${novas.length}: ${novas.join(", ")}`)
  return novas[0]
}

export async function separador(page, nome) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  await page.locator(".people-destination").waitFor({ timeout: 15_000 })
  await page.locator(".people-tabs").getByRole("button", { name: nome }).click()
}

/** Open someone's profile sheet by address, in Friends › Find. */
export async function perfilDe(page, endereco) {
  await separador(page, "Encontrar")
  await page.getByLabel("Cola um link ou endereço").fill(endereco)
  await page.getByRole("button", { name: "Abrir perfil" }).click()
  const folha = page.locator(".person-profile")
  await folha.waitFor({ timeout: 15_000 })
  return folha
}

/**
 * Send a friend request from the profile sheet. In community mode the sheet
 * shows "Message" instead of "Send friend request" (see `e2e-emparelhar.mjs`):
 * open the conversation and request from the footer button.
 */
export async function pedirAmizade(page, endereco) {
  const folha = await perfilDe(page, endereco)
  const directo = folha.getByRole("button", { name: "Pedir amizade" })
  if (await directo.isVisible().catch(() => false)) {
    await directo.click()
    await folha.getByRole("status").filter({ hasText: "Pedido enviado" }).waitFor({ timeout: 30_000 })
    await page.keyboard.press("Escape")
    return true
  }
  await folha.getByRole("button", { name: "Mensagem", exact: true }).click()
  const rodape = page.getByRole("button", { name: "Pedir amizade" }).first()
  await rodape.waitFor({ timeout: 60_000 })
  await rodape.click()
  return true
}

/** Accept the first request in Friends › Received. Returns ms until the button appears, or -1. */
export async function aceitarAmizade(page, ms = 90_000) {
  const ms1 = await ate(async () => {
    await separador(page, /^Recebidos/)
    return page.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first().isVisible()
  }, ms, 1500)
  if (ms1 < 0) return -1
  await page.locator(".people-requests").getByRole("button", { name: "Aceitar" }).first().click()
  return ms1
}

/** Open the first direct message (or the one with `text`). */
export async function abrirDirecta(page, texto) {
  await page.getByRole("button", { name: "Amigos", exact: true }).first().click()
  let linha = page.locator(".direct-row button.direct-open")
  if (texto) linha = linha.filter({ hasText: texto })
  const botao = linha.first()
  if (!(await botao.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Abrir o painel lateral" }).click().catch(() => {})
  }
  await botao.click({ timeout: 60_000 })
  await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 60_000 })
}

export async function dizer(page, frase) {
  const caixa = page.locator('input[placeholder="Escreve uma mensagem"]')
  await caixa.click()
  await caixa.fill(frase)
  await page.keyboard.press("Enter")
}

/** Milliseconds until the message appears, or -1. */
export async function ouviu(page, frase, timeout = 60_000) {
  const inicio = Date.now()
  return page
    .getByText(frase, { exact: false })
    .first()
    .waitFor({ timeout })
    .then(() => Date.now() - inicio, () => -1)
}

export async function criarCanal(page, nome) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  await page.getByRole("button", { name: "Criar canal" }).first().click()
  await page.locator("form.prompt input").first().fill(nome)
  await page.locator("form.prompt button.primary").first().click()
  await page.getByRole("heading", { name: nome }).waitFor({ timeout: 30_000 })
}

export async function abrirCanal(page, nome) {
  await page.getByRole("button", { name: "Comunidades", exact: true }).first().click().catch(() => {})
  const linha = page.locator(".channel-name", { hasText: nome }).first()
  const gaveta = page.getByRole("button", { name: "Abrir o painel lateral" })
  if (!(await linha.isVisible().catch(() => false))) {
    if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) !== "true") await gaveta.click().catch(() => {})
  }
  await linha.click({ timeout: 60_000 })
  if ((await gaveta.getAttribute("aria-expanded").catch(() => null)) === "true") await gaveta.click().catch(() => {})
  await page.locator('input[placeholder="Escreve uma mensagem"]').waitFor({ timeout: 30_000 })
}

export async function temCanal(page, nome, timeout = 90_000) {
  return page.locator(`.channel-name[title="${nome}"]`).first().waitFor({ state: "attached", timeout }).then(() => true, () => false)
}

/** Join the voice room "voz" in the open channel (`Session.SALAS_INICIAIS`). */
export async function entrarNaVoz(page) {
  const voz = page
    .locator(".room-row button.room")
    .filter({ has: page.locator(".room-name", { hasText: "voz" }) })
    .first()
  if (!(await voz.isVisible({ timeout: 10_000 }).catch(() => false))) return false
  await voz.click()
  return true
}

/** Network and console logs from a Playwright context, for diagnostics. */
export function escutar(alvo, saco, rotulo) {
  const ligarPagina = (page) => {
    page.on("websocket", (ws) => {
      ws.on("framesent", (t) => saco.push(`${rotulo} TRAMA> ${typeof t.payload === "string" ? t.payload.slice(0, 400) : "(binário)"}`))
      ws.on("framereceived", (t) => saco.push(`${rotulo} TRAMA< ${typeof t.payload === "string" ? t.payload.slice(0, 400) : "(binário)"}`))
    })
    page.on("console", (m) => saco.push(`${rotulo} CONSOLA ${m.type()} ${m.text().slice(0, 400)}`))
    page.on("pageerror", (e) => saco.push(`${rotulo} PAGEERROR ${e.message}`))
  }
  if (typeof alvo.on === "function" && typeof alvo.pages === "function") {
    alvo.on("page", ligarPagina)
    for (const p of alvo.pages()) ligarPagina(p)
  } else ligarPagina(alvo)
}

/**
 * The gate of an app without an account, ready. Since phase 8.1 Setup opens
 * with "Already using Orwell on another device?"; an unpaired host goes
 * straight to the name step. Wait for whichever comes first.
 */
export async function portaoPronto(page, timeout = 60_000) {
  const nome = page.getByPlaceholder("Como queres aparecer")
  const pergunta = page.getByRole("button", { name: "Não, criar conta" })
  await nome.or(pergunta).first().waitFor({ timeout })
}

/** From gate to the name step, where "Import account" lives. */
export async function irParaONome(page, timeout = 60_000) {
  await portaoPronto(page, timeout)
  const pergunta = page.getByRole("button", { name: "Não, criar conta" })
  if (await pergunta.count()) await pergunta.click()
  await page.getByPlaceholder("Como queres aparecer").waitFor({ timeout })
}

/** From gate to pairing: the "Yes..." button from the question, or the old "Pair" button. */
export async function irParaEmparelhar(page, timeout = 60_000) {
  await portaoPronto(page, timeout)
  const sim = page.getByRole("button", { name: "Sim, emparelhar este aparelho" })
  if (await sim.count()) await sim.click()
  else await page.getByRole("button", { name: "Emparelhar", exact: true }).click()
}
