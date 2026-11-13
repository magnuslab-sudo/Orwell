import { createSocket } from "node:dgram"
import type { ServidorDeTeste } from "../../apps/server/testes/cliente-de-teste.js"

/** `ws://127.0.0.1:porta/_enclave/gateway` → `http://127.0.0.1:porta`. */
export function origemHttp(servidor: Pick<ServidorDeTeste, "url">): string {
  return servidor.url.replace(/^ws:/, "http:").replace(/\/_enclave\/gateway$/, "")
}

/**
 * Um porto UDP que o sistema acaba de largar.
 *
 * `sfuPort: 0` no homeserver significa «não há SFU», não «escolhe um porto».
 * O teste pede um número livre e entrega-o ao motor.
 */
export async function portoUdpLivre(): Promise<number> {
  const socket = createSocket("udp4")
  await new Promise<void>((pronto) => socket.bind(0, "127.0.0.1", pronto))
  const porto = socket.address().port
  await new Promise<void>((pronto) => socket.close(() => pronto()))
  return porto
}
