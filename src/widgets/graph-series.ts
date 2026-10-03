/**
 * What a LAYER is: the series vocabulary, and how one resolves to colour.
 *
 * Split from the element for the reason the plan gives (no file over ~800
 * lines) and along the boundary that was already there: this file answers
 * "what can a graph show", <bi-graph> answers "how a surface shows it". A
 * panel that only needs to DESCRIBE a layer -- and most do; the description is
 * the whole API -- imports this and not a custom element.
 *
 * `resolveInk` is the one thing here that touches the DOM, and only to read
 * tokens off a live element. It cannot live in draw/, which is DOM-free by
 * contract, and it must not live in a widget, because a second graph-shaped
 * widget would then own a second copy of the material.
 */
import { cssVar } from '../theme/base';
import { withAlpha } from '../theme/ramp';
import type { Ink, FillPattern } from '../draw/series';
import type { Knot, KnotBounds } from '../core/curve';

export interface SeriesBase {
  id?: string;
  /** Shown in the readout and, at expanded density, in the legend. */
  label?: string;
  /**
   * The family's own hierarchy word, meaning what it means on a control: `lead`
   * is juice inside the glass (filled, blooming), `counter` is juice on its
   * edge (a hairline, no fill). Four traces that all lead average to a wash for
   * exactly the reason eight knobs did. One lead per graph -- unless each
   * lead names its own `pattern`, which keeps overlapping fills apart.
   */
  rank?: 'lead' | 'counter';
  /** The fill's screen (draw/series.ts hatchPattern). On the ink skins it
   *  replaces the house 45-degree rule; on the others it replaces the wash. */
  pattern?: FillPattern;
  /** Overrides the graph's own accent for this layer. A hex or an rgb(). */
  accent?: string;
  /** Force the fill on or off. Defaults to on for lead, off for counter. */
  fill?: boolean;
  /** Readout formatter for this layer's y values. */
  format?: (v: number) => string;
}

export interface TraceSeries extends SeriesBase {
  kind: 'trace';
  data: ArrayLike<number>;
}

export interface RollSeries extends SeriesBase {
  kind: 'roll';
  /** Read once per frame. The graph owns the ring. */
  poll: () => number;
  samples?: number;
}

export interface CurveSeries extends SeriesBase {
  kind: 'curve';
  f: (x: number) => number;
  /**
   * The xfade-curve gesture: dragging anywhere on the plot edits one scalar
   * parameter, and the curve redraws as a family. Needs `binding`. Right and up
   * both increase, at the same px-per-unit rate, so a diagonal drag is not
   * twice as fast on the short axis.
   */
  drag?: { path: string; travel?: number };
}

export interface KnotSeries extends SeriesBase {
  kind: 'knots';
  knots: Knot[];
  /** Nodes are only DRAWN when this is set. A read-only breakpoint curve is
   * just a curve, and dots on it advertise a gesture that does not exist. */
  edit?: boolean;
  bounds?: KnotBounds;
  /** Called on every change during a drag, with a fresh array. */
  onChange?: (knots: Knot[]) => void;
  /** Gesture brackets, so the host can make one undo entry out of a drag --
   * the ContinuousEditHandle contract, hand-rolled because FieldBinding is
   * scalar-only by design and an array parameter is a recorded nano-unit gap
   * (NANO-UNIT-NEEDS entry 2), not something to fake here. */
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

export interface BarSeries extends SeriesBase { kind: 'bars'; data: ArrayLike<number> }
export interface ScatterSeries extends SeriesBase {
  kind: 'scatter';
  points: readonly (readonly [number, number])[];
}
export interface BandSeries extends SeriesBase {
  kind: 'band';
  lo: (x: number) => number;
  hi: (x: number) => number;
}

export type Series =
  | TraceSeries | RollSeries | CurveSeries | KnotSeries
  | BarSeries | ScatterSeries | BandSeries;

/**
 * Resolve one series' colours from the live tokens.
 *
 * Read through cssVar (cached per element per name) rather than a second
 * palette in TypeScript -- and per widget rather than per :root, so a graph
 * given its own --accent recolours its whole material, exactly as a knob
 * does.
 */
export function resolveInk(el: Element, s: Series, scale: number, ink: boolean): Ink {
  const accent = s.accent || cssVar(el, '--accent', '#22d3ee');
  const lead = (s.rank ?? 'lead') === 'lead';
  const wantFill = s.fill ?? lead;
  if (ink) {
    // Printed: a solid key-weight line, and a SCREEN rather than a wash
    // beneath it. There is no half a pigment; an alpha flood under a solid
    // line reads as a plate laid down at the wrong density.
    return {
      line: accent,
      lineWidth: (lead ? 2 : 1.25) * scale,
      // named screens are for fills laid over one another: lighter, so
      // where two cross neither drowns the other
      fill: wantFill ? withAlpha(accent, s.pattern ? 0.55 : 0.85) : null,
      hatch: true,
      pattern: s.pattern,
      glow: null,
      node: accent,
      nodeEdge: cssVar(el, '--plot-node-edge', '#f2ece1'),
      caution: cssVar(el, '--app-caution', '#e8a83c'),
    };
  }
  return {
    line: lead ? accent : withAlpha(accent, 0.8),
    lineWidth: (lead ? 2 : 1.25) * scale,
    // a screen is sparse ink, so it takes a stronger colour than a wash
    fill: wantFill ? withAlpha(accent, s.pattern ? 0.5 : 0.16) : null,
    hatch: false,
    pattern: s.pattern,
    glow: lead ? withAlpha(accent, 0.3) : null,
    node: accent,
    nodeEdge: cssVar(el, '--plot-node-edge', '#04060a'),
    caution: cssVar(el, '--app-caution', '#e8a83c'),
  };
}
