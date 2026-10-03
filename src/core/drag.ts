/**
 * The pointer-gesture primitive. Every drag in this codebase goes through it.
 *
 * Ported from nano-modules/web/src/utils/pointer-drag-op.ts. Three details are
 * the whole reason it exists, and each is a bug the prior art hit first:
 *
 *   LISTENERS ON `window`, NOT THE ELEMENT. A drag must survive the pointer
 *   leaving the control, and an element-scoped listener stops firing the moment
 *   it does.
 *
 *   POINTER CAPTURE IS DEFERRED UNTIL THE THRESHOLD IS CROSSED. Capturing on
 *   pointerdown means a plain click captures too, and a captured pointer never
 *   produces a `click` event — so any ancestor listening for one (a card that
 *   selects itself, say) silently stops working. Deferring keeps the click path
 *   intact for gestures that never became drags.
 *
 *   RELEASING BELOW THE THRESHOLD IS `CancelReason.NoChange`, NOT AN ACCEPT.
 *   That IS the click path, and naming it distinguishes "the user tapped" from
 *   "the user aborted" from "we tore this down" — three cases that want three
 *   different responses.
 */

export type Point = [x: number, y: number];

export enum CancelReason {
  /** Released without passing the threshold — treat as a click. */
  NoChange = 'NoChange',
  /** pointercancel, or the user pressed Escape. */
  UserAction = 'UserAction',
  /** dispose() — the widget went away mid-gesture. */
  Programmatic = 'Programmatic',
}

export interface DragCallbacks {
  move?: (e: PointerEvent, delta: Point) => void;
  accept?: (e: PointerEvent, delta: Point) => void;
  cancel?: (reason: CancelReason) => void;
  /** Runs after accept OR cancel, always. Release resources here. */
  complete?: () => void;
  /** Skip the threshold entirely and track from pointerdown. For controls that
   * jump to the cursor on press (an absolute-positioning slider), where waiting
   * 5px would make the first press feel dead. */
  callMoveImmediately?: boolean;
  /** Deliver one final `move` with the release coordinates before finishing. */
  callMoveBeforeDone?: boolean;
  /** Manhattan distance in px. Default 5. */
  threshold?: number;
}

export class PointerDragOp {
  private disposed = false;
  private readonly pointerId: number;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
  private readonly onCancel: (e: PointerEvent) => void;
  private readonly onKey: (e: KeyboardEvent) => void;

  private crossed = false;
  private readonly startX: number;
  private readonly startY: number;

  constructor(
    e: PointerEvent,
    private readonly element: HTMLElement,
    readonly callbacks: DragCallbacks,
  ) {
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;

    this.onMove = this.handleMove.bind(this);
    this.onUp = this.handleUp.bind(this);
    this.onCancel = this.handleCancel.bind(this);
    this.onKey = this.handleKey.bind(this);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    // Escape aborts a live drag and puts the value back. Captured on window
    // because the element may never have had focus.
    window.addEventListener('keydown', this.onKey, true);

    if (callbacks.callMoveImmediately) {
      this.capture();
      this.crossed = true;
      this.onMove(e);
    }
  }

  private capture(): void {
    // Wrapped: setPointerCapture throws if the pointer is already gone (a
    // release that raced the threshold), and that must not kill the gesture's
    // teardown.
    try {
      this.element.setPointerCapture(this.pointerId);
    } catch {
      /* pointer already released */
    }
  }

  private delta(e: PointerEvent): Point {
    return [e.clientX - this.startX, e.clientY - this.startY];
  }

  private handleMove(e: PointerEvent): void {
    if (this.disposed || e.pointerId !== this.pointerId) return;
    const d = this.delta(e);
    if (!this.crossed) {
      const manhattan = Math.abs(d[0]) + Math.abs(d[1]);
      if (manhattan <= (this.callbacks.threshold ?? 5)) return;
      this.capture();
      this.crossed = true;
    }
    this.callbacks.move?.(e, d);
  }

  private handleUp(e: PointerEvent): void {
    if (this.disposed || e.pointerId !== this.pointerId) return;
    const d = this.delta(e);
    if (this.callbacks.callMoveBeforeDone) this.callbacks.move?.(e, d);
    if (this.crossed) this.callbacks.accept?.(e, d);
    else this.callbacks.cancel?.(CancelReason.NoChange);
    this.callbacks.complete?.();
    this.teardown();
  }

  private handleCancel(e: PointerEvent): void {
    if (this.disposed || e.pointerId !== this.pointerId) return;
    if (this.callbacks.callMoveBeforeDone) this.callbacks.move?.(e, this.delta(e));
    this.callbacks.cancel?.(CancelReason.UserAction);
    this.callbacks.complete?.();
    this.teardown();
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.disposed || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    this.callbacks.cancel?.(CancelReason.UserAction);
    this.callbacks.complete?.();
    this.teardown();
  }

  /** Abort from outside — a disconnecting widget must call this or the window
   * listeners outlive it. */
  dispose(): void {
    if (this.disposed) return;
    this.callbacks.cancel?.(CancelReason.Programmatic);
    this.callbacks.complete?.();
    this.teardown();
  }

  private teardown(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.element.releasePointerCapture(this.pointerId);
    } catch {
      /* never captured, or already released */
    }
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    window.removeEventListener('keydown', this.onKey, true);
  }
}

/**
 * Rate-limit state writes to a wall clock, with a guaranteed trailing flush.
 *
 * NOT requestAnimationFrame, and the distinction is load-bearing. nano-lfo
 * coalesced edits into its draw loop and found that Chrome does not run rAF for
 * a backgrounded or occluded tab: a drag on a window that had lost focus set
 * the pending edit and nothing ever consumed it, so the control silently did
 * nothing (plugin_wave.ts:200-210).
 *
 *   Drawing genuinely should stop when nobody is looking.
 *   The state behind it must not.
 *
 * So: rAF for pixels, this for values.
 */
export class Throttle {
  private pending: (() => void) | null = null;
  private timer = 0;
  private lastRun = 0;

  constructor(private readonly intervalMs = 24) {}

  push(fn: () => void): void {
    this.pending = fn;
    const since = performance.now() - this.lastRun;
    if (since >= this.intervalMs) {
      this.run();
    } else if (!this.timer) {
      this.timer = window.setTimeout(() => this.run(), this.intervalMs - since);
    }
  }

  /** Run whatever is still held. Call on pointerup — otherwise the last few
   * pixels of every drag are dropped. */
  flush(): void {
    if (this.pending) this.run();
  }

  cancel(): void {
    this.pending = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  private run(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
    }
    const fn = this.pending;
    this.pending = null;
    if (!fn) return;
    this.lastRun = performance.now();
    fn();
  }
}
