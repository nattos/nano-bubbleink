/**
 * Outline geometry: smooth-cornered polygons, and the "bud" panel built from
 * one.
 *
 * WHAT PROBLEM THIS SOLVES. A section in a plugin is conventionally a box with
 * a caption above it, or a fieldset with a notch cut for its legend. Both read
 * as filing — the label is an annotation ABOUT the box. The brief asks for
 * outlines that "playfully curve and hug", with header labels that "bud off",
 * and the difference is topological rather than decorative: the label is not
 * next to the group, it is PART OF the group's silhouette, growing out of the
 * top edge on tangent-continuous fillets like a smaller bubble merging with a
 * larger one. One outline, one thing, and the eye gets the grouping for free
 * without a heavier border to enforce it.
 *
 * Everything here is pure: numbers in, an SVG path string out. No DOM, no
 * component state — rule 3 of the portability contract, and the reason this
 * shape can move to a canvas or to WebGPU later without being rewritten.
 *
 * ---------------------------------------------------------------------------
 * WHY A POLYGON WITH PER-VERTEX RADII IS THE WHOLE ABSTRACTION
 *
 * The first cut of this was a dedicated path builder that walked the body edge,
 * detoured up and around each tab, and joined the two with hand-written arcs.
 * It needed three sweep flags to be right and had a different code path for the
 * concave fillet than for the convex corner.
 *
 * It is all one operation. Rounding a corner does not care whether the turn is
 * convex or reflex — the same construction, applied at a vertex that turns the
 * other way, produces the concave fillet that makes a tab look grown rather
 * than glued. So the primitive is a closed polygon whose vertices carry radii,
 * and the bud panel is just a particular list of vertices.
 */

export interface Vertex {
  x: number;
  y: number;
  /** Corner radius at this vertex. 0 leaves it sharp. */
  r: number;
}

/**
 * SQUIRCLE SMOOTHING.
 *
 * A circular corner meets the straight edge with matching tangent but a JUMP in
 * curvature — flat, then suddenly 1/r. The eye reads that discontinuity, and it
 * is most of why a plain border-radius looks mechanical while a physical
 * moulded object does not. The fix is the same one Apple's "continuous corner"
 * uses: spend a longer run of the edge on the corner and keep the control
 * points nearer the vertex, so curvature ramps in instead of switching on.
 *
 * Every corner is emitted as a cubic, circular and squircular alike, with these
 * two numbers interpolated by `smoothing` — so smoothing is a continuous dial
 * from "CSS border-radius" to "moulded", and a widget can animate along it.
 *
 *   RUN   how far along each edge the corner extends, in radii.
 *         1.0 = circular. 1.35 tuned by eye against a stroked outline: beyond
 *         ~1.5 a 14px radius starts eating short edges and the shape reads as
 *         an oval rather than as a soft rectangle.
 *   CTRL  control-point distance from the vertex, as a fraction of the run.
 *         0.4477 is exactly the circular-arc cubic approximation (1 - 0.5523).
 *
 * At smoothing = 1 the curve passes 0.539r from the vertex along the diagonal
 * against a circle's 0.414r: FATTER at the diagonal, longer along the edges,
 * which is the squircle signature.
 */
const RUN_CIRCLE = 1.0;
const RUN_SQUIRCLE = 1.35;
const CTRL_CIRCLE = 0.4477;
const CTRL_SQUIRCLE = 0.42;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A closed path through `pts`, with each corner rounded by its own radius.
 *
 * `smoothing` 0 gives circular corners, 1 gives squircular ones; anything
 * between is a blend. Reflex vertices round concavely, which is what makes the
 * bud fillets work.
 *
 * Runs are clamped to half the length of each adjoining edge, so a radius
 * larger than the shape it is rounding degrades to "as round as it can be"
 * rather than to a self-intersecting knot. A caller that hands this a 40px
 * radius on a 30px box gets a capsule, which is almost always what they meant.
 */
export function smoothPolyPath(pts: Vertex[], smoothing = 1): string {
  const n = pts.length;
  if (n < 3) return '';
  const s = clamp01(smoothing);
  const runScale = lerp(RUN_CIRCLE, RUN_SQUIRCLE, s);
  const ctrlFrac = lerp(CTRL_CIRCLE, CTRL_SQUIRCLE, s);

  // Edge lengths and unit directions, indexed by the vertex the edge leaves.
  const dir: { x: number; y: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    dir.push(len > 1e-6 ? { x: dx / len, y: dy / len, len } : { x: 0, y: 0, len: 0 });
  }

  // The run each vertex actually gets, after clamping against both its edges.
  const run: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = dir[(i - 1 + n) % n].len;
    const next = dir[i].len;
    run.push(Math.max(0, Math.min(pts[i].r * runScale, prev * 0.5, next * 0.5)));
  }

  const f = (v: number) => (Math.abs(v) < 1e-4 ? '0' : v.toFixed(3));
  const parts: string[] = [];

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const din = dir[(i - 1 + n) % n];   // arriving at p
    const dout = dir[i];                // leaving p
    const q = run[i];
    // Entry point of the corner, backed off along the incoming edge; exit point
    // pushed forward along the outgoing one.
    const ax = p.x - din.x * q;
    const ay = p.y - din.y * q;
    const bx = p.x + dout.x * q;
    const by = p.y + dout.y * q;

    if (i === 0) parts.push(`M${f(ax)} ${f(ay)}`);
    else parts.push(`L${f(ax)} ${f(ay)}`);

    if (q > 1e-4) {
      const c1x = p.x - din.x * q * ctrlFrac;
      const c1y = p.y - din.y * q * ctrlFrac;
      const c2x = p.x + dout.x * q * ctrlFrac;
      const c2y = p.y + dout.y * q * ctrlFrac;
      parts.push(`C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(bx)} ${f(by)}`);
    }
  }
  parts.push('Z');
  return parts.join('');
}

/** A rounded rectangle, as a smooth polygon. Corner radii may differ per corner
 * — which is how a group with a round hero dial at one end gets a capsule there
 * and a normal corner at the other. */
export function smoothRect(
  x: number, y: number, w: number, h: number,
  r: number | [number, number, number, number],
  smoothing = 1,
): string {
  const [tl, tr, br, bl] = typeof r === 'number' ? [r, r, r, r] : r;
  return smoothPolyPath(
    [
      { x, y, r: tl },
      { x: x + w, y, r: tr },
      { x: x + w, y: y + h, r: br },
      { x, y: y + h, r: bl },
    ],
    smoothing,
  );
}

/** A label tab budding off an edge. */
export interface Bud {
  /** Along-edge extent, in panel coordinates. */
  x0: number;
  x1: number;
  /** How far it protrudes beyond the edge. */
  depth: number;
  /** The bud's own outer radius. */
  r: number;
}

/**
 * A step in the panel's height, partway along.
 *
 * The body is full height to the left of `at` and `drop` shorter to the right
 * of it, top and bottom, with the transition spread over `run` and rounded by
 * `r` at both ends -- a convex turn into the step and a concave one out of it,
 * which together read as a single shoulder rather than as two corners.
 */
export interface Shoulder {
  /** Along-edge position where the step begins. */
  at: number;
  /** How much shorter the right side is, per edge. */
  drop: number;
  /** Horizontal distance the step is spread over. */
  run: number;
  /** Corner radius at both ends of the step. */
  r: number;
}

export interface BudPanelOptions {
  /** Body corner radii, clockwise from top-left. */
  radius: number | [number, number, number, number];
  /** Buds on the top edge, left to right, non-overlapping. */
  buds?: Bud[];
  /**
   * Radius of the concave joint where a bud's flank meets the body edge.
   *
   * THIS IS THE WHOLE EFFECT. At 0 the tab is a rectangle stuck on the top
   * edge and reads as glued. At ~0.6x the bud radius the two silhouettes merge
   * the way two soap bubbles do, and the label reads as having grown out of the
   * group. It is also the first thing to look wrong at small scale, which is
   * why the gallery renders this at 40%.
   */
  fillet: number;
  /** Optional height step, for an outline that hugs a tall element at one end
   * and a short row at the other. */
  shoulder?: Shoulder;
  smoothing?: number;
}

/**
 * The body rectangle with its label tabs merged into one silhouette.
 *
 * Coordinates are the BODY's: a bud protrudes to negative y, so a caller must
 * leave `max(depth)` of headroom above the body inside whatever surface this is
 * drawn on.
 */
export function budPanelPath(
  x: number, y: number, w: number, h: number,
  opts: BudPanelOptions,
): string {
  const [tl, tr, br, bl] = typeof opts.radius === 'number'
    ? [opts.radius, opts.radius, opts.radius, opts.radius]
    : opts.radius;
  const buds = (opts.buds ?? []).filter((b) => b.x1 > b.x0 && b.depth > 0);
  const pts: Vertex[] = [{ x, y, r: tl }];

  for (const b of buds) {
    const f = Math.min(opts.fillet, (b.x1 - b.x0) * 0.5);
    const top = y - b.depth;
    // Bud radius cannot exceed half its own width, or the two top corners fight
    // over the same run and the tab pinches.
    const r = Math.min(b.r, (b.x1 - b.x0) * 0.5, b.depth * 0.8);
    pts.push(
      { x: x + b.x0, y, r: f },          // reflex: top edge turns up
      { x: x + b.x0, y: top, r },        // convex
      { x: x + b.x1, y: top, r },        // convex
      { x: x + b.x1, y, r: f },          // reflex: back down onto the top edge
    );
  }

  const sh = opts.shoulder;
  if (sh && sh.drop > 0) {
    // Down the step on the top edge, along the short right end, and back up on
    // the bottom. The convex/concave pairing falls out of the vertex order --
    // see the note in smoothPolyPath about reflex vertices.
    pts.push(
      { x: x + sh.at, y, r: sh.r },
      { x: x + sh.at + sh.run, y: y + sh.drop, r: sh.r },
      { x: x + w, y: y + sh.drop, r: tr },
      { x: x + w, y: y + h - sh.drop, r: br },
      { x: x + sh.at + sh.run, y: y + h - sh.drop, r: sh.r },
      { x: x + sh.at, y: y + h, r: sh.r },
    );
  } else {
    pts.push(
      { x: x + w, y, r: tr },
      { x: x + w, y: y + h, r: br },
    );
  }
  pts.push({ x, y: y + h, r: bl });
  return smoothPolyPath(pts, opts.smoothing ?? 1);
}
