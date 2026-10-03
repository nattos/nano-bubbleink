/**
 * The layer painters. One function per KIND of thing a graph can show.
 *
 * Pure, like everything in draw/: a context, a Plot, a resolved ink, and plain
 * data. Nothing here reads CSS, touches the DOM, or knows which widget called
 * it -- the widget resolves tokens into an `Ink` once and hands it down. That
 * is the portability rule (a texture that had to be reimplemented to move would
 * not survive the move), and it is also what lets the same painter draw into an
 * offscreen bitmap for the cache.
 *
 * ---------------------------------------------------------------------------
 * RANK APPLIES TO A SERIES
 *
 * Four traces on one surface fail the same way eight knobs in a row did: they
 * all shout, they average to a wash, and the eye has nowhere to land. So a
 * series carries the family's own `rank`, meaning the same thing it means on a
 * control -- `lead` is filled and blooming, `counter` is a hairline with the
 * fill withdrawn. It is the same inversion, and one graph should have one lead.
 *
 * ---------------------------------------------------------------------------
 * CLIPPING IS ANNOUNCED
 *
 * A trace that leaves the y-axis gets clipped to the box, which is correct, and
 * the flat run along the rail is then indistinguishable from a signal that
 * genuinely limited there. That is the single most common lie a scope tells. So
 * `paintTrace` reports which rails it hit and the caller draws a fringe on them
 * -- the smallest possible mark that says "the shape continues past here".
 */
import type { Plot } from './plot';
import { decimate } from './plot';
import { minMark } from './marks';
import { sampleKnots, type Knot } from '../core/curve';

/** Everything a painter needs to know about colour, resolved from tokens. */
export interface Ink {
  line: string;
  lineWidth: number;
  /** Fill under the trace, or null for none. */
  fill: string | null;
  /** Ink skins fill with a SCREEN, not a wash -- see hatchPattern. */
  hatch: boolean;
  /** Which screen, when the layer names one (any skin): layers filled over
   *  one another stay apart by their screen as well as their colour. */
  pattern?: FillPattern;
  /** Crystal bloom under the line. Null on the ink skins, where a printed line
   * does not glow and a blur reads as a registration error. */
  glow: string | null;
  node: string;
  nodeEdge: string;
  /** Announced clipping, and anything else that means "the picture is not the
   * whole story". Amber by house rule. */
  caution: string;
}

/**
 * Where a path ran past the frame -- per pixel column, not per rail.
 *
 * A boolean "this trace clipped somewhere" can only be drawn as a bar across
 * the whole width, and a full-width bar is louder than the trace it annotates
 * while saying less than the trace already shows. Per column it becomes a set
 * of ticks under exactly the peaks that left, which is both quieter and the
 * actually useful answer -- "here, here and here" rather than "somewhere".
 *
 * One mask is allocated per draw by the widget and shared by every layer, so
 * two series clipping in the same column produce one mark, not two.
 */
export class ClipMask {
  readonly top: Uint8Array;
  readonly bottom: Uint8Array;
  any = false;

  constructor(readonly x0: number, readonly cols: number) {
    const n = Math.max(1, Math.ceil(cols));
    this.top = new Uint8Array(n);
    this.bottom = new Uint8Array(n);
  }

  /** Half a pixel of tolerance: a sample sitting exactly ON the rail is at the
   * frame's edge, not past it, and reporting that as clipped puts a permanent
   * caution mark on every graph whose data touches its own axis. */
  mark(px: number, py: number, top: number, bottom: number): void {
    if (py >= top - 0.5 && py <= bottom + 0.5) return;
    const k = Math.round(px - this.x0);
    if (k < 0 || k >= this.top.length) return;
    if (py < top) this.top[k] = 1; else this.bottom[k] = 1;
    this.any = true;
  }
}

/**
 * A polyline, as a flat [x0,y0,x1,y1,...] list.
 *
 * Built once and consumed twice -- stroked, and filled to a baseline. That is
 * not an optimisation, it is a correctness fix. The first version passed a
 * `path()` CALLBACK to both, and the callback opened with moveTo; inside the
 * fill that started a new subpath, so closePath joined the last point back to
 * the first DATA point instead of to the baseline corner, and every filled
 * series rendered a lens-shaped wedge instead of the area under it. Sharing the
 * points instead of the path-building makes that unrepresentable -- and it also
 * stops paintCurve evaluating its function twice per frame.
 */
type Pts = number[];

function strokePts(g: CanvasRenderingContext2D, ink: Ink, pts: Pts): void {
  if (pts.length < 4) return;
  const trace = () => {
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  };
  // The bloom first, as a wide soft pass under the line. Two strokes rather
  // than shadowBlur: shadowBlur on a long polyline is measured in whole frames,
  // and this is a per-frame path.
  if (ink.glow) {
    g.save();
    g.strokeStyle = ink.glow;
    g.lineWidth = ink.lineWidth + 3.5;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    trace();
    g.stroke();
    g.restore();
  }
  g.save();
  g.strokeStyle = ink.line;
  g.lineWidth = ink.lineWidth;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  trace();
  g.stroke();
  g.restore();
}

/**
 * The ink skins' fill: a 45-degree screen, not an alpha wash.
 *
 * On paper a tint IS a screen of dots or lines -- there is no such thing as
 * half a pigment. A 20%-alpha flood under a solid key line reads as a printing
 * fault, a plate laid down at the wrong density, which is exactly the mistake
 * the skin spends the rest of its effort avoiding. Cached per colour because
 * createPattern allocates a canvas.
 */
const hatchCache = new Map<string, CanvasPattern | null>();

/** The screens: `fwd` the house 45-degree rule (/), `back` its mirror (\),
 *  `rule` horizontal lines, `dots` a dot grid. All the same weight of ink,
 *  so no layer reads louder for its screen. */
export type FillPattern = 'fwd' | 'back' | 'rule' | 'dots';

export function hatchPattern(g: CanvasRenderingContext2D, color: string, kind: FillPattern = 'fwd'): CanvasPattern | null {
  const key = `${kind} ${color}`;
  const hit = hatchCache.get(key);
  if (hit !== undefined) return hit;
  const s = kind === 'dots' ? 4 : 5;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const h = c.getContext('2d');
  let pat: CanvasPattern | null = null;
  if (h) {
    h.strokeStyle = color;
    h.fillStyle = color;
    h.lineWidth = 1;
    if (kind === 'rule') {
      h.fillRect(0, 0, s, 1);
    } else if (kind === 'dots') {
      h.fillRect(1, 1, 1.5, 1.5);
    } else {
      // Two strokes so the diagonal is continuous across tile edges;
      // `back` is the same tile mirrored.
      if (kind === 'back') { h.translate(s, 0); h.scale(-1, 1); }
      h.beginPath();
      h.moveTo(-1, s + 1);
      h.lineTo(s + 1, -1);
      h.moveTo(-1, 1);
      h.lineTo(1, -1);
      h.moveTo(s - 1, s + 1);
      h.lineTo(s + 1, s - 1);
      h.stroke();
    }
    pat = g.createPattern(c, 'repeat');
  }
  hatchCache.set(key, pat);
  return pat;
}

function fillPts(g: CanvasRenderingContext2D, p: Plot, ink: Ink, pts: Pts): void {
  if (!ink.fill || pts.length < 4) return;
  // The baseline is zero when the axis straddles it and the floor otherwise --
  // a bipolar signal filled from the bottom of the box reads as all-positive.
  const base = p.y.min < 0 && p.y.max > 0 ? p.toY(0) : p.box.y + p.box.h;
  g.save();
  g.beginPath();
  g.moveTo(pts[0], base);
  for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.lineTo(pts[pts.length - 2], base);
  g.closePath();
  const screen = ink.pattern ?? (ink.hatch ? 'fwd' : null);
  g.fillStyle = screen ? (hatchPattern(g, ink.fill, screen) ?? ink.fill) : ink.fill;
  g.fill();
  g.restore();
}

/** Confine drawing to the plot box. Every painter runs inside one of these. */
export function withBox<T>(g: CanvasRenderingContext2D, p: Plot, fn: () => T): T {
  g.save();
  g.beginPath();
  g.rect(p.box.x, p.box.y, p.box.w, p.box.h);
  g.clip();
  try { return fn(); } finally { g.restore(); }
}

/**
 * A dense sample array over the x-domain, decimated to pixel columns.
 *
 * `n` samples map onto x-min..x-max. Fewer samples than columns draws a plain
 * polyline through them; more draws the min/max envelope.
 */
export function paintTrace(
  g: CanvasRenderingContext2D, p: Plot, ink: Ink,
  read: (i: number) => number, n: number, clip?: ClipMask,
): void {
  if (n <= 0) return;
  const { x, y, w, h } = p.box;
  const top = y;
  const bot = y + h;
  const mark = (px: number, py: number) => clip?.mark(px, py, top, bot);

  withBox(g, p, () => {
    if (n <= w) {
      const step = n > 1 ? w / (n - 1) : 0;
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        const py = p.toY(read(i));
        const px = x + i * step;
        mark(px, py);
        pts.push(px, py);
      }
      fillPts(g, p, ink, pts);
      strokePts(g, ink, pts);
      return;
    }
    // Above one sample per column the honest picture is the envelope's AREA,
    // not a line through its middle: a stroke of the outline alone leaves a
    // hollow ribbon that reads as two signals. And the area IS the trace here,
    // so there is no separate fill-to-baseline -- flooding under a 4096-sample
    // waveform would put a solid block behind the only thing worth seeing.
    const col = decimate(read, n, Math.round(w));
    g.save();
    g.beginPath();
    for (let k = 0; k < col.cols; k++) {
      const py = p.toY(col.max[k]);
      mark(x + k, py);
      if (k === 0) g.moveTo(x + k, py); else g.lineTo(x + k, py);
    }
    for (let k = col.cols - 1; k >= 0; k--) {
      const py = p.toY(col.min[k]);
      mark(x + k, py);
      g.lineTo(x + k, py);
    }
    g.closePath();
    g.fillStyle = ink.line;
    g.fill();
    g.restore();
  });
}

/** An analytic function of x, sampled per pixel column. */
export function paintCurve(
  g: CanvasRenderingContext2D, p: Plot, ink: Ink, f: (x: number) => number,
  samples = 0, clip?: ClipMask,
): void {
  const { x, y, w, h } = p.box;
  const n = Math.max(2, samples || Math.round(w));
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const px = x + (i / (n - 1)) * w;
    const py = p.toY(f(p.fromX(px)));
    clip?.mark(px, py, y, y + h);
    pts.push(px, py);
  }
  withBox(g, p, () => {
    fillPts(g, p, ink, pts);
    strokePts(g, ink, pts);
  });
}

export interface KnotInk extends Ink {
  /** Radius of a node. Scales with --bi-scale so a 40% graph keeps grabbable
   * nodes rather than dots. */
  nodeR: number;
  /** The node under the pointer, or -1. */
  hot: number;
  /** Nodes are drawn at all only when the curve is editable; a read-only knot
   * curve is just a curve, and dots on it advertise a gesture that does not
   * exist. */
  nodes: boolean;
}

export function paintKnots(g: CanvasRenderingContext2D, p: Plot, ink: KnotInk, knots: Knot[]): void {
  if (knots.length === 0) return;
  const { x, w } = p.box;
  const pts = sampleKnots(knots, Math.max(48, Math.round(w)));
  const first = p.toX(pts[0][0]);
  const last = p.toX(pts[pts.length - 1][0]);
  // The held run before the first knot and after the last -- the curve
  // evaluates flat out there, so drawing nothing would leave the reader to
  // guess, and guessing "zero" is the usual guess.
  const flat: number[] = [];
  if (first > x) flat.push(x, p.toY(pts[0][1]));
  for (const [dx, dy] of pts) flat.push(p.toX(dx), p.toY(dy));
  if (last < x + w) flat.push(x + w, p.toY(pts[pts.length - 1][1]));
  withBox(g, p, () => {
    fillPts(g, p, ink, flat);
    strokePts(g, ink, flat);
    if (!ink.nodes) return;
    for (let i = 0; i < knots.length; i++) {
      const px = p.toX(knots[i].x);
      const py = p.toY(knots[i].y);
      const r = i === ink.hot ? ink.nodeR + 1.5 : ink.nodeR;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fillStyle = ink.node;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = ink.nodeEdge;
      g.stroke();
    }
  });
}

/**
 * A bar per value -- vectors, spectra, histograms.
 *
 * Bars are floored through minMark: a bar whose natural width rounds below a
 * pixel does not draw faintly, it vanishes, and an absent bar reads as an
 * absent DATUM rather than a small one.
 */
export function paintBars(
  g: CanvasRenderingContext2D, p: Plot, ink: Ink, read: (i: number) => number, n: number,
): void {
  if (n <= 0) return;
  const { x, w } = p.box;
  const slot = w / n;
  const bw = minMark(slot - Math.min(2, slot * 0.25), 1.5);
  const base = p.y.min < 0 && p.y.max > 0 ? p.toY(0) : p.box.y + p.box.h;
  withBox(g, p, () => {
    g.save();
    g.fillStyle = ink.hatch && ink.fill ? (hatchPattern(g, ink.fill, ink.pattern) ?? ink.line) : ink.line;
    for (let i = 0; i < n; i++) {
      const py = p.toY(read(i));
      const cx = x + (i + 0.5) * slot;
      g.fillRect(cx - bw / 2, Math.min(py, base), bw, Math.max(1, Math.abs(base - py)));
    }
    g.restore();
  });
}

/** A filled region between two functions -- a modulation swing band, a
 * tolerance, an unreachable zone. Drawn UNDER everything by convention. */
export function paintBand(
  g: CanvasRenderingContext2D, p: Plot, fill: string,
  lo: (x: number) => number, hi: (x: number) => number, samples = 0,
): void {
  const { x, w } = p.box;
  const n = Math.max(2, samples || Math.round(w / 2));
  withBox(g, p, () => {
    g.save();
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = p.toY(hi(p.fromX(px)));
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    for (let i = n - 1; i >= 0; i--) {
      const px = x + (i / (n - 1)) * w;
      g.lineTo(px, p.toY(lo(p.fromX(px))));
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.restore();
  });
}

export function paintScatter(
  g: CanvasRenderingContext2D, p: Plot, ink: Ink, pts: readonly (readonly [number, number])[], r = 2,
): void {
  withBox(g, p, () => {
    g.save();
    g.fillStyle = ink.line;
    for (const [dx, dy] of pts) {
      g.beginPath();
      g.arc(p.toX(dx), p.toY(dy), r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  });
}

/**
 * The clipping fringe: a tick under each column the data left through.
 *
 * Not a rescale -- the frame the author chose is the frame they get -- and not
 * a banner. Its height scales with the box and floors at a pixel, because a
 * fixed 2px mark is an annotation on a 130px plot and most of the picture on a
 * 16px sparkline.
 */
export function paintClipFringe(g: CanvasRenderingContext2D, p: Plot, clip: ClipMask, color: string): void {
  if (!clip.any) return;
  const { x, y, h } = p.box;
  const t = Math.max(1, Math.min(2.5, h * 0.035));
  g.save();
  g.fillStyle = color;
  for (let k = 0; k < clip.top.length; k++) {
    if (clip.top[k]) g.fillRect(x + k, y, 1, t);
    if (clip.bottom[k]) g.fillRect(x + k, y + h - t, 1, t);
  }
  g.restore();
}
