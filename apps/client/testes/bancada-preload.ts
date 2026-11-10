import { contextBridge, ipcRenderer } from "electron"

/**
 * The bench preload, and only that one.
 *
 * It exists for a question the real preload cannot answer: what does Electron do
 * when the response of a synchronous read cannot be cloned? Measuring it requires
 * asking for a raw channel, and a preload that accepts a channel name from the
 * renderer and forwards it is exactly the gate that `src/preload/index.ts` refuses
 * to have-that is how a preload becomes, without noticing, a remote execution bridge.
 *
 * So the bench opens a SECOND window with this file. None of this ships in the app:
 * it does not enter the `electron-vite` build, and the only thing that loads it
 * is `scripts/ipc-canais-electron.mjs`.
 */
contextBridge.exposeInMainWorld("bancada", {
  lerEmCru: (canal: string) => ipcRenderer.sendSync(canal),
  /** A raw request: to measure the error envelope after it crosses the IPC. */
  pedirEmCru: (canal: string) => ipcRenderer.invoke(canal),
})
