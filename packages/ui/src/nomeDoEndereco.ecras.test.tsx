import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import type { DenunciaRecebida, Participant } from "@enclave/client-core"
import type { EnclaveBridge, Profile } from "./bridge.js"
import type { ChatMessage } from "./types.js"
import { RichText } from "./components/RichText.js"
import { ToastProvider } from "./components/Toast.js"
import { useDirectory } from "./hooks/useDirectory.js"
import { montarResumo } from "./hooks/useOverlayDeJogo.js"
import { nomeEmFalta } from "./lib/format.js"
import { CallChip } from "./screens/call/CallChip.js"
import { CallPanel } from "./screens/call/CallPanel.js"
import { MemberPanel } from "./screens/chat/MemberPanel.js"
import { Timeline } from "./screens/chat/Timeline.js"
import { SeccaoDenuncias } from "./screens/overlays/SeccaoDenuncias.js"
import { strings } from "./strings.js"

/**
 * The name from the address, on the main screens (owner's order on 4 November
 * 2026). Someone who did not pick a name shows as the first word of their
 * address, italic and in the secondary color (`.nome-do-endereco`, with title
 * "From the address"); someone who did pick one shows as is, with no mark.
 * Names come from `useDirectory` for real, so collision is the app's.
 */

afterEach(cleanup)
// jsdom has no media pipeline: video boxes only need `play()` not to explode.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)

const noop = (): void => {}
const GINVODRA = "@ginvodra-sastybis-dirgybus-boblytum:orwell.pt"
const GINVODRA_OUTRA = "@ginvodra-pelmara-sostrin-quavely:outro.pt"
const MILSINDA = "@milsinda-odreto-viddyvox-pofletum:orwell.pt"
const ANA = "@ana-rocha-faril-quelmo:orwell.pt"

const perfil = (displayName: string): Profile => ({ displayName, donations: [] })

/** The directory as the app builds it: Ana has a name, the others do not. */
function ComDirectorio({
  vizinhos,
  mensagens = [],
  children,
}: {
  vizinhos: string[]
  mensagens?: ChatMessage[]
  children: (directorio: ReturnType<typeof useDirectory>) => React.ReactNode
}): React.JSX.Element {
  const semente = new Map([[ANA, perfil("Ana Silva")]])
  const directorio = useDirectory(mensagens, semente, undefined, vizinhos)
  return <>{children(directorio)}</>
}

function marcaDe(elemento: HTMLElement | null): HTMLElement | null {
  return elemento?.querySelector<HTMLElement>(".nome-do-endereco") ?? null
}

describe("lista de membros", () => {
  function montar(membros: string[]): void {
    render(
      <ComDirectorio vizinhos={membros}>
        {({ directory, nameFor }) => (
          <MemberPanel
            channel="!geral:orwell.pt"
            members={membros}
            state="ready"
            onRetry={noop}
            me={null}
            directory={directory}
            nameFor={nameFor}
            onInvite={noop}
            onUserMenu={noop}
            onOpenProfile={noop}
          />
        )}
      </ComDirectorio>,
    )
  }

  it("quem não tem nome aparece pela palavra do endereço, discreta; quem tem, tal e qual", () => {
    montar([ANA, MILSINDA])
    const milsinda = screen.getByText("Milsinda")
    expect(milsinda.classList.contains("nome-do-endereco")).toBe(true)
    expect(milsinda.getAttribute("title")).toBe(strings.profile.nomeDoEndereco)
    const ana = screen.getByText("Ana Silva")
    expect(ana.closest(".nome-do-endereco")).toBeNull()
    expect(screen.queryByText(strings.profile.noName)).toBeNull()
    expect(screen.queryByText(MILSINDA)).toBeNull()
  })

  it("duas contas com a mesma primeira palavra levam as duas a segunda, mesmo de servidores diferentes", () => {
    montar([GINVODRA, GINVODRA_OUTRA, MILSINDA])
    expect(screen.getByText("Ginvodra Sastybis")).toBeTruthy()
    expect(screen.getByText("Ginvodra Pelmara")).toBeTruthy()
    expect(screen.getByText("Milsinda")).toBeTruthy()
    expect(screen.queryByText("Ginvodra")).toBeNull()
  })

  it("quem escolheu nome não conta para a colisão: o nome escolhido não mostra a palavra", () => {
    // Ana has a name, so the only unnamed account starting with "ana" gets one word.
    const outraAna = "@ana-quilbo-pardes-vintor:orwell.pt"
    montar([ANA, outraAna])
    expect(screen.getByText("Ana")).toBeTruthy()
    expect(screen.getByText("Ana Silva")).toBeTruthy()
  })
})

describe("linhas de mensagem e menções", () => {
  const mensagem = (sender: string, seq: number, body: string): ChatMessage => ({
    channel: "!geral:orwell.pt",
    seq,
    sender,
    payload: { t: "message", id: `m-${seq}`, sentAt: seq * 120_000, body },
  })

  it("o autor sem nome aparece pela palavra do endereço, discreta, e o autor com nome não", () => {
    const mensagens = [mensagem(MILSINDA, 1, "bom dia"), mensagem(ANA, 2, "olá")]
    render(
      <ToastProvider>
        <ComDirectorio vizinhos={[]} mensagens={mensagens}>
          {({ directory, nameFor }) => (
            <Timeline
              channel="!geral:orwell.pt"
              messages={mensagens}
              pending={[]}
              onRetry={noop}
              onDiscard={noop}
              me={null}
              nameFor={nameFor}
              directory={directory}
            />
          )}
        </ComDirectorio>
      </ToastProvider>,
    )
    const autores = [...document.querySelectorAll<HTMLElement>(".author")]
    expect(autores.map((autor) => autor.textContent)).toEqual(["Milsinda", "Ana Silva"])
    expect(marcaDe(autores[0]!)?.textContent).toBe("Milsinda")
    expect(marcaDe(autores[1]!)).toBeNull()
  })

  it("a menção de quem não tem nome diz @Palavra, com a palavra discreta", () => {
    render(<RichText nameFor={(endereco) => nomeEmFalta(endereco)}>{`olá ${MILSINDA}!`}</RichText>)
    const mencao = document.querySelector<HTMLElement>(".mention")!
    expect(mencao.textContent).toBe("@Milsinda")
    expect(marcaDe(mencao)?.textContent).toBe("Milsinda")
  })
})

describe("chamada", () => {
  it("os cartões de quem não tem nome dizem a palavra do endereço, discreta; o nosso e o da Ana não", () => {
    const pessoas = [MILSINDA, ANA].map((address) => ({ address, connected: true, stream: null }) as Participant)
    render(
      <ComDirectorio vizinhos={[MILSINDA, ANA, GINVODRA]}>
        {({ directory, nameFor }) => (
          <CallPanel
            call={{ setMuted: noop, setCameraOff: noop } as unknown as EnclaveBridge["call"]}
            channel="!geral:orwell.pt"
            participants={pessoas}
            localStream={null}
            selfLabel="Eu"
            selfProfile={perfil("Eu")}
            nameFor={nameFor}
            directory={directory}
            onLeave={noop}
            aLigar={[GINVODRA]}
          />
        )}
      </ComDirectorio>,
    )
    const nomes = [...document.querySelectorAll<HTMLElement>(".call-chip-name")]
    expect(nomes.map((nome) => nome.textContent)).toEqual(["Eu", "Milsinda", "Ana Silva", "Ginvodra"])
    expect(nomes.map((nome) => marcaDe(nome) !== null)).toEqual([false, true, false, true])
    // The video box (hidden without a camera) says the same as the card.
    const rodapes = [...document.querySelectorAll<HTMLElement>(".tile-label")]
    expect(rodapes.some((rodape) => marcaDe(rodape)?.textContent === "Milsinda")).toBe(true)
  })

  it("um cartão sem endereço (o nosso) nunca leva a marca, mesmo com um nome parecido", () => {
    render(<CallChip label="Milsinda" profile={undefined} texto="tu" proprio />)
    expect(marcaDe(document.querySelector<HTMLElement>(".call-chip-name"))).toBeNull()
  })

  it("a overlay de jogo recebe a marca de quem não tem nome, e só dessa pessoa", () => {
    const resumo = montarResumo({
      sala: "Sala",
      entrada: 1,
      eu: { id: ANA, nome: "Ana Silva" },
      outros: [{ id: MILSINDA, nome: nomeEmFalta(MILSINDA), stream: null, micCalado: false }],
      falam: new Set(),
      micMuted: false,
      soundOff: false,
    })
    expect(resumo.pessoas.map((pessoa) => [pessoa.nome, pessoa.doEndereco ?? false])).toEqual([
      ["Ana Silva", false],
      ["Milsinda", true],
    ])
  })
})

describe("denúncias recebidas (caixa do fundador)", () => {
  const DENUNCIA: DenunciaRecebida = {
    id: "c-1",
    canal: "!sala:orwell.pt",
    dia: "2026-11-04",
    motivo: 3,
    nota: "",
    denunciado: MILSINDA,
    alvo: { tipo: "mensagem", id: "m-2" },
    itens: [
      { autor: ANA, dia: "2026-11-04", hora: "09:58", texto: "bom dia", anexos: [], verificada: true, denunciada: false },
      { autor: MILSINDA, dia: "2026-11-04", hora: "10:01", texto: "a ofensa", anexos: [], verificada: true, denunciada: true },
    ],
    lida: false,
  }

  it("o denunciado e o autor sem nome dizem-se pela palavra do endereço, e o autor sem nome vai discreto", async () => {
    const nomeDe = (endereco: string): string => (endereco === ANA ? "Ana Silva" : nomeEmFalta(endereco))
    render(<SeccaoDenuncias carregar={() => Promise.resolve([DENUNCIA])} nomeDe={nomeDe} />)
    expect((await screen.findByTestId("denuncia-denunciado")).textContent).toContain("Milsinda")
    const autores = [...document.querySelectorAll<HTMLElement>(".denuncia-item-cabecalho strong")]
    expect(autores.map((autor) => autor.textContent)).toEqual(["Ana Silva", "Milsinda"])
    expect(marcaDe(autores[0]!)).toBeNull()
    expect(marcaDe(autores[1]!)?.textContent).toBe("Milsinda")
    expect(document.body.textContent).not.toContain(strings.profile.noName)
  })
})
