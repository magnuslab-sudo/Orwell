/**
 * The error code that appears on screen.
 *
 * An error displays in two lines: "Error 104" at the top, and below it a short
 * sentence saying what happened. The number is something a person can dictate
 * over the phone or paste into a report without copying the whole sentence, and
 * it is the same in both languages. The sentence lives in the catalogs (`errosPt`,
 * `errosEn`); only the number lives here.
 *
 * The key is the raw message the core fires (`client-core`), because it is the
 * only stable thing that crosses the boundary between core and interface.
 *
 * Variable data (the channel, the address, the number of channels) never go in
 * the key: they go in the error's `cause`, and the sentence uses them when it
 * needs to. A key with an address inside would be a different key for each
 * person, and the error would fall to 900.
 *
 * Hundreds:
 *   1xx  vault and account
 *   2xx  server and connection
 *   3xx  channels, invites and members
 *   4xx  calls and media
 *   5xx  files and images
 *   6xx  friends, feed and profile
 *   7xx  devices and pairing
 *   900  any error not in this table
 *
 * A code is never reused. When an error ships, the number is free and stays
 * free forever: an old report with "Error 104" must still mean the same thing.
 *
 * Two keys may share a code when, to the reader, they are the same error (see
 * `CHAVES_DO_EMPARELHAMENTO`). This is done via a key map, and never by putting
 * the same number in two entries of this table.
 *
 * Reserved blocks (phase 5, 20/10/2026). No one else uses these numbers:
 *   720-739  agent A, state across devices (instant, account channel)
 *   740-759  agent B, device revocation
 * Numbers were assigned in wave 2 (agent D), within each block. 718 is already
 * from the server's `bad-device-cert` refusal, which revocation (B) also uses:
 * a device not on the list does not enter.
 *
 * The test `codigosDeErro.cobertura.test.ts` scans the core, bridges and
 * interface, and fails if a message that can reach the screen has no code.
 */
export const CODIGOS_DE_ERRO: Readonly<Record<string, number>> = {
  "vault is locked": 101,
  "no vault to open": 102,
  "vault holds no identity": 103,
  "wrong passphrase, or the vault is damaged": 104,
  "this vault was written by a newer version of the app": 105,
  "vault storage is full": 106,
  "this is not an enclave account file": 107,
  "an export passphrase is required": 108,
  "this platform cannot protect a vault without a passphrase": 109,
  "this vault needs the system keychain": 110,
  "the vault file is damaged": 111,
  "this account is no longer valid on this server": 112,
  "this vault already holds an account": 113,
  "local storage failed": 114,
  "could not leave every channel, account kept": 115,
  // A separator that no longer owns the account, or kept the old version
  // (`apps/web/src/posse-do-separador.ts`). 116: refused to connect to server.
  // 117: refused to write to vault (sealed, or the ownership record belongs to another).
  "this tab no longer writes": 116,
  "this tab no longer writes to the vault": 117,
  // First attempt to open the vault without a password, on a separator that
  // does not have it stored (`apps/web/src/bridge.ts`, `vault.ts`).
  "this vault needs a passphrase": 118,
  // The session was used before the account was loaded (`session.ts`).
  "no identity loaded": 119,
  // "Merge accounts" (phase 8.2): `Session.juntarAvisar`, `juntarTrocar`,
  // `adicionarSucessora`/`convidarSucessora`, and the `mesma-conta` reason from
  // pairing (`CHAVES_DO_EMPARELHAMENTO`).
  "there is no account to join": 120,
  "could not leave every channel, nothing was deleted": 121,
  "the account could not be switched": 122,
  "this account did not become another": 123,
  "an account cannot be joined to itself": 124,
  "the other device stopped waiting, nothing was deleted": 125,
  // 1.0 "Arca" (slice 2): a vault or account file without the `orwv2` header,
  // which 1.0 never decrypts (`cabecalhoDoCofre.ts`). Jumps from 125 to 130 on
  // purpose: 126-129 are reserved for 8.2, which runs on another branch.
  "this vault is from the beta": 130,
  "this account file is from the beta": 131,
  // Copy to clipboard (`lib/copiar.ts`, `clipboard:write`).
  "clipboard unavailable": 132,
  "clipboard text is invalid": 133,
  // Memorize the session (F1, `Vault.memorizar`): the platform has no secure place
  // to store it, or the vault has no password (vault `os`).
  "this device cannot remember the session": 134,
  "this vault has no passphrase to remember": 135,
  // "Set password" (F3, `Vault.definirPalavraPasse`) on a vault that already has one.
  "this vault already has a passphrase": 136,
  // "Switch account" (`contasDoAparelho.ts`): the requested account is not on this device.
  "there is no such account on this device": 137,

  "could not reach the homeserver": 201,
  "no connection to the server": 202,
  "the server refused the login": 203,
  "the server did not answer in time": 204,
  "the server did not confirm the send": 205,
  "the connection dropped": 206,
  "unexpected answer from the server": 207,
  "the session ended": 208,
  "the connection was replaced": 209,
  // Fatal server refusals, arriving as `status` "server-error" (see
  // `CHAVES_DO_SERVIDOR`).
  "this address belongs to another key": 210,
  "the key does not match the address": 211,
  "the server closed the connection": 212,
  "the server refused a message that was too large": 213,
  // "Send report" (phase 4 of settings): `client-core/src/relato.ts`.
  "the server did not take the log": 214,
  "too many logs sent": 215,
  // Reports: `client-core/src/denuncia.ts`, the refusal, the cap and the clock of
  // the signed request.
  "the server did not take the report": 216,
  "too many reports sent": 217,
  // The session's `status` "account-suspended", and the server's `error` with the
  // same code: the account is suspended on this server (reports, section 8). Key
  // matches code, like "device-revoked".
  "account-suspended": 218,
  // The request to review the suspension was refused (`client-core/src/denuncia.ts`).
  "the server did not take the review request": 219,
  "the device clock is off": 220,
  // The server's response to the `founder` and `caixa` routes could not be read.
  "could not read the report inbox": 221,

  "not a member of this channel": 301,
  "you may not invite in this channel": 302,
  "that person is already in this channel": 303,
  "that person has no invite keys": 304,
  "no invite key verifies": 305,
  "that person's invite key expired": 306,
  "could not add that person to this channel": 307,
  "a direct conversation has no administration": 308,
  "only an administrator may manage roles": 309,
  "the role needs an id and a name": 310,
  "the admin role is built in": 311,
  "the founder cannot lose the role": 312,
  "that role does not exist in this channel": 313,
  "to leave, forget the channel": 314,
  "you may not expel in this channel": 315,
  "this channel has no recorded founder": 316,
  "the founder cannot be expelled": 317,
  "that person is not in this channel": 318,
  "to change room, join it": 319,
  "you may not move people in this channel": 320,
  "you already administer this channel": 321,
  "this channel already has an administrator": 322,
  "only an administrator may edit this channel": 323,
  "the channel needs a name": 324,
  "the category needs a name": 325,
  "the room needs a name": 326,
  "the default room cannot be deleted": 327,
  "that room id is reserved": 328,
  "you may not pin in this channel": 329,
  "the room has the maximum of pinned messages": 330,
  "this room was never published": 331,
  "the ticket needs a subject": 332,
  "only an attendant or the author may change the ticket": 333,
  "you may not attend tickets in this channel": 334,
  "the reply needs text": 335,
  "a feed channel cannot be deleted": 336,
  "a direct conversation cannot be deleted": 337,
  "the common room belongs to the server": 338,
  "you may not delete this channel": 339,
  "that is not a valid invite link": 340,
  "that invite is from another server": 341,
  "could not prepare the entry": 342,
  "that invite no longer exists": 343,
  "that invite expired": 344,
  "this device has no seat in this channel": 345,
  "you are no longer a member of this channel": 346,
  "an invitation to this channel can no longer be opened, a new seat was requested": 347,
  "unknown ticket state": 348,
  // Core warnings with `code` (see `fraseDoStatus` in `statusPolicy.ts`).
  "this channel was recreated": 349,
  "this channel no longer exists here": 350,
  "some channels could not be read": 351,
  "that invite reached its limit": 352,
  // Moderation (phase 3 of 0.9, `session.ts`).
  "only the author or a moderator may delete this message": 353,
  "only a closed ticket can be deleted": 354,
  "you may not moderate in this channel": 355,
  "the nickname is too long": 356,
  "a nickname belongs to a channel": 357,
  // The short invite link (1.0 "Arca", slice 5b-2; `resolverConvite`).
  "this invite link is wrong": 358,
  "too many invite lookups": 359,
  "this server does not open short invite links": 360,
  // Reports: `Session.prepararDenuncia` refuses the message.
  // The report sheet (`screens/chat/denunciar.ts`): the note for reason 8 and good faith.
  "the report needs a note": 361,
  "the report needs the good-faith confirmation": 362,
  "this message cannot be reported": 363,
  // The copy to founder that did not encrypt (the report goes without it).
  "the founder copy could not be sealed": 364,
  // INV-02 (4/11/2026): server rejected the redemption due to rate limit (\`invite.rejected\` \`rate-limited\`).
  "too many invite requests": 365,
  // The core refuses before requesting an address that the server does not debut (4/11/2026).
  // The rule is `podeEstrearCanal` (@enclave/protocol); the channel goes in `cause`.
  "the server does not open this channel address": 366,

  "the call could not be set up on this server": 401,
  "the call has no send path": 402,
  "the call dropped and did not come back": 403,
  // Browser errors, by `name` (see `erros-do-browser.ts` in core).
  "the browser or the system did not allow this": 404,
  "no microphone or camera was found": 405,
  "the microphone or the camera is busy": 406,
  "no microphone or camera fits": 407,
  "the browser stopped the operation": 408,
  "the browser was not ready": 409,
  "the browser blocked this for safety": 410,
  "this browser cannot do that": 411,
  // A chamada (`call.ts`, e as pontes).
  "could not open the microphone": 412,
  "could not open the camera or the microphone": 413,
  "call signalling failed": 414,
  "that person did not answer the call": 415,
  "the network blocks the call to that person": 416,
  "no relay server for the call": 417,
  "you are not in a call": 418,
  "this call server carries only voice": 419,
  "the call is too large to share a screen": 420,
  "this device cannot share the screen from the app": 421,
  "could not share the screen": 422,
  // Screen share audio (26/10/2026): sharing stays muted, and the person knows why.
  "the system did not give the screen sound": 440,
  "this system cannot share the screen sound": 441,
  // In the browser, the selector's sound box left unticked (2/11/2026).
  "the browser did not give the screen sound": 445,
  // Music in the call (phase 9, 27/10/2026). See `musica.ts` and `Call.partilharMusica`.
  "this call server does not carry music": 442,
  // The AFK room (2/11/2026). Block 470-479, to avoid collision with screen share audio.
  "the afk room has no voice and no text": 470,
  "only a voice room can be the afk room": 471,
  // The captured DJ sources (2/11/2026). Block 480-489. See `somDoDj.ts`.
  "the chosen source gave no sound": 480,
  "this device does not give the system sound": 481,
  "could not capture this sound source": 482,
  "this device cannot capture a sound source": 483,
  "the system does not allow recording the sound": 484,
  "could not read this audio file": 443,
  "could not play this audio file": 444,
  // SFU refusals (see `CHAVES_DAS_RECUSAS_DO_SFU` in `call-sfu.ts`).
  "someone already shares a screen in this call": 423,
  "the call has the maximum of cameras": 424,
  "the call is full": 425,
  "this device is in too many calls": 426,
  "too many call requests": 427,
  "this server does not relay call media": 428,
  "join the call first": 429,
  "the call server refused the request": 430,
  "could not announce you in the call": 431,
  "the call media key failed": 432,
  "the call media failed": 433,
  // The server's entire outbound budget (3/11/2026). See `orcamento-de-saida.ts` on server.
  "the server is full of broadcasts": 446,
  // A person in the call whose media key this device does not yet have (3/11/2026).
  // Not an error thrown: it is the warning `sfu-receptor-sem-chave` (see `avisoDaChamada`).
  "no media key for this person yet": 447,
  // A source that did not go out because its cipher was not ready (SEC-02, 4/11/2026).
  // The source goes in `cause` (`CifraDoEmissorEmFalta`, in `call-sfu.ts`).
  "the call media could not be encrypted": 448,
  // The same cipher, while still trying (4/11/2026). Not an error thrown: it is the
  // warning `sfu-emissor-cifra-a-repetir` (see `avisoDaChamada`). Only when the
  // attempts run out does 448 come out.
  "your media is not going out yet": 449,
  // The mic died silently more than four times in a minute, and the app stopped
  // reopening it on its own (4/11/2026). See `Call.#microfoneMorreu`.
  "the microphone keeps stopping": 452,
  // The call server rejected the audio because of a state that has already passed,
  // and the app is requesting again (4/11/2026). Not a thrown error: the warning
  // `sfu-consumo-em-falta` (see `avisoDaChamada`).
  "the sound of this person is not here yet": 453,
  // The audio pipeline (see `client-core/src/audio/README.md`).
  "audio-invalid-profile": 434,
  "audio-invalid-stage": 435,
  "audio-invalid-strength": 436,
  "audio-preference-save-failed": 437,
  "audio-preview-unavailable": 438,
  "audio-preview-failed": 439,
  // The permissions model (1.2, 3/11/2026). Block 450-459.
  "the everyone role is built in": 450,
  "you may not change the permissions of this room": 451,
  // Voice moderation (2/11/2026). Block 460-469.
  "to leave the call, leave it": 460,
  // The microphone sensitivity (2/11/2026). Block 490-499.
  "audio-invalid-threshold": 490,
  "audio-meter-denied": 491,
  "audio-meter-failed": 492,

  "this device cannot shrink images": 501,
  "this is not an image this device can read": 502,
  "this image is too large even after compression": 503,
  "could not compress this image": 504,
  "too large to send": 505,
  "unreadable image": 506,
  "could not read the page": 507,
  // Video for broadcasts (`videos.ts` in core, `lib/videos.ts` in the UI).
  "the video is too large": 508,
  "the video is too long": 509,
  "this video format is not accepted": 510,
  "the video upload was cancelled": 511,
  "could not read this video": 512,
  "a video upload is already in progress": 513,
  "the video upload failed": 514,
  // Asking for an attachment's bytes failed because of a fault, not because nobody has it (1.3.7).
  "the attachment request failed": 515,

  "a friend request is already pending": 601,
  "that person is blocked": 602,
  "there is no friend request to cancel": 603,
  "you cannot block yourself": 604,
  "that is not an account address": 605,
  "too many friends to show": 606,
  "your feed has people who are not friends": 607,
  "too many friend lists in a row": 608,
  // Opaque addresses (1.0 "Arca", slice 3): the direct one is a DH with the account key.
  "this device cannot start a new conversation": 609,
  "the other account is not known to the server": 610,
  "this device has not received this conversation yet": 611,
  "this conversation is waiting for the other person": 612,
  "this device does not know the account feed yet": 613,

  "this device has no account key": 701,
  "this server cannot pair devices": 702,
  "this version of the app cannot do that": 703,
  "not a pairing link": 704,
  "a pairing with this code already exists": 705,
  "this code is no longer open": 706,
  "another device already joined this code": 707,
  "too many pairing attempts": 708,
  "the other device disconnected": 709,
  "the pairing code expired": 710,
  "a third device tried to join": 711,
  "the words were not the same": 712,
  "pairing cancelled": 713,
  "the other device did not answer in time": 714,
  "the certificate is not from this account": 715,
  "the server refused the device list": 716,
  "this account already has four devices": 717,
  "this device is not on the account's list": 718,
  // 720-739: account state across devices (agent A, `session.ts`).
  "read mark channel is invalid": 720,
  "read mark time is invalid": 721,
  "preference key is invalid": 722,
  "preference value is too long": 723,
  "too many preferences": 724,
  "archive channel is invalid": 725,
  // The `status` "account-channel-foreign" (daily): the account channel had a
  // leaf from another account, from a revoked device or outside the manifest, and
  // the group was dropped. Key matches the state code, like "device-revoked".
  "account-channel-foreign": 726,
  // 740-759: device revocation (agent B, `revogacao.ts` and `session.ts`).
  // Keys in kebab-case because that's how the core throws them; what matters is
  // that they stay stable.
  "device-revoke-no-account-key": 740,
  "device-revoke-unsupported": 741,
  "device-key-invalid": 742,
  "device-revoke-self": 743,
  "device-revoke-manifest-unread": 744,
  "device-not-in-manifest": 745,
  "device-revoke-manifest-refused": 746,
  "device-revoke-incomplete": 747,
  // The `status` "device-revoked" on the session, and the server's `error` with
  // the same code: this device was removed from the account on another device.
  "device-revoked": 748,
}

/**
 * The reason for a failed pairing (`PairFalha` from core) is the key in this
 * table.
 *
 * The core uses short codes ("refused:full") because that's what the pairing
 * protocol defines, not the UI. This map is the bridge: with it a pairing
 * failure goes through the same `translateError` as all others, and gets
 * "Error NNN" like them. Three reasons share a key with `Session` (701, 702,
 * 202) because they look the same to the user.
 */
export const CHAVES_DO_EMPARELHAMENTO: Readonly<Record<string, string>> = {
  "sem-chave-de-conta": "this device has no account key",
  "servidor-sem-emparelhamento": "this server cannot pair devices",
  "sem-ligacao": "no connection to the server",
  "link-invalido": "not a pairing link",
  "recusado:exists": "a pairing with this code already exists",
  "recusado:unknown": "this code is no longer open",
  "recusado:full": "another device already joined this code",
  "recusado:rate-limited": "too many pairing attempts",
  "fechado:closed": "the other device disconnected",
  "fechado:peer-left": "the other device disconnected",
  "fechado:expired": "the pairing code expired",
  "fechado:intruder": "a third device tried to join",
  "palavras-diferentes": "the words were not the same",
  cancelado: "pairing cancelled",
  "tempo-esgotado": "the other device did not answer in time",
  "cadeia-invalida": "the certificate is not from this account",
  manifesto: "the server refused the device list",
  "manifesto-cheio": "this account already has four devices",
  "mesma-conta": "an account cannot be joined to itself",
}

/**
 * The `code` of a fatal server `error`, used as the key in this table.
 *
 * The server uses short codes (`apps/server/src/gateway.ts`) and sends an
 * English mechanic phrase. The session passes them to the UI as `status`
 * "server-error", with the detail "code: phrase". Those not here fall back to
 * "the server closed the connection", with the code in `cause`.
 */
export const CHAVES_DO_SERVIDOR: Readonly<Record<string, string>> = {
  "address-taken": "this address belongs to another key",
  "key-mismatch": "the key does not match the address",
  "bad-device-cert": "this device is not on the account's list",
  "device-revoked": "device-revoked",
  "account-suspended": "account-suspended",
  "frame-too-large": "the server refused a message that was too large",
  "rate-limited": "too many pairing attempts",
}

/** The key of a server error, by its code. */
export function chaveDoServidor(codigo: string): string {
  return Object.hasOwn(CHAVES_DO_SERVIDOR, codigo) ? CHAVES_DO_SERVIDOR[codigo]! : "the server closed the connection"
}

/**
 * The data that travels in the `cause` of an error, for the phrase to use.
 *
 * Only simple objects are read. A `cause` that is another `Error`, text, or
 * nothing gives an empty detail, and the phrase falls back to the no-data
 * version.
 */
export type DetalheDoErro = Readonly<Record<string, unknown>>

/**
 * An error phrase: fixed text, or a function of the detail.
 *
 * The function must work with no detail. The `cause` is lost in paths that
 * don't carry it (an event, an old bridge), and the user must read a complete
 * phrase anyway.
 */
export type FraseDeErro = string | ((detalhe: DetalheDoErro) => string)

/** The code for errors the table does not know. */
export const CODIGO_DESCONHECIDO = 900

export function codigoDoErro(mensagem: string): number {
  // `hasOwn`, not direct indexing: "constructor" or "toString" would reach up to
  // the prototype and fetch a function, and the code would stop being a number.
  return Object.hasOwn(CODIGOS_DE_ERRO, mensagem) ? CODIGOS_DE_ERRO[mensagem]! : CODIGO_DESCONHECIDO
}
