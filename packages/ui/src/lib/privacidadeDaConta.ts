import { PREFS_EVENT, readPrefs, REGRAS_DE_PEDIDOS, writePrefs, DEFAULT_PREFS, type Prefs, type QuemPodePedir } from "../hooks/usePrefs.js"
import { MARCA_DE_SEMENTE } from "./preferenciasDaConta.js"

/**
 * The two Privacy choices that travel between the account's devices
 * (stage 4): who can request friendship, and whether presence shows.
 *
 * They belong to the PERSON, not the device: whoever says "nobody requests my friendship" on the
 * phone does not want to receive requests on the computer, and whoever hides on one
 * device becomes visible on another if the choice does not travel.
 *
 * **A module separate from `preferenciasDaConta.ts`, with the same rules.** The
 * design is theirs, step by step: apply what the account has, upload as
 * SEED (`MARCA_DE_SEMENTE`) only what was chosen here and the account does not have, and
 * then carry each gesture and bring back each change. It stands apart because that
 * file is at the account's core and is being changed by other hands at the same
 * time; joining the two is a cleanup for later. It connects in the same place
 * (`estadoDaConta.ts`).
 */
export const PRIVACIDADE_QUE_VIAJA = {
  pedidosDeAmizade: "interface.pedidos-de-amizade",
  mostrarOnline: "interface.mostrar-online",
} as const

type Privacidade = Pick<Prefs, "pedidosDeAmizade" | "mostrarOnline">

/** What the account says, read with tolerance. Only the keys that are there and read. */
function daConta(preferencias: Readonly<Record<string, string>>): Partial<Privacidade> {
  const saida: Partial<Privacidade> = {}
  const regra = preferencias[PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade]
  if ((REGRAS_DE_PEDIDOS as readonly unknown[]).includes(regra)) saida.pedidosDeAmizade = regra as QuemPodePedir
  const online = preferencias[PRIVACIDADE_QUE_VIAJA.mostrarOnline]
  if (online === "sim" || online === "nao") saida.mostrarOnline = online === "sim"
  return saida
}

/** What the account says, applied to this device. Only writes when something changes. */
export function aplicarPrivacidadeDaConta(preferencias: Readonly<Record<string, string>>): void {
  const actuais = readPrefs()
  const novas = { ...actuais, ...daConta(preferencias) }
  if (novas.pedidosDeAmizade !== actuais.pedidosDeAmizade || novas.mostrarOnline !== actuais.mostrarOnline) {
    writePrefs(novas)
  }
}

/** Link privacy to the account. The same contract as `ligarPreferenciasDaConta`. Returns how to disconnect. */
export function ligarPrivacidadeDaConta(
  ler: () => { readonly preferencias: Readonly<Record<string, string>> },
  aoMudar: (ouvinte: () => void) => () => void,
  definir: (chave: string, valor: string, at?: number) => void,
  { semear = true }: { semear?: boolean } = {},
): () => void {
  const naConta = ler().preferencias
  aplicarPrivacidadeDaConta(naConta)

  // Chosen here before the account knows: uploads as seed, and only what
  // differs from the factory (a new device does not erase the choice of a sibling).
  if (semear) {
    const locais = readPrefs()
    if (
      naConta[PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade] === undefined &&
      locais.pedidosDeAmizade !== DEFAULT_PREFS.pedidosDeAmizade
    ) {
      definir(PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade, locais.pedidosDeAmizade, MARCA_DE_SEMENTE)
    }
    if (naConta[PRIVACIDADE_QUE_VIAJA.mostrarOnline] === undefined && locais.mostrarOnline !== DEFAULT_PREFS.mostrarOnline) {
      definir(PRIVACIDADE_QUE_VIAJA.mostrarOnline, locais.mostrarOnline ? "sim" : "nao", MARCA_DE_SEMENTE)
    }
  }

  let vistas = ler().preferencias
  const largarConta = aoMudar(() => {
    const agora = ler().preferencias
    if (agora === vistas) return
    vistas = agora
    aplicarPrivacidadeDaConta(agora)
  })

  /*
    The gesture writes to `usePrefs`, and from here it uploads. Only what differs from what the
    account already has uploads: what the account just brought also passes through this event,
    and cannot go back there as a new choice.
  */
  const aoMudarPrefs = (): void => {
    const locais = readPrefs()
    const conta = daConta(ler().preferencias)
    if (locais.pedidosDeAmizade !== (conta.pedidosDeAmizade ?? DEFAULT_PREFS.pedidosDeAmizade)) {
      definir(PRIVACIDADE_QUE_VIAJA.pedidosDeAmizade, locais.pedidosDeAmizade)
    }
    if (locais.mostrarOnline !== (conta.mostrarOnline ?? DEFAULT_PREFS.mostrarOnline)) {
      definir(PRIVACIDADE_QUE_VIAJA.mostrarOnline, locais.mostrarOnline ? "sim" : "nao")
    }
  }
  if (typeof window !== "undefined") window.addEventListener(PREFS_EVENT, aoMudarPrefs)

  return () => {
    largarConta()
    if (typeof window !== "undefined") window.removeEventListener(PREFS_EVENT, aoMudarPrefs)
  }
}
