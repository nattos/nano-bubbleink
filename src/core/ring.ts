/**
 * A fixed-length ring of samples, for anything that scrolls.
 *
 * Sparklines, meters, convergence traces, the scope's history lane. All of them
 * want the same thing -- the last N values, oldest first, without allocating --
 * and the version in nano-modules' spark-chart.ts is written inline, indexes
 * with `% samples` on every read, and reallocates its history whenever the
 * sample count changes mid-life.
 *
 * `read()` fills a caller-owned linear buffer so the draw path can hand a plain
 * ascending array to the plotter and never think about wrap-around. That matters
 * more than it sounds: a wrapped buffer drawn without unwrapping produces one
 * bogus segment per frame, jumping across the whole plot, which reads as a
 * glitch in the DATA.
 */
export class Ring {
  private readonly buf: Float32Array;
  private linear: Float32Array;
  /** Total pushes ever. The count, not the index -- `writes % n` is the slot. */
  private writes = 0;

  constructor(readonly capacity: number) {
    this.buf = new Float32Array(Math.max(1, capacity));
    this.linear = new Float32Array(this.buf.length);
  }

  /** How many real samples are held. Below capacity until the ring fills, so a
   * fresh sparkline draws the three samples it has rather than 61 zeros -- a
   * zero it never measured is a value it is asserting. */
  get length(): number {
    return Math.min(this.writes, this.buf.length);
  }

  get latest(): number {
    return this.writes === 0 ? 0 : this.buf[(this.writes - 1) % this.buf.length];
  }

  push(v: number): void {
    this.buf[this.writes % this.buf.length] = v;
    this.writes++;
  }

  clear(): void {
    this.writes = 0;
    this.buf.fill(0);
  }

  /** Oldest to newest, into a reused buffer. The returned array is only valid
   * until the next call -- callers draw from it and drop it. */
  read(): Float32Array {
    const n = this.length;
    const cap = this.buf.length;
    const start = this.writes - n;
    for (let i = 0; i < n; i++) this.linear[i] = this.buf[(start + i) % cap];
    return this.linear.subarray(0, n);
  }

  /** Min and max over the held samples, for an autoscaling axis. Returns null
   * when empty, so a caller can tell "no data" from "all zero". */
  extent(): [number, number] | null {
    const n = this.length;
    if (n === 0) return null;
    const cap = this.buf.length;
    const start = this.writes - n;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = this.buf[(start + i) % cap];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }
}
