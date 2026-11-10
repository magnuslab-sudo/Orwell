import { useCallback, useMemo } from "react"
import type { Profile } from "../bridge.js"
import type { ChatMessage } from "../types.js"
import { nomeEmFalta, palavrasRepetidas } from "../lib/format.js"

/**
 * A published profile payload, reshaped into the UI's `Profile`.
 *
 * The wire format carries the avatar as an attachment (`avatar.inline`); the
 * UI speaks `avatarDataUrl`. The old cast skipped this translation, so every
 * surface fed by the directory — member rows, feed authors, Amigos, call
 * chips, notifications — showed initials for people who had published a
 * perfectly good picture.
 */
export function profileFromPayload(payload: unknown): Profile {
  const raw = payload as {
    displayName?: string
    statusText?: string
    bio?: string
    email?: string
    donations?: Profile["donations"]
    updatedAt?: number
    avatarDataUrl?: string
    avatar?: { inline?: string; url?: string }
  }
  const avatarDataUrl = raw.avatarDataUrl ?? raw.avatar?.inline
  return {
    displayName: raw.displayName ?? "",
    donations: raw.donations ?? [],
    ...(raw.statusText !== undefined ? { statusText: raw.statusText } : {}),
    ...(raw.bio !== undefined ? { bio: raw.bio } : {}),
    ...(raw.email !== undefined ? { email: raw.email } : {}),
    ...(raw.updatedAt !== undefined ? { updatedAt: raw.updatedAt } : {}),
    ...(avatarDataUrl !== undefined ? { avatarDataUrl } : {}),
  }
}

/**
 * Everyone's profile, assembled from what they published.
 *
 * There is no directory to look a person up in: a display name is something a
 * member told a group. Keyed on the authenticated sender, never on anything
 * inside the payload, which the sender writes.
 */
export function useDirectory(
  messages: ChatMessage[],
  /** Profiles remembered by the vault, so names survive a reload. */
  seed?: ReadonlyMap<string, Profile>,
  /** This account's own profile, which never arrives over the network. */
  self?: { address: string | null; profile: Profile } | undefined,
  /**
   * The accounts this screen shows beyond those who wrote (channel members,
   * people in the call), so `nomeEmFalta` collisions can see them.
   */
  vizinhos?: readonly string[],
): {
  directory: Map<string, Profile>
  nameFor: (sender: string) => string
} {
  const directory = useMemo(() => {
    // The vault's copy first; anything published live overlays it, with the
    // same freshest-wins rule the vault itself applies.
    const byAddress = new Map<string, Profile>(seed ?? [])
    for (const message of messages) {
      if (message.payload.t !== "profile") continue
      const known = byAddress.get(message.sender)
      const incoming = profileFromPayload(message.payload)
      if (!known || (incoming.updatedAt ?? 0) >= (known.updatedAt ?? 0)) {
        byAddress.set(message.sender, incoming)
      }
    }

    // Your own profile is the one that never arrives: your sends come back
    // as echoes and are skipped by design, so the directory knew everybody
    // except you — and every surface reading from it drew your initial where
    // your photograph should be. Seeded from the vault's own copy, through
    // the same normaliser, so there is exactly one shape of Profile.
    if (self?.address) byAddress.set(self.address, profileFromPayload(self.profile))
    return byAddress
  }, [messages, seed, self?.address, self?.profile])

  /*
    No published name means the first word of the address (`nomeEmFalta`), and
    the second too when another account on the same screen with no name starts
    with the same letter. The screen is what we see here: who wrote, who is in
    the directory and the neighbors. Looking beyond the screen only adds one
    more word, never merges two people.
  */
  const repetidas = useMemo(() => {
    const semNome = new Set<string>()
    const considerar = (conta: string): void => {
      if (!directory.get(conta)?.displayName) semNome.add(conta)
    }
    for (const conta of directory.keys()) considerar(conta)
    for (const message of messages) considerar(message.sender)
    for (const conta of vizinhos ?? []) considerar(conta)
    return palavrasRepetidas(semNome)
  }, [directory, messages, vizinhos])

  const nameFor = useCallback(
    (sender: string): string => directory.get(sender)?.displayName || nomeEmFalta(sender, repetidas),
    [directory, repetidas],
  )

  return { directory, nameFor }
}
