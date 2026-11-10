// The typing indicator and the nudge, with TWO real accounts.
//
// None of this is verified with one window alone: these are the two features of
// the app that exist only when someone on the other side sees them. A unit test
// shows the signal GOES OUT; only a second browser shows it ARRIVES.
//
// Against a local server, with real MLS and a real gateway:
//   node apps/server/dist/main.js
//   npx vite preview apps/web --port 4173
//   node scripts/e2e-escrita-buzz.mjs [url] [server]
//
// The preview root is positional not `--root`: vite refuses the option and exits,
// and anyone following the old recipe ended up with the script hitting a port where
// nobody was listening.
//
// The second argument is the server where accounts are created, and it exists because
// 8448 is the port everyone uses: one forgotten server from another test on it is enough
// for this script to write to a database that is not its own. Without the argument nothing
// changes, the creation screen already comes filled with `localhost:8448`, and that is what stays.
import { chromium } from "playwright"
import { criarConta } from "./conta.mjs"
import { comLingua } from "./ambiente.mjs"

const URL = comLingua(process.argv[2] ?? "http://127.0.0.1:4173")
const SERVIDOR = process.argv[3] ?? null

const browser = await chromium.launch()
const results = []
const check = (label, ok, detail = "") => {
  results.push([label, ok])
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** A disposable account, from zero to shell open. */
async function conta(nome, viewport) {
  const ctx = await browser.newContext(viewport ? { viewport } : {})
  const page = await ctx.newPage()
  const erros = []
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text())
  })
  page.on("pageerror", (e) => erros.push(String(e)))
  await page.goto(URL, { waitUntil: "networkidle" })
  await criarConta(page, { nome, frase: `frase-de-teste-${nome}`, servidor: SERVIDOR ?? undefined })
  await page.getByRole("button", { name: "Amigos" }).waitFor({ timeout: 60_000 })
  await wait(2500)
  const texto = await page.evaluate(() => document.body.innerText)
  const addr = texto.match(/@[a-z-]+:[^\s]+/)?.[0] ?? null
  console.log(`   [${nome}] ${addr}`)
  return { ctx, page, nome, addr, erros }
}

const ana = await conta("Ana")
const bruno = await conta("Bruno")

check(
  "os endereços vêm em quatro palavras de pseudo-latim",
  /^@[a-z]+-[a-z]+-[a-z]+-[a-z]+:/.test(bruno.addr ?? ""),
  bruno.addr ?? "sem endereço",
)

// ------------------------------------------------ a shared channel
//
// Unique name per run, not "general". The server only lets you write to a
// channel where you have a seat OR that has never been used (`#mayReach`), so
// the second run with the same name hits a channel that already exists from another account
// and gets `channel.rejected`, with nothing broken.
const SALA = `verif-${Date.now().toString(36)}`
await ana.page.getByRole("button", { name: "Criar canal", exact: true }).first().click()
await ana.page.locator('input[placeholder="geral"]').fill(SALA)
await ana.page.getByRole("button", { name: "Confirmar" }).click()
await wait(5000)

// Invite Bruno via the address.
await ana.page.getByRole("button", { name: "Convidar" }).first().click()
await ana.page.locator('input[placeholder="@abc…:servidor"]').fill(bruno.addr)
await ana.page.getByRole("button", { name: "Confirmar" }).click()
await wait(12_000)

const brunoTemCanal = await bruno.page.evaluate((sala) => document.body.innerText.includes(sala), SALA)
check("o Bruno entrou no canal da Ana", brunoTemCanal)

// Bruno opens the channel.
await bruno.page.getByRole("button", { name: new RegExp(SALA) }).first().click()
await wait(2500)

// -------------------------------------------- the typing indicator
/** What the observer's screen says about who is typing. */
const indicador = (page) =>
  page.evaluate(() => document.querySelector(".timeline-typing")?.textContent?.trim() ?? null)

check("antes de alguém escrever, não há indicador nenhum", (await indicador(bruno.page)) === null)

// Ana types, key by key, like a person.
const caixaAna = ana.page.locator('input[placeholder="Escreve uma mensagem"]')
await caixaAna.click()
await caixaAna.pressSequentially("olá Bruno, isto é uma frase a ser escrita", { delay: 45 })
await wait(1200)

const visto = await indicador(bruno.page)
check("o Bruno vê que a Ana está a escrever", (visto ?? "").includes("está a escrever"), visto ?? "nada")

// And does not see herself typing.
const anaVeSe = await indicador(ana.page)
check("a Ana não se vê a si própria no indicador", anaVeSe === null, anaVeSe ?? "nada")

// ------------------------------------ the timeout erases it with no end message
// Nobody sends an "I stopped typing": whoever closes the laptop mid-sentence
// never would. The indicator must die on its own, on the side of whoever sees it.
await wait(8000)
const depois = await indicador(bruno.page)
check("o indicador expira sozinho, sem mensagem de fim", depois === null, depois ?? "apagado")

// --------------------------------------------------- how many events went out
// Pacing is what separates this from a stream that gives the server the exact
// rhythm of who is typing. A phrase of ~40 keystrokes in ~2s must send ONE signal.
const enviados = await ana.page.evaluate(() => window.__typingSent ?? null)
if (enviados !== null) {
  check("uma frase inteira produziu um punhado de sinais, não um por tecla", enviados <= 3, `${enviados} sinais`)
}

// ---------------------------------------------------------------- mentions
//
// Bruno types an @ in the shared channel, picks Ana from the list, and what
// goes to the group must be HER ADDRESS, while both their screens show the name.
// It is the complete separation of the feature, and you only see it with both
// windows open: one writes, the other reads and gets notified.
const caixaBruno = bruno.page.locator('input[placeholder="Escreve uma mensagem"]')
await caixaBruno.click()
await caixaBruno.pressSequentially("@", { delay: 60 })
await wait(1200)

const sugeridos = await bruno.page.locator(".mention-picker [role=option]").count()
check("a arroba abre sugestões de quem está na sala", sugeridos >= 1, `${sugeridos} sugestões`)

// Only those in the channel, and never ourselves.
const nomesSugeridos = await bruno.page.locator(".mention-picker .mention-name").allTextContents()
check("não me sugere a mim próprio", !nomesSugeridos.includes("Bruno"), nomesSugeridos.join(", "))

// Navigate with the keyboard, which is the path that takes the most work to get right.
await bruno.page.keyboard.press("Enter")
await wait(600)
const naCaixa = await caixaBruno.inputValue()
check("escolher põe o NOME na caixa, e não o endereço", !naCaixa.includes(":"), naCaixa)

await caixaBruno.pressSequentially("olha isto", { delay: 30 })
await bruno.page.keyboard.press("Enter")
await wait(6000)

// On the reader's side: the mention is a button with the name, and the address is hidden.
const mencao = ana.page.locator(".message .mention")
check("a menção chega à Ana desenhada com um nome", (await mencao.count()) === 1, `${await mencao.count()}`)
const textoMencao = (await mencao.count()) ? await mencao.first().textContent() : ""
check("mostra o nome e não o endereço em latim", !textoMencao.includes(":"), textoMencao)

// And the notification: in a room channel, which is where the mention actually matters.
const avisos = await ana.page.evaluate(() => {
  const b = document.querySelector('button[title="Notificações"], button[aria-label^="Notificações"]')
  return b ? b.textContent.trim() : null
})
check("a Ana fica com um aviso de que foi mencionada", /\d/.test(avisos ?? ""), avisos ?? "sem sino")

// Clicking the mention opens THAT person's profile.
//
// Implemented on Bruno's side, not Ana's, for a reason that is not a detail: Ana
// was mentioned to herself, and the profile of whoever clicks is theirs, a different
// screen, with a different name. The person who has another person's profile to open
// is whoever wrote the mention.
const mencaoNoBruno = bruno.page.locator(".message .mention")
check("quem escreveu também vê a menção desenhada", (await mencaoNoBruno.count()) === 1)
if (await mencaoNoBruno.count()) {
  await mencaoNoBruno.first().click()
  await wait(2500)
  const perfil = await bruno.page.evaluate(() => document.body.innerText.includes("Perfil de"))
  check("clicar na menção abre o perfil dessa pessoa", perfil)
  const fechar = bruno.page.getByRole("button", { name: "Fechar" })
  if (await fechar.count()) await fechar.first().click()
  await wait(1500)
}

// -------------------------------------------------------------- the nudge
// Only in direct conversations: a nudge to thirty people is not a nudge,
// it is an alarm. In a room channel the button does not exist at all.
const botaoNoCanal = await ana.page.getByRole("button", { name: /Cotovelada/ }).count()
check("num canal de espaço não há cotovelada nenhuma", botaoNoCanal === 0, `${botaoNoCanal} botões`)

// Ana opens Bruno's profile from the people list and requests a direct conversation.
await ana.page.locator(`button:has-text("${bruno.addr.slice(1, 7)}")`).first().click()
await wait(1500)
await ana.page.getByRole("button", { name: "Mensagem" }).click()
await wait(9000)

const naDm = await ana.page.getByRole("button", { name: /Cotovelada/ }).count()
check("numa conversa directa a cotovelada aparece", naDm === 1, `${naDm} botões`)

// Bruno must have the conversation open to feel it: a nudge in another conversation
// arrives as an unread message and does not shake any screen.
//
// He opens it from Ana's PROFILE in the channel's member list, not from a line
// in the sidebar. The reason is not convenience: the identifier of a direct
// conversation is derived from both addresses in alphabetical order (see
// `openDirect`), so both sides opening it land in the SAME channel, his already
// exists, created by her. Looking for the line in the sidebar was what this script
// did, and it stopped working when direct conversations moved to the Friends page:
// the click found nothing and everything that followed failed for a reason that was
// not the one being measured. The correct approach is proven in
// `medir-barra-escrita.mjs`, including waits.
const primeiraPalavraDaAna = ana.addr.slice(1).split(/[-:]/)[0]
const cotoveladaDoBruno = () => bruno.page.locator('button[title^="Abanar o ecrã"]')

// A newly created direct conversation may already come open; in that case there
// is nothing to open, and insisting would close it.
if ((await cotoveladaDoBruno().count()) === 0) {
  await bruno.page.locator(`button[title*="${primeiraPalavraDaAna}"]`).first().click()
  await wait(2000)
  await bruno.page.getByRole("button", { name: "Mensagem" }).click()
  await wait(9000)
}
check("o Bruno consegue abrir a mesma conversa directa", (await cotoveladaDoBruno().count()) === 1)

/** Is the screen shaking? It is the class that CSS uses, and nothing else. */
const abanar = (page) => page.evaluate(() => document.querySelector(".main")?.classList.contains("buzzing") ?? null)

check("antes da cotovelada, o ecrã do Bruno está quieto", (await abanar(bruno.page)) === false)

// By `title` and not by label: during the countdown the button says "5s", and a
// selector by text fails to find it exactly when you need to look at it. (The
// button moved to the input bar and lost the emoji cited here; the `title` did
// not change.) Sample quickly, not with a fixed wait: the shake lasts 820 ms on
// purpose, a jiggle, not an earthquake, so a sample taken one second after the
// click arrives late and sees nothing.
await ana.page.locator('button[title^="Abanar o ecrã"]').click()
let abanou = false
for (let i = 0; i < 60 && !abanou; i++) {
  abanou = (await abanar(bruno.page)) === true
  if (!abanou) await wait(50)
}
check("a cotovelada da Ana abana o ecrã do Bruno", abanou)

// The 5-second interval, with time showing, owner's request.
const rotulo = await ana.page.evaluate(() => {
  const b = document.querySelector('button[title^="Podes dar outra dentro de"]')
  return b ? { texto: b.textContent.trim(), fechado: b.disabled } : null
})
check(
  "o botão fecha-se e diz quantos segundos faltam",
  rotulo?.fechado === true && /\d+s/.test(rotulo.texto),
  rotulo ? rotulo.texto : "sem contador",
)

// And the shake passes on its own: a jiggle, not an earthquake.
await wait(2500)
check("o abanão passa sozinho", (await abanar(bruno.page)) === false)

// At the end of the interval the button opens again.
await wait(4000)
const reaberto = await ana.page.locator('button[title^="Abanar o ecrã"]').count()
check("passados os 5 segundos a cotovelada volta a estar disponível", reaberto === 1)

await ana.page.screenshot({ path: "/tmp/orwell-ana-dm.png" })
await bruno.page.screenshot({ path: "/tmp/orwell-bruno-dm.png" })

// ------------------------------------------------ the invariant that costs the most
//
// What is ephemeral cannot be replayed. A recorded buzz is looked up in the
// backfill and shakes the screen of whoever opens the conversation the next day, // once for each nudge that was left there. Here the eve is staged: a burst of
// nudges and typing signals, then Bruno reloads the app, which is exactly when
// the backfill runs.
for (let i = 0; i < 3; i++) {
  await wait(5200)
  await ana.page.locator('button[title^="Abanar o ecrã"]').click()
}
await caixaAna.click()
await caixaAna.pressSequentially("mais uma frase a ser escrita agora", { delay: 40 })
await wait(1500)

await bruno.page.reload({ waitUntil: "networkidle" })
await wait(12_000)

// Thirty seconds of samples: if any nudge had been replayed, the screen would
// shake on its own right here without anyone touching anything.
let abanouSozinho = false
let indicadorFantasma = null
for (let i = 0; i < 60; i++) {
  if ((await abanar(bruno.page)) === true) abanouSozinho = true
  const t = await indicador(bruno.page)
  if (t) indicadorFantasma = t
  await wait(100)
}
check("recarregar não reproduz cotovelada nenhuma do que já passou", !abanouSozinho)
check(
  "recarregar não acende o indicador de escrita de ninguém",
  indicadorFantasma === null,
  indicadorFantasma ?? "nada",
)

// And the vault kept only what was SAID.
//
// What you read here is the DIRECT CONVERSATION, which is where the four nudges
// landed, reload brings it back open, which is where Bruno was. It must come
// EMPTY: nobody ever said anything to it, and if a buzz had been saved it would
// show up now as a line.
//
// It is worth saying why this number changed from 1 to 0. While the script opened
// the conversation from the sidebar, a click that stopped finding anything, Bruno
// never left the channel, and what was counted next was the CHANNEL history, with
// the mention message in it. In other words: the assertion passed without ever
// looking at the conversation where the nudges actually happened. Once the opening
// is fixed, you look at the right place, and the right place is empty.
const conversaDirecta = await bruno.page.evaluate(() =>
  [...document.querySelectorAll(".message")].map((n) => n.textContent?.trim() ?? ""),
)
check(
  "a conversa directa recarregada não guardou cotovelada nenhuma",
  conversaDirecta.length === 0,
  `${conversaDirecta.length} linhas: ${conversaDirecta.join(" | ").slice(0, 80)}`,
)

// And on the other side the symmetric proof: what was SAID survived intact. Without
// this half, an app that lost all history would pass the test above with flying colors.
await bruno.page.getByRole("button", { name: new RegExp(SALA) }).first().click()
await wait(4000)
const canal = await bruno.page.evaluate(() =>
  [...document.querySelectorAll(".message")].map((n) => n.textContent?.trim() ?? ""),
)
check("o canal recarregado tem a mensagem que foi dita", canal.length === 1, `${canal.length} linhas`)
check(
  "e é mesmo essa, sem nada de efémero pelo meio",
  (canal[0] ?? "").includes("olha isto"),
  (canal[0] ?? "").slice(0, 60),
)

// ----------------------------------------------------------- console errors
check("nenhum erro de consola na Ana", ana.erros.length === 0, ana.erros.slice(0, 3).join(" | "))
check("nenhum erro de consola no Bruno", bruno.erros.length === 0, bruno.erros.slice(0, 3).join(" | "))

await browser.close()
console.log("")
const falhas = results.filter(([, ok]) => !ok)
console.log(falhas.length === 0 ? "TUDO PASSOU" : `${falhas.length} FALHAS`)
process.exit(falhas.length === 0 ? 0 : 1)
