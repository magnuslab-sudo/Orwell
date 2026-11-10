// Pin messages in a room, with THREE accounts for real.
//
// Three and not two, and it is the third that justifies the script: the first two
// prove that pinning reaches the screen of whoever is in the channel, and the third
// proves the only part of this that no unit test reaches, whoever joins the channel
// AFTER sees what was already pinned, with the text. Persistent secrecy locks him
// out of the epoch where the message was said forever; what he reads is the copy
// that traveled in the pin, re-sent by `republishRooms` when the group grew.
//
// Against a local server, with MLS for real and the gateway for real:
//   sh scripts/dev-reiniciar-servidor.sh
//   npx vite preview apps/web --port 4173
//   node scripts/e2e-fixar.mjs [url] [server]
//
// The preview root is positional and not `--root`. See `e2e-escrita-buzz.mjs`,
// which learned that the hard way.
//
// **If someone else is working on the same machine, give the server its own port and folder.**
// 8452 is the one all worktrees use, and `dev-reiniciar-servidor.sh` starts by KILLING
// whoever is there: two checks at the same time kill the server in the middle. The symptom
// is a failure that looks like a product bug, here it was "Bruno's header does not count
// the pin", with the same code passing 26/26 minutes before. What confirms it is the
// server startup, which prints the database path: if it points to a different folder,
// the server is not yours.
//
//   ENCLAVE_DATA_DIR=$PWD/.dev-fixar ENCLAVE_SERVER_NAME=localhost:8477 \
//   ENCLAVE_BIND_PORT=8477 ENCLAVE_COMMON_ROOM='!orwell:localhost:8477' \
//   ENCLAVE_COMMUNITY_MODE=true node apps/server/dist/main.js
//   npx vite preview apps/web --port 4188
//   node scripts/e2e-fixar.mjs http://127.0.0.1:4188/app/ localhost:8477
import { chromium } from "playwright"
import { alvo, alvoApp } from "./ambiente.mjs"
import { criarConta } from "./conta.mjs"
import { aceitarConvite, convidar, etiquetaDe } from "./convite.mjs"

const URL = alvoApp(process.argv[2])
const SERVIDOR = alvo(process.argv[3])

const browser = await chromium.launch()
const results = []
const check = (label, ok, detail = "") => {
  results.push([label, ok])
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function conta(nome) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const erros = []
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text())
  })
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(URL, { waitUntil: "networkidle" })
  await criarConta(page, { nome, servidor: SERVIDOR })
  await page.getByRole("button", { name: "Amigos" }).waitFor({ timeout: 60_000 })
  await wait(2500)
  const texto = await page.evaluate(() => document.body.innerText)
  const addr = texto.match(/@[a-z-]+:[^\s]+/)?.[0] ?? null
  console.log(`   [${nome}] ${addr}`)
  return { ctx, page, nome, addr, erros }
}

const ana = await conta("Ana")
const bruno = await conta("Bruno")
const carla = await conta("Carla")

// Unique name per run: the server only lets you write to a channel where you have
// a seat or one that has never been used. See `e2e-escrita-buzz.mjs`.
const SALA = `fixar-${Date.now().toString(36)}`
await ana.page.getByRole("button", { name: "Criar canal", exact: true }).first().click()
await ana.page.locator('input[placeholder="geral"]').fill(SALA)
await ana.page.getByRole("button", { name: "Confirmar" }).click()
await wait(6000)

/**
 * Invite and accept, via `convite.mjs`.
 *
 * They are two gestures and not one, inviting sends a request in a direct message,
 * and whoever joins is the one who accepts, and accepting has three steps in the
 * UI that are not the button. The helper knows them all and waits for the FACT: the
 * channel in the sidebar of whoever accepted. The first version of this script wrote
 * it by hand, caught the "Join with a link" from the sidebar instead of the invite
 * card, and measured the void.
 */
const ETIQUETA = etiquetaDe(SALA)

async function meter(quem) {
  const enviado = await convidar(ana.page, ETIQUETA, quem.addr)
  check(`o convite ao ${quem.nome} saiu`, enviado)
  return await aceitarConvite(quem.page, ETIQUETA)
}

check("o Bruno entrou no canal da Ana", await meter(bruno))

await bruno.page.locator(".channel-list .channel-name", { hasText: ETIQUETA }).first().click()
await wait(3000)

// ------------------------------------------------------- Bruno says something
const AVISO = "o código do portão é 4417"
const caixaBruno = bruno.page.locator('input[placeholder="Escreve uma mensagem"]')
await caixaBruno.click()
await caixaBruno.fill(AVISO)
await bruno.page.keyboard.press("Enter")
await wait(6000)

const anaLeu = await ana.page.evaluate((texto) => document.body.innerText.includes(texto), AVISO)
check("a Ana recebeu a mensagem do Bruno", anaLeu)

// ------------------------------------------------- before pinning, nothing at the top
const botaoFixadas = (page) => page.getByRole("button", { name: "Ver o que está fixado nesta sala" })
check("sem nada fixado não há botão nenhum no cabeçalho", (await botaoFixadas(ana.page).count()) === 0)

// --------------------------------------------------- Ana pins his message
//
// Right-click on someone ELSE's message: that is what pinning means, and it was
// exactly what the menu did not allow before this feature.
await ana.page.locator(".message", { hasText: AVISO }).first().click({ button: "right" })
await wait(800)
const entradaFixar = ana.page.getByText("Fixar na sala")
check("o menu da mensagem alheia oferece fixar a quem funda o canal", (await entradaFixar.count()) === 1)
await entradaFixar.first().click()
await wait(6000)

check("o cabeçalho da Ana passa a contar uma fixada", (await botaoFixadas(ana.page).count()) === 1)

// And on the other end of the wire, which is what no single window shows.
check("e o do Bruno também, sem ele ter feito nada", (await botaoFixadas(bruno.page).count()) === 1)

await botaoFixadas(bruno.page).first().click()
await wait(1200)
const naFolhaDoBruno = await bruno.page.evaluate(() => {
  const folha = document.querySelector(".pinned-panel")
  return folha ? folha.textContent : null
})
check("o Bruno abre a folha e lê lá a mensagem fixada", (naFolhaDoBruno ?? "").includes(AVISO), naFolhaDoBruno ?? "sem folha")
check("e vê quem a fixou", (naFolhaDoBruno ?? "").includes("fixada por Ana"), naFolhaDoBruno ?? "")
// Pinning is not his: the unpin button does not appear to those without the role.
check("sem o cargo, o Bruno não tem por onde desafixar", !(naFolhaDoBruno ?? "").includes("Desafixar"))
await bruno.page.keyboard.press("Escape")
await wait(600)

// His menu, on the same message, does not offer pinning.
await bruno.page.locator(".message", { hasText: AVISO }).first().click({ button: "right" })
await wait(800)
check("nem por onde fixar", (await bruno.page.getByText("Fixar na sala").count()) === 0)
await bruno.page.keyboard.press("Escape")
await wait(600)

// ------------------------------------------------------------ Carla arrives now
//
// The part only a third browser shows. Everything above was encrypted in epochs
// she will never have: the original message is unreadable to her forever, and
// there is no summary that will bring it to her.
check("a Carla entrou no canal", await meter(carla))

await carla.page.locator(".channel-list .channel-name", { hasText: ETIQUETA }).first().click()
await wait(6000)

// Her conversation is empty, and it must be. That is what makes the next line
// proof and not coincidence.
const conversaDaCarla = await carla.page.evaluate(
  () => document.querySelector(".timeline")?.textContent ?? "",
)
check("a conversa da Carla não tem a mensagem original: a epoch fechou-lhe", !conversaDaCarla.includes(AVISO))

check("mas o cabeçalho dela conta a fixada", (await botaoFixadas(carla.page).count()) === 1)
await botaoFixadas(carla.page).first().click()
await wait(1200)
const naFolhaDaCarla = await carla.page.evaluate(() => document.querySelector(".pinned-panel")?.textContent ?? null)
check(
  "e ela LÊ o que está fixado, pela cópia que viajou com a fixação",
  (naFolhaDaCarla ?? "").includes(AVISO),
  naFolhaDaCarla ?? "sem folha",
)
await carla.page.keyboard.press("Escape")
await wait(600)

// ------------------------------------------------------------------ on mobile
//
// The sheet is wide and hangs from the right corner of the header, which on a
// narrow screen is where the people list button also lives. What matters is what
// fits: the button stays reachable, and the sheet fits on screen instead of
// spilling right with text cut off.
await carla.page.setViewportSize({ width: 390, height: 844 })
await wait(1500)
check("ao telemóvel o botão das fixadas continua no cabeçalho", (await botaoFixadas(carla.page).count()) === 1)

await botaoFixadas(carla.page).first().click()
await wait(1200)
const caixa = await carla.page.evaluate(() => {
  const folha = document.querySelector(".pinned-panel")
  if (!folha) return null
  const r = folha.getBoundingClientRect()
  return { left: r.left, right: r.right, largura: window.innerWidth, texto: folha.textContent ?? "" }
})
check("a folha cabe no ecrã estreito, sem sair pela direita nem pela esquerda",
  caixa !== null && caixa.left >= 0 && caixa.right <= caixa.largura + 1,
  caixa ? `${Math.round(caixa.left)}…${Math.round(caixa.right)} de ${caixa.largura}` : "sem folha")
check("e continua a dizer o que está fixado", (caixa?.texto ?? "").includes(AVISO))

// And the page does not start scrolling sideways because of it, which is the
// bug a wide sheet causes without showing up.
const rolaDeLado = await carla.page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
)
check("o ecrã não ganha rolamento horizontal", !rolaDeLado)

await carla.page.keyboard.press("Escape")
await carla.page.setViewportSize({ width: 1280, height: 720 })
await wait(1200)

// ------------------------------------------------------------------ desafixar
await botaoFixadas(ana.page).first().click()
await wait(1000)
await ana.page.locator(".pinned-panel").getByRole("button", { name: "Desafixar" }).first().click()
await wait(7000)

check("desafixar tira o botão do cabeçalho da Ana", (await botaoFixadas(ana.page).count()) === 0)
check("e do de quem estava a ler", (await botaoFixadas(bruno.page).count()) === 0)
check("e do de quem tinha acabado de chegar", (await botaoFixadas(carla.page).count()) === 0)

// ------------------------------------------------------------------- consola
for (const quem of [ana, bruno, carla]) {
  const graves = quem.erros.filter((e) => !/favicon|ERR_/.test(e))
  check(`sem erros de consola em ${quem.nome}`, graves.length === 0, graves.slice(0, 2).join(" | "))
}

await browser.close()
const falhas = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - falhas.length}/${results.length} verificações passaram`)
process.exit(falhas.length === 0 ? 0 : 1)
