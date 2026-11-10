import { decodeDeviceCredential, type DeviceCredential, type UserAddress } from "@enclave/protocol"
import type { CiphersuiteImpl, ClientState, RatchetTree } from "ts-mls"
import type { PrivateMessage } from "ts-mls"
import { unprotectPrivateMessage } from "ts-mls/messageProtection.js"

/**
 * Recovering *who sent this*.
 *
 * MLS authenticates the author of every application message: the FramedContent
 * is signed by the sender's leaf key, and the sender's leaf index travels in the
 * encrypted sender_data. ts-mls verifies all of that — and then throws the leaf
 * index away, because its public `processMessage` returns only the plaintext.
 *
 * So this is an API gap, not a security gap. The alternative, stamping a sender
 * field inside our own payload and signing it, would be strictly worse: it would
 * cost us MLS's deniability (a signed payload is a transferable proof that a
 * specific person said a specific thing, which is exactly what a chat app for
 * at-risk communities should not mint), and it would put attribution in the hands
 * of the sender rather than the protocol.
 *
 * `unprotectPrivateMessage` is reachable through ts-mls's `./*.js` subpath
 * exports but is not part of its documented surface, so the dependency is pinned
 * to an exact version and `sender.test.ts` locks the behaviour. If a ts-mls
 * upgrade breaks this, that test fails loudly rather than the app silently
 * mislabelling authorship.
 */

export interface OpenedApplicationMessage {
  applicationData: Uint8Array
  senderLeafIndex: number
  /**
   * The tree of the epoch in which the message was encrypted, not the current one.
   *
   * This is what the sender verified against, and this is where you read who they are.
   * In a message from an epoch already left, the leaf may have become empty or already
   * belong to someone else in the current tree (3/11/2026, Orwell channel).
   */
  senderTree: ClientState["ratchetTree"]
  /** State with the secret tree advanced — must replace the caller's state. */
  newState: ClientState
}

export async function openApplicationMessage(
  state: ClientState,
  message: PrivateMessage,
  suite: CiphersuiteImpl,
): Promise<OpenedApplicationMessage | undefined> {
  const historical = message.epoch < state.groupContext.epoch

  // Messages from an epoch we have already left still arrive, because delivery
  // is not ordered with respect to commits. We keep a bounded window of past
  // receiver state precisely for this; outside the window the message is
  // undecryptable and that is the intended forward-secrecy behaviour.
  const receiver = historical ? state.historicalReceiverData.get(message.epoch) : undefined
  if (historical && !receiver) return undefined

  const senderDataSecret = receiver ? receiver.senderDataSecret : state.keySchedule.senderDataSecret
  const secretTree = receiver ? receiver.secretTree : state.secretTree
  const ratchetTree = receiver ? receiver.ratchetTree : state.ratchetTree
  const groupContext = receiver ? receiver.groupContext : state.groupContext

  const result = await unprotectPrivateMessage(
    senderDataSecret,
    message,
    secretTree,
    ratchetTree,
    groupContext,
    state.clientConfig.keyRetentionConfig,
    suite,
  )

  if (result.content.content.contentType !== "application") return undefined
  if (result.content.content.sender.senderType !== "member") return undefined

  const newState: ClientState = receiver
    ? {
        ...state,
        historicalReceiverData: new Map(state.historicalReceiverData).set(message.epoch, {
          ...receiver,
          secretTree: result.tree,
        }),
      }
    : { ...state, secretTree: result.tree }

  return {
    applicationData: result.content.content.applicationData,
    senderLeafIndex: result.content.content.sender.leafIndex,
    senderTree: ratchetTree,
    newState,
  }
}

/**
 * The chain written in the leaf, as it is there.
 *
 * Without revalidation: `addressBindingAuthService` refused to admit any leaf whose
 * chain did not close, so what is in the tree already passed. Here only read, and
 * a read that fails returns `undefined`, never throws, because the caller is in the
 * middle of opening a message.
 */
export function credentialAtLeaf(tree: RatchetTree, leafIndex: number): DeviceCredential | undefined {
  const node = tree[leafIndex * 2]
  if (node?.nodeType !== "leaf") return undefined
  if (node.leaf.credential.credentialType !== "basic") return undefined
  return decodeDeviceCredential(node.leaf.credential.identity)
}

/**
 * Map an authenticated leaf index to the address in that leaf's credential.
 *
 * Safe to trust: `addressBindingAuthService` already refused to admit any leaf
 * whose credential did not hash to its own signing key.
 *
 * The address is the ACCOUNT one, and stays that way when an account has multiple
 * devices: whoever writes is the person, the leaf is just the machine they spoke from.
 * This is why foundation, roles, friendships and admin lists, everything stored by
 * address, do not know that devices exist.
 */
export function addressAtLeaf(tree: RatchetTree, leafIndex: number): UserAddress | undefined {
  return credentialAtLeaf(tree, leafIndex)?.address
}

/** The ACCOUNT key in the leaf, the one safety numbers compare. */
export function accountKeyAtLeaf(tree: RatchetTree, leafIndex: number): Uint8Array | undefined {
  return credentialAtLeaf(tree, leafIndex)?.accountKey
}

/** The DEVICE key in the leaf, which is also the one that signs what comes from it. */
export function deviceKeyAtLeaf(tree: RatchetTree, leafIndex: number): Uint8Array | undefined {
  return credentialAtLeaf(tree, leafIndex)?.deviceKey
}

/**
 * The FIRST leaf a given address occupies.
 *
 * Media keys are per-sender, and the sender id has to be something both ends
 * derive identically without exchanging anything. The leaf index is exactly
 * that: it is part of the group state everyone already agrees on.
 *
 * **An account can have multiple leaves, and this returns the lowest one.** This is
 * correct where the unit is the leaf itself and the caller already knows which one they want, and
 * it is wrong where the unit is the PERSON: removing someone from a channel by the leaf
 * this returns removes one device and leaves the others inside. For those use `leavesOf`,
 * which returns all of them. See the comment on `leavesOf` for the list of places where
 * the difference has already bitten.
 */
export function leafIndexOf(tree: RatchetTree, address: UserAddress): number | undefined {
  return leavesOf(tree, address)[0]
}

/**
 * ALL leaves of an address, in ascending order.
 *
 * An account with three devices has three leaves in the tree, each with its own key,
 * and each able to read everything the group encrypts from the moment it joined. Whoever
 * acts on the PERSON, expel, unfriend, declare someone left, must act on all of them:
 * `removeMembers` already takes the list and already proves the `UpdatePath` for each
 * removal, so removing an entire person is one commit, not N commits or a half removal.
 *
 * Returns empty for anyone not in the tree, the same answer `leafIndexOf` gave with
 * `undefined`, except without forcing the caller to distinguish "not here" from "here once".
 */
export function leavesOf(tree: RatchetTree, address: UserAddress): number[] {
  const leaves: number[] = []
  for (let leafIndex = 0; leafIndex * 2 < tree.length; leafIndex++) {
    if (addressAtLeaf(tree, leafIndex) === address) leaves.push(leafIndex)
  }
  return leaves
}

/** Every member's address, indexed by leaf. Holes are empty leaves. */
export function memberAddresses(tree: RatchetTree): Map<number, UserAddress> {
  const members = new Map<number, UserAddress>()
  for (let leafIndex = 0; leafIndex * 2 < tree.length; leafIndex++) {
    const address = addressAtLeaf(tree, leafIndex)
    if (address) members.set(leafIndex, address)
  }
  return members
}

/**
 * The PEOPLE in the group, each with the leaves they occupy.
 *
 * `memberAddresses` is per-leaf and so repeats the address of anyone with multiple
 * devices, which is correct for someone asking "whose leaf is this" and wrong for
 * someone asking "who is here". Counting people by `memberAddresses(...).values()`
 * switched to counting machines the day the second leaf appeared, and the member list
 * started showing the same person twice.
 *
 * Insertion order is that of each person's first leaf, which is stable across clients
 * because it is the tree's own order.
 */
export function memberAccounts(tree: RatchetTree): Map<UserAddress, number[]> {
  const people = new Map<UserAddress, number[]>()
  for (let leafIndex = 0; leafIndex * 2 < tree.length; leafIndex++) {
    const address = addressAtLeaf(tree, leafIndex)
    if (!address) continue
    const leaves = people.get(address)
    if (leaves) leaves.push(leafIndex)
    else people.set(address, [leafIndex])
  }
  return people
}
