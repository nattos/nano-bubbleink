/**
 * <bi-graph> -- one plotting surface for the whole family.
 *
 * ---------------------------------------------------------------------------
 * ONE SURFACE, A LIST OF LAYERS
 *
 * The prior art has three graphs written three times. nano-modules'
 * envelope-graph is a breakpoint editor, xfade-curve is a one-parameter
 * analytic curve you can drag, spark-chart is a scrolling ring buffer. They
 * share no code and they agree on nothing -- padding, grid, accent source, even
 * whether the canvas is sized from getBoundingClientRect are all different.
 * Each is fine alone; together they read as three products.
 *
 * What they actually differ in is the CONTENT. The frame -- box, axes, grid,
 * mapping, cursor, readout, staleness -- is one thing said three times. So here
 * the frame is the widget and the content is a list of series:
 *
 *   trace    a dense array of samples over the x-domain (scope, spectrum)
 *   roll     a live scalar, sampled per frame into a ring (the sparkline)
 *   curve    an analytic f(x) (transfer curves, fade laws, filter response)
 *   knots    a breakpoint curve with per-segment bend -- EDITABLE
 *   bars     one bar per value (harmonic vectors, histograms)
 *   scatter  points
 *   band     a filled region between two functions, drawn underneath
 *
 * Mixing them is the point rather than a bonus: the activation-transfer widget
 * this model needs is an analytic curve with a live operating point on it, and
 * a drawn correction curve over the top, and a swing band behind both. Three
 * layers, one surface, one axis pair -- which is the only way those three can
 * be read against each other at all.
 *
 * ---------------------------------------------------------------------------
 * A SPARKLINE IS THIS WIDGET AT COMPACT DENSITY
 *
 * Not a separate element. `compact` takes the frame away entirely -- no border,
 * no grid, no gutter, no labels, no padding -- and what is left is ink in a
 * box, which is what a sparkline is. That is worth insisting on, because
 * <spark-chart> in the prior art is a WORSE graph than its big sibling and
 * nobody noticed: it sizes from clientWidth (the documented runaway-growth
 * loop), holds an unconditional rAF, hardcodes its colour, and pre-fills its
 * history with zeros it never measured. None of those are decisions; they are
 * what happens when the small version is a different file.
 *
 * `normal` adds the well, the grid and a readout line. `expanded` adds tick
 * labels and axis names. Same element, same code, three amounts of frame.
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVES
 *
 * The data does not. Per core/spring.ts, anything representing a temporal
 * process is assigned and never eased -- a trace that springs to its new shape
 * is asserting a morph the signal never performed, and on a scope that is a
 * lie about the waveform.
 *
 * The VIEW does. Autoscale rides the `drift` tier, which is what that tier is
 * for: a transform of the frame the values are drawn in. So the numbers snap
 * and the axis glides, and the two are never confused because they are
 * different objects.
 *
 * ---------------------------------------------------------------------------
 * HOVER, AND WHY THE READOUT IS NOT A TOOLTIP
 *
 * House rule: no popups on hover, especially in a plugin window. A graph makes
 * that tempting -- every charting library on earth answers "what is the value
 * here" with a floating box -- so the rule is restated in code: the crosshair
 * readout lives in the widget's OWN header line, whose space is reserved
 * whether or not anything is hovered, so nothing is covered and nothing
 * reflows. Off the pointer it reads the cursor or the latest sample; under the
 * pointer it reads where the pointer is. At compact there is no header, so
 * hover only sharpens the well's edge, like every other control in the family.
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { base, cssVar } from '../theme/base';
import { withAlpha } from '../theme/ramp';
import { fitCanvas, FrameLoop } from '../core/canvas';
import { Spring } from '../core/spring';
import { Ring } from '../core/ring';
import { Staleness, drawGhost } from '../core/stale';
import { PointerDragOp, Throttle } from '../core/drag';
import { toPos, fromPos } from '../core/schema';
import { domainChars } from '../core/format';
import { drawHaloLine, drawCursor } from '../draw/marks';
import { smoothRect } from '../draw/bud';
import {
  makePlot, niceTicks, tickFormatter, drawGrid, drawTickLabels,
  type Axis, type Box, type Plot, type Tick,
} from '../draw/plot';
import {
  paintTrace, paintCurve, paintKnots, paintBars, paintScatter, paintBand, paintClipFringe,
  ClipMask,
} from '../draw/series';
import {
  resolveInk,
  type Series, type CurveSeries, type KnotSeries, type RollSeries,
} from './graph-series';
import {
  evalCurve, moveKnot, insertKnot, removeKnot, bendSegment, segmentAt,
  DEFAULT_BOUNDS, type Knot,
} from '../core/curve';
import type { FieldBinding, ContinuousEditHandle } from '../core/binding';
import type { Density } from './scalar-base';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const UNIT: Axis = { min: 0, max: 1 };

/** Default heights, in CSS px before --bi-scale. Compact is a text-line's
 * worth: a sparkline that is taller than its row is a chart. */
const HEIGHT: Record<Density, number> = { compact: 22, normal: 84, expanded: 132 };

type DragState =
  | { kind: 'node'; s: KnotSeries; i: number }
  | { kind: 'bend'; s: KnotSeries; i: number; startBend: number; startPy: number }
  | { kind: 'param'; path: string; travel: number; startX: number; startY: number; startPos: number };

@customElement('bi-graph')
export class BiGraph extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: block;
        min-width: 0;
        outline: none;
      }
      .head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--sp-2);
        padding-bottom: 2px;
        min-height: calc(1.35 * var(--fs-xs));
      }
      .name {
        flex: 0 1 auto;
        font-size: var(--fs-sm);
        color: var(--app-text-color2);
        letter-spacing: var(--app-tr-2);
        user-select: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The readout. Right-anchored and allowed to take the slack, so that
       * whether it is empty (no hover, no cursor) or full, the NAME does not
       * move. The reservation inside it -- see the .reading spans in
       * readout() -- keeps the numbers from crawling as the pointer sweeps. */
      .read {
        flex: 1 1 auto;
        text-align: right;
        font-size: var(--fs-xs);
        color: var(--app-text-color1);
        white-space: nowrap;
        user-select: none;
        font-variant-numeric: tabular-nums;
      }
      .read .dim { color: var(--app-text-color3); }
      canvas {
        display: block;
        width: 100%;
        max-width: 100%;
        touch-action: none;
        user-select: none;
      }
      :host([interactive]) canvas { cursor: crosshair; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
      :host([density='compact']) .head { display: none; }
    `,
  ];

  /** Optional -- only a `curve` layer with a drag target needs it. */
  @property({ attribute: false }) binding?: FieldBinding;
  @property({ attribute: false }) series: Series[] = [];
  @property({ attribute: false }) xAxis: Axis = UNIT;
  @property({ attribute: false }) yAxis: Axis = UNIT;
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Reflected so the cursor style can key off it without JS. */
  @property({ type: Boolean, reflect: true }) interactive = false;
  /** Height in CSS px before --bi-scale; 0 takes the density default. */
  @property({ type: Number }) height = 0;
  /**
   * A live playhead in data-x -- the incoming signal's position on a transfer
   * curve, the operating point, the phase. Drawn with the house halo so it
   * reads over any layer.
   */
  @property({ type: Number }) cursor: number | null = null;
  /** Rescale y to the data, on the drift tier. Off by default: a fixed frame
   * is what makes two readings comparable, and an axis that moves on its own
   * is the fastest way to make a small change look like a big one. */
  @property({ type: Boolean }) autoY = false;

  @state() private rev = 0;

  @query('canvas') private canvasEl?: HTMLCanvasElement;

  private readonly ink = true;

  /** Ring per rolling layer, keyed by the series object. A WeakMap so a series
   * the host drops takes its history with it. */
  private readonly rings = new WeakMap<RollSeries, Ring>();

  private readonly hoverS = new Spring(0, 'snap', 1e-3);

  private readonly yLo = new Spring(0, 'drift', 1e-4);
  private readonly yHi = new Spring(1, 'drift', 1e-4);
  private autoInit = false;

  private readonly stale = new Staleness();
  private hoverPx: number | null = null;
  private hotNode = -1;
  private hotSeries: KnotSeries | null = null;
  private drag: DragState | null = null;
  private dragOp: PointerDragOp | null = null;
  private editHandle: ContinuousEditHandle | null = null;
  private readonly throttle = new Throttle(16);
  /** The in-progress edit's knots. The host is the owner, but a controlled
   * component that waits for its parent to hand the value back drops frames
   * mid-drag; this holds the live copy until the gesture ends. */
  private live: { s: KnotSeries; knots: Knot[] } | null = null;
  private ro: ResizeObserver | null = null;

  private readonly loop = new FrameLoop((dt) => {
    let moving = this.hoverS.tick(dt);
    if (this.autoY) moving = this.tickAuto(dt) || moving;
    this.draw();
    return moving || this.hasRolling || this.drag !== null;
  });

  // ---- lifecycle ----

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('pointerenter', this.onEnter);
    this.addEventListener('pointerleave', this.onLeave);
    this.ro = new ResizeObserver(() => this.wake());
    this.ro.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('pointerenter', this.onEnter);
    this.removeEventListener('pointerleave', this.onLeave);
    this.ro?.disconnect();
    this.ro = null;
    this.loop.stop();
    this.dragOp?.dispose();
    this.throttle.cancel();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('series')) {
      this.interactive = this.series.some(
        (s) => (s.kind === 'knots' && s.edit) || (s.kind === 'curve' && !!s.drag),
      );
      this.stale.markCurrent();
    }
    this.wake();
  }

  /** Draw at least one more frame. The loop parks itself when nothing is live,
   * so a page of static graphs costs nothing between changes. */
  private wake(): void {
    this.loop.wake();
  }

  private get hasRolling(): boolean {
    return this.series.some((s) => s.kind === 'roll');
  }

  // ---- hover ----

  private onEnter = (): void => {
    if (this.disabled) return;
    this.hoverS.target = 1;
    this.wake();
  };

  private onLeave = (): void => {
    if (this.drag) return;
    this.hoverS.target = 0;
    this.hoverPx = null;
    this.hotNode = -1;
    this.hotSeries = null;
    this.rev++;
    this.wake();
  };

  // ---- geometry ----

  private get scale(): number {
    return parseFloat(getComputedStyle(this).getPropertyValue('--bi-scale')) || 1;
  }

  private get boxHeight(): number {
    return (this.height || HEIGHT[this.density]) * this.scale;
  }

  /** Tick-label size, and whether there is any point drawing them.
   *
   * At --bi-scale 0.4 a 9px label is 3.6px, which is not a small number, it is
   * a smudge -- and it costs the plot a third of its width for a gutter full of
   * smudges. Below the floor the labels are dropped and the gutter collapses,
   * so `expanded` degrades to `normal` rather than to an unreadable version of
   * itself. Same rule as minMark, applied to type: a mark too small to be
   * understood is indistinguishable from a bug. */
  private get labelFs(): number {
    return 9 * this.scale;
  }

  private get labelled(): boolean {
    return this.density === 'expanded' && this.labelFs >= 7;
  }

  /**
   * The plot box inside the canvas.
   *
   * The left gutter is MEASURED from the widest y label rather than reserved at
   * a guess: an axis running 0..1 needs 22px and one running 27.5..7040 needs
   * 34, and a fixed gutter either clips the second or wastes a tenth of the
   * plot on the first -- which at 40% scale is the difference between a
   * readable chart and a stripe.
   */
  private boxFor(g: CanvasRenderingContext2D, w: number, h: number, yt: Tick[], font: string): Box {
    if (this.density === 'compact') return { x: 0, y: 0, w, h };
    const pad = 3 * this.scale;
    if (!this.labelled) {
      return { x: pad, y: pad, w: Math.max(1, w - 2 * pad), h: Math.max(1, h - 2 * pad) };
    }
    g.save();
    g.font = font;
    let gutter = 0;
    const fmt = tickFormatter(this.yAxisLive);
    for (const t of yt) if (t.major) gutter = Math.max(gutter, g.measureText(fmt(t.v)).width);
    g.restore();
    const left = Math.ceil(gutter) + 6 * this.scale;
    const bottom = 13 * this.scale;
    return {
      x: left, y: pad,
      w: Math.max(1, w - left - pad * 2),
      h: Math.max(1, h - pad - bottom),
    };
  }

  /** The y axis actually in force -- the authored one, or the sprung autoscale. */
  private get yAxisLive(): Axis {
    if (!this.autoY) return this.yAxis;
    return { ...this.yAxis, min: this.yLo.value, max: this.yHi.value };
  }

  /**
   * Autoscale, snapped to the tick ladder before it is sprung.
   *
   * Tracking the raw extent makes the axis twitch on every frame of a live
   * signal, and a twitching axis moves the data drawn against it. Snapping the
   * TARGET to round numbers means the axis only moves when the reading has
   * genuinely changed scale, and then it glides once.
   */
  private tickAuto(dt: number): boolean {
    let lo = Infinity;
    let hi = -Infinity;
    const see = (v: number) => { if (v < lo) lo = v; if (v > hi) hi = v; };
    for (const s of this.series) {
      if (s.kind === 'trace' || s.kind === 'bars') {
        for (let i = 0; i < s.data.length; i++) see(s.data[i]);
      } else if (s.kind === 'roll') {
        const e = this.ringFor(s).extent();
        if (e) { see(e[0]); see(e[1]); }
      } else if (s.kind === 'knots') {
        for (const k of this.knotsOf(s)) see(k.y);
      }
    }
    if (lo === Infinity) return this.yLo.tick(dt) || this.yHi.tick(dt);
    const span = Math.max(1e-9, hi - lo);
    const step = Math.pow(10, Math.floor(Math.log10(span / 3)));
    const rlo = Math.floor(lo / step) * step;
    const rhi = Math.ceil(hi / step) * step;
    this.yLo.target = rlo;
    this.yHi.target = rhi > rlo ? rhi : rlo + step;
    if (!this.autoInit) {
      this.autoInit = true;
      this.yLo.snapTo(this.yLo.target);
      this.yHi.snapTo(this.yHi.target);
    }
    return this.yLo.tick(dt) || this.yHi.tick(dt);
  }

  private ringFor(s: RollSeries): Ring {
    let r = this.rings.get(s);
    if (!r) { r = new Ring(s.samples ?? 96); this.rings.set(s, r); }
    return r;
  }

  private knotsOf(s: KnotSeries): Knot[] {
    return this.live && this.live.s === s ? this.live.knots : s.knots;
  }

  // ---- materials ----

  // ---- the draw ----

  private draw(): void {
    const c = this.canvasEl;
    if (!c) return;
    const size = fitCanvas(c);
    if (!size) return;
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, size.w, size.h);

    const font = `${this.labelFs.toFixed(1)}px ${cssVar(this, '--app-mono', 'monospace')}`;
    const yAxis = this.yAxisLive;
    const yt = niceTicks(yAxis, this.density === 'compact' ? 3 : 4);
    const xt = niceTicks(this.xAxis, this.density === 'expanded' ? 6 : 4);
    const box = this.boxFor(g, size.w, size.h, yt, font);
    const p = makePlot(box, this.xAxis, yAxis);

    this.paintWell(g, p);
    if (this.density !== 'compact') {
      drawGrid(g, p, {
        minor: cssVar(this, '--plot-grid', 'rgba(255,255,255,0.045)'),
        major: cssVar(this, '--plot-grid-major', 'rgba(255,255,255,0.10)'),
        zero: cssVar(this, '--plot-zero', 'rgba(255,255,255,0.22)'),
      }, xt, yt);
    }

    // Bands first, everything else in author order, editable knots last so
    // their nodes are never buried under a later layer. One clip mask for the
    // whole surface, so two layers leaving through the same column mark it once.
    const clip = new ClipMask(box.x, box.w);
    for (const s of this.series) if (s.kind === 'band') this.paintOne(g, p, s, clip);
    for (const s of this.series) if (s.kind !== 'band' && s.kind !== 'knots') this.paintOne(g, p, s, clip);
    for (const s of this.series) if (s.kind === 'knots') this.paintOne(g, p, s, clip);

    // The fringe announces that the data leaves the frame THE AUTHOR CHOSE.
    // Under autoY the frame is chosen by the data, so it always contains it and
    // any excursion is the axis spring being a frame behind -- announcing that
    // would put a permanent caution stripe on every live graph.
    if (!this.autoY) {
      paintClipFringe(g, p, clip, withAlpha(cssVar(this, '--app-caution', '#e8a83c'), 0.85));
    }

    if (this.cursor != null && this.cursor >= p.x.min && this.cursor <= p.x.max) {
      const cx = p.toX(this.cursor);
      drawHaloLine(g, cx, box.y, cx, box.y + box.h, withAlpha(cssVar(this, '--app-text-color1', '#fff'), 0.6));
      const lead = this.series.find((s) => s.kind !== 'band');
      const v = lead ? this.valueAt(lead, this.cursor) : null;
      if (v != null) drawCursor(g, cx, p.toY(v), 4 * this.scale, cssVar(this, '--juice-hot', '#fff'));
    }

    // The pointer crosshair. A rule, not a box -- the numbers are in the head.
    if (this.hoverPx != null && this.density !== 'compact' && this.hoverS.value > 0.01) {
      const x = clamp(this.hoverPx, box.x, box.x + box.w);
      g.save();
      g.globalAlpha = this.hoverS.value;
      g.strokeStyle = cssVar(this, '--hover-edge', 'rgba(255,255,255,0.26)');
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, box.y);
      g.lineTo(Math.round(x) + 0.5, box.y + box.h);
      g.stroke();
      g.restore();
    }

    if (this.labelled) {
      drawTickLabels(g, p, cssVar(this, '--app-text-color3', '#888'), font, xt, yt);
    }
    if (this.stale.ghost) {
      drawGhost(g, size.w, size.h, cssVar(this, '--app-bg-color1', '#000'),
        'holding the previous result', cssVar(this, '--app-caution', '#e8a83c'));
    }
    this.rev++;
  }

  /**
   * The well: the same ground and the same squircled edge every other container
   * in the family has, so a graph sits in a panel as a member of it rather than
   * as an embedded chart.
   */
  private paintWell(g: CanvasRenderingContext2D, p: Plot): void {
    if (this.density === 'compact') return;
    const { x, y, w, h } = p.box;
    const r = parseFloat(cssVar(this, '--app-r-3', '4')) * this.scale;
    const path = new Path2D(smoothRect(x + 0.5, y + 0.5, w - 1, h - 1, r, 1));
    g.save();
    g.fillStyle = cssVar(this, '--well-bg', '#04060a');
    g.fill(path);
    const rest = cssVar(this, '--well-edge', 'rgba(255,255,255,0.08)');
    const hot = cssVar(this, '--hover-edge', 'rgba(255,255,255,0.26)');
    // Two passes rather than an interpolation: canvas has no color-mix, and
    // cross-fading the two strokes is what the hover spring is FOR.
    g.strokeStyle = rest;
    g.lineWidth = 1;
    g.stroke(path);
    if (this.hoverS.value > 0.01) {
      g.globalAlpha = this.hoverS.value;
      g.strokeStyle = hot;
      g.stroke(path);
    }
    g.restore();
  }

  private paintOne(g: CanvasRenderingContext2D, p: Plot, s: Series, clip: ClipMask): void {
    const ink = resolveInk(this, s, this.scale, this.ink);
    switch (s.kind) {
      case 'trace':
        paintTrace(g, p, ink, (i) => s.data[i], s.data.length, clip);
        break;
      case 'roll': {
        const r = this.ringFor(s);
        r.push(s.poll());
        const buf = r.read();
        paintTrace(g, p, ink, (i) => buf[i], buf.length, clip);
        break;
      }
      case 'curve':
        paintCurve(g, p, ink, s.f, 0, clip);
        break;
      case 'knots':
        paintKnots(g, p, {
          ...ink,
          nodeR: this.nodeR,
          hot: this.hotSeries === s ? this.hotNode : -1,
          // Nodes only where they can be hit. In a 20px-tall box a node is
          // larger than the curve it sits on and no pointer can land between
          // two of them, so drawing them advertises a gesture the size does not
          // deliver -- the compact column is a picture, not an editor.
          nodes: !!s.edit && p.box.h >= 34,
        }, this.knotsOf(s));
        break;
      case 'bars':
        paintBars(g, p, ink, (i) => s.data[i], s.data.length);
        break;
      case 'scatter':
        paintScatter(g, p, ink, s.points, 2 * this.scale);
        break;
      case 'band':
        paintBand(g, p, ink.fill ?? withAlpha(ink.line, 0.14), s.lo, s.hi);
        break;
    }
  }

  // ---- reading ----

  /** A series' y at a given data-x, or null when it has no answer there. */
  private valueAt(s: Series, x: number): number | null {
    const idxOf = (n: number) => {
      const t = (x - this.xAxis.min) / (this.xAxis.max - this.xAxis.min || 1);
      return clamp(Math.round(t * (n - 1)), 0, n - 1);
    };
    switch (s.kind) {
      case 'trace': return s.data.length ? s.data[idxOf(s.data.length)] : null;
      case 'bars': return s.data.length ? s.data[idxOf(s.data.length)] : null;
      case 'roll': { const r = this.ringFor(s); return r.length ? r.read()[idxOf(r.length)] : null; }
      case 'curve': return s.f(x);
      case 'knots': return evalCurve(this.knotsOf(s), x);
      default: return null;
    }
  }

  // ---- gestures ----

  private local(e: PointerEvent | MouseEvent): [number, number] {
    const r = this.canvasEl!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  /** Rebuild the plot for hit-testing. Cheap, and it must use exactly the
   * geometry the last draw used -- a hit test computed from a second, slightly
   * different box is how a node ends up grabbable one pixel off itself. */
  private plotNow(): Plot | null {
    const c = this.canvasEl;
    if (!c) return null;
    const g = c.getContext('2d');
    const r = c.getBoundingClientRect();
    if (!g || r.width < 1) return null;
    const yAxis = this.yAxisLive;
    const font = `${this.labelFs.toFixed(1)}px ${cssVar(this, '--app-mono', 'monospace')}`;
    const yt = niceTicks(yAxis, this.density === 'compact' ? 3 : 4);
    return makePlot(this.boxFor(g, r.width, r.height, yt, font), this.xAxis, yAxis);
  }

  private get editable(): KnotSeries | null {
    return (this.series.find((s) => s.kind === 'knots' && s.edit) as KnotSeries) ?? null;
  }

  /** Node radius, floored: below ~2.5px a node is a speck rather than a
   * handle, and a handle you cannot see is one you cannot aim at. */
  private get nodeR(): number {
    return Math.max(2.5, 3.6 * this.scale);
  }

  private hitNode(p: Plot, s: KnotSeries, px: number, py: number): number {
    // The hit radius is floored harder than the drawn one, and deliberately
    // larger than it: a pointer target does not shrink just because the picture
    // did.
    const rad = Math.max(9, 11 * this.scale);
    let best = -1;
    let bestD = rad * rad;
    const knots = this.knotsOf(s);
    for (let i = 0; i < knots.length; i++) {
      const d = (p.toX(knots[i].x) - px) ** 2 + (p.toY(knots[i].y) - py) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  private onMove = (e: PointerEvent): void => {
    if (this.disabled) return;
    const [px, py] = this.local(e);
    this.hoverPx = px;
    const s = this.editable;
    const p = s ? this.plotNow() : null;
    this.hotSeries = s;
    this.hotNode = s && p ? this.hitNode(p, s, px, py) : -1;
    this.rev++;
    this.wake();
  };

  private onDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0) return;
    const p = this.plotNow();
    if (!p) return;
    const [px, py] = this.local(e);
    const s = this.editable;

    if (s) {
      const node = this.hitNode(p, s, px, py);
      if (node >= 0) this.drag = { kind: 'node', s, i: node };
      else {
        const seg = segmentAt(this.knotsOf(s), p.fromX(px));
        if (seg < 0) return;
        this.drag = { kind: 'bend', s, i: seg, startBend: this.knotsOf(s)[seg].bend, startPy: py };
      }
      this.live = { s, knots: this.knotsOf(s).map((k) => ({ ...k })) };
      s.onEditStart?.();
    } else {
      const cs = this.series.find((q) => q.kind === 'curve' && q.drag) as CurveSeries | undefined;
      if (!cs?.drag || !this.binding) return;
      const spec = this.binding.spec(cs.drag.path);
      if (!spec) return;
      this.drag = {
        kind: 'param', path: cs.drag.path, travel: cs.drag.travel ?? 0.25,
        startX: e.clientX, startY: e.clientY,
        startPos: toPos(spec, this.binding.getValue(cs.drag.path)),
      };
      this.editHandle = this.binding.beginContinuousEdit(cs.drag.path, this.binding.getValue(cs.drag.path));
    }

    e.preventDefault();
    this.dragOp = new PointerDragOp(e, this.canvasEl as HTMLElement, {
      move: (ev) => this.dragMove(ev),
      accept: () => { this.throttle.flush(); this.editHandle?.accept(); },
      cancel: () => { this.throttle.cancel(); this.editHandle?.cancel(); },
      complete: () => {
        if (this.drag?.kind === 'node' || this.drag?.kind === 'bend') this.drag.s.onEditEnd?.();
        this.drag = null;
        this.dragOp = null;
        this.editHandle = null;
        this.live = null;
        this.wake();
      },
    });
    this.wake();
  };

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const p = this.plotNow();
    if (!p) return;
    // Shift is fine everywhere in this family: 0.25x on a rotary, 0.25x here.
    const slow = e.shiftKey ? 0.25 : 1;

    if (d.kind === 'param') {
      const spec = this.binding?.spec(d.path);
      if (!spec) return;
      // Right and up both increase, at one full range per `travel` of the box.
      const dpx = (e.clientX - d.startX) - (e.clientY - d.startY);
      const pos = clamp(d.startPos + (slow * dpx) / (p.box.w * d.travel), 0, 1);
      const v = fromPos(spec, pos);
      this.throttle.push(() => this.editHandle?.update(v));
      this.rev++;
      this.wake();
      return;
    }

    const [px, py] = this.local(e);
    const bounds = d.s.bounds ?? DEFAULT_BOUNDS;
    let next: Knot[];
    if (d.kind === 'node') {
      next = moveKnot(this.knotsOf(d.s), d.i, p.fromX(px), p.fromY(py), bounds);
    } else {
      // ~120px of vertical travel spans the whole bend range. Down bends down,
      // which is the direction the curve visibly goes.
      const dy = (py - d.startPy) * slow;
      next = bendSegment(this.knotsOf(d.s), d.i, d.startBend - dy / (120 * this.scale));
    }
    this.live = { s: d.s, knots: next };
    d.s.onChange?.(next);
    this.rev++;
    this.wake();
  }

  /**
   * Double-click: add a knot on the curve, remove one on a node.
   *
   * The same pair envelope-graph uses, and worth keeping because it needs no
   * modifier and no mode -- the target of the click already says which of the
   * two you meant.
   */
  private onDblClick = (e: MouseEvent): void => {
    const s = this.editable;
    const p = this.plotNow();
    if (!s || !p || this.disabled) return;
    e.preventDefault();
    const [px, py] = this.local(e);
    const bounds = s.bounds ?? DEFAULT_BOUNDS;
    const node = this.hitNode(p, s, px, py);
    const next = node >= 0
      ? removeKnot(s.knots, node, bounds)
      : insertKnot(s.knots, p.fromX(px), p.fromY(py), bounds);
    if (next === s.knots) return;
    s.onEditStart?.();
    s.onChange?.(next);
    s.onEditEnd?.();
    this.hotNode = -1;
    this.wake();
  };

  // ---- render ----

  /**
   * What the head says: the hovered x and every series' value there; failing
   * that the cursor's; failing that the newest sample of anything that is a
   * time series.
   *
   * The fallbacks matter more than the hover does. A readout that empties the
   * moment the pointer leaves teaches the reader to keep the pointer parked on
   * the chart, which is the tooltip habit arriving through the back door. A
   * static curve with no cursor genuinely has nothing to report and says
   * nothing, rather than inventing a number to fill the space.
   */
  private readout(): unknown {
    const p = this.plotNow();
    const at = this.hoverPx != null && p
      ? p.fromX(clamp(this.hoverPx, p.box.x, p.box.x + p.box.w))
      : this.cursor;
    const fx = tickFormatter(this.xAxis);
    const parts: unknown[] = [];
    /*
     * Every number here reserves the widest string its own AXIS can produce,
     * the same rule the scalar controls use -- see core/format.ts. It matters
     * more here than anywhere else in the family, because this readout updates
     * on pointermove: an unreserved number re-lays-out the head on every frame
     * of a sweep, so the labels visibly crawl left and right under the pointer
     * while you are trying to read them.
     *
     * From the DECLARED axis, not the live one. Under autoY the live axis is
     * itself moving on the drift spring, so reserving against it would make the
     * reservation the very thing that jitters.
     */
    const reserve = (n: number) => `--reading-ch:${n}`;
    if (at != null) {
      parts.push(html`<span class="dim">x</span> <span class="reading"
        style=${reserve(domainChars(this.xAxis.min, this.xAxis.max, fx))}>${fx(at)}</span>`);
    }
    for (const s of this.series) {
      if (s.kind === 'band' || s.kind === 'scatter') continue;
      const v = at != null ? this.valueAt(s, at)
        : s.kind === 'roll' ? this.ringFor(s).latest
        : s.kind === 'trace' ? (s.data.length ? s.data[s.data.length - 1] : null)
        : null;
      if (v == null) continue;
      const f = s.format ?? tickFormatter(this.yAxisLive);
      parts.push(html`<span class="dim">${s.label ?? s.id ?? 'y'}</span> <span class="reading"
        style=${reserve(domainChars(this.yAxis.min, this.yAxis.max, f))}>${f(v)}</span>`);
    }
    if (!parts.length) return nothing;
    return parts.map((x, i) => (i ? html`&nbsp;&middot; ${x}` : x));
  }

  render() {
    // `rev` is read so Lit re-renders the head when the canvas loop moves; the
    // canvas itself is drawn imperatively and never by Lit.
    void this.rev;
    return html`
      ${this.density === 'compact' ? nothing : html`
        <div class="head">
          <span class="name">${this.label}</span>
          <span class="read">${this.readout()}</span>
        </div>`}
      <canvas
        style=${`height:${this.boxHeight.toFixed(1)}px`}
        @pointerdown=${this.onDown}
        @pointermove=${this.onMove}
        @dblclick=${this.onDblClick}
      ></canvas>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-graph': BiGraph;
  }
}
