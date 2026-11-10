import type { MenuItem } from "../overlays/ContextMenu.js"
import { strings } from "../../strings.js"
import type { Microfone } from "../../hooks/useMicrofones.js"

/**
 * What opens the arrow next to the microphone, and the arrow next to the sound.
 *
 * Pure and separate from the component, like `menuItems.ts` and
 * `menuDaPessoa.ts`: what decides if an entry shows is a rule, and a rule is
 * easier to test without a screen around it.
 *
 * **The house rule governs all of this: what you cannot do does not show, and
 * never shows greyed out.** So there is not a single inert entry here. Without
 * device names we do not list a queue of "Microphone 1, Microphone 2" that lets
 * you choose nothing, we show a path to where you can choose, with the
 * explanation beside it. And there is no speaker choice because this product
 * does not know how to apply it: offering it would be a button lying.
 */

/** The badge for what is chosen. A menu without it does not say where you are. */
function marcar(escolhido: boolean, label: string): string {
  return escolhido ? `✓ ${label}` : ` ${label}`
}

export function itensDoMicrofone({
  microfones,
  nomeados,
  escolhido,
  escolher,
  abrirDefinicoes,
  abrirConta,
}: {
  microfones: Microfone[]
  /** Do we already read devices by name? See `useMicrofones`. */
  nomeados: boolean
  /** The stored `deviceId`. Empty means "whatever the system picks". */
  escolhido: string
  escolher: (deviceId: string) => void
  abrirDefinicoes: () => void
  abrirConta: () => void
}): MenuItem[] {
  const itens: MenuItem[] = []

  if (nomeados) {
    // The omission first, always: it is the only entry that works on any device,
    // and it is where you go back when the chosen one disappears.
    itens.push({ label: marcar(escolhido === "", strings.call.inputDeviceDefault), onSelect: () => escolher("") })
    for (const microfone of microfones) {
      itens.push({
        label: marcar(escolhido === microfone.deviceId, microfone.label),
        onSelect: () => escolher(microfone.deviceId),
      })
    }
  } else {
    // Without names there is nothing to tell one device from another, and a list
    // like this is a choice you cannot make. Send to where you can, with the
    // explanation of what is missing written there.
    itens.push({ label: strings.call.inputDevicePick, onSelect: abrirDefinicoes })
  }

  itens.push({ label: strings.call.inputVolume, onSelect: abrirDefinicoes, separatorBefore: true })
  itens.push({ label: strings.call.audioSettings, onSelect: abrirDefinicoes })
  return itens
}

/*
  The "My account" entry left both audio menus, by owner decision on August 19,
  2026.

  The reason is about tidiness, not code: these menus open from the microphone
  and the sound, and what you look for in them is sound. You reach the account
  through the identity on the same card, which is where people look for it. An
  entry that shows in three places tells you none of them is the right place.

  `abrirConta` stays in the contract: the card uses it, and removing it here
  would mean changing the caller to save a parameter.
*/
/**
 * The sound arrow.
 *
 * No speaker list, and that is a decision, not an oversight: choosing the
 * output takes `setSinkId` applied to every audio element in the call, and that
 * does not exist in this product. A list that does not change the sound coming
 * out is worse than no list, the person chooses, hears no difference, and
 * stops trusting the rest of the menu.
 */
export function itensDoSom({
  abrirDefinicoes,
  abrirConta,
}: {
  abrirDefinicoes: () => void
  abrirConta: () => void
}): MenuItem[] {
  return [
    { label: strings.call.notificationVolume, onSelect: abrirDefinicoes },
    { label: strings.call.audioSettings, onSelect: abrirDefinicoes },
  ]
}
