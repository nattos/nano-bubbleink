/**
 * A DOM-free observable value, and the listener discipline that goes with it.
 *
 * Modelled on nano-lfo/web/src/stage_controller.ts, whose comment records the
 * bug this exists to prevent:
 *
 *   Listeners are a SET, never a single slot. With one slot, whoever
 *   subscribed last silently won — the plugin page and its map both needed
 *   telling, and the map lost. It still received pointer events and still
 *   moved the latent, so the sound changed, while its own canvas never
 *   repainted once. From outside that is indistinguishable from a dead
 *   control.
 *
 * Canvas widgets redraw from `subscribe()`, NOT from Lit reactivity: state
 * that lives here is invisible to Lit, so a component that waits to be
 * re-rendered paints once and never again.
 */
export class Emitter {
  private readonly listeners = new Set<() => void>();

  /** Returns an unsubscribe function. Callers MUST keep it and call it in
   * `disconnectedCallback`, or a detached widget keeps redrawing. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(): void {
    // Iterate a copy: a listener is allowed to unsubscribe itself while being
    // notified, and mutating the Set mid-iteration would skip its neighbour.
    for (const fn of [...this.listeners]) fn();
  }

  get size(): number {
    return this.listeners.size;
  }
}
