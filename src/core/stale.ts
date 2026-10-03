/**
 * Hold-then-ghost: what a readout does while it is behind its control.
 *
 * From annotator's groove2_explorer.ts, and the reasoning there is worth
 * keeping verbatim because it is the whole justification:
 *
 *   A decode is ~15ms of model plus a scheduling tail, so moving the probe
 *   blanks the display for a few frames -- and a blank display is read as
 *   "there is nothing there", which is the one thing this page must never say
 *   by accident. Holding the previous frame means the operator sees a stale
 *   answer instead of a wrong one.
 *
 * We need this: a patch preview costs a render pass, so every scope, spectrum
 * and portrait in the oscillator panel lags its knob by at least a frame.
 *
 * Three states, not two:
 *   CURRENT  the display matches the control
 *   HELD     it does not, but recently enough that the user cannot tell, and
 *            should not be made to care -- render the old frame as if current
 *   GHOST    it has been long enough that presenting stale data as current
 *            would be a lie -- render it dimmed and SAY SO
 *
 * The ghost is a fade, never a blank. The shape on screen is still the best
 * available answer and the user is usually mid-gesture; the only thing that
 * has to change is whether they would attribute it to the control's current
 * position.
 */

/**
 * How long a held frame stays presented as if it were current.
 *
 * Below this the user should not be able to tell a recompute happened at all.
 * Above it, a display that has not caught up must say so, or a stale reading
 * gets attributed to the value under the cursor.
 */
export const GHOST_MS = 500;

export class Staleness {
  /** When the display stopped matching its input. 0 means it matches. */
  private heldAt = 0;

  /** The input moved; whatever is on screen is now behind. */
  markStale(): void {
    if (this.heldAt === 0) this.heldAt = performance.now();
  }

  /** A fresh frame landed; the display is honest again. */
  markCurrent(): void {
    this.heldAt = 0;
  }

  get current(): boolean {
    return this.heldAt === 0;
  }

  /** Past the point where holding can pass for current. */
  get ghost(): boolean {
    return this.heldAt !== 0 && performance.now() - this.heldAt > GHOST_MS;
  }

  get heldMs(): number {
    return this.heldAt === 0 ? 0 : performance.now() - this.heldAt;
  }
}

/**
 * Draw the ghost treatment over a canvas whose contents are stale.
 *
 * A scrim in the surface's OWN background colour, not black and not a blur:
 * the point is to push the picture back, not to obscure it. The label is amber
 * because amber means "this is a claim, not a measurement" -- the one job that
 * colour has in this system.
 */
export function drawGhost(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  bg: string,
  label = 'holding the previous result',
  amber = '#e8a83c',
): void {
  g.save();
  g.globalAlpha = 0.66;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  g.fillStyle = amber;
  g.font = '600 11px var(--app-mono), monospace';
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText(label, w - 6, h - 4);
  g.restore();
}

/**
 * The debounce ladder.
 *
 * Observed across the prior art and worth having as one table rather than as
 * scattered magic numbers: the split is what keeps a drag smooth. The cheap
 * half happens now; the expensive halves are deferred by increasing amounts,
 * so a sweep across a surface reuses work instead of firing one recompute per
 * pixel.
 */
export const DEBOUNCE = {
  /** Selection, overlay, cursor -- anything already in memory. */
  immediate: 0,
  /** A model decode or a patch re-render. */
  compute: 65,
  /** Restarting audio: expensive, audible, and worth waiting out a gesture. */
  audio: 180,
  /** Past this, admit the display is behind. */
  ghost: GHOST_MS,
} as const;
