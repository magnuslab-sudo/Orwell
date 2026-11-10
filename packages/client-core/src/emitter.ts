/**
 * A minimal typed event emitter.
 *
 * Node's `EventEmitter` would pull `node:events` into the browser bundle for
 * the sake of three methods. This package has to run unmodified in Electron's
 * main process and in a browser tab, so it carries no platform imports at all.
 */
export type Listener<T> = (payload: T) => void

/**
 * An interface of event name to payload. Written as a mapped-object constraint
 * rather than `Record<string, unknown>` so plain interfaces qualify — interfaces
 * have no implicit index signature, which `Record` would demand.
 */
export type EventMap = { [event: string]: unknown }

export class Emitter<Events extends EventMap> {
  #listeners = new Map<keyof Events, Set<Listener<never>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.#listeners.get(event)
    if (!set) {
      set = new Set()
      this.#listeners.set(event, set)
    }
    set.add(listener as Listener<never>)
    return () => set.delete(listener as Listener<never>)
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event)
    if (!set) return
    // Copy first: a listener that unsubscribes itself must not perturb the
    // iteration, and one that throws must not silence the others.
    for (const listener of [...set]) {
      try {
        ;(listener as Listener<Events[K]>)(payload)
      } catch {
        // A broken listener is not the emitter's problem to escalate.
      }
    }
  }

  removeAll(): void {
    this.#listeners.clear()
  }
}
