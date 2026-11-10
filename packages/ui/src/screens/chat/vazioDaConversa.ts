/**
 * Why this conversation is empty.
 *
 * A room with not a single message has three possible causes, and the difference between them is the difference between "nothing has happened yet" and "it happened, and this device no longer has it". Saying the same sentence for all three is the version of the screen that lies: someone who reads "nobody has written here yet" in a room where they spoke yesterday concludes the app lost their conversation.
 *
 * None of these causes is a fault, and that is why none is written as an error. The one that most needs to be said is the middle one: the vault has a cap per channel and dumps the oldest, and nobody should have to discover that alone from a blank screen.
 *
 * The decision lives out here and not inside the JSX for a practical reason: it is a choice between three, proven with a table, and the `Timeline` is not the place to hide it in a chain of ternaries.
 */
export type VazioDaConversa =
  /**
   * There are older messages stored on this device that have not yet been opened. The only case where there is still something to fetch: the gate is the load old messages button, not the compose box.
   */
  | "por-abrir"
  /**
   * This channel has saved history, and nothing is left of this room.
   *
   * Two different things fall here, and on purpose: a new room inside an old channel, and a room whose messages left through the vault cap. They cannot be told apart by what this screen knows, and the sentence that serves both is the one that says only what is always true, the device keeps the most recent. To promise that "there was a conversation here and it left" would be guessing on the first one.
   */
  | "despejado"
  /**
   * Nothing from this channel ever reached this device. The gate is to write.
   */
  | "nova"

/**
 * @param temMensagensGuardadas The channel had history in the vault when it opened.
 * @param podeCarregarAntigas There is more in the vault than what is in memory.
 */
export function vazioDaConversa({
  temMensagensGuardadas,
  podeCarregarAntigas,
}: {
  temMensagensGuardadas: boolean
  podeCarregarAntigas: boolean
}): VazioDaConversa {
  // First what can still be fixed. A channel with more to load may not have been seeded, order matters, not the conjunction.
  if (podeCarregarAntigas) return "por-abrir"
  if (temMensagensGuardadas) return "despejado"
  return "nova"
}
