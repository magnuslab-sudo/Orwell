/**
 * The public key for automatic updates (Ed25519).
 *
 * Written by `scripts/gerar-chave-de-actualizacoes.mjs`. Do not edit by hand.
 *
 * It is the entire anchor for automatic updates: an installer only installs if
 * the manifest describing it comes signed by the private key that pairs with
 * this one. The private key lives outside the repository, on the publisher's
 * machine, and never goes to the server, so a compromised `orwell.pt` cannot
 * pass an update through. See `actualizacao-windows.ts`.
 *
 * Changing this value in a new version leaves already installed versions with
 * the old key: they refuse everything the new one signs. A key change requires
 * a manual installation on each machine.
 */
export const CHAVE_PUBLICA_DE_ACTUALIZACOES = "5B52SWtzJH9AZ2-aCvfVISywn4cVp9fmopkMFOXZEBY"
