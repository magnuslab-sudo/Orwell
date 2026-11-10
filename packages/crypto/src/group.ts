import {
  decodeDeviceCredential,
  decodePayload,
  EXTENSAO_PERMISSOES,
  EXTENSAO_RETRATO,
  encodeDeviceCredential,
  encodePayload,
  verifyDeviceChain,
  type DeviceCredential,
  type Identity,
  type Payload,
  type UserAddress,
} from "@enclave/protocol"
import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup,
  createGroupInfoWithExternalPubAndRatchetTree,
  decodeGroupState,
  decodeMlsMessage,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  joinGroupExternal,
  joinGroupWithExtensions,
  makePskIndex,
  processMessage,
  type CiphersuiteImpl,
  type ClientState,
  type Credential,
  type Extension,
  type KeyPackage,
  type MLSMessage,
  type PrivateKeyPackage,
  type Proposal,
  type PublicMessage,
} from "ts-mls"
import type { FramedContent } from "ts-mls"
import { unprotectPrivateMessage } from "ts-mls/messageProtection.js"
import { unprotectPublicMessage } from "ts-mls/messageProtectionPublic.js"
import {
  accountKeyAtLeaf,
  addressAtLeaf,
  deviceKeyAtLeaf,
  leafIndexOf,
  leavesOf,
  openApplicationMessage,
} from "./sender.js"
import { enclaveCapabilities, enclaveClientConfig, loadSuite } from "./suite.js"

/**
 * One channel == one MLS group.
 *
 * Sharing a single group across a whole space would be cheaper, but it would
 * mean a member of #general holds the keys to #moderators. Per-channel groups
 * make "who can read this" a cryptographic fact rather than a server-side ACL
 * that a compromised server can rewrite.
 */

export interface GroupSession {
  readonly channel: string
  state: ClientState
  readonly suite: CiphersuiteImpl
}

/**
 * The leaf credential: the entire chain, not just the address in text.
 *
 * Before it held just the address, and whoever validated would recompute the digest
 * against the key that signed the leaf. Now it carries the chain, address, account key,
 * device key, account signature, because the leaf is now signed by the device and
 * the address must remain the digest of the account. It travels here, not in a separate
 * payload, because the leaf is the only state that all members already share and already
 * validate: whoever joins mid-way receives the entire tree and validates each leaf,
 * without needing to have seen anything happen.
 */
function credentialFor(identity: Identity): Credential {
  return { credentialType: "basic", identity: encodeDeviceCredential(identity.credential) }
}

/**
 * MLS wants its own signature keypair per leaf. It is the DEVICE key that signs it:
 * a leaf is a machine, and it is the machine that gets revoked when it is lost. The
 * binding to the address is not lost for that, it goes in the credential, in
 * `credentialFor`, and `addressBindingAuthService` verifies it link by link.
 */
function signatureKeyPair(identity: Identity): { signKey: Uint8Array; publicKey: Uint8Array } {
  return { signKey: identity.deviceSigningPrivateKey, publicKey: identity.deviceSigningPublicKey }
}

export interface GeneratedKeyPackage {
  publicPackage: KeyPackage
  privatePackage: PrivateKeyPackage
  /** Serialised form to hand to the homeserver for others to claim. */
  wire: Uint8Array
}

/**
 * KeyPackages are single-use by design: reusing one across two joins re-derives
 * the same init secret and destroys forward secrecy for both. The client keeps a
 * pool topped up and the server hands each out exactly once.
 */
export async function generateKeyPackages(identity: Identity, count: number): Promise<GeneratedKeyPackage[]> {
  const suite = await loadSuite()
  const results: GeneratedKeyPackage[] = []
  for (let i = 0; i < count; i++) {
    const generated = await generateKeyPackageWithKey(
      credentialFor(identity),
      enclaveCapabilities(),
      defaultLifetime,
      [],
      signatureKeyPair(identity),
      suite,
    )
    results.push({
      publicPackage: generated.publicPackage,
      privatePackage: generated.privatePackage,
      wire: encodeMlsMessage({ version: "mls10", wireformat: "mls_key_package", keyPackage: generated.publicPackage }),
    })
  }
  return results
}

/** Create a brand-new channel with only ourselves in it. */
export async function createChannel(identity: Identity, channel: string): Promise<GroupSession> {
  const suite = await loadSuite()
  const [seed] = await generateKeyPackages(identity, 1)
  if (!seed) throw new Error("failed to generate the founding key package")

  const state = await createGroup(
    new TextEncoder().encode(channel),
    seed.publicPackage,
    seed.privatePackage,
    [],
    suite,
    enclaveClientConfig(),
  )
  return { channel, state, suite }
}

export interface AddMembersResult {
  session: GroupSession
  /** Broadcast to the channel: everyone applies it to reach the new epoch. */
  commit: Uint8Array
  /** Send only to the joining members. */
  welcome: Uint8Array
}

/**
 * Add members and advance the epoch.
 *
 * The commit rekeys the group, which is what gives post-compromise security: a
 * device compromised before this commit cannot read anything after it.
 */
export async function addMembers(
  session: GroupSession,
  keyPackages: KeyPackage[],
  opcoes: { retrato?: Uint8Array } = {},
): Promise<AddMembersResult> {
  const proposals: Proposal[] = keyPackages.map((keyPackage) => ({ proposalType: "add", add: { keyPackage } }))

  /*
    The channel snapshot (phase 1 of 1.1) goes in the `GroupInfo` of the Welcome, which only
    the joiner decrypts (RFC 9420 §12.4.3.1). It does not go in the group context: there it would
    be state for everyone, and a 1.0.x client's `joinGroup` would reject a Welcome
    with a context extension that its leaf does not declare. In the `GroupInfo`,
    it drops it without noticing.
  */
  const groupInfoExtensions: Extension[] = opcoes.retrato ? [{ extensionType: EXTENSAO_RETRATO, extensionData: opcoes.retrato }] : []
  const result = await createCommit(
    { state: session.state, cipherSuite: session.suite, pskIndex: makePskIndex(session.state, {}) },
    { extraProposals: proposals, ratchetTreeExtension: true, groupInfoExtensions },
  )
  if (!result.welcome) throw new Error("commit added members but produced no welcome")

  return {
    session: { ...session, state: result.newState },
    commit: encodeMlsMessage(result.commit),
    welcome: encodeMlsMessage({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome }),
  }
}

export interface RemoveMembersResult {
  session: GroupSession
  /**
   * Broadcast ALL of these, in order.
   *
   * A removal is today a single commit, but the shape remains a list: whoever
   * broadcasts does not need to know how many there are, and a future operation that needs
   * two does not force changes to whoever carries it.
   */
  commits: Uint8Array[]
}

/**
 * Remove members and advance the epoch.
 *
 * After this commit the removed member holds keys for past epochs only. That is
 * the honest guarantee: a ban stops future reads, it does not retroactively
 * unsend what they already have.
 *
 * A single commit, and that is the whole point of this function.
 *
 * A commit that removes somebody MUST carry an UpdatePath, RFC 9420 §12.4, with
 * the table in §12.1 marking `remove` as *path required*. That path is what
 * denies the removed member the next epoch: the secrets are sealed to the tree
 * resolution, which no longer includes their leaf. Without a path, the commit secret is zero, the
 * secret of the new epoch derives from the old one, and the old one is precisely what the
 * removed member has.
 *
 * `ts-mls` 1.6.2 only required a path from TWO removals onwards, an off-by-one error in
 * `clientState.js` (`Object.values(grouped.remove).length > 1`), and so a
 * single removal, which is all expulsion and all broken friendship, went out
 * without a path. It is fixed in `patches/ts-mls+1.6.2.patch`, where it says
 * why the version was not bumped.
 *
 * The earlier fix, remove without a path and advance the epoch next, closed
 * the end but left the middle open: the intermediate epoch derived from the previous one, which
 * the removed member has, so any third party encrypting there would deliver the
 * message to them. The server just had to deliver the first commit and hold the second, and
 * not even a symptom appeared: whoever was stuck decrypted perfectly. See the prefix
 * test in `group.test.ts`.
 */
export async function removeMembers(session: GroupSession, leafIndices: number[]): Promise<RemoveMembersResult> {
  const proposals: Proposal[] = leafIndices.map((removed) => ({ proposalType: "remove", remove: { removed } }))

  const result = await createCommit(
    { state: session.state, cipherSuite: session.suite, pskIndex: makePskIndex(session.state, {}) },
    { extraProposals: proposals, ratchetTreeExtension: true },
  )
  if (!rotatedOwnLeafKey(session.state, result.newState)) {
    // The commit comes out encrypted, so the path is not readable from outside, but it
    // leaves a mark in our own state: only whoever creates an UpdatePath swaps
    // their leaf's private key. It is the available proof, and it acts as a brake on a
    // patch lost in a badly run `npm install`: better for expulsion to fail
    // in front of our eyes than to go out without a path and lie to whoever hit the button.
    throw new Error("remoção sem UpdatePath: o remendo em patches/ts-mls+1.6.2.patch não está aplicado")
  }
  return { session: { ...session, state: result.newState }, commits: [encodeMlsMessage(result.commit)] }
}

/** If a commit renewed our leaf's private key, see `removeMembers`. */
function rotatedOwnLeafKey(before: ClientState, after: ClientState): boolean {
  const ownNode = after.privatePath.leafIndex * 2
  const antes = before.privatePath.privateKeys[ownNode]
  const depois = after.privatePath.privateKeys[ownNode]
  if (!depois) return false
  if (!antes) return true
  return antes.length !== depois.length || antes.some((byte, i) => byte !== depois[i])
}

/**
 * Rekey without changing membership.
 *
 * Run periodically and after any suspected compromise. It is the only mechanism
 * that heals a group whose member's device was silently read: past keys stop
 * working from the next epoch on.
 */
export async function rotateEpoch(session: GroupSession): Promise<RemoveMembersResult> {
  const result = await createCommit(
    { state: session.state, cipherSuite: session.suite, pskIndex: makePskIndex(session.state, {}) },
    { ratchetTreeExtension: true },
  )
  // A commit with no proposals always carries an UpdatePath, it is the only way the
  // library guarantees it, and that is why `removeMembers` relies on it.
  return { session: { ...session, state: result.newState }, commits: [encodeMlsMessage(result.commit)] }
}

/** Join a channel from a Welcome produced by an existing member. */
export async function joinChannel(
  channel: string,
  welcomeBytes: Uint8Array,
  keyPackage: KeyPackage,
  privatePackage: PrivateKeyPackage,
): Promise<GroupSession> {
  return (await joinChannelComExtensoes(channel, welcomeBytes, keyPackage, privatePackage)).session
}

export interface EntradaPorWelcome {
  session: GroupSession
  /** The extensions of the `GroupInfo` in the Welcome. See `retratoDasExtensoes`. */
  extensoes: Extension[]
}

/**
 * Join via Welcome and get the `GroupInfo` extensions, which carry the
 * channel snapshot (phase 1 of 1.1).
 *
 * `joinGroupWithExtensions` is the same path as `joinGroup` (ts-mls 1.6.2's `joinGroup`
 * calls it and drops the second half): the same tree validation, with the patch from
 * `patches/ts-mls+1.6.2.patch` (RFC 9420 §12.4.3.1), the same credential, the same
 * `GroupInfo` signature and the same confirmation tag. Proved in `group.unmerged.test.ts`.
 */
export async function joinChannelComExtensoes(
  channel: string,
  welcomeBytes: Uint8Array,
  keyPackage: KeyPackage,
  privatePackage: PrivateKeyPackage,
): Promise<EntradaPorWelcome> {
  const suite = await loadSuite()
  const decoded = decodeMlsMessage(welcomeBytes, 0)
  if (!decoded) throw new Error("welcome message is malformed")

  const [message] = decoded
  if (message.wireformat !== "mls_welcome") throw new Error(`expected a welcome, got ${message.wireformat}`)

  const [state, extensoes] = await joinGroupWithExtensions(
    message.welcome,
    keyPackage,
    privatePackage,
    emptyPskIndex,
    suite,
    undefined,
    undefined,
    enclaveClientConfig(),
  )
  return { session: { channel, state, suite }, extensoes }
}

/** The bytes of the snapshot in the extensions of a Welcome, or `null` if there are none (Welcome from a 1.0.x client). */
export function retratoDasExtensoes(extensoes: readonly Extension[]): Uint8Array | null {
  const retrato = extensoes.find((extensao) => extensao.extensionType === EXTENSAO_RETRATO)
  return retrato ? retrato.extensionData : null
}

/** Whether the leaf of this key package reads the snapshot from the Welcome (declares `EXTENSAO_RETRATO`). */
export function declaraRetrato(keyPackage: KeyPackage): boolean {
  return keyPackage.leafNode.capabilities.extensions.includes(EXTENSAO_RETRATO)
}

/** Whether the leaf of this key package reads the 1.2 permission model (declares `EXTENSAO_PERMISSOES`). */
export function declaraPermissoes(keyPackage: KeyPackage): boolean {
  return keyPackage.leafNode.capabilities.extensions.includes(EXTENSAO_PERMISSOES)
}

/**
 * The entry card of a channel: whoever has it can join on their own.
 *
 * It is a `GroupInfo` with two things inside: the external initiation public key
 * (`external_pub`) and the entire tree. With them, whoever arrives builds a
 * commit that adds themselves and joins the group without being invited, without a Welcome,
 * and without waiting for anyone. It is the mechanism from RFC 9420 §12.4.3.2, and it
 * exists precisely for the case we had to solve here: a public room where whoever signs up
 * at midnight cannot be left out just because there is no one awake to open the door.
 *
 * **This is a door key, and we treat it as such.** Publishing the card of a private
 * channel would open it to anyone who got their hands on it: there is no invite to validate,
 * they join themselves. So the card is only published for the channel the server announces as public,
 * the server only keeps it and only delivers it for that one, and each of those guards is
 * written on its side.
 *
 * What the card reveals to whoever reads it: who the members are and the public keys
 * of their leaves. On a channel open to any account on the server that is little more than what
 * subscriptions already say. What it does NOT reveal is a single word of what was said inside:
 * the application keys do not live in the `GroupInfo`, and whoever joins by this door
 * starts reading the moment they join, exactly like whoever joins via Welcome.
 *
 * It is good for a single epoch only. As soon as the channel advances, this card stops working
 * and whoever enters with it is rejected, that is why whoever joins publishes the next one right away.
 */
export async function publishableGroupInfo(session: GroupSession): Promise<Uint8Array> {
  const info = await createGroupInfoWithExternalPubAndRatchetTree(session.state, [], session.suite)
  return encodeMlsMessage({ version: "mls10", wireformat: "mls_group_info", groupInfo: info })
}

export interface ExternalJoinResult {
  session: GroupSession
  /**
   * Broadcast on the channel, like any other commit.
   *
   * It goes in `mls_public_message` and not private, because whoever signs it is not
   * yet a member: they have no epoch keys to encrypt it with. It is the only message
   * of this product that goes in clear, and what it contains is what the
   * tree is going to have in view of all members anyway.
   */
  commit: Uint8Array
  /**
   * Whether this join led to removal of our old leaf. See `joinChannelExternally`.
   *
   * Reported to the caller because it is diagnosis that matters: it means this
   * device was already in the tree, so it left the room without exiting it.
   */
  resync: boolean
}

/**
 * Join a channel by the front door, with no invite and no one on the other side.
 *
 * Two checks before anything, and neither is formality:
 *
 * - the card must be a `GroupInfo`, and not some other frame that
 *   the server decided to deliver in its place;
 * - the group it describes must be THIS channel. Without this, a hostile server
 *   would answer the public channel request with the card of another channel, and
 *   whoever arrived would join in good faith a place they never asked for, and end up
 *   inside in sight of everyone.
 *
 * The rest of the distrust is in the library and it does it: `joinGroupExternal`
 * validates the tree against the `tree_hash` in the context, validates the credential of whoever
 * signed the card via the `authService` (which here is what binds the address to
 * the key, see `suite.ts`) and checks the card's own signature. A card
 * forged by someone who is not a member does not pass any of the three.
 *
 * **Whoever comes back with the same device carries the old leaf with them** (`resync`, RFC
 * 9420 §12.4.3.2). Forgetting the room on this device does not remove it from the tree, and the
 * library accepts a new leaf with a signature key that is already
 * elsewhere: it only compares leaves with each other when it validates an entire tree. A
 * tree with two identical leaves would then be rejected to EVERYONE after that
 * ("signature keys not unique"): no card would open and no Add would pass. That is how
 * the public room closed on 12/9/2026.
 *
 * The question is asked to the tree that the library built itself, not to our
 * own reading of the card: if there is another leaf there with this device's key,
 * we repeat with `resync`, which removes it in the same commit. It costs a second round
 * only for whoever returns. Another device on the same account has another key and keeps
 * its own leaf, as it always has.
 */
export async function joinChannelExternally(
  channel: string,
  groupInfoBytes: Uint8Array,
  keyPackage: KeyPackage,
  privatePackage: PrivateKeyPackage,
): Promise<ExternalJoinResult> {
  const suite = await loadSuite()
  const decoded = decodeMlsMessage(groupInfoBytes, 0)
  if (!decoded) throw new Error("group info is malformed")

  const [message] = decoded
  if (message.wireformat !== "mls_group_info") throw new Error(`expected group info, got ${message.wireformat}`)

  const groupId = new TextDecoder().decode(message.groupInfo.groupContext.groupId)
  if (groupId !== channel) throw new Error(`group info is for ${groupId}, not ${channel}`)

  const entrar = (resync: boolean) =>
    joinGroupExternal(message.groupInfo, keyPackage, privatePackage, resync, suite, undefined, enclaveClientConfig())

  let entrada = await entrar(false)
  const resync = outraFolhaComAChave(entrada.newState, keyPackage.leafNode.signaturePublicKey)
  if (resync) entrada = await entrar(true)

  return {
    session: { channel, state: entrada.newState, suite },
    commit: encodeMlsMessage({ version: "mls10", wireformat: "mls_public_message", publicMessage: entrada.publicMessage }),
    resync,
  }
}

/** Is there, besides ours, a leaf signed by this key? */
function outraFolhaComAChave(state: ClientState, chave: Uint8Array): boolean {
  const nossa = state.privatePath.leafIndex
  const arvore = state.ratchetTree
  for (let folha = 0; folha * 2 < arvore.length; folha++) {
    if (folha === nossa) continue
    const no = arvore[folha * 2]
    if (no?.nodeType !== "leaf") continue
    const outra = no.leaf.signaturePublicKey
    if (outra.length === chave.length && outra.every((byte, i) => byte === chave[i])) return true
  }
  return false
}

export interface SendResult {
  session: GroupSession
  ciphertext: Uint8Array
}

export async function encryptPayload(session: GroupSession, payload: Payload): Promise<SendResult> {
  const result = await createApplicationMessage(session.state, encodePayload(payload), session.suite)
  return {
    session: { ...session, state: result.newState },
    ciphertext: encodeMlsMessage({
      version: "mls10",
      wireformat: "mls_private_message",
      privateMessage: result.privateMessage,
    }),
  }
}

export type IncomingResult =
  | {
      kind: "payload"
      session: GroupSession
      payload: Payload
      sender: UserAddress
      /**
       * The leaf this came from, and the device key that signed it.
       *
       * `sender` is the PERSON and is what almost everything wants: who wrote it, who has
       * role, who founded. These two say which MACHINE of theirs it came from, and they exist
       * because of a payload that cannot be judged without them, the
       * `device.revoke`, where the question "who is revoking whom" is between
       * devices of the same account and the address is the same on both sides.
       *
       * They came already verified by MLS and were dropped here. See the
       * header of `openApplicationMessage`: the leaf travels signed inside the
       * `sender_data`, so this is protocol attribution and not a
       * declaration by the sender.
       */
      senderLeaf: number
      senderDeviceKey: Uint8Array
      /**
       * The account key from the credential of that leaf, read from the tree of the
       * message's epoch (the same as `sender`). `undefined` in a credential without it.
       */
      senderAccountKey: Uint8Array | undefined
    }
  | { kind: "epoch"; session: GroupSession; epoch: bigint }
  | {
      kind: "ignored"
      session: GroupSession
      reason: string
      /**
       * The epoch that the frame itself declares, when the frame gets read.
       *
       * It is not decoration: it is what separates two refusals that look the same and are not
       * the same thing. A frame from an EARLIER epoch than ours will never open,        * it is the history said before we joined, and forward secrecy
       * makes sure it stays that way. A frame from a LATER epoch is the opposite:
       * the channel moved on without us, and that is deafness.
       *
       * `undefined` when we did not even read the header (garbage, wireformat we do not process):
       * then we do not know, and we do not pretend we know.
       */
      epochDoFrame?: bigint | undefined
    }

/** The epoch declared in the frame header, without opening anything. */
function epochDeclarada(message: MLSMessage): bigint | undefined {
  if (message.wireformat === "mls_private_message") return message.privateMessage.epoch
  if (message.wireformat === "mls_public_message") return message.publicMessage.content.epoch
  if (message.wireformat === "mls_group_info") return message.groupInfo.groupContext.epoch
  return undefined
}

/**
 * The epoch that some MLS bytes declare in clear: private message, public message or card.
 *
 * It is what a server that cannot decrypt anything can read, and it is what the rule of
 * one commit per epoch uses. `undefined` for what does not even have a header.
 */
export function declaredEpoch(bytes: Uint8Array): bigint | undefined {
  let decoded
  try {
    decoded = decodeMlsMessage(bytes, 0)
  } catch {
    return undefined
  }
  return decoded ? epochDeclarada(decoded[0]) : undefined
}

/**
 * Decrypt and apply one inbound frame.
 *
 * A failure here is never fatal to the session — a hostile or buggy server can
 * inject garbage at will, and the correct response is to drop that frame and
 * keep the group state untouched, not to tear down the channel.
 */
export async function receive(session: GroupSession, ciphertext: Uint8Array): Promise<IncomingResult> {
  const decoded = decodeMlsMessage(ciphertext, 0)
  if (!decoded) return { kind: "ignored", session, reason: "malformed MLS frame" }

  const [message] = decoded
  if (message.wireformat !== "mls_private_message" && message.wireformat !== "mls_public_message") {
    return { kind: "ignored", session, reason: `unroutable wireformat ${message.wireformat}` }
  }
  const epochDoFrame = epochDeclarada(message)

  // Application messages take the sender-preserving path; handshake traffic goes
  // through ts-mls's own state machine, which already reports the committer.
  if (message.wireformat === "mls_private_message") {
    let opened
    try {
      opened = await openApplicationMessage(session.state, message.privateMessage, session.suite)
    } catch (error) {
      return { kind: "ignored", session, reason: `rejected: ${(error as Error).message}`, epochDoFrame }
    }

    if (opened) {
      const next: GroupSession = { ...session, state: opened.newState }
      // In the tree of the message's epoch, not the current one: see `senderTree`.
      const sender = addressAtLeaf(opened.senderTree, opened.senderLeafIndex)
      const senderDeviceKey = deviceKeyAtLeaf(opened.senderTree, opened.senderLeafIndex)
      // Both read the SAME chain from the same leaf: either both come out or neither does.
      // The guard is double in the same place, because a payload whose device we could not
      // name would become a `device.revoke` with no revoker.
      if (!sender || !senderDeviceKey) {
        return { kind: "ignored", session: next, reason: "sender leaf has no usable credential", epochDoFrame }
      }

      try {
        return {
          kind: "payload",
          session: next,
          payload: decodePayload(opened.applicationData),
          sender,
          senderLeaf: opened.senderLeafIndex,
          senderDeviceKey,
          senderAccountKey: accountKeyAtLeaf(opened.senderTree, opened.senderLeafIndex),
        }
      } catch (error) {
        return {
          kind: "ignored",
          session: next,
          reason: `undecodable payload: ${(error as Error).message}`,
          epochDoFrame,
        }
      }
    }
  }

  if (message.wireformat === "mls_public_message") {
    const recusa = remocaoIndevidaNumaEntrada(session.state, message.publicMessage)
    if (recusa) return { kind: "ignored", session, reason: `rejected: ${recusa}`, epochDoFrame }
  }

  let result
  try {
    result = await processMessage(message, session.state, makePskIndex(session.state, {}), acceptAll, session.suite)
  } catch (error) {
    if (await tiraANossaFolha(session, message)) {
      return { kind: "ignored", session: marcadaComoRemovida(session), reason: "removed from the group", epochDoFrame }
    }
    return { kind: "ignored", session, reason: `rejected: ${(error as Error).message}`, epochDoFrame }
  }

  const next: GroupSession = { ...session, state: result.newState }
  if (result.kind === "newState") {
    return { kind: "epoch", session: next, epoch: result.newState.groupContext.epoch }
  }
  return { kind: "ignored", session: next, reason: "application message took the fallback path", epochDoFrame }
}

/**
 * Whether this commit, authenticated in our epoch, removes our leaf from the group.
 *
 * The ts-mls library should report it (`groupActiveState: removedFromGroup`), but it only gets
 * there after applying the UpdatePath of the commit, and the path comes encrypted for who
 * STAYS: whoever leaves does not open it, and processing crashes before ("Could not find
 * common ancestor"). Measured on 20/10/2026 (F7 of the sync audit). The
 * result was a zombie channel: in the list, deaf, asking to rejoin whoever had just removed us.
 *
 * So we decide here, with the proofs that ts-mls requires of a member commit,
 * and no other trust: the encryption (or the member tag, in a clear commit) with the keys
 * of this epoch, which the server does not have, and the signature of the leaf of whoever committed
 * (`unprotectPrivateMessage` and `unprotectPublicMessage` verify both). Only then
 * do we read the removal list, by value, looking for our leaf.
 */
async function tiraANossaFolha(session: GroupSession, mensagem: MLSMessage): Promise<boolean> {
  const state = session.state
  let conteudo: FramedContent
  try {
    if (mensagem.wireformat === "mls_private_message") {
      if (mensagem.privateMessage.epoch !== state.groupContext.epoch) return false
      const aberto = await unprotectPrivateMessage(
        state.keySchedule.senderDataSecret,
        mensagem.privateMessage,
        state.secretTree,
        state.ratchetTree,
        state.groupContext,
        state.clientConfig.keyRetentionConfig,
        session.suite,
      )
      conteudo = aberto.content.content
    } else if (mensagem.wireformat === "mls_public_message") {
      if (mensagem.publicMessage.content.epoch !== state.groupContext.epoch) return false
      const aberto = await unprotectPublicMessage(
        state.keySchedule.membershipKey,
        state.groupContext,
        state.ratchetTree,
        mensagem.publicMessage,
        session.suite,
      )
      conteudo = aberto.content
    } else {
      return false
    }
  } catch {
    return false
  }
  if (conteudo.contentType !== "commit" || conteudo.sender.senderType !== "member") return false
  const nossa = state.privatePath.leafIndex
  return conteudo.commit.proposals.some(
    (proposta) => proposta.proposalOrRefType === "proposal" && proposta.proposal.proposalType === "remove" && proposta.proposal.remove.removed === nossa,
  )
}

/**
 * The same group, marked as ts-mls would mark it if it had managed to finish.
 *
 * Only the activity state changes. Whoever reads `groupActiveState` (the core, when
 * deciding to drop the channel) gets one answer only, whether it comes from ts-mls or
 * from here, and a group saved this way stays marked after reopening.
 */
function marcadaComoRemovida(session: GroupSession): GroupSession {
  return { ...session, state: { ...session.state, groupActiveState: { kind: "removedFromGroup" } } }
}

/**
 * An external commit can only remove the old leaf of whoever joins (RFC 9420 §12.4.3.2).
 *
 * The library checks that there is at most one removal, and stops there: an external commit
 * that removed SOMEONE ELSE's leaf would pass and be applied by everyone.
 * Since an external commit is built with the card of the public room, which any account can fetch,
 * that was expelling whoever wanted, the founder included.
 *
 * The rule: the removed leaf must have the same signature key as the new leaf in the
 * commit's path, which is the one of whoever joins and the one the commit signs. That is what
 * `joinChannelExternally` does in the `resync`. And nothing by reference: the RFC does not
 * let an external commit cite proposals that whoever joins could never validate.
 *
 * Checked before the library processes the message, on the clear content. We do not accept
 * anything here, we only refuse, so reading before the signature is verified opens no door.
 *
 * @returns the reason for refusal, or `undefined` if the commit can proceed.
 */
function remocaoIndevidaNumaEntrada(state: ClientState, mensagem: PublicMessage): string | undefined {
  const conteudo = mensagem.content
  if (conteudo.sender.senderType !== "new_member_commit" || conteudo.contentType !== "commit") return undefined
  const { proposals, path } = conteudo.commit
  if (proposals.some((proposta) => proposta.proposalOrRefType === "reference")) {
    return "external commit references proposals"
  }
  const remocoes = proposals.flatMap((proposta) =>
    proposta.proposalOrRefType === "proposal" && proposta.proposal.proposalType === "remove" ? [proposta.proposal.remove.removed] : [],
  )
  if (remocoes.length === 0) return undefined
  if (!path) return "external commit removes a leaf without a path"
  const nova = path.leafNode.signaturePublicKey
  for (const folha of remocoes) {
    const no = state.ratchetTree[folha * 2]
    const antiga = no?.nodeType === "leaf" ? no.leaf.signaturePublicKey : undefined
    if (!antiga || antiga.length !== nova.length || antiga.some((byte, i) => byte !== nova[i])) {
      return `external commit removes leaf ${folha}, which is not the joiner's own`
    }
  }
  return undefined
}

/**
 * The signature public key sitting in a member's leaf of the ratchet tree.
 *
 * The key of the DEVICE that person is speaking from, it is what signs what comes out
 * of it. It serves to verify a particular device; it does not serve for safety numbers,
 * and that is why `memberAccountKey` exists alongside it.
 */
export function memberSigningKey(session: GroupSession, address: UserAddress): Uint8Array | null {
  return memberSigningKeys(session, address)[0] ?? null
}

/**
 * Device keys for all leaves of a person, in leaf order.
 *
 * An account with three devices has three distinct leaf keys, and the question
 * "did this person sign this?" only has an honest answer against the set: with
 * the singular form alone, a payload signed by someone's second device would
 * appear not to be theirs.
 *
 * Empty list for anyone not in the tree, the same answer as the `null` from
 * the singular form, without forcing the caller to distinguish absence from single presence.
 */
export function memberSigningKeys(session: GroupSession, address: UserAddress): Uint8Array[] {
  const tree = session.state.ratchetTree
  const keys: Uint8Array[] = []
  for (const leafIndex of leavesOf(tree, address)) {
    const node = tree[leafIndex * 2]
    if (node?.nodeType !== "leaf") continue
    keys.push(node.leaf.signaturePublicKey)
  }
  return keys
}

/**
 * The leaves a person occupies in this group.
 *
 * The shortcut that removal needs: `removeMembers` takes leaf indices, and
 * removing a person means removing all their leaves in one commit. Call this and pass
 * the entire result, that is the difference between expelling someone and disconnecting
 * their computer.
 */
export function memberLeaves(session: GroupSession, address: UserAddress): number[] {
  return leavesOf(session.state.ratchetTree, address)
}

/**
 * The ACCOUNT key of a member, read from the chain in the leaf.
 *
 * **This is what safety numbers compare**, and the reason is symmetry: the number is
 * calculated over both keys and read aloud by both sides. If one side used the account
 * key and the other the device key, the two numbers would diverge even with no one in
 * the middle, and a safety number that disagrees by construction is worse than none,
 * because it teaches you to ignore it. Over account keys the number is the same from
 * any device and says what it always said: this is the person.
 *
 * Safe to read without revalidation: `addressBindingAuthService` refused any leaf whose
 * chain did not close, so this account key is the one with the address as its hash.
 */
export function memberAccountKey(session: GroupSession, address: UserAddress): Uint8Array | null {
  const tree = session.state.ratchetTree
  const leafIndex = leafIndexOf(tree, address)
  if (leafIndex === undefined) return null
  return accountKeyAtLeaf(tree, leafIndex) ?? null
}

/**
 * Which epoch a group is on.
 *
 * The one number that says whether a commit has landed since a moment ago —
 * which is how concurrent repairs stay out of each other's way: whoever is
 * about to issue a second remove-and-add checks this first, sees somebody
 * else's commit already applied, and does nothing instead of forking the very
 * channel the repair exists to heal.
 */
export function epochOf(session: GroupSession): bigint {
  return session.state.groupContext.epoch
}

// --------------------------------------------------------------- persistence

/**
 * Serialise a live group so it survives a restart.
 *
 * This blob is the most sensitive thing the client ever writes: it contains the
 * current epoch secrets, and anyone holding it can read the channel until the
 * next commit. It must only ever be stored inside the encrypted vault — never
 * logged, never synced, never sent to a server.
 */
export function exportSession(session: GroupSession): Uint8Array {
  return encodeGroupState(session.state)
}

export async function importSession(channel: string, blob: Uint8Array): Promise<GroupSession> {
  const suite = await loadSuite()
  const decoded = decodeGroupState(blob, 0)
  if (!decoded) throw new Error(`stored state for ${channel} is corrupt`)

  const [groupState] = decoded
  // The config is behaviour, not state, so it is reapplied from code rather than
  // restored. That way a change to padding or key retention takes effect on the
  // next launch instead of being frozen into old vaults.
  return { channel, state: { ...groupState, clientConfig: enclaveClientConfig() }, suite }
}

/**
 * A key package plus its private half, in a form the vault can hold.
 *
 * Both halves must persist: a Welcome can arrive days after we published the
 * package, and without the private half we simply cannot join.
 */
export interface StoredKeyPackage {
  wire: Uint8Array
  initPrivateKey: Uint8Array
  hpkePrivateKey: Uint8Array
  signaturePrivateKey: Uint8Array
}

export function exportKeyPackage(generated: GeneratedKeyPackage): StoredKeyPackage {
  return {
    wire: generated.wire,
    initPrivateKey: generated.privatePackage.initPrivateKey,
    hpkePrivateKey: generated.privatePackage.hpkePrivateKey,
    signaturePrivateKey: generated.privatePackage.signaturePrivateKey,
  }
}

export function importKeyPackage(stored: StoredKeyPackage): {
  publicPackage: KeyPackage
  privatePackage: PrivateKeyPackage
} {
  return {
    publicPackage: decodeKeyPackage(stored.wire),
    privatePackage: {
      initPrivateKey: stored.initPrivateKey,
      hpkePrivateKey: stored.hpkePrivateKey,
      signaturePrivateKey: stored.signaturePrivateKey,
    },
  }
}

export function decodeKeyPackage(bytes: Uint8Array): KeyPackage {
  const decoded = decodeMlsMessage(bytes, 0)
  if (!decoded) throw new Error("key package is malformed")
  const [message]: [MLSMessage, number] = decoded
  if (message.wireformat !== "mls_key_package") throw new Error(`expected a key package, got ${message.wireformat}`)
  return message.keyPackage
}

/**
 * The device chain that a key package carries, verified, or `undefined`.
 *
 * **This runs BEFORE the package is spent, and that is its reason for existing.**
 * The same verification lives in `addressBindingAuthService` (`suite.ts`) and
 * ts-mls does it inside `createCommit`: a leaf with a broken chain makes the
 * commit fail. But by then the package has already been requested from the server, and
 * a requested package never goes back in the pool. The inviter needs to decide
 * package by package, before the commit, what goes in and what gets thrown out, and
 * to do that must read the chain here.
 *
 * All THREE links, not two. The first two are `verifyDeviceChain`: the address is
 * the hash of the account key, and the account signed the device key. The third is
 * what `suite.ts` does and must be repeated here: the device key of the credential
 * is the one that signs THIS leaf (`leafNode.signaturePublicKey`). Without it, a
 * credential copied from another device and pasted into a leaf signed by any key
 * would pass the first two and go spend the commit only to fail inside.
 *
 * Never throws: an unreadable credential, of another type, or with a broken link
 * returns `undefined`, the same silent refusal as `verifyDeviceChain`.
 */
export function credentialOfKeyPackage(keyPackage: KeyPackage): DeviceCredential | undefined {
  try {
    const credential = keyPackage.leafNode.credential
    if (credential.credentialType !== "basic") return undefined
    const chain = decodeDeviceCredential(credential.identity)
    if (!chain) return undefined
    if (!verifyDeviceChain(chain)) return undefined
    if (!bytesEqual(chain.deviceKey, keyPackage.leafNode.signaturePublicKey)) return undefined
    return chain
  } catch {
    return undefined
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
