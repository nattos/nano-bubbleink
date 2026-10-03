/**
 * The plot FRAME: a box, two axes, the mapping between data and pixels, and a
 * grid that tells the truth about the domain. Pure -- no DOM, no state, no CSS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A FILE AND NOT THREE COPIES
 *
 * The prior art has the same drawing three times and they disagree in every
 * particular. envelope-inspector pads 10px, xfade-curve pads 3px, spark-chart
 * pads none. Two of them hardcode a quarter grid; the third has no grid. One
 * reads its accent from --app-hi-color1, one hardcodes rgba(65,105,225).
 * Individually each is fine. Together they are three charts that look like they
 * came from three products, and no amount of shared colour tokens fixes that,
 * because what differs is the FRAME.
 *
 * So the frame is the shared thing and the content is a list. Everything in
 * here is about the box the data sits in; nothing in here knows what the data
 * is.
 *
 * ---------------------------------------------------------------------------
 * TICKS ARE COMPUTED, NEVER QUARTERED
 *
 * All three prior graphs draw quarters, and all three are correct to do so,
 * because all three plot a normalised [0,1] against a normalised [0,1]. Ours
 * will not: a transfer curve is dB, a mode bank is Hz over eight octaves, a
 * convergence trace is iterations. A quarter grid on a 27.5..7040 Hz axis puts
 * lines at 1786 and 3413 Hz, which are not numbers anybody wants to read, and
 * the reader either does the arithmetic or -- far more likely -- stops trusting
 * the axis and reads the shape only.
 *
 * `niceTicks` picks from the 1/2/5 ladder for a linear axis and from decades
 * (with 2 and 5 subdivisions when there is room) for a log one. It returns a
 * MAJOR flag rather than two lists, so the tiering is one pass and a label can
 * always be attached to the line it belongs to.
 */

export type AxisKind = 'linear' | 'log';

export interface Axis {
  min: number;
  max: number;
  /** `log` needs min > 0 and silently falls back to linear otherwise -- the
   * same policy as core/schema.ts, and for the same reason: a surface that
   * quietly stops mapping is worse than one with the wrong feel. */
  kind?: AxisKind;
  /** Axis name, shown at expanded density. */
  label?: string;
  /** Tick formatter. Defaults to a compact general-purpose number. */
  format?: (v: number) => string;
}

export interface Box { x: number; y: number; w: number; h: number }

export interface Plot {
  box: Box;
  x: Axis;
  y: Axis;
  /** Data -> pixels. Unclamped: a caller drawing a trace needs the true pixel
   * position of an out-of-range sample so it can clip the PATH rather than the
   * DATA -- clamping here would fold an overshoot flat onto the rail and draw a
   * limiter that is not in the signal. */
  toX(v: number): number;
  toY(v: number): number;
  fromX(px: number): number;
  fromY(py: number): number;
}

const isLog = (a: Axis) => a.kind === 'log' && a.min > 0 && a.max > a.min;

export function makePlot(box: Box, x: Axis, y: Axis): Plot {
  const xl = isLog(x);
  const yl = isLog(y);
  const lxr = xl ? Math.log(x.max / x.min) : 0;
  const lyr = yl ? Math.log(y.max / y.min) : 0;
  const xr = x.max - x.min || 1;
  const yr = y.max - y.min || 1;
  return {
    box, x, y,
    toX: (v) => box.x + (xl ? Math.log(Math.max(1e-30, v) / x.min) / lxr : (v - x.min) / xr) * box.w,
    // y up: the data's maximum is the box's TOP.
    toY: (v) => box.y + box.h - (yl ? Math.log(Math.max(1e-30, v) / y.min) / lyr : (v - y.min) / yr) * box.h,
    fromX: (px) => {
      const t = (px - box.x) / (box.w || 1);
      return xl ? x.min * Math.exp(t * lxr) : x.min + t * xr;
    },
    fromY: (py) => {
      const t = (box.y + box.h - py) / (box.h || 1);
      return yl ? y.min * Math.exp(t * lyr) : y.min + t * yr;
    },
  };
}

export interface Tick { v: number; major: boolean }

/** The 1/2/5 ladder step nearest `target` divisions across `span`. */
function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function niceTicks(a: Axis, target = 5): Tick[] {
  const out: Tick[] = [];
  if (!(a.max > a.min)) return out;
  if (isLog(a)) {
    const d0 = Math.floor(Math.log10(a.min));
    const d1 = Math.ceil(Math.log10(a.max));
    // Below ~4 decades a bare decade grid is too sparse to read a value off, so
    // the 2 and 5 rungs come in as minors. Above it they would be a smear.
    const sub = d1 - d0 <= 4 ? [1, 2, 5] : [1];
    for (let d = d0; d <= d1; d++) {
      for (const m of sub) {
        const v = m * Math.pow(10, d);
        if (v >= a.min && v <= a.max) out.push({ v, major: m === 1 });
      }
    }
    return out;
  }
  const step = niceStep(a.max - a.min, target);
  const first = Math.ceil(a.min / step) * step;
  // Every other line is major, anchored so zero is always one of them -- the
  // zero rule is the line a bipolar plot is read against and it must not land
  // on a minor.
  for (let v = first, i = 0; v <= a.max + step * 1e-6; v += step, i++) {
    const k = Math.round(v / step);
    out.push({ v: Math.abs(v) < step * 1e-9 ? 0 : v, major: k % 2 === 0 });
  }
  return out;
}

/**
 * Compact tick text. Not `toFixed(2)` everywhere: an axis running 0..1 wants
 * two decimals and one running 27.5..7040 wants none, and the number of
 * decimals a tick needs is a property of the STEP, not of the value.
 */
export function tickFormatter(a: Axis): (v: number) => string {
  if (a.format) return a.format;
  if (isLog(a)) {
    return (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
      : v >= 1 ? String(Math.round(v * 100) / 100)
      : String(Math.round(v * 1e4) / 1e4));
  }
  const step = niceStep(a.max - a.min, 5);
  const dec = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step))));
  return (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : v.toFixed(dec));
}

export interface GridInk {
  /** Major line. */
  major: string;
  /** Minor line -- lighter, unlabelled. */
  minor: string;
  /** The zero rule, on whichever axis crosses zero. Brighter than a major,
   * because it is the one line that means something rather than marking a
   * position. */
  zero: string;
}

/**
 * The grid, in three weights.
 *
 * Tiering is lifted from nano-modules' arr-ruler, where bar / beat /
 * subdivision get three line weights AND three start heights. The reason it
 * works there is the reason it works here: an evenly-weighted grid is a texture
 * the eye filters out, and a tiered one is a ruler the eye counts on.
 */
export function drawGrid(g: CanvasRenderingContext2D, p: Plot, ink: GridInk, xt: Tick[], yt: Tick[]): void {
  const { x, y, w, h } = p.box;
  g.save();
  g.lineWidth = 1;
  for (const t of yt) {
    const py = Math.round(p.toY(t.v)) + 0.5;
    if (py < y - 0.5 || py > y + h + 0.5) continue;
    g.strokeStyle = t.v === 0 && p.y.min < 0 && p.y.max > 0 ? ink.zero : t.major ? ink.major : ink.minor;
    g.beginPath();
    g.moveTo(x, py);
    g.lineTo(x + w, py);
    g.stroke();
  }
  for (const t of xt) {
    const px = Math.round(p.toX(t.v)) + 0.5;
    if (px < x - 0.5 || px > x + w + 0.5) continue;
    g.strokeStyle = t.v === 0 && p.x.min < 0 && p.x.max > 0 ? ink.zero : t.major ? ink.major : ink.minor;
    g.beginPath();
    g.moveTo(px, y);
    g.lineTo(px, y + h);
    g.stroke();
  }
  g.restore();
}

/** Tick labels along the bottom and left rails. Majors only -- a labelled minor
 * is how an axis turns into a wall of digits. */
export function drawTickLabels(
  g: CanvasRenderingContext2D, p: Plot, color: string, font: string, xt: Tick[], yt: Tick[],
): void {
  const { x, y, w, h } = p.box;
  const fx = tickFormatter(p.x);
  const fy = tickFormatter(p.y);
  g.save();
  g.fillStyle = color;
  g.font = font;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  let lastY = -Infinity;
  for (const t of yt) {
    if (!t.major) continue;
    const py = p.toY(t.v);
    // Drop a label that would collide with the one below it. Better a sparse
    // axis than an unreadable one; the LINE is still there either way.
    if (py < y - 1 || py > y + h + 1 || Math.abs(py - lastY) < 11) continue;
    lastY = py;
    g.fillText(fy(t.v), x - 4, py);
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  let lastX = -Infinity;
  for (const t of xt) {
    if (!t.major) continue;
    const px = p.toX(t.v);
    const text = fx(t.v);
    const half = g.measureText(text).width / 2;
    if (px < x - 1 || px > x + w + 1 || px - half < lastX + 6) continue;
    lastX = px + half;
    g.fillText(text, px, y + h + 4);
  }
  g.restore();
}

/**
 * Column decimation: min and max per pixel column.
 *
 * A 4096-sample frame drawn into 200 pixels by taking every 20th sample is not
 * a smaller picture of the signal, it is a DIFFERENT signal -- stride sampling
 * beats against any periodicity in the data and produces slow ripples that are
 * an artefact of the window width. Every scope that does it shows patterns that
 * move when you resize the panel.
 *
 * Min/max per column is the honest reduction: the envelope drawn is exactly the
 * envelope of the samples in that column, so the picture gets coarser as the
 * box narrows and never gains structure that is not in the data.
 */
export interface Columns { min: Float32Array; max: Float32Array; cols: number }

export function decimate(read: (i: number) => number, n: number, cols: number): Columns {
  const c = Math.max(1, Math.floor(cols));
  const lo = new Float32Array(c);
  const hi = new Float32Array(c);
  lo.fill(Infinity);
  hi.fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const k = Math.min(c - 1, Math.floor((i / Math.max(1, n - 1)) * (c - 1)));
    const v = read(i);
    if (v < lo[k]) lo[k] = v;
    if (v > hi[k]) hi[k] = v;
  }
  // A column no sample landed in (more columns than samples) inherits its
  // neighbour rather than staying at +/-Infinity, so the path is continuous.
  let last = -1;
  for (let k = 0; k < c; k++) {
    if (lo[k] === Infinity) {
      if (last >= 0) { lo[k] = lo[last]; hi[k] = hi[last]; }
    } else last = k;
  }
  for (let k = c - 1; k >= 0; k--) {
    if (lo[k] === Infinity && k + 1 < c) { lo[k] = lo[k + 1]; hi[k] = hi[k + 1]; }
  }
  return { min: lo, max: hi, cols: c };
}
