/**
 * The microphone and sound on the account card, verified live.
 *
 * Tests the three things the change must guarantee and that no test in jsdom
 * proves: that it mutes OUTSIDE a call, that the choice is still there when you
 * join a call, and that the card fits in a 236px column and a 390px screen with
 * a long accented name.
 *
 * Against a local server only, never production: the target comes from `ambiente.mjs`,
 * which has the lock.
 *
 * ---------------------------------------------------------------------------
 *
 * **WHAT CHANGED, and why this file was rewritten on August 19, 2026.**
 *
 * This script was born against a card where each toggle had a WORD next to the
 * icon, and measured it: `b.querySelector("span").textContent` had to say
 * "Microfone" and then become "Silenciado". On August 11 (`294f5b9`) the owner
 * asked for icons instead of words, the `<span>` vanished, and after that:
 *
 *  - the three label checks started comparing `""` with "Microfone" and turned
 *    RED even though nothing was broken;
 *  - reading the 236px block dereferenced `null` and the script DIED there,
 *    halfway through, before reaching the 390px check.
 *
 * It stayed that way for five days because this script does not run in any CI
 * and is not mentioned in `package.json` or any document.
 *
 * **What is measured now is what the card says today**, and they are the three
 * signals that `CartaoDaConta.tsx` itself names in its comment: the `.off` class,
 * the BAR drawn over the icon (an extra `<path>` inside the `<svg>`), and the
 * accessible name, which carries the state through words since they left the
 * screen ("Silenciado. Ligar microfone."). The tooltip (`data-tip`) says only
 * the action, and that is also checked, they were the same phrase for one
 * iteration, and the long phrase did not fit the column.
 *
 * **Clipping stopped being measured with `scrollWidth`, and that is a finding
 * not a preference.** On a healthy `.me-audio-btn`, `scrollWidth` is 103 and
 * `clientWidth` is 82, measured. The difference is not clipped content: it is
 * the TOOLTIP, which is a `::after` on `[data-tip]` (`components.css:692`) and
 * lives inside the button, invisible until you hover and wider than the button.
 * `scrollWidth` on an element with a tooltip measures the tooltip. Write
 * `scrollWidth > clientWidth` here and you get a check that is always red, or,  * worse, always green measuring something else. What is measured now is geometry:
 * each button box inside the column box, the question you wanted to ask from the
 * start.
 *
 * ---------------------------------------------------------------------------
 *
 * **THE SABOTAGES.** A measurement that never fails is not a measurement.
 *
 *   node scripts/verificar-audio-cartao.mjs                     # must all be OK
 *   SABOTAR=sem-nome  node scripts/verificar-audio-cartao.mjs   # must FAIL
 *   SABOTAR=sem-barra node scripts/verificar-audio-cartao.mjs   # must FAIL
 *   SABOTAR=sem-dica  node scripts/verificar-audio-cartao.mjs   # must FAIL
 *   SABOTAR=alvo      node scripts/verificar-audio-cartao.mjs   # must FAIL
 *
 * Each erases one of the three signals (or the touch target) and nothing else,
 * and anyone who does not bite their own is measuring something else. Run on
 * August 19, 2026, against the live application: 0 failures without sabotage,
 * and no sabotage passed.
 */
import { chromium } from "playwright"
import { criarContaEEntrar } from "./conta.mjs"
import { alvo, alvoApp, FRASE } from "./ambiente.mjs"

/*
  The target comes from `ambiente.mjs`, not from two default values written here.
  
  The ones that were here were `http://127.0.0.1:5173` (without the `/app/`, which the
  `vite.config.ts` of `@enclave/web` declares as `base` since the homepage took the root) and
  `localhost:8450` (one of the ten old ports; development is 8452). Neither got anywhere, and the
  symptom of both is the same: sixty seconds waiting for an account creation screen that never
  appears. `ambiente.mjs` exists because of this kind of error and brings the production lock
  with it.
  */
const WEB = alvoApp(process.env.ORWELL_WEB)
const HOME = alvo(process.env.ORWELL_HOME)
const NOME = process.env.ORWELL_NOME ?? "Maria João Sótão de Bragança"
const SABOTAGEM = process.env.SABOTAR ?? ""

/** Minimum touch target, in pixels. WCAG 2.2 AA; the card CSS promises 28. */
const ALVO_MINIMO = 24

const browser = await chromium.launch({
  headless: true,
  args: [
    // Without this, `getUserMedia` on call entry asks for permission and waits for a click no one
    // gives.
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
})

let falhas = 0
const ok = (condicao, texto) => {
  console.log(`${condicao ? "  ok  " : " FALHA"} ${texto}`)
  if (!condicao) falhas++
}

/**
 * The sabotage, applied live to the card already on screen.
 *
 * Runs after each state change and not just once: React redraws the button on each click and
 * carried the sabotage with it. That is why it lives in a `MutationObserver` and not in a single
 * pass.
 */
async function sabotar(page) {
  if (!SABOTAGEM) return
  await page.evaluate((qual) => {
    /*
      The ones that are VISUAL are done by stylesheet, and the ones that are ATTRIBUTE by
      observer.
      
      The first version of this function removed the bar from the icon with `removeChild`, and
      the price was immediate: React owns that node, `removeChild` under it breaks reconciliation,
      and the sabotage started breaking three checks, its own and two others that had nothing to
      do with it ("linking from the card turns off the red in both"). A sabotage that breaks what
      is not its own proves nothing: you do not know if the check that turned red bit or caught
      the wreckage. React never notices CSS.
      */
    const folha = {
      "sem-barra": ".me-audio-btn.off svg > *:last-child { display: none !important }",
      alvo: ".me-audio-btn { min-width: 16px !important; height: 16px !important }",
    }[qual]
    if (folha) {
      const estilo = document.createElement("style")
      estilo.textContent = folha
      document.head.appendChild(estilo)
      return
    }

    const aplicar = () => {
      for (const botao of document.querySelectorAll(".me-audio-btn")) {
        if (qual === "sem-nome") botao.removeAttribute("aria-label")
        if (qual === "sem-dica") botao.removeAttribute("data-tip")
      }
    }
    aplicar()
    if (!window.__sabotagem) {
      window.__sabotagem = new MutationObserver(aplicar)
      window.__sabotagem.observe(document.body, { childList: true, subtree: true, attributes: true })
    }
  }, SABOTAGEM)
}

async function abrir(largura, altura) {
  const ctx = await browser.newContext({
    viewport: { width: largura, height: altura },
    permissions: ["microphone", "camera"],
  })
  const page = await ctx.newPage()
  page.on("console", (m) => {
    if (/error|erro|falh/i.test(m.text())) console.log("    [browser]", m.text().slice(0, 160))
  })
  page.on("pageerror", (e) => console.log("    [pageerror]", String(e).slice(0, 200)))
  await page.goto(WEB, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1200)

  // New account in each context: a clean profile is what guarantees that the state we see comes
  // from preferences and not from a previous session.
  // The server is pre-set from wherever the application was served and is no longer on screen:
  // point to this one through advanced options, to not clutter anyone else's.
  await criarContaEEntrar(page, { nome: NOME, frase: FRASE, servidor: HOME })
  // `attached` not `visible`: at 390px the card exists in the DOM with the drawer closed, and
  // waiting for it to show is waiting for a click that only the 390px block gives. Waiting for
  // visibility here hung the script for sixty seconds and killed the last section, the one that
  // measures narrow screens.
  await page.locator(".me-audio-btn").first().waitFor({ state: "attached", timeout: 60_000 })
  await sabotar(page)
  return { ctx, page }
}

/** The sidebar drawer, on narrow screens where it is not a column. */
async function abrirGaveta(page) {
  const menu = page.getByRole("button", { name: /abrir o painel lateral/i }).first()
  if (await menu.isVisible().catch(() => false)) {
    await menu.click()
    // The drawer slides; measuring mid-transition gives false numbers.
    await page.waitForTimeout(700)
  }
  const aberta = await page.evaluate(() => document.querySelector("aside.sidebar")?.classList.contains("open"))
  if (!aberta) throw new Error("a gaveta não abriu — a medição a 390px não valeria nada")
}

/**
 * The state of the two toggles, by the three signals the card promises.
 *
 * `tracos` are the drawings inside the `<svg>` that put ink on the screen: `off` adds a
 * `<path>`, the bar, and it is the signal that people who cannot distinguish colors read.
 * See `MicIcon` and `HeadphonesIcon` in `packages/ui/src/icons.tsx`.
 *
 * Count by the drawn box not by `children.length`, because a stroke hidden by CSS is still a
 * child and not a stroke: counting nodes is counting intent, and what matters here is what
 * you see.
 */
const estado = (page) =>
  page.evaluate(() => {
    const botoes = [...document.querySelectorAll(".me-audio-btn")]
    const prefs = JSON.parse(localStorage.getItem("enclave.prefs") ?? "{}")
    const comTinta = (botao) =>
      [...(botao.querySelector("svg")?.children ?? [])].filter((desenho) => {
        const caixa = desenho.getBoundingClientRect()
        return caixa.width > 0 || caixa.height > 0
      }).length
    return {
      quantos: botoes.length,
      calados: botoes.map((b) => b.classList.contains("off")),
      nomes: botoes.map((b) => b.getAttribute("aria-label") ?? ""),
      dicas: botoes.map((b) => b.getAttribute("data-tip") ?? ""),
      tracos: botoes.map(comTinta),
      microfone: prefs.micMuted === true,
      som: prefs.soundOff === true,
    }
  })

/* ------------------------------------------ 1. mute outside a call */

console.log(`\n== silenciar sem estar em chamada, e a escolha sobreviver ==${SABOTAGEM ? ` [SABOTADO: ${SABOTAGEM}]` : ""}`)
{
  const { ctx, page } = await abrir(1280, 900)

  const inicial = await estado(page)
  ok(inicial.quantos === 2, `os dois botões estão no cartão (vi ${inicial.quantos})`)
  ok(!inicial.calados[0] && !inicial.calados[1], "de fábrica ouve-se e é-se ouvido")
  // The state left the screen and went into the accessible name. Whoever hears the screen is
  // the only one who does not see any of the three drawn signals, and this is the phrase it
  // comes down to: if it does not say the state, nothing else does.
  ok(
    inicial.nomes[0] === "Microfone ligado. Desligar microfone." && inicial.nomes[1] === "Som ligado. Desligar o som.",
    `os nomes dizem estado E acção: ${inicial.nomes.join(" | ")}`,
  )
  ok(
    inicial.dicas[0] === "Desligar microfone" && inicial.dicas[1] === "Desligar o som",
    `e o balão diz só a acção: ${inicial.dicas.join(" | ")}`,
  )

  // No call standing: this is the click that did not exist before.
  await page.locator(".me-audio-btn").first().click()
  await page.waitForTimeout(300)
  await sabotar(page)
  const calado = await estado(page)
  ok(calado.calados[0] === true, "o microfone fica marcado como calado")
  ok(calado.nomes[0] === "Silenciado. Ligar microfone.", `o nome muda com a cor: "${calado.nomes[0]}"`)
  // The drawn bar is the signal that does not depend on any color, and it is the only one that
  // survives a grayscale screen or someone who does not see red.
  ok(
    calado.tracos[0] === inicial.tracos[0] + 1,
    `o ícone ganha a barra por cima (${inicial.tracos[0]} → ${calado.tracos[0]} desenhos)`,
  )
  ok(calado.microfone === true, "a escolha foi gravada nas preferências")

  // Reload is the test that the choice lives longer than the screen.
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "Configurações" }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(600)
  await sabotar(page)
  const depois = await estado(page)
  ok(depois.calados[0] === true, "e sobrevive a recarregar a página")

  /* ---------------------------------- 2. enter a call already muted */

  console.log("\n== entrar numa chamada e a escolha manter-se ==")
  // A channel and a voice room inside it: it is by clicking the room that you enter a channel
  // call, and that is the entry we want to prove.
  await page.getByRole("button", { name: /criar canal/i }).first().click()
  await page.getByPlaceholder("geral").fill("diagnostico")
  await page.getByRole("button", { name: /^Confirmar$/ }).click()
  await page.waitForTimeout(3000)

  await page.getByRole("button", { name: /nova sala/i }).first().click()
  await page.getByPlaceholder("Anúncios").fill("Voz")
  await page.getByRole("button", { name: /^Voz$/ }).click()
  await page.getByRole("button", { name: /^Criar$/ }).click()
  await page.waitForTimeout(2000)

  await page.locator(".room-name", { hasText: "Voz" }).first().click()
  // `getUserMedia` with fake device, plus negotiation: give it time.
  await page.waitForTimeout(5000)
  await sabotar(page)

  const emChamada = await page.evaluate(() => {
    const painel = document.querySelector(".call")
    const botoes = [...(painel?.querySelectorAll(".call-btn") ?? [])]
    return {
      painel: Boolean(painel),
      painelCalado: botoes[0]?.classList.contains("off") ?? null,
      botoesNoPainel: botoes.length,
      cartaoCalado: document.querySelector(".me-audio-btn")?.classList.contains("off") ?? null,
    }
  })
  ok(emChamada.painel, "o painel da chamada abriu")
  ok(emChamada.painelCalado === true, "o painel abre JÁ calado — a escolha atravessou a entrada")
  ok(
    emChamada.cartaoCalado === emChamada.painelCalado,
    `o cartão e o painel dizem o mesmo (cartão: ${emChamada.cartaoCalado}, painel: ${emChamada.painelCalado})`,
  )

  // What the interface says must match what the track is doing. This is where we would catch the
  // worst mistake: the red button and the microphone transmitting.
  const faixa = await page.evaluate(() => {
    const video = document.querySelector(".call-video video")
    const faixas = video?.srcObject?.getAudioTracks?.() ?? []
    return faixas.length > 0 ? faixas[0].enabled : null
  })
  ok(faixa === false, `a faixa de áudio está desactivada de facto (enabled: ${faixa})`)

  // Turn it back on, with the call standing: same state in both places.
  await page.locator(".me-audio-btn").first().click()
  await page.waitForTimeout(500)
  await sabotar(page)
  const ligado = await page.evaluate(() => ({
    cartao: document.querySelector(".me-audio-btn")?.classList.contains("off") ?? null,
    painel: document.querySelector(".call .call-btn")?.classList.contains("off") ?? null,
    faixa: (document.querySelector(".call-video video")?.srcObject?.getAudioTracks?.() ?? [])[0]?.enabled ?? null,
  }))
  ok(ligado.cartao === false && ligado.painel === false, "ligar pelo cartão desliga o vermelho nos dois")
  ok(ligado.faixa === true, "e a faixa volta a transmitir")

  // Muting the sound silences the microphone by side effect, without erasing the person's choice.
  await page.locator(".me-audio-btn").nth(1).click()
  await page.waitForTimeout(500)
  await sabotar(page)
  const semSom = await estado(page)
  const faixaSemSom = await page.evaluate(
    () => (document.querySelector(".call-video video")?.srcObject?.getAudioTracks?.() ?? [])[0]?.enabled ?? null,
  )
  ok(semSom.calados[0] === true && semSom.calados[1] === true, "sem som, o microfone também cala")
  ok(faixaSemSom === false, "e a faixa deixa de transmitir")
  ok(semSom.microfone === false, "a escolha da pessoa fica intacta por baixo")
  // The only phrase in the interface that explains a silent microphone with no one touching it.
  // Without it the button stays red for a reason that is not written anywhere, and the person
  // will look for it in the microphone settings.
  ok(
    semSom.dicas[0] === "Silenciado porque o som está desligado",
    `e o balão diz PORQUÊ: "${semSom.dicas[0]}"`,
  )

  await page.screenshot({ path: "scripts/.saida-audio-cartao-chamada.png" }).catch(() => {})
  await ctx.close()
}

/* ------------------------- 3. the 236px column, which is the tightest case */

console.log("\n== 236px de coluna (desktop): o caso mais apertado ==")
{
  const { ctx, page } = await abrir(1280, 860)
  await page.getByRole("button", { name: /criar canal/i }).first().click()
  await page.getByPlaceholder("geral").fill("diagnostico")
  await page.getByRole("button", { name: /^Confirmar$/ }).click()
  await page.waitForTimeout(3000)
  await sabotar(page)

  /**
   * What is measured on a button without words: geometry, not `scrollWidth`.
   *
   * `sai` is how many pixels the button sticks out of the column, and it is the question the
   * word check was trying to ask. `alvo` is the CSS promise (`min-width: 28px; height: 28px`)
   * and WCAG 2.2: a 16px toggle is hit with a mouse and missed with a thumb.
   */
  const medir = () =>
    page.evaluate(() => {
      const linha = document.querySelector(".me-audio")
      const lateral = document.querySelector("aside.sidebar")
      const nome = document.querySelector(".me-name-text")
      if (!linha || !lateral || !nome) return null
      const coluna = lateral.getBoundingClientRect()
      return {
        coluna: Math.round(coluna.width),
        nomeVisivel: Math.round(nome.getBoundingClientRect().width),
        botoes: [...document.querySelectorAll(".me-audio-btn")].map((b) => {
          const caixa = b.getBoundingClientRect()
          return {
            largura: Math.round(caixa.width),
            altura: Math.round(caixa.height),
            sai: Math.round(Math.max(coluna.left - caixa.left, caixa.right - coluna.right)),
            icone: Math.round(b.querySelector("svg")?.getBoundingClientRect().width ?? 0),
            nome: b.getAttribute("aria-label") ?? "",
            dica: b.getAttribute("data-tip") ?? "",
          }
        }),
      }
    })

  const medida = await medir()

  if (!medida) {
    ok(false, "não encontrei o cartão na coluna")
  } else {
    console.log(`  --   coluna de ${medida.coluna}px, nome com ${medida.nomeVisivel}px`)
    ok(
      medida.botoes.every((b) => b.sai <= 0),
      `os dois botões cabem na coluna (${medida.botoes.map((b) => `${b.largura}×${b.altura}px`).join(", ")})`,
    )
    ok(
      medida.botoes.every((b) => b.largura >= ALVO_MINIMO && b.altura >= ALVO_MINIMO),
      `os dois cumprem o alvo de ${ALVO_MINIMO}px: ${medida.botoes.map((b) => `${b.largura}×${b.altura}`).join(" e ")}`,
    )
    ok(
      medida.botoes.every((b) => b.icone > 0 && b.nome.length > 0 && b.dica.length > 0),
      `cada um tem desenho, nome e balão: ${medida.botoes.map((b) => `${b.icone}px "${b.nome}"`).join(", ")}`,
    )
  }

  await page.mouse.move(640, 400)
  await page.waitForTimeout(400)
  await page.locator("aside.sidebar").screenshot({ path: "scripts/.saida-audio-cartao-coluna.png" }).catch(() => {})

  // And with both muted at the same time, which is where the design grows: each
  // icon gains the bar, and the pair gains a red frame.
  await page.locator(".me-audio-btn").first().click()
  await page.locator(".me-audio-btn").nth(1).click()
  await page.waitForTimeout(500)
  await sabotar(page)
  const pior = await medir()
  if (!pior) {
    ok(false, "não encontrei o cartão calado na coluna")
  } else {
    ok(
      pior.botoes.every((b) => b.sai <= 0),
      `com os dois calados continuam dentro da coluna (${pior.botoes.map((b) => `${b.largura}px`).join(" e ")})`,
    )
    ok(
      pior.botoes.every((b) => b.icone > 0 && b.nome.length > 0),
      `e cada um continua com desenho e nome: ${pior.botoes.map((b) => `"${b.nome}"`).join(", ")}`,
    )
  }

  await page.mouse.move(640, 400)
  await page.waitForTimeout(400)
  await page
    .locator("aside.sidebar")
    .screenshot({ path: "scripts/.saida-audio-cartao-coluna-calado.png" })
    .catch(() => {})
  await ctx.close()
}

/* -------------------------------------------- 4. 390px, with a long name */

console.log("\n== 390px, nome comprido e acentuado, sem transbordo ==")
{
  const { ctx, page } = await abrir(390, 780)

  // With a channel in the list, not on the empty screen: the card lives below
  // a populated list, and that is where overflow would appear.
  await page.getByRole("button", { name: /criar canal/i }).first().click()
  await page.getByPlaceholder("geral").fill("diagnostico")
  await page.getByRole("button", { name: /^Confirmar$/ }).click()
  await page.waitForTimeout(3000)

  await abrirGaveta(page)
  await sabotar(page)

  const medida = await page.evaluate(() => {
    const linha = document.querySelector(".me-audio")
    const cartao = document.querySelector(".me")
    const nome = document.querySelector(".me-name-text")
    const marca = document.querySelector(".me-name > .dot")
    if (!linha || !cartao || !nome || !marca) return null
    const caixa = linha.getBoundingClientRect()
    const lateral = document.querySelector("aside.sidebar").getBoundingClientRect()
    const marcaCaixa = marca.getBoundingClientRect()
    return {
      linha: { esquerda: caixa.left, direita: caixa.right },
      lateral: { esquerda: lateral.left, direita: lateral.right },
      transbordo: linha.scrollWidth - linha.clientWidth,
      nomeCortado: nome.scrollWidth > nome.clientWidth,
      // The state marker must stay INSIDE the column: we already fixed a case where
      // a long name pushed it out.
      marcaDentro: marcaCaixa.right <= lateral.right + 0.5 && marcaCaixa.width > 0,
      botoes: [...document.querySelectorAll(".me-audio-btn")].map((b) => {
        const r = b.getBoundingClientRect()
        return {
          largura: Math.round(r.width),
          altura: Math.round(r.height),
          dentro: r.left >= lateral.left - 0.5 && r.right <= lateral.right + 0.5,
          iconeVisivel: (b.querySelector("svg")?.getBoundingClientRect().width ?? 0) > 0,
          // The text left the button on August 11 and moved here. What we check now is
          // not that it shows, but that it EXISTS for whoever listens.
          nomeAcessivel: b.getAttribute("aria-label") ?? "",
        }
      }),
    }
  })

  if (!medida) {
    ok(false, "não encontrei o cartão a 390px")
  } else {
    ok(medida.transbordo <= 0, `a linha não transborda (scroll extra: ${medida.transbordo}px)`)
    ok(
      medida.botoes.every((b) => b.dentro),
      `os dois botões cabem na coluna (larguras: ${medida.botoes.map((b) => b.largura).join(" e ")}px)`,
    )
    ok(
      medida.botoes.every((b) => b.iconeVisivel && b.nomeAcessivel.length > 0),
      `ícone desenhado e nome acessível nos dois: ${medida.botoes.map((b) => `"${b.nomeAcessivel}"`).join(", ")}`,
    )
    ok(
      medida.botoes.every((b) => b.largura >= ALVO_MINIMO && b.altura >= ALVO_MINIMO),
      `e o alvo de ${ALVO_MINIMO}px aguenta-se no ecrã estreito: ${medida.botoes.map((b) => `${b.largura}×${b.altura}`).join(" e ")}`,
    )
    ok(medida.marcaDentro, "a marca de estado continua dentro da coluna, com o nome comprido")
    console.log(`  --   o nome ${medida.nomeCortado ? "corta com reticências" : "cabe inteiro"}`)
  }

  // Warnings and help balloons out of the way before capture: we want to see
  // the card, and the cursor on the rail leaves a balloon above it.
  await page.evaluate(() => {
    for (const fechar of document.querySelectorAll(".toast button, .toast-close")) fechar.click()
  })
  await page.mouse.move(200, 400)
  await page.waitForTimeout(600)
  await page.screenshot({ path: "scripts/.saida-audio-cartao-390.png" }).catch(() => {})

  // And the muted state, which is what you read at a glance.
  await page.locator(".me-audio-btn").first().click()
  await page.waitForTimeout(400)
  await page.mouse.move(200, 400)
  await page.screenshot({ path: "scripts/.saida-audio-cartao-390-calado.png" }).catch(() => {})
  await ctx.close()
}

await browser.close()
console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`)
process.exit(falhas === 0 ? 0 : 1)
