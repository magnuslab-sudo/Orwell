import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { moradaDeSala } from "@enclave/protocol"
// The harness server, for real, on an ephemeral port. The sessions are from this
// package (`./session.js`): this task's code is what gets measured.
import { ate, CofreEmMemoria, levantarServidor, type ServidorDeTeste } from "../../../apps/server/testes/cliente-de-teste.js"
import { lerCaixa } from "./denuncia.js"
import { origemDoServidorDe } from "./relato.js"
import { Session } from "./session.js"
import { Vault } from "./vault.js"

/**
 * The founder's report box in the app (Task 6), with real sessions.
 *
 * Ana creates the channel, Bruno writes, Carla reports. The server delivers the
 * copy with no delay (`denunciaAtrasoHoras: [0, 0]`). Ana's session reads the box
 * after connecting, verifies each item (the authorship and the author's chain) and stores
 * the report in the vault, in `denuncias[canal]`.
 */

interface Conta {
  nome: string
  session: Session
  vault: Vault
  backend: CofreEmMemoria
  address: string
}

let servidor: ServidorDeTeste
const abertas: Session[] = []
const PRIMEIRA = Session.CAIXA_PRIMEIRA_MS
const RELOGIO = Session.CAIXA_MS

async function conta(nome: string): Promise<Conta> {
  const backend = new CofreEmMemoria()
  const vault = new Vault(backend)
  await vault.create("frase-passe-de-teste")
  const session = new Session(vault)
  const identidade = await session.createIdentity(servidor.casa)
  await session.connect()
  await session.updateProfile({ displayName: nome, donations: [] })
  abertas.push(session)
  return { nome, session, vault, backend, address: identidade.address }
}

/** The same account, in another session on the same vault: this is what a restart does. */
async function reabrir(antes: Conta): Promise<Conta> {
  antes.session.disconnect()
  await antes.session.flush().catch(() => {})
  const vault = new Vault(antes.backend)
  await vault.unlock("frase-passe-de-teste")
  const session = new Session(vault)
  session.loadIdentity()
  await session.connect()
  abertas.push(session)
  return { ...antes, session, vault }
}

function esperarFase(session: Session, fase: string, prazoMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const prazo = setTimeout(() => {
      desligar()
      reject(new Error(`o emparelhamento nunca chegou a ${fase}`))
    }, prazoMs)
    const desligar = session.on("pair", (evento) => {
      if (evento.fase === fase) {
        clearTimeout(prazo)
        desligar()
        resolve()
      } else if (evento.fase === "falhou") {
        clearTimeout(prazo)
        desligar()
        reject(new Error(`o emparelhamento falhou: ${evento.razao}`))
      }
    })
  })
}

/** A device paired with `principal`, without the account key. Like the harness one, with a session from this package. */
async function emparelhar(principal: Conta): Promise<Session> {
  const vault = new Vault(new CofreEmMemoria())
  await vault.create("frase-do-telemovel")
  const session = new Session(vault)
  abertas.push(session)
  const sasPrincipal = esperarFase(principal.session, "sas")
  const { link } = await principal.session.emparelharComoAnfitriao()
  const sasTelemovel = esperarFase(session, "sas")
  session.emparelharComoConvidado(link)
  await Promise.all([sasPrincipal, sasTelemovel])
  const certificado = esperarFase(session, "certificado")
  const concluido = esperarFase(principal.session, "concluido", 30_000)
  await session.confirmarSas()
  await principal.session.confirmarSas()
  await certificado
  session.loadIdentity()
  await session.connect()
  session.concluirEmparelhamento()
  await concluido
  return session
}

function mensagem(corpo: string): never {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], links: [], mentions: [] } as never
}

async function dizer(autor: Conta, canal: string, corpo: string, leitores: readonly Conta[]): Promise<string> {
  await autor.session.send(canal, mensagem(corpo))
  const idEm = (leitor: Conta): string | undefined =>
    leitor.session.history(canal).find((e) => e.payload["body"] === corpo)?.payload["id"] as string | undefined
  for (const leitor of leitores) await ate(() => idEm(leitor) !== undefined, `"${corpo}" chega a ${leitor.nome}`)
  return idEm(leitores[0]!)!
}

const ESCOLHA = { motivo: 3 as const, nota: "Insultos.", boaFe: true, contacto: { nome: "Carla Silva", email: "carla@exemplo.pt" } }

let ana: Conta
let bruno: Conta
let carla: Conta
let canal: string

beforeAll(async () => {
  servidor = await levantarServidor({ denunciaAtrasoHoras: [0, 0] })
  // No solo reads in the middle of tests, except where the test asks for it.
  Session.CAIXA_PRIMEIRA_MS = 60 * 60_000
  ana = await conta("Ana")
  bruno = await conta("Bruno")
  carla = await conta("Carla")
  canal = moradaDeSala(servidor.casa)
  await ana.session.createSpaceChannel(canal)
  await ate(() => ana.session.founderOf(canal) === ana.address, "a Ana funda o canal")
  for (const outra of [bruno, carla]) {
    await ana.session.seat(canal, outra.address)
    await ate(() => outra.session.channels.includes(canal), `${outra.nome} entra no canal`)
  }
}, 90_000)

afterEach(() => {
  Session.CAIXA_PRIMEIRA_MS = 60 * 60_000
  Session.CAIXA_MS = RELOGIO
})

afterAll(async () => {
  for (const s of abertas.splice(0)) s.disconnect()
  Session.CAIXA_PRIMEIRA_MS = PRIMEIRA
  Session.CAIXA_MS = RELOGIO
  await servidor?.fechar()
})

async function carlaDenuncia(corpo: string, mexer?: (preparada: Awaited<ReturnType<Session["prepararDenuncia"]>>) => void): Promise<void> {
  const id = await dizer(bruno, canal, corpo, [ana, carla])
  await dizer(carla, canal, `a Carla responde a "${corpo}"`, [ana, bruno])
  const origem = origemDoServidorDe(carla.address)
  const preparada = await carla.session.prepararDenuncia({ canal, pessoa: bruno.address, mensagem: { id } }, origem)
  expect(preparada.temCopia).toBe(true)
  mexer?.(preparada)
  await expect(carla.session.denunciar(preparada, ESCOLHA, origem, "1.2.0")).resolves.toEqual({ ok: true })
}

describe("a caixa de denúncias do fundador, com sessões a sério", () => {
  it("depois de ligar, o fundador lê a caixa e a denúncia fica no cofre em denuncias[canal], com os itens do Bruno verificados", async () => {
    await carlaDenuncia("o Bruno insulta toda a gente")
    const avisos: unknown[] = []
    Session.CAIXA_PRIMEIRA_MS = 300
    ana = await reabrir(ana)
    ana.session.on("status", (evento) => {
      if (evento.code === "denuncia-recebida") avisos.push(evento)
    })
    await ate(() => ana.session.denunciasDe(canal).length === 1, "a denúncia chega ao cofre da Ana")

    const [recebida] = ana.session.denunciasDe(canal)
    expect(recebida).toMatchObject({ canal, motivo: 3, nota: "Insultos.", denunciado: bruno.address, lida: false })
    expect(recebida!.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(ana.vault.contents.denuncias?.[canal]?.length).toBe(1)
    const doBruno = recebida!.itens.filter((item) => item.autor === bruno.address)
    expect(doBruno.length).toBeGreaterThan(0)
    expect(doBruno.every((item) => item.verificada)).toBe(true)
    expect(recebida!.itens.filter((item) => item.denunciada).map((item) => item.texto)).toEqual(["o Bruno insulta toda a gente"])
    // Nothing from whoever reported: not the messages, not the address, not the contact.
    const texto = JSON.stringify(recebida)
    for (const proibido of [carla.address, "a Carla responde", "Carla Silva", "carla@exemplo.pt", "1.2.0"]) {
      expect(texto).not.toContain(proibido)
    }
    // In the order of the author, never by seq (which in the copy is -1).
    const quando = recebida!.itens.map((item) => `${item.dia}T${item.hora}`)
    expect([...quando].sort()).toEqual(quando)

    // The session says only the channel, and nothing else.
    await ate(() => avisos.length === 1, "o aviso da denúncia")
    expect(avisos[0]).toEqual({ detail: "", code: "denuncia-recebida", channel: canal })
  }, 60_000)

  it("depois de um reinício, a mesma cópia não aparece duas vezes, e o servidor apaga a já guardada", async () => {
    await carlaDenuncia("mais um insulto do Bruno")
    await ana.session.recolherDenuncias()
    const antes = ana.session.denunciasDe(canal).length
    ana = await reabrir(ana)
    // The ID was left unsaid to the server: come back again, and don't enter twice.
    await ana.session.recolherDenuncias()
    expect(ana.session.denunciasDe(canal).length).toBe(antes)
    expect(ana.vault.contents.caixaVista ?? []).toEqual([])
    // The server no longer has it.
    expect(await lerCaixa(origemDoServidorDe(ana.address), ana.session.identity, [])).toEqual([])
  }, 60_000)

  it("um item mexido por quem denuncia chega como não verificado", async () => {
    await carlaDenuncia("o Bruno outra vez", (preparada) => {
      const item = preparada.itensDoFundador.find((i) => i.denunciada)!
      item.item.p = { ...item.item.p, body: "o Bruno nunca disse isto" }
    })
    await ana.session.recolherDenuncias()
    const ultima = ana.session.denunciasDe(canal)[0]!
    const denunciada = ultima.itens.find((item) => item.denunciada)!
    expect(denunciada.texto).toBe("o Bruno nunca disse isto")
    expect(denunciada.verificada).toBe(false)
    expect(ultima.itens.filter((item) => !item.denunciada).every((item) => item.verificada)).toBe(true)
  }, 60_000)

  it("os itensDoFundador que chegam da interface não contam: a cópia sai sem as mensagens de quem denuncia", async () => {
    // The interface (the renderer, in Electron) is untrusted: it puts Carla's
    // messages in the founder's list.
    await carlaDenuncia("o Bruno ainda", (preparada) => {
      expect(preparada.itens.some((item) => item.autor === carla.address)).toBe(true)
      preparada.itensDoFundador = [...preparada.itens]
    })
    await ana.session.recolherDenuncias()
    const ultima = ana.session.denunciasDe(canal)[0]!
    expect(ultima.itens.filter((item) => item.denunciada).map((item) => item.texto)).toEqual(["o Bruno ainda"])
    expect(ultima.itens.some((item) => item.autor === carla.address)).toBe(false)
    const texto = JSON.stringify(ultima)
    expect(texto).not.toContain(carla.address)
    expect(texto).not.toContain("a Carla responde")
  }, 60_000)

  it("uma leitura periódica da caixa que falha diz-se num status de registo, só com a mensagem do erro", async () => {
    const buscar = globalThis.fetch
    const espiao = vi.spyOn(globalThis, "fetch").mockImplementation((entrada, opcoes) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url
      if (url.includes("/_enclave/denuncia/caixa")) return Promise.reject(new Error("a rede caiu"))
      return buscar(entrada, opcoes)
    })
    try {
      const falhas: unknown[] = []
      Session.CAIXA_PRIMEIRA_MS = 300
      ana = await reabrir(ana)
      ana.session.on("status", (evento) => {
        if (evento.code === "denuncia-caixa-falhou") falhas.push(evento)
      })
      await ate(() => falhas.length === 1, "o status da leitura que falhou")
      // `enviarPedidoAssinado` translates the network failure into its own key.
      expect(falhas[0]).toEqual({ detail: "could not reach the homeserver", level: "error", code: "denuncia-caixa-falhou", route: "log" })
    } finally {
      espiao.mockRestore()
    }
  }, 30_000)

  it("marcarDenunciaLida grava a leitura no cofre", async () => {
    const [primeira] = ana.session.denunciasDe(canal)
    await ana.session.marcarDenunciaLida(primeira!.id)
    expect(ana.session.denunciasDe(canal).find((d) => d.id === primeira!.id)!.lida).toBe(true)
    expect(ana.vault.contents.denuncias?.[canal]?.find((d) => d.id === primeira!.id)?.lida).toBe(true)
  }, 30_000)

  it("no aparelho emparelhado sem chave de conta, a cópia fica por abrir: conta-se, e chega pela conta depois de o principal a abrir", async () => {
    const telemovel = await emparelhar(ana)
    expect(telemovel.identity.signingPrivateKey).toBeUndefined()
    const antes = ana.session.denunciasDe(canal).length
    const temANova = (): boolean =>
      telemovel.denunciasDe(canal).some((d) => d.itens.some((item) => item.texto === "o Bruno no telemóvel"))
    await carlaDenuncia("o Bruno no telemóvel")
    await telemovel.recolherDenuncias()
    expect(temANova()).toBe(false)
    expect(telemovel.denunciasPorAbrir(canal)).toBe(1)
    expect(telemovel.vault.contents.caixaVista ?? []).toEqual([])
    // The copy stayed on the server, for the device that opens it.
    await telemovel.recolherDenuncias()
    await ana.session.recolherDenuncias()
    expect(ana.session.denunciasDe(canal).length).toBe(antes + 1)
    // And the main one sends it open to the phone, through the account channel.
    await ate(temANova, "a denúncia chega ao telemóvel pela conta", 30_000)
    expect(telemovel.denunciasPorAbrir(canal)).toBe(0)
  }, 90_000)
})
