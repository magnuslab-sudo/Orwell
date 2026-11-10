import {
  aparelhosSemORevogado,
  fromBase64,
  signDeviceManifest,
  signDeviceRevocation,
  toBase64,
  verifyDeviceRevocation,
  type DeviceManifest,
  type DeviceManifestWire,
  type Payload,
  type UserAddress,
} from "@enclave/protocol"

/**
 * Revoke a device from this account (docs/PLANO_MULTIDISPOSITIVO.md §4; phase 5 plan,
 * section B).
 *
 * **The gesture, in this order:**
 *
 * 1. Publish the next manifest without the device, signed by the account key, with the device
 *    in the frame `revoke` list. The server revokes only what leaves the manifest AND appears
 *    in that list (`aparelhosRevogados`): the device does not join, does not complain or
 *    publish key packages, its packets leave the bundle, and no manifest puts it back
 *    (`CAPACIDADE_REVOGACAO`). Without the list, leaving the manifest is not revocation.
 * 2. Store the revocation in the vault (`revokedDevices`), so the gates for this device
 *    (`#pacotesAdmissiveis`, `#admit`) reject it if it reappears.
 * 3. In each channel of the account: remove the device's leaf in a commit (`removeMembers`
 *    with UpdatePath, which the patch to `ts-mls` guarantees), and send `device.revoke`
 *    signed by the account key, so other members also reject it.
 *
 * **Honesty, which the interface must enforce:** revoking cuts reading from the next epoch on.
 * What the device already had, it keeps.
 *
 * **Resumable.** The revoked device goes into the vault BEFORE the manifest leaves, and comes
 * out if the server refuses it for a reason (I3 of the revision of slot 1). With no response
 * it stays: the server may have accepted, and retry must know the revocation is from this
 * account. A device already out of the manifest and in the vault as revoked does not publish
 * manifest again: the gesture moves on to channels. Channels already notified stay in the vault
 * (`canaisAvisados`), and retry does not send them another `device.revoke`; the leaf is
 * tried on all, because removing it from where it already left costs no commit. A revocation
 * that failed midway (network, a channel that refused the commit) retries this way at no cost,
 * and that is how it repairs itself.
 *
 * **Only a device with the account key revokes.** A paired device does not have it, and that
 * is what stops a stolen phone from revoking its siblings and staying alone to speak for the person.
 *
 * This module does not know `Session`. It speaks to it through `SessaoParaRevogar`, which is
 * the minimum revocation needs, so it can be proven without a relay.
 */

/** What revocation needs from the session, and nothing more. */
export interface SessaoParaRevogar {
  readonly address: UserAddress
  /** The ACCOUNT private key, if this device has it. */
  readonly chaveDeConta: Uint8Array | undefined
  /** The public key of THIS device. Does not revoke itself. */
  readonly chaveDesteAparelho: Uint8Array
  /** The server announces `CAPACIDADE_REVOGACAO`. */
  readonly servidorRevoga: boolean
  /** "Did not read" and "does not exist" are different things: see `#lerManifesto` in the session. */
  lerManifestoProprio(): Promise<{ lido: true; manifesto: DeviceManifest | null } | { lido: false }>
  /** The highest version this vault has ever seen of this account's own manifest. */
  versaoVista(): number | undefined
  /**
   * Publish and wait for the verdict. `revogar` goes in the `revoke` list of
   * `manifest.publish`. Whoever implements this stores the accepted version in the vault.
   */
  publicarManifesto(wire: DeviceManifestWire, revogar: readonly string[]): Promise<{ ok: true } | { ok: false; reason: string }>
  /** The channels where this account is. */
  canais(): readonly string[]
  /** Remove this device's leaf from the channel, in a commit. `false` if it was not there. */
  tirarFolha(canal: string, aparelho: Uint8Array): Promise<boolean>
  enviar(canal: string, payload: Payload): Promise<void>
  /** Save to the vault, right now (not in the next batch). */
  lembrarRevogado(aparelho: string): Promise<void>
  /** Remove from the vault: the server refused the manifest, and revocation did not happen. */
  esquecerRevogado(aparelho: string): Promise<void>
  /** Whether the vault already has this device of this account as revoked. */
  jaRevogado(aparelho: string): boolean
  /** The channels where the `device.revoke` of this device has already been sent. */
  canaisAvisados(aparelho: string): readonly string[]
  /** Save to the vault that this channel has been notified. */
  lembrarAvisado(aparelho: string, canal: string): Promise<void>
}

/** What happened in each channel. A failure in one does not stop the others. */
export interface RelatorioDeRevogacao {
  /** The version of the manifest just published, or `null` if it was already published (resume). */
  readonly versao: number | null
  /** Channels where the sheet just went out. */
  readonly tirada: readonly string[]
  /** Channels where `device.revoke` was sent just now (ones from an earlier pass don't count). */
  readonly avisados: readonly string[]
  /** Channels where either thing failed, with the message. */
  readonly falhas: readonly { readonly canal: string; readonly erro: string }[]
}

type RevogacaoPayload = Extract<Payload, { t: "device.revoke" }>

/**
 * The failed channels, each one once. A channel can fail twice in the same pass
 * (the sheet and the notice), and the phrase in 747 counts channels.
 */
export function canaisComFalha(relatorio: Pick<RelatorioDeRevogacao, "falhas">): string[] {
  return [...new Set(relatorio.falhas.map((falha) => falha.canal))]
}

/**
 * The reason for `publicarManifesto` when the server did not respond. It is the only one
 * where the manifest MAY have been accepted, so the only one that does not undo the
 * mark in the vault.
 */
export const SEM_RESPOSTA = "no-answer"

/** Ed25519 public keys: 43 base64url characters, 32 bytes. */
function chaveDeAparelho(texto: string): Uint8Array {
  let bytes: Uint8Array
  try {
    bytes = /^[A-Za-z0-9_-]{43}$/.test(texto) ? fromBase64(texto) : new Uint8Array()
  } catch {
    bytes = new Uint8Array()
  }
  if (bytes.length !== 32) throw new Error("device-key-invalid", { cause: { device: texto } })
  return bytes
}

/**
 * The `device.revoke` payload, signed by the account key.
 *
 * The signature covers the device and the account address (`deviceRevocationMessage`),
 * not `revokedAt`: repeating a revocation changes nothing.
 */
export function payloadDeRevogacao(
  chaveDeConta: Uint8Array,
  address: UserAddress,
  aparelho: Uint8Array,
  agora: number,
): RevogacaoPayload {
  return {
    t: "device.revoke",
    device: toBase64(aparelho),
    revokedAt: agora,
    sig: toBase64(signDeviceRevocation(chaveDeConta, aparelho, address)),
  }
}

/**
 * Judge a `device.revoke` that arrived on a channel.
 *
 * What decides is the ACCOUNT key of who sent it, read from the credential of the
 * sending sheet (MLS authenticates the sheet, and the sheet carries the chain). Without it,
 * or with a signature that does not check out, it does not count: MLS says which device it came from,
 * and a device alone cannot revoke its siblings. Returns, never throws.
 */
export function lerRevogacao(
  payload: RevogacaoPayload,
  remetente: UserAddress,
  chaveDeContaDoRemetente: Uint8Array | undefined,
): { ok: true; aparelho: string } | { ok: false; razao: "no-account-key" | "bad-device-key" | "bad-signature" } {
  if (chaveDeContaDoRemetente === undefined) return { ok: false, razao: "no-account-key" }
  let aparelho: Uint8Array
  let assinatura: Uint8Array
  try {
    aparelho = chaveDeAparelho(payload.device)
    assinatura = fromBase64(payload.sig)
  } catch {
    return { ok: false, razao: "bad-device-key" }
  }
  if (!verifyDeviceRevocation(chaveDeContaDoRemetente, aparelho, remetente, assinatura)) {
    return { ok: false, razao: "bad-signature" }
  }
  return { ok: true, aparelho: payload.device }
}

/**
 * Revoke `device` (public key in base64url) in this account.
 *
 * Throws, with a stable English key and data in `cause`, when nothing was done:
 * `device-revoke-no-account-key`, `device-revoke-unsupported`,
 * `device-key-invalid`, `device-revoke-self`, `device-revoke-manifest-unread`,
 * `device-not-in-manifest`, `device-revoke-manifest-refused` (with `reason`
 * in `cause`; with `no-answer`, the vault keeps the revoked device for retry to resume).
 * After the manifest goes out, does not throw: returns the report, with failures per channel,
 * and the caller decides (the session throws `device-revoke-incomplete`).
 */
export async function revogarAparelho(
  sessao: SessaoParaRevogar,
  aparelho: string,
  agora: number = Date.now(),
): Promise<RelatorioDeRevogacao> {
  const chaveDeConta = sessao.chaveDeConta
  if (chaveDeConta === undefined) throw new Error("device-revoke-no-account-key")
  if (!sessao.servidorRevoga) throw new Error("device-revoke-unsupported")
  const chave = chaveDeAparelho(aparelho)
  if (toBase64(chave) === toBase64(sessao.chaveDesteAparelho)) {
    throw new Error("device-revoke-self", { cause: { device: aparelho } })
  }

  const leitura = await sessao.lerManifestoProprio()
  if (!leitura.lido) throw new Error("device-revoke-manifest-unread")
  const existente = leitura.manifesto
  const naLista = existente !== null && existente.devices.some((device) => toBase64(device.deviceKey) === aparelho)

  let versao: number | null = null
  const jaNoCofre = sessao.jaRevogado(aparelho)
  if (naLista) {
    // `aparelhosSemORevogado` refuses itself again, because it is the rule of the
    // manifest and not just of this function.
    const devices = aparelhosSemORevogado(existente.devices, chave, sessao.chaveDesteAparelho)
    versao = Math.max(sessao.versaoVista() ?? 0, existente.version) + 1
    // The mark before the manifest (I3): between the server accepting and the vault
    // saving, a failure left the device out of the manifest and out of the vault,
    // and retry threw `device-not-in-manifest` with the sheets on the channels.
    if (!jaNoCofre) await sessao.lembrarRevogado(aparelho)
    const resposta = await sessao.publicarManifesto(
      signDeviceManifest(chaveDeConta, {
        address: sessao.address,
        version: versao,
        devices,
        signedAt: Math.floor(agora / 1000),
      }),
      [aparelho],
    )
    if (!resposta.ok) {
      // Refused with reason: it did not happen, and the vault goes back to what it was. No answer,
      // it may have happened: the mark stays, and retry decides.
      if (resposta.reason !== SEM_RESPOSTA && !jaNoCofre) await sessao.esquecerRevogado(aparelho)
      throw new Error("device-revoke-manifest-refused", { cause: { reason: resposta.reason, version: versao } })
    }
  } else if (!jaNoCofre) {
    // Neither in the manifest nor in the vault: not from this account, or never was there.
    throw new Error("device-not-in-manifest", { cause: { device: aparelho } })
  }

  const payload = payloadDeRevogacao(chaveDeConta, sessao.address, chave, agora)
  const jaAvisados = new Set(sessao.canaisAvisados(aparelho))
  const tirada: string[] = []
  const avisados: string[] = []
  const falhas: { canal: string; erro: string }[] = []
  for (const canal of sessao.canais()) {
    // The sheet first: that is what cuts off the read. The notice goes next, already in
    // the new epoch, and fails alone without undoing the removal.
    try {
      if (await sessao.tirarFolha(canal, chave)) tirada.push(canal)
    } catch (erro) {
      falhas.push({ canal, erro: erro instanceof Error ? erro.message : String(erro) })
    }
    if (jaAvisados.has(canal)) continue
    try {
      await sessao.enviar(canal, payload)
      avisados.push(canal)
      await sessao.lembrarAvisado(aparelho, canal)
    } catch (erro) {
      falhas.push({ canal, erro: erro instanceof Error ? erro.message : String(erro) })
    }
  }
  return { versao, tirada, avisados, falhas }
}

// ------------------------------------------------------------------- cofre

/**
 * The revocations this vault knows about: by account address, the device keys
 * in base64url. Ones from this account itself (ones this device did) and ones from others
 * (ones that arrived by `device.revoke` on a shared channel).
 *
 * Lives in the vault without being declared in `VaultContents`: the vault's `#adopt`
 * copies what it does not know and returns it unchanged (see `vault.ts`). A vault from
 * a version without this field opens it empty, which is "I know of no revocations",
 * and is no worse than before.
 */
export interface CofreComRevogados {
  revokedDevices?: Record<string, string[]>
}

/** How many accounts the vault remembers. Revoking is rare; the cap guards against garbage. */
export const CONTAS_COM_REVOGADOS = 512
/** How many revoked devices per account. From here on the oldest ones come out. */
export const REVOGADOS_POR_CONTA = 64

/**
 * Store a revocation. Returns `false` if it was already there (nothing to save).
 *
 * Takes `object` not `VaultContents`: the field is not declared there (see
 * `CofreComRevogados`), and so it serves both the vault and a test object.
 */
export function notarRevogado(cofre: object, address: string, aparelho: string): boolean {
  const contents = cofre as CofreComRevogados
  contents.revokedDevices ??= {}
  const lista = contents.revokedDevices[address] ?? []
  if (lista.includes(aparelho)) return false
  // The most recent account goes to the end, and the cut removes ones from the start.
  delete contents.revokedDevices[address]
  contents.revokedDevices[address] = [...lista, aparelho].slice(-REVOGADOS_POR_CONTA)
  for (const antiga of Object.keys(contents.revokedDevices).slice(0, -CONTAS_COM_REVOGADOS)) {
    delete contents.revokedDevices[antiga]
  }
  return true
}

export function estaRevogado(cofre: object, address: string, aparelho: string): boolean {
  return (cofre as CofreComRevogados).revokedDevices?.[address]?.includes(aparelho) === true
}

/**
 * Undo `notarRevogado`: the server refused the manifest that was revoking (I3).
 * Returns `false` if it was not there.
 */
export function esquecerRevogado(cofre: object, address: string, aparelho: string): boolean {
  const revogados = (cofre as CofreComRevogados).revokedDevices
  const lista = revogados?.[address]
  if (revogados === undefined || lista === undefined || !lista.includes(aparelho)) return false
  const resto = lista.filter((chave) => chave !== aparelho)
  if (resto.length > 0) revogados[address] = resto
  else delete revogados[address]
  return true
}

/**
 * The channels where this vault already sent the `device.revoke` for each device it
 * revoked (M6). Only ones from revocations DONE here; by device key, which is unique
 * across accounts. Like `revokedDevices`, lives in the vault without being declared
 * in `VaultContents`.
 */
export interface CofreComAvisos {
  revogacoesAvisadas?: Record<string, string[]>
}

/** How many notified channels are remembered per revoked device. Above that, retry warns the oldest ones again. */
export const AVISOS_POR_REVOGADO = 1024

export function notarAvisado(cofre: object, aparelho: string, canal: string): boolean {
  const contents = cofre as CofreComAvisos
  contents.revogacoesAvisadas ??= {}
  const lista = contents.revogacoesAvisadas[aparelho] ?? []
  if (lista.includes(canal)) return false
  delete contents.revogacoesAvisadas[aparelho]
  contents.revogacoesAvisadas[aparelho] = [...lista, canal].slice(-AVISOS_POR_REVOGADO)
  for (const antigo of Object.keys(contents.revogacoesAvisadas).slice(0, -REVOGADOS_POR_CONTA)) {
    delete contents.revogacoesAvisadas[antigo]
  }
  return true
}

export function canaisAvisados(cofre: object, aparelho: string): readonly string[] {
  return (cofre as CofreComAvisos).revogacoesAvisadas?.[aparelho] ?? []
}
