import { existsSync, readdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { WebSocket } from "ws"
import { assinarPedido, origemDoServidorDe, pedirRevisao } from "@enclave/client-core"
import {
  FEDERATION_PATH,
  fromBase64,
  generateIdentity,
  parseServerName,
  PROTOCOL_VERSION,
  ROTAS_DA_DENUNCIA,
  sign,
  signPeerClaim,
  toBase64,
  type AccountIdentity,
  type AvisoDeSuspensao,
  type Identity,
  type Payload,
  type ServerFrame,
} from "@enclave/protocol"
import {
  ate,
  canalComTodos,
  Cliente,
  contasDeTeste,
  desligarContas,
  levantarServidor,
  type ContaDeTeste,
  type ServidorDeTeste,
} from "../testes/cliente-de-teste.js"
import { loadOrCreateServerKey } from "./config.js"
import { currentSecond } from "./db.js"
import { ArquivoDeDenuncias, nomeDoFicheiroDaConta, type Fila } from "./denuncia.js"
import { Gateway } from "./gateway.js"

/**
 * Account suspension (Task 8; `docs/planos/denuncias-design.md`, §8 and §9b),
 * end to end with real clients.
 *
 * Suspension is written the way the VPS script writes it (Task 10): the line in
 * `suspensoes` by `store.suspender`, and the notice by
 * `ArquivoDeDenuncias.escreverAviso`. Never by SQL or by hand file.
 */

const PAR = parseServerName("par.example")

let servidor: ServidorDeTeste
let arquivo: ArquivoDeDenuncias
let par: ReturnType<typeof loadOrCreateServerKey>
let ana: ContaDeTeste
let bruno: ContaDeTeste
let carla: ContaDeTeste
let canal: string
const abertas: ContaDeTeste[] = []

beforeAll(async () => {
  // The federated link, so the federated route for key packages has someone to serve.
  servidor = await levantarServidor({ allowlist: [PAR] })
  arquivo = new ArquivoDeDenuncias(join(dirname(servidor.baseDeDados), "denuncias"))
  par = loadOrCreateServerKey(join(dirname(servidor.baseDeDados), "par"))
  servidor.enclave.store.cachePeerKey(PAR, par.keyId, par.publicKey, currentSecond() + 3600)
  ;[ana, bruno, carla] = (await contasDeTeste(servidor, ["Ana", "Bruno", "Carla"])) as [ContaDeTeste, ContaDeTeste, ContaDeTeste]
  abertas.push(ana, bruno, carla)
  canal = await canalComTodos(servidor, ana, [bruno, carla])
}, 90_000)

afterAll(async () => {
  desligarContas(abertas)
  await servidor?.fechar()
})

/** A complete notice under article 17, paragraph 3 of the DSA. */
function avisoDe(endereco: string, revisao: Partial<AvisoDeSuspensao["revisao"]> = {}): AvisoDeSuspensao {
  return {
    v: 1,
    endereco,
    motivo: 3,
    medida: "suspensao-da-conta",
    desde: "2026-11-03",
    ate: null,
    ambito: "A conta não entra neste servidor e não envia mensagens.",
    factos: "Insultos repetidos no canal, denunciados por duas pessoas.",
    origem: "denuncia",
    semMeiosAutomaticos: true,
    norma: "Termos de utilização, ponto 4.",
    revisao: { pedida: null, decisao: "pendente", nota: "", ...revisao },
  }
}

/** How the VPS script suspends: the line in the base and the notice in file. */
async function suspender(endereco: string): Promise<void> {
  servidor.enclave.store.suspender(endereco, 1)
  await arquivo.escreverAviso(endereco, avisoDe(endereco))
}

function mensagem(corpo: string): Payload {
  return { t: "message", id: crypto.randomUUID(), sentAt: Date.now(), body: corpo, attachments: [], links: [], mentions: [] } as unknown as Payload
}

const tem = (conta: ContaDeTeste, corpo: string): boolean =>
  conta.session.history(canal).some((entrada) => entrada.payload["body"] === corpo)

/** The hello, the challenge and the response, on a raw socket: returns the first frame after `auth.finish`. */
async function entrarCru(identidade: AccountIdentity): Promise<{ resposta: ServerFrame; fechou: Promise<void> }> {
  const socket = new WebSocket(servidor.url)
  const fila: ServerFrame[] = []
  const esperas: ((frame: ServerFrame) => void)[] = []
  socket.on("message", (raw: Buffer) => {
    const frame = JSON.parse(raw.toString("utf8")) as ServerFrame
    const espera = esperas.shift()
    if (espera) espera(frame)
    else fila.push(frame)
  })
  const fechou = new Promise<void>((resolver) => socket.once("close", () => resolver()))
  await new Promise<void>((resolver, rejeitar) => {
    socket.once("open", () => resolver())
    socket.once("error", rejeitar)
  })
  const proximo = (): Promise<ServerFrame> =>
    fila.length > 0 ? Promise.resolve(fila.shift()!) : new Promise((resolver) => esperas.push(resolver))
  socket.send(JSON.stringify({ t: "hello", version: PROTOCOL_VERSION, capabilities: ["commit-after-echo"] }))
  expect((await proximo()).t).toBe("hello.ok")
  socket.send(JSON.stringify({ t: "auth.begin", address: identidade.address, signingKey: toBase64(identidade.signingPublicKey) }))
  const desafio = await proximo()
  if (desafio.t !== "auth.challenge") throw new Error(`sem desafio: ${desafio.t}`)
  socket.send(JSON.stringify({ t: "auth.finish", signature: toBase64(sign(identidade, fromBase64(desafio.nonce))) }))
  return { resposta: await proximo(), fechou }
}

/** A signed request to a reports route, by `inject`. */
async function pedir(identidade: Identity | AccountIdentity, rota: (typeof ROTAS_DA_DENUNCIA)[keyof typeof ROTAS_DA_DENUNCIA], corpo: unknown) {
  const resposta = await servidor.enclave.app.inject({
    method: "POST",
    url: rota,
    payload: assinarPedido(identidade as Identity, rota, corpo) as unknown as Record<string, unknown>,
  })
  return { estado: resposta.statusCode, corpo: resposta.json<Record<string, unknown>>() }
}

async function pedirAoPar(endereco: string, bundle: boolean) {
  const claim = signPeerClaim(
    { keyId: par.keyId, privateKey: par.privateKey },
    {
      origin: PAR,
      destination: servidor.casa,
      issuedAt: currentSecond(),
      nonce: toBase64(crypto.getRandomValues(new Uint8Array(16))),
      address: endereco,
    },
    bundle ? { bundle: true } : {},
  )
  const resposta = await servidor.enclave.app.inject({
    method: "POST",
    url: `${FEDERATION_PATH}/keypackage`,
    payload: claim as unknown as Record<string, unknown>,
  })
  return { estado: resposta.statusCode, corpo: resposta.json<{ keyPackage: string | null; keyPackages?: unknown[] }>() }
}

describe("suspensão de conta no servidor, com clientes reais", () => {
  it("uma conta suspensa não entra: error account-suspended fatal com a frase, e a sessão emite status account-suspended com o aviso", async () => {
    // A raw socket: the frame the server sends, as is.
    const crua = generateIdentity(servidor.casa)
    ;(await Cliente.ligar(servidor.url, crua)).fechar()
    await suspender(crua.address)
    const { resposta, fechou } = await entrarCru(crua)
    expect(resposta).toEqual({ t: "error", code: "account-suspended", message: Gateway.FRASE_CONTA_SUSPENSA, fatal: true })
    await fechou

    // The session: reads the notice by the signed request, says it and doesn't sign on again.
    const [dora] = await contasDeTeste(servidor, ["Dora"])
    abertas.push(dora!)
    dora!.session.disconnect()
    await suspender(dora!.address)
    const estados: { code?: string; route?: string; aviso?: AvisoDeSuspensao }[] = []
    const ligacoes: string[] = []
    dora!.session.on("status", (estado) => estados.push(estado))
    dora!.session.on("connection", ({ state }) => ligacoes.push(state))
    await expect(dora!.session.connect()).rejects.toThrow()
    const suspensa = estados.find((estado) => estado.code === "account-suspended")
    expect(suspensa).toMatchObject({ route: "toast", aviso: avisoDe(dora!.address) })
    await new Promise((resolver) => setTimeout(resolver, 300))
    // Doesn't retry: no connection ever reaches "online" or stays to reconnect.
    expect(ligacoes).not.toContain("online")
    expect(ligacoes.at(-1)).not.toBe("reconnecting")

    // No gateway, by the signed request: asks for review and reads the marked notice.
    expect(await dora!.session.pedirRevisao("Peço que revejam.")).toEqual({ ok: true })
    expect((await dora!.session.avisoDeSuspensao())?.revisao.pedida).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  }, 60_000)

  it("ligada antes da suspensão, a conta é fechada no envio seguinte; keypackage.claim e /_enclave/federation/keypackage devolvem null", async () => {
    const store = servidor.enclave.store
    expect(store.availableKeyPackages(bruno.address)).toBeGreaterThan(0)
    await suspender(bruno.address)

    // The next send closes the connection, and the message never reaches anyone.
    void bruno.session.send(canal, mensagem("depois de suspenso")).catch(() => undefined)
    await ate(() => bruno.avisos.includes("account-suspended"), "o Bruno ouve account-suspended")
    await carla.session.send(canal, mensagem("a Carla continua"))
    await ate(() => tem(ana, "a Carla continua"), "a mensagem da Carla chega à Ana")
    expect(tem(ana, "depois de suspenso")).toBe(false)

    // No one invites her: her key packages are not served or consumed.
    const antes = store.availableKeyPackages(bruno.address)
    const deFora = generateIdentity(servidor.casa)
    const cliente = await Cliente.ligar(servidor.url, deFora)
    cliente.enviar({ t: "keypackage.claim", address: bruno.address, bundle: false })
    expect(await cliente.proximoDe("keypackage.claimed")).toMatchObject({ address: bruno.address, keyPackage: null })
    cliente.enviar({ t: "keypackage.claim", address: bruno.address, bundle: true })
    expect(await cliente.proximoDe("keypackage.claimed")).toMatchObject({ keyPackage: null, keyPackages: [] })
    cliente.fechar()

    const singular = await pedirAoPar(bruno.address, false)
    expect(singular).toEqual({ estado: 200, corpo: { keyPackage: null } })
    const bundle = await pedirAoPar(bruno.address, true)
    expect(bundle.estado).toBe(200)
    expect(bundle.corpo).toMatchObject({ keyPackage: null, keyPackages: [] })
    expect(store.availableKeyPackages(bruno.address)).toBe(antes)

    // An account that is not suspended remains served (the route did not close).
    expect((await pedirAoPar(carla.address, false)).corpo.keyPackage).not.toBeNull()
  }, 60_000)

  it("ligada antes da suspensão, qualquer trama que não seja o ping fecha a ligação com account-suspended", async () => {
    const identidade = generateIdentity(servidor.casa)
    const cliente = await Cliente.ligar(servidor.url, identidade)
    servidor.enclave.store.suspender(identidade.address, null)
    // The ping goes through: it is not about the account, it is about the connection.
    expect(await cliente.ateAoPong()).toEqual([])
    cliente.enviar({ t: "presence.set", visible: false })
    expect(await cliente.proximoDe("error")).toEqual({
      t: "error",
      code: "account-suspended",
      message: Gateway.FRASE_CONTA_SUSPENSA,
      fatal: true,
    })
    servidor.enclave.store.levantar(identidade.address)
    cliente.fechar()
  }, 30_000)

  it("fecharSuspensas fecha a ligação em menos de 60 s mesmo sem envio", async () => {
    expect(Gateway.VARRER_SUSPENSAS_MS).toBeLessThanOrEqual(60_000)
    const antes = Gateway.VARRER_SUSPENSAS_MS
    // The same timer, shorter: the test does not wait a minute.
    Gateway.VARRER_SUSPENSAS_MS = 200
    const outro = await levantarServidor().finally(() => {
      Gateway.VARRER_SUSPENSAS_MS = antes
    })
    try {
      const [eva] = await contasDeTeste(outro, ["Eva"])
      outro.enclave.store.suspender(eva!.address, null)
      const esperou = await ate(() => eva!.avisos.includes("account-suspended"), "a Eva é fechada sem enviar nada", 10_000)
      expect(esperou).toBeLessThan(60_000)
      expect(outro.enclave.gateway.fecharSuspensas()).toBe(0)
      eva!.session.disconnect()
    } finally {
      await outro.fechar()
    }
  }, 60_000)

  it("uma suspensão com fim amanhã acaba sozinha: dois dias depois a conta volta a entrar, sem ninguém a levantar", async () => {
    const identidade = generateIdentity(servidor.casa)
    ;(await Cliente.ligar(servidor.url, identidade)).fechar()
    const agora = Date.now()
    const dia = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
    // Suspended two days ago, ending the day after that (like `--ate`):
    // the last second of that day in UTC. Only the Date is false, and only here.
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      vi.setSystemTime(agora - 2 * 86_400_000)
      const fim = Date.parse(`${dia(agora - 86_400_000)}T23:59:59Z`) / 1000
      servidor.enclave.store.suspender(identidade.address, null, fim)
      expect(servidor.enclave.store.estaSuspensa(identidade.address)).toBe(true)
      expect(servidor.enclave.store.suspensas()).toContain(identidade.address)
    } finally {
      vi.useRealTimers()
    }
    // Two days later, which is now.
    expect(servidor.enclave.store.estaSuspensa(identidade.address)).toBe(false)
    expect(servidor.enclave.store.suspensas()).not.toContain(identidade.address)
    const { resposta } = await entrarCru(identidade)
    expect(resposta.t).not.toBe("error")
  }, 30_000)

  it("as mensagens que lhe mandam ficam no servidor como para quem está desligado; levantar deixa-a entrar e ler", async () => {
    const [fabio] = await contasDeTeste(servidor, ["Fábio"])
    abertas.push(fabio!)
    const sala = await canalComTodos(servidor, ana, [fabio!])
    fabio!.session.disconnect()
    await suspender(fabio!.address)

    await ana.session.send(sala, mensagem("para o Fábio, enquanto suspenso"))
    await expect(fabio!.session.connect()).rejects.toThrow()

    const inicio = (): unknown => {
      const base = new DatabaseSync(servidor.baseDeDados, { readOnly: true })
      try {
        return base.prepare("SELECT activa, at_second FROM suspensoes WHERE address = ?").get(fabio!.address)
      } finally {
        base.close()
      }
    }
    const antes = inicio() as { activa: number; at_second: number }
    expect(antes.activa).toBe(1)
    await new Promise((resolver) => setTimeout(resolver, 1100))
    servidor.enclave.store.levantar(fabio!.address)
    expect(servidor.enclave.store.estaSuspensa(fabio!.address)).toBe(false)
    // Lifting does not change `at_second`: it still says when the suspension started.
    expect(inicio()).toEqual({ activa: 0, at_second: antes.at_second })
    await fabio!.session.connect()
    await ate(
      () => fabio!.session.history(sala).some((entrada) => entrada.payload["body"] === "para o Fábio, enquanto suspenso"),
      "o Fábio lê o que lhe mandaram",
      30_000,
    )
  }, 90_000)

  it("/suspensao devolve o aviso com os campos do art. 17.º; /revisao escreve o pedido, marca pedida e conta na fila; segunda revisão no mesmo dia passa, quarta dá 429; conta não suspensa dá 403", async () => {
    const gil = generateIdentity(servidor.casa)
    servidor.enclave.store.registerOrVerifyAccount(gil.address, gil.signingPublicKey)
    expect(await pedir(gil, ROTAS_DA_DENUNCIA.suspensao, {})).toEqual({ estado: 200, corpo: { aviso: null } })
    expect(await pedir(gil, ROTAS_DA_DENUNCIA.revisao, { nota: "Não fiz nada." })).toEqual({
      estado: 403,
      corpo: { error: "not-suspended" },
    })

    await suspender(gil.address)
    const lido = await pedir(gil, ROTAS_DA_DENUNCIA.suspensao, {})
    expect(lido.estado).toBe(200)
    const aviso = lido.corpo["aviso"] as AvisoDeSuspensao
    expect(aviso).toEqual(avisoDe(gil.address))
    // The fields of article 17, paragraph 3: measure, duration, scope, facts, origin,
    // without automated means, standard, and review.
    for (const campo of ["medida", "desde", "ate", "ambito", "factos", "origem", "semMeiosAutomaticos", "norma", "revisao"]) {
      expect(aviso).toHaveProperty(campo)
    }

    // The file name is not the short address: two accounts do not collide.
    const pasta = join(dirname(servidor.baseDeDados), "denuncias")
    expect(existsSync(join(pasta, "suspensoes", `${nomeDoFicheiroDaConta(gil.address)}.json`))).toBe(true)
    expect(nomeDoFicheiroDaConta(gil.address)).toMatch(/^[0-9a-f]{32}$/)

    // Malformed: no note.
    expect((await pedir(gil, ROTAS_DA_DENUNCIA.revisao, { nota: "" })).estado).toBe(400)

    expect(await pedir(gil, ROTAS_DA_DENUNCIA.revisao, { nota: "Fui eu, mas foi uma vez." })).toEqual({ estado: 200, corpo: { ok: true } })
    const marcado = await arquivo.lerAviso(gil.address)
    expect(marcado?.revisao.pedida).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(marcado?.revisao.decisao).toBe("pendente")
    const revisoes = (): string[] =>
      readdirSync(join(pasta, "revisoes")).filter((nome) => nome.startsWith(`${nomeDoFicheiroDaConta(gil.address)}-`))
    expect(revisoes()).toHaveLength(1)
    const pedido = JSON.parse(readFileSync(join(pasta, "revisoes", revisoes()[0]!), "utf8")) as Record<string, unknown>
    expect(pedido).toMatchObject({ v: 1, endereco: gil.address, nota: "Fui eu, mas foi uma vez." })
    const fila = (): Fila => JSON.parse(readFileSync(join(pasta, "fila.json"), "utf8")) as Fila
    const pendentes = fila().revisoesPendentes

    // The second and third on the same day pass; the fourth gets 429.
    expect((await pedir(gil, ROTAS_DA_DENUNCIA.revisao, { nota: "Segunda nota." })).estado).toBe(200)
    expect((await pedir(gil, ROTAS_DA_DENUNCIA.revisao, { nota: "Terceira nota." })).estado).toBe(200)
    expect(await pedir(gil, ROTAS_DA_DENUNCIA.revisao, { nota: "Quarta nota." })).toEqual({
      estado: 429,
      corpo: { error: "too-many-requests" },
    })
    expect(revisoes()).toHaveLength(3)
    expect(fila().revisoesPendentes).toBe(pendentes + 2)

    // The core states the refusal with the key from 219, whether it is the cap or a non-suspended account.
    const origem = origemDoServidorDe(gil.address)
    await expect(pedirRevisao(origem, gil as unknown as Identity, "Quinta nota.")).rejects.toThrow(
      "the server did not take the review request",
    )
    servidor.enclave.store.levantar(gil.address)
    await expect(pedirRevisao(origem, gil as unknown as Identity, "Já não estou suspenso.")).rejects.toThrow(
      "the server did not take the review request",
    )
  }, 60_000)
})
