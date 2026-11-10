/**
 * The presence rings, measured in a real layout engine.
 *
 * The ring is the owner's request from October 27, 2026: 2 px around each
 * thumbnail face, green online, yellow away, red busy, gray offline, stopped
 * outside a call and pulsing inside one. Tests run in jsdom, which does not
 * apply stylesheets: they say the attributes are there, they do not say what
 * color paints, whether the pulse moves, or if the ring gets clipped by a box
 * with `overflow`. This runs the real `MemberPanel` and `ChannelSidebar`, with
 * the real stylesheet, at 1280 px and 390 px, and checks:
 *
 * - no errors on the page;
 * - each state paints the ring its color (gray is "offline", `idle`);
 * - only who is in a call pulses (`anel-pulsa`, 1.6 s), and in a voice room
 *   everyone pulses;
 * - the corner dot leaves view where there is a ring, and stays for the screen
 *   reader;
 * - the ring (the face plus 2 px) fits inside each clipping box (`overflow`
 *   other than `visible`), and no list gains horizontal scroll;
 * - with `prefers-reduced-motion`, there is no pulse, and the ring of who is in
 *   a call stays stopped and wider (3 px);
 * - in call chips (`CallChip`, in three sizes: 96, 64 and 40 px), the ring
 *   paints the state color and always pulses, the pulse ends before the voice
 *   ring (the green of who speaks), and nothing clips it.
 *
 * Records a screenshot of each case in `scripts/.saida-aneis-de-presenca/`.
 *
 *   node scripts/medir-aneis-de-presenca.mjs
 *
 * Color contrast is measured in `components/aneisDePresenca.contraste.test.ts`.
 */
import { build } from "esbuild"
import { chromium } from "playwright"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { alvo } from "./ambiente.mjs"

const AQUI = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(AQUI, ".saida-aneis-de-presenca")
const RAIZ = join(AQUI, "..")
const UI = (caminho) => JSON.stringify(join(RAIZ, "packages/ui/src", caminho))

mkdirSync(SAIDA, { recursive: true })

const SERVIDOR = alvo()
/** The four states, and a fifth online state that is in a call. */
const MEMBROS = {
  [`@ana:${SERVIDOR}`]: { nome: "Ana", presenca: "active", esperado: "online" },
  [`@bea:${SERVIDOR}`]: { nome: "Beatriz", presenca: "away", esperado: "ausente" },
  [`@cid:${SERVIDOR}`]: { nome: "Cid", presenca: "busy", esperado: "ocupado" },
  [`@dio:${SERVIDOR}`]: { nome: "Diogo", presenca: "idle", esperado: "offline" },
  [`@eva:${SERVIDOR}`]: { nome: "Eva Maria Vasconcelos", presenca: "active", esperado: "online", emChamada: true },
}

/** The expected colors, by tokens. Changing a token without changing this fails here. */
const CORES = {
  online: "rgb(80, 250, 123)",
  ausente: "rgb(245, 200, 76)",
  ocupado: "rgb(255, 92, 92)",
  offline: "rgb(74, 85, 120)",
}

const ENTRADA = join(SAIDA, "entrada.tsx")
writeFileSync(
  ENTRADA,
  `
import { createRoot } from "react-dom/client"
import { MemberPanel } from ${UI("screens/chat/MemberPanel.js")}
import { ChannelSidebar } from ${UI("screens/chat/ChannelSidebar.js")}
import { CallChip } from ${UI("screens/call/CallChip.js")}
import { ToastContext } from ${UI("components/Toast.js")}
import ${UI("styles.css")}

const MEMBROS = ${JSON.stringify(MEMBROS)}
const p = new URLSearchParams(location.search)
const estreito = p.get("estreito") === "1"
const vista = p.get("vista")
const noop = () => {}
const nomeDe = (address) => MEMBROS[address]?.nome ?? address
const directory = new Map(Object.entries(MEMBROS).map(([a, m]) => [a, { displayName: m.nome, donations: [] }]))

const salas = [
  { category: "", rooms: [{ room: "", name: "geral", category: "", kind: "text", position: -1 }] },
  { category: "Voz", rooms: [{ room: "v1", name: "Estúdio", category: "Voz", kind: "voice", position: 0 }] },
]
const presentes = [
  { address: "@cid:${SERVIDOR}", name: "Cid", presence: "busy" },
  { address: "@eva:${SERVIDOR}", name: "Eva Maria Vasconcelos" },
]

/*
  Os cartões da chamada, nos três tamanhos do CSS: o mosaico (96 px), a faixa
  (64 px) e a fila por cima de um ecrã em foco (40 px). Em cada um, uma pessoa
  calada e ligada, uma ocupada e uma a falar (\`--voz\` no máximo, que acende o
  halo e o anel de voz verde).
*/
function Chamada() {
  const fila = (
    <div className="call-people">
      <span className="call-person" data-caso="calada"><CallChip label="Ana" profile={directory.get("@ana:${SERVIDOR}")} texto="ligada" presence="active" /></span>
      <span className="call-person" data-caso="ocupado"><CallChip label="Cid" profile={directory.get("@cid:${SERVIDOR}")} texto="ligado" presence="busy" /></span>
      <span className="call-person" data-caso="a-falar"><CallChip label="Eva" profile={directory.get("@eva:${SERVIDOR}")} texto="ligada" presence="active" /></span>
    </div>
  )
  return (
    <ToastContext.Provider value={noop}>
      <section className="call call-sala" data-tamanho="96"><div className="call-corpo">{fila}</div></section>
      <section className="call call-faixa" data-tamanho="64"><div className="call-corpo">{fila}</div></section>
      <section className="call call-sala" data-tamanho="40"><div className="call-corpo com-foco">{fila}</div></section>
    </ToastContext.Provider>
  )
}

function Demo() {
  if (vista === "chamada") return <Chamada />
  return (
    <ToastContext.Provider value={noop}>
      <div className="app">
        <div className="rail" />
        <ChannelSidebar
          view="chat"
          rooms={["!geral:${SERVIDOR}"]}
          labelFor={() => "geral"}
          active="!geral:${SERVIDOR}"
          callChannel={null}
          ringing={new Map()}
          unreads={new Map()}
          profile={{ displayName: "Duarte", donations: [] }}
          address="@duarte:${SERVIDOR}"
          connection="online"
          open={estreito && vista === "salas"}
          onClose={noop}
          onSelectChannel={noop}
          onChannelMenu={noop}
          onCompose={noop}
          onEditProfile={noop}
          onPrompt={noop}
          onSaveStatus={noop}
          roomGroups={salas}
          activeRoom=""
          onSelectRoom={noop}
          voicePresence={(room) => (room === "v1" ? presentes : [])}
        />
        <main className="main" />
        <MemberPanel
          channel="!geral:${SERVIDOR}"
          open={estreito && vista === "membros"}
          onClose={noop}
          members={Object.keys(MEMBROS)}
          state="ready"
          onRetry={noop}
          me={null}
          directory={directory}
          nameFor={nomeDe}
          onInvite={noop}
          onUserMenu={noop}
          onOpenProfile={noop}
          presenceFor={(address) => MEMBROS[address]?.presenca ?? "idle"}
          emChamada={(address) => MEMBROS[address]?.emChamada === true}
        />
      </div>
    </ToastContext.Provider>
  )
}

createRoot(document.getElementById("raiz")).render(<Demo />)
`,
  "utf8",
)

await build({
  entryPoints: [ENTRADA],
  bundle: true,
  outfile: join(SAIDA, "pagina.js"),
  jsx: "automatic",
  loader: { ".css": "css", ".tsx": "tsx", ".ts": "ts", ".json": "json", ".woff2": "file" },
  external: ["@sapphi-red/*"],
  format: "iife",
  logLevel: "error",
})

writeFileSync(
  join(SAIDA, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="pagina.css"><body><div id="raiz"></div><script src="pagina.js"></script></body>`,
  "utf8",
)

const browser = await chromium.launch()
const resultados = []
const check = (etiqueta, ok, detalhe = "") => {
  resultados.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${etiqueta}${detalhe ? ` — ${detalhe}` : ""}`)
}

/** Everything measured from a ring, read in the browser. */
async function lerAneis(page, onde) {
  return page.evaluate((seletor) => {
    const aneis = [...document.querySelectorAll(`${seletor} [data-anel]`)]
    return aneis.map((anel) => {
      const r = anel.getBoundingClientRect()
      const estilo = getComputedStyle(anel)
      const depois = getComputedStyle(anel, "::after")
      const ponto = anel.querySelector(".presence-dot")
      const pontoR = ponto?.getBoundingClientRect()
      /* The clipping boxes: each ancestor with `overflow` other than
         `visible`. The ring is the face plus 2 px on each side. */
      const cortes = []
      for (let el = anel.parentElement; el && el !== document.body; el = el.parentElement) {
        const o = getComputedStyle(el)
        if (o.overflowX === "visible" && o.overflowY === "visible") continue
        const c = el.getBoundingClientRect()
        const dentro =
          r.left - 2 >= c.left - 0.5 && r.right + 2 <= c.right + 0.5 && r.top - 2 >= c.top - 0.5 && r.bottom + 2 <= c.bottom + 0.5
        // Out of view by being lower in the list is not clipping: it is scroll.
        const visivelNaVertical = r.bottom > c.top && r.top < c.bottom
        if (!dentro && visivelNaVertical) cortes.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`)
      }
      return {
        estado: anel.dataset.anel,
        emChamada: anel.hasAttribute("data-em-chamada"),
        nome: anel.closest("li")?.querySelector(".member-name, .voice-member-name")?.textContent?.trim() ?? "",
        sombra: estilo.boxShadow,
        animacao: depois.content === "none" ? null : `${depois.animationName} ${depois.animationDuration} ${depois.animationTimingFunction}`,
        largura: r.width,
        altura: r.height,
        redondo: estilo.borderTopLeftRadius === "50%",
        pontoVisivel: pontoR ? pontoR.width > 1 && pontoR.height > 1 : false,
        pontoTemNome: ponto ? (ponto.getAttribute("aria-label") ?? "") !== "" : null,
        cortes,
      }
    })
  }, onde)
}

for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  const estreito = largura < 600
  for (const movimento of ["normal", "reduzido"]) {
    for (const vista of estreito ? ["membros", "salas"] : ["tudo"]) {
      const ctx = await browser.newContext({
        viewport: { width: largura, height: altura },
        reducedMotion: movimento === "reduzido" ? "reduce" : "no-preference",
      })
      const page = await ctx.newPage()
      const erros = []
      page.on("pageerror", (e) => erros.push(String(e)))
      await page.goto(`file://${join(SAIDA, "index.html")}?estreito=${estreito ? 1 : 0}&vista=${vista}`)
      await page.waitForSelector(".members [data-anel]", { state: "attached", timeout: 10_000 })
      await page.waitForTimeout(250)

      const id = `${largura}-${movimento}-${vista}`
      check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))

      const verMembros = vista !== "salas"
      const verSalas = vista !== "membros"

      if (verMembros) {
        const membros = await lerAneis(page, ".members")
        check(`${id}: um anel por membro`, membros.length === Object.keys(MEMBROS).length, String(membros.length))
        for (const [, m] of Object.entries(MEMBROS)) {
          const anel = membros.find((a) => a.nome.startsWith(m.nome))
          if (!anel) {
            check(`${id}: ${m.nome} tem anel`, false)
            continue
          }
          const larguraDoAnel = movimento === "reduzido" && m.emChamada ? "3px" : "2px"
          check(
            `${id}: ${m.nome} (${m.presenca}) pinta ${m.esperado}, ${larguraDoAnel}`,
            anel.estado === m.esperado && anel.sombra === `${CORES[m.esperado]} 0px 0px 0px ${larguraDoAnel}`,
            anel.sombra,
          )
          const pulsoEsperado = m.emChamada && movimento === "normal" ? "anel-pulsa 1.6s ease-in-out" : null
          check(`${id}: ${m.nome} ${pulsoEsperado ? "pulsa" : "está parado"}`, anel.animacao === pulsoEsperado, String(anel.animacao))
          check(`${id}: ${m.nome}: o ponto sai da vista e guarda o nome`, !anel.pontoVisivel && anel.pontoTemNome === true)
          check(`${id}: ${m.nome}: o anel é redondo e do tamanho da cara (32 px)`, anel.redondo && anel.largura === 32 && anel.altura === 32, `${anel.largura}×${anel.altura}`)
          check(`${id}: ${m.nome}: o anel não é cortado por nenhuma caixa`, anel.cortes.length === 0, anel.cortes.join(", "))
        }
        const lado = await page.evaluate(() => {
          const lista = document.querySelector(".members")
          return { scroll: lista.scrollWidth, cabe: lista.clientWidth }
        })
        check(`${id}: o painel de membros não ganha scroll de lado`, lado.scroll <= lado.cabe, `${lado.scroll} em ${lado.cabe}`)
        await page.locator(".members").screenshot({ path: join(SAIDA, `${id}-membros.png`) })
      }

      if (verSalas) {
        /* Voice room faces no longer have a ring or pulse (owner, October 27, 2026,
           commit 35d24c4): measures the size (1.3 × 18 px) and that nothing
           clips them, and that there is no `[data-anel]` or pulse there. */
        const caras = await page.evaluate(() =>
          [...document.querySelectorAll(".room-voice-members .message-avatar")].map((cara) => {
            const r = cara.getBoundingClientRect()
            const cortes = []
            for (let el = cara.parentElement; el && el !== document.body; el = el.parentElement) {
              const o = getComputedStyle(el)
              if (o.overflowX === "visible" && o.overflowY === "visible") continue
              const c = el.getBoundingClientRect()
              const dentro = r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5
              if (!dentro && r.bottom > c.top && r.top < c.bottom) cortes.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`)
            }
            const embrulho = cara.closest(".avatar-wrap") ?? cara
            const depois = getComputedStyle(embrulho, "::after")
            return {
              nome: cara.closest("li")?.querySelector(".voice-member-name")?.textContent?.trim() ?? "",
              largura: r.width,
              altura: r.height,
              anel: cara.closest("[data-anel]") !== null,
              pulso: depois.content !== "none" && depois.animationName !== "none",
              cortes,
            }
          }),
        )
        check(`${id}: duas caras na sala de voz`, caras.length === 2, String(caras.length))
        for (const cara of caras) {
          check(
            `${id}: voz ${cara.nome}: 23 px (1,3 × 18), e não é cortada`,
            cara.largura === 23 && cara.altura === 23 && cara.cortes.length === 0,
            `${cara.largura}×${cara.altura} px ${cara.cortes.join(", ")}`,
          )
          check(`${id}: voz ${cara.nome}: sem anel nem pulso`, !cara.anel && !cara.pulso, `anel ${cara.anel} · pulso ${cara.pulso}`)
        }
        const lado = await page.evaluate(() => {
          const lista = document.querySelector(".sidebar")
          return { scroll: lista.scrollWidth, cabe: lista.clientWidth }
        })
        check(`${id}: a barra das salas não ganha scroll de lado`, lado.scroll <= lado.cabe, `${lado.scroll} em ${lado.cabe}`)

        // The account bar: the ring of the own face, green and stopped.
        const proprio = await page.evaluate(() => {
          const el = document.querySelector(".me-avatar")
          return { estado: el?.dataset.anel, sombra: el ? getComputedStyle(el).boxShadow : "" }
        })
        check(`${id}: a faixa da conta tem o anel da própria cara`, proprio.estado === "online" && proprio.sombra === `${CORES.online} 0px 0px 0px 2px`, proprio.sombra)
        await page.locator(".sidebar").screenshot({ path: join(SAIDA, `${id}-salas.png`) })
      }
      await ctx.close()
    }
  }
}

/*
  The call chips. The pulse must end before the voice ring: both are green for
  who is online, and one passing over the other would read as "speaking". The
  outer radius of the pulse at the end of the animation is measured (the ring
  radius plus shadow, times the scale of the last frame, read from CSSOM) and
  the inner radius of the voice ring (the SVG circle, minus half the stroke).
*/
for (const [largura, altura] of [
  [1280, 860],
  [390, 844],
]) {
  for (const movimento of ["normal", "reduzido"]) {
    const ctx = await browser.newContext({
      viewport: { width: largura, height: altura },
      reducedMotion: movimento === "reduzido" ? "reduce" : "no-preference",
    })
    const page = await ctx.newPage()
    const erros = []
    page.on("pageerror", (e) => erros.push(String(e)))
    await page.goto(`file://${join(SAIDA, "index.html")}?vista=chamada`)
    await page.waitForSelector(".call-chip [data-anel]", { state: "attached", timeout: 10_000 })
    // Speaking: what `useNivelDeVoz` writes to the chip when the voice is loud.
    await page.evaluate(() => {
      for (const c of document.querySelectorAll('[data-caso="a-falar"] .call-chip')) c.style.setProperty("--voz", "1")
    })
    await page.waitForTimeout(250)
    const id = `${largura}-${movimento}-chamada`
    /* The animation name is read before stopping it; then stop the pulse at the
       end (1,6 s minus a bit), to read the larger scale it reaches. CSSOM does
       not work: in a `file://\` Chromium does not let you read the rules. */
    const nomes = await page.evaluate(() =>
      [...document.querySelectorAll(".call-chip [data-anel]")].map((a) => {
        const d = getComputedStyle(a, "::after")
        return d.content === "none" || d.animationName === "none" ? null : `${d.animationName} ${d.animationDuration}`
      }),
    )
    await page.evaluate(() => {
      // Use Web Animations API and not `animation-delay\`: a negative delay in an infinite
      // animation already running wraps and lands at the start of the next
      // iteration.
      for (const a of document.getAnimations()) {
        if (a.animationName !== "anel-pulsa-no-cartao") continue
        a.pause()
        a.currentTime = 1599
      }
    })
    await page.waitForTimeout(50)
    check(`${id}: sem erros na página`, erros.length === 0, erros.join(" | "))

    const cartoes = await page.evaluate(() => {
      return [...document.querySelectorAll(".call-chip [data-anel]")].map((anel) => {
        const r = anel.getBoundingClientRect()
        const estilo = getComputedStyle(anel)
        const depois = getComputedStyle(anel, "::after")
        const largura = Number(/(\d+(?:\.\d+)?)px$/.exec(estilo.boxShadow)?.[1] ?? 0)
        const raio = r.width / 2
        const pulsa = depois.content !== "none" && depois.animationName !== "none"
        // The pulse scale at the end, read from computed style with the animation
        // stopped at the last moment (see the `getAnimations()\` above).
        const escala = Number(/^matrix\(([\d.]+)/.exec(depois.transform)?.[1] ?? 1)
        const foraDoPulso = pulsa ? (raio + 2) * escala : raio + largura
        const voz = anel.closest(".call-chip-rosto").querySelector(".anel-de-voz.fala")
        const circulo = voz.querySelector("circle")
        const rVoz = circulo.r.baseVal.value - parseFloat(getComputedStyle(circulo).strokeWidth) / 2
        const chip = anel.closest(".call-chip").getBoundingClientRect()
        const cx = r.left + raio
        const cy = r.top + raio
        const cabe =
          cx - foraDoPulso >= chip.left - 0.5 && cx + foraDoPulso <= chip.right + 0.5 && cy - foraDoPulso >= chip.top - 0.5 && cy + foraDoPulso <= chip.bottom + 0.5
        return {
          tamanho: anel.closest("[data-tamanho]").dataset.tamanho,
          caso: anel.closest("[data-caso]").dataset.caso,
          estado: anel.dataset.anel,
          emChamada: anel.hasAttribute("data-em-chamada"),
          sombra: estilo.boxShadow,
          animacao: null,
          largura: r.width,
          foraDoPulso,
          rVoz,
          cabe,
          pontoVisivel: (() => {
            const pr = anel.querySelector(".presence-dot")?.getBoundingClientRect()
            return pr ? pr.width > 1 : false
          })(),
          haloAceso: Number(getComputedStyle(anel.closest(".call-chip-rosto").querySelector(".halo-de-voz")).opacity),
        }
      })
    })
    cartoes.forEach((c, i) => (c.animacao = nomes[i] ?? null))
    check(`${id}: nove cartões (três tamanhos × três pessoas)`, cartoes.length === 9, String(cartoes.length))
    for (const c of cartoes) {
      const esperado = c.caso === "ocupado" ? "ocupado" : "online"
      const larguraDoAnel = movimento === "reduzido" ? "3px" : "2px"
      const etiqueta = `${id}: ${c.tamanho} px, ${c.caso}`
      check(`${etiqueta}: pinta ${esperado}, ${larguraDoAnel}`, c.estado === esperado && c.sombra === `${CORES[esperado]} 0px 0px 0px ${larguraDoAnel}`, c.sombra)
      check(
        `${etiqueta}: ${movimento === "normal" ? "pulsa (anel-pulsa-no-cartao 1.6s)" : "parado"}`,
        c.emChamada && c.animacao === (movimento === "normal" ? "anel-pulsa-no-cartao 1.6s" : null),
        String(c.animacao),
      )
      check(`${etiqueta}: a cara tem ${c.tamanho} px`, c.largura === Number(c.tamanho), String(c.largura))
      check(
        `${etiqueta}: o anel acaba antes do anel de voz`,
        c.foraDoPulso < c.rVoz,
        `${c.foraDoPulso.toFixed(1)} px < ${c.rVoz.toFixed(1)} px`,
      )
      check(`${etiqueta}: o cartão não corta o anel nem o pulso`, c.cabe)
      check(`${etiqueta}: o ponto sai da vista`, !c.pontoVisivel)
      if (c.caso === "a-falar") check(`${etiqueta}: o halo acende a falar`, c.haloAceso > 0.9, String(c.haloAceso))
    }
    await page.screenshot({ path: join(SAIDA, `${id}.png`), fullPage: true })
    await ctx.close()
  }
}

await browser.close()
const falhas = resultados.filter((ok) => !ok).length
console.log(`\n${resultados.length - falhas}/${resultados.length} PASS`)
process.exit(falhas === 0 ? 0 : 1)
