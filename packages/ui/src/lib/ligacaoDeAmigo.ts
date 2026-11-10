import { FRIEND_PATH, friendLink, parseFriendLink, sameHomeserver } from "@enclave/client-core"
import { parseAddress } from "@enclave/protocol"

/**
 * The short friend link (1.0 "Arca", `docs/planos/moradas-opacas-e-corte.md`
 * section 1.6): `https://orwell.pt/a#<id>` instead of
 * `https://orwell.pt/app/amigo#@<id>:orwell.pt`.
 *
 * The server is the one from the link, so the `@` and `:servidor` are stripped. Only when the
 * account is on another server (federation) does the fragment carry `<id>@<servidor>`.
 * The address stays in the fragment for the reason `FRIEND_PATH`: the fragment
 * never reaches the server, and opening the link doesn't tell it who we're looking for.
 *
 * `/a` is what gets copied and what the QR code carries. The front Caddy redirects it
 * to `/app/a` (`infra/Caddyfile`), and the browser preserves the fragment through the
 * redirect. The app reads both, and the old form too, throughout 1.0.
 *
 * Stays in the UI, not in the core next to `parseFriendLink`, to avoid rebuilding
 * `dist` for `client-core` in this slice. It doesn't repeat any rules: the short link is
 * translated to the long form and `parseFriendLink` validates it (host, `http` only on
 * loopback, no query, address format). This way the two never disagree on what a valid
 * link is.
 */
export const CAMINHO_CURTO_DO_AMIGO = "/a"

/** The same, after the Caddy redirect: this is what the app opens. */
export const CAMINHO_DO_AMIGO_NA_APP = "/app/a"

/** The same cap as `parseFriendLink`, before any regex. */
const TECTO = 2048

/** The short link of my account, for "Copy" and for the QR. */
export function ligacaoCurtaDeAmigo(servidor: string, endereco: string): string {
  const longa = friendLink(servidor, endereco)
  // The scheme and host come from `friendLink`, which already knows when it is `http`.
  const origem = longa.slice(0, longa.indexOf(FRIEND_PATH))
  const { localPart, server } = parseAddress(endereco)
  const id = encodeURIComponent(localPart)
  const fragmento = sameHomeserver(server, servidor) ? id : `${id}@${server}`
  return `${origem}${CAMINHO_CURTO_DO_AMIGO}#${fragmento}`
}

/**
 * Read a friend link, short (`/a#…`, `/app/a#…`) or long (`/app/amigo#@…`).
 * Returns the link server and the address, like `parseFriendLink`, or `null`.
 */
export function lerLigacaoDeAmigo(link: string): { server: string; address: string } | null {
  const texto = link.trim()
  if (texto.length > TECTO) return null
  // The path counts letter by letter, as in `parseFriendLink`; `parseFriendLink`
  // validates the scheme below.
  const curta = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+)(\/app\/a|\/a)(\?[^#]*)?#(.*)$/.exec(texto)
  if (!curta) return parseFriendLink(texto)
  const [, origem, , query, cru] = curta
  if (!origem || query !== undefined || cru === undefined) return null
  let fragmento: string
  try {
    fragmento = decodeURIComponent(cru)
  } catch {
    return null
  }
  const partes = /^([^\s:@/#?]+)(?:@([^\s@/#?]+))?$/.exec(fragmento)
  if (!partes?.[1]) return null
  const host = origem.replace(/^https?:\/\//i, "")
  const endereco = `@${partes[1]}:${partes[2] ?? host.toLowerCase()}`
  return parseFriendLink(`${origem}${FRIEND_PATH}#${encodeURIComponent(endereco)}`)
}

/** True if the path is that of a friend link the app opens. */
export function eCaminhoDeAmigo(caminho: string): boolean {
  return caminho === FRIEND_PATH || caminho === CAMINHO_DO_AMIGO_NA_APP
}
