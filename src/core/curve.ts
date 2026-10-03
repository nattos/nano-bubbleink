/**
 * Breakpoint curves with per-segment curvature. Pure, DOM-free, no imports.
 *
 * This is the data model behind every editable curve in the family -- envelopes,
 * transfer shaping, automation, velocity maps. It is deliberately the SAME model
 * nano-modules' envelope-math.ts uses, because that one mirrors the C++ in
 * native/src/sketch/envelope.h and a UI curve that cannot round-trip through the
 * engine's own format is a curve the engine cannot play.
 *
 * ---------------------------------------------------------------------------
 * WHAT A BEND IS
 *
 * A segment between two knots is not a line; it carries one number, `bend`, in
 * [-1, 1], which warps the parameter along the segment:
 *
 *   y = y0 + shapeT(t, bend) * (y1 - y0),   shapeT(t, b) = t ^ 2^(-3b)
 *
 * Three properties make this the right primitive rather than, say, a control
 * handle per side:
 *
 *   ENDPOINTS ARE EXACT AT EVERY BEND. shapeT(0)=0 and shapeT(1)=1 identically,
 *   so bending a segment CANNOT move a knot. That invariant is what lets the
 *   editor put node-drag and segment-bend on the same surface: the two gestures
 *   are provably independent, and a user bending a curve never has to re-fix an
 *   endpoint they did not touch.
 *
 *   IT IS ONE NUMBER. A bend serialises as a third float beside x and y, which
 *   is what keeps the wire format three floats per knot. Bezier handles are two
 *   numbers each with an ordering constraint between neighbours, and every
 *   editor that ships them also ships a way to un-tangle them.
 *
 *   THE SIGN IS THE GESTURE. Positive is up-and-fast-out, negative is
 *   down-and-slow-out, zero is a straight line, and the drag that sets it is a
 *   vertical drag on the segment itself. Nothing to learn.
 *
 * NO S-CURVE PARAMETER, deliberately. A symmetric variant of the same power law
 * would cost four lines and it is the first thing anyone asks for -- but it is a
 * SECOND curvature dimension, and the wire format has room for one. An S here is
 * two knots with opposite bends, which is also what it is in the engine, in the
 * file, and in the user's head. A UI-only shape flag that the serialiser has to
 * drop is data loss with a nice picture on top.
 *
 * ---------------------------------------------------------------------------
 * ZERO-SPAN SEGMENTS ARE VERTICAL EDGES
 *
 * Two knots may share an x. That is not a degenerate case to guard against, it
 * is how the model spells a STEP -- a hard jump, an attack transient, a gate.
 * Every function here treats a zero-span segment as an instantaneous edge, and
 * `sampleKnots` emits it as one, because a uniform sampler steps over it and
 * draws a slope that is not in the data.
 */

export interface Knot {
  /** Domain position. Sorted ascending; ties are legal and mean a step. */
  x: number;
  y: number;
  /** Curvature of the segment STARTING here, in [-1, 1]. The last knot's bend
   * is unused -- kept in the record anyway so a knot is one shape everywhere
   * and an insert never has to decide what to do with a missing field. */
  bend: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The warp itself. Exact at both ends for every `bend`. */
export function shapeT(t: number, bend: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (bend === 0) return t;
  return Math.pow(t, Math.pow(2, -3 * clamp(bend, -1, 1)));
}

/** Evaluate at `x`. Flat outside the knots -- a curve holds its end values
 * rather than extrapolating, because extrapolating a drawn shape invents data
 * the user never drew. */
export function evalCurve(knots: Knot[], x: number): number {
  const n = knots.length;
  if (n === 0) return 0;
  if (n === 1 || x <= knots[0].x) return knots[0].y;
  if (x >= knots[n - 1].x) return knots[n - 1].y;
  for (let i = 0; i < n - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    if (x < a.x || x > b.x) continue;
    const span = b.x - a.x;
    // At a step, the LATER knot wins: the jump is complete at its own x.
    if (span <= 0) continue;
    return a.y + shapeT((x - a.x) / span, a.bend) * (b.y - a.y);
  }
  return knots[n - 1].y;
}

/**
 * Sample for drawing, in DATA space, segment by segment.
 *
 * Per-segment rather than a uniform sweep for two reasons the prior art learned
 * the hard way: a uniform sampler renders a zero-span step as a slope, and it
 * spends the same budget on a flat segment as on a hard bend. `resolution` is
 * the sample count the WHOLE domain would get; each segment takes its share
 * plus a floor, so a narrow segment still gets enough points to show its
 * curvature.
 */
export function sampleKnots(knots: Knot[], resolution = 160): [number, number][] {
  const n = knots.length;
  if (n === 0) return [];
  if (n === 1) return [[knots[0].x, knots[0].y]];
  const span = knots[n - 1].x - knots[0].x;
  const out: [number, number][] = [[knots[0].x, knots[0].y]];
  for (let i = 0; i < n - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const w = b.x - a.x;
    if (w <= 0) {
      out.push([b.x, b.y]); // the vertical edge, as one jump
      continue;
    }
    // A straight segment needs its two endpoints and nothing between them.
    const steps = a.bend === 0 ? 1
      : Math.max(2, Math.round((span > 0 ? w / span : 1) * resolution));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push([a.x + w * t, a.y + shapeT(t, a.bend) * (b.y - a.y)]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edits. Every one returns a NEW array.
//
// Not for purity's sake: the editor hands the result to a caller that may keep
// it (an undo entry, a preview, a diff against the committed value), and an
// in-place mutation makes those the same object. This is the same reason
// ContinuousEditHandle exists one layer up.
// ---------------------------------------------------------------------------

export interface KnotBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Hold the first and last knot at xMin / xMax. True for a normalised curve
   * whose domain IS the control's range; false for an open lane where the end
   * of the drawing is wherever the user stopped. */
  pinEnds: boolean;
}

export const DEFAULT_BOUNDS: KnotBounds = { xMin: 0, xMax: 1, yMin: 0, yMax: 1, pinEnds: true };

/**
 * Move one knot.
 *
 * X is clamped between its neighbours -- MAY equal them, so a knot can be
 * dragged onto its neighbour to make a step, which is the only way to author
 * one by hand. Pinned ends keep their x and move only in y.
 */
export function moveKnot(
  knots: Knot[], i: number, x: number, y: number, b: KnotBounds = DEFAULT_BOUNDS,
): Knot[] {
  const out = knots.map((k) => ({ ...k }));
  const last = out.length - 1;
  if (i < 0 || i > last) return out;
  let nx: number;
  if (i === 0) nx = b.pinEnds ? b.xMin : clamp(x, b.xMin, out[1]?.x ?? b.xMax);
  else if (i === last) nx = b.pinEnds ? b.xMax : clamp(x, out[last - 1]?.x ?? b.xMin, b.xMax);
  else nx = clamp(x, out[i - 1].x, out[i + 1].x);
  out[i].x = nx;
  out[i].y = clamp(y, b.yMin, b.yMax);
  return out;
}

/** Insert a knot, keeping the array sorted. The new knot inherits the bend of
 * the segment it lands in, so adding a point to a curved run does not flatten
 * the half you did not click on. */
export function insertKnot(knots: Knot[], x: number, y: number, b: KnotBounds = DEFAULT_BOUNDS): Knot[] {
  const nx = clamp(x, b.xMin, b.xMax);
  let bend = 0;
  for (let i = 0; i < knots.length - 1; i++) {
    if (nx >= knots[i].x && nx <= knots[i + 1].x) { bend = knots[i].bend; break; }
  }
  const out = [...knots.map((k) => ({ ...k })), { x: nx, y: clamp(y, b.yMin, b.yMax), bend }];
  out.sort((p, q) => p.x - q.x);
  return out;
}

/** Remove a knot. Refuses to leave fewer than two, and refuses the pinned ends
 * -- a curve with one point has no domain and a curve missing an end has no
 * defined value there. */
export function removeKnot(knots: Knot[], i: number, b: KnotBounds = DEFAULT_BOUNDS): Knot[] {
  if (knots.length <= 2) return knots;
  if (b.pinEnds && (i === 0 || i === knots.length - 1)) return knots;
  return knots.filter((_, j) => j !== i).map((k) => ({ ...k }));
}

export function bendSegment(knots: Knot[], i: number, bend: number): Knot[] {
  const out = knots.map((k) => ({ ...k }));
  if (i >= 0 && i < out.length - 1) out[i].bend = clamp(bend, -1, 1);
  return out;
}

/** Index of the segment containing `x`, or -1. */
export function segmentAt(knots: Knot[], x: number): number {
  for (let i = 0; i < knots.length - 1; i++) {
    if (x >= knots[i].x && x <= knots[i + 1].x) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Wire format: a flat [x0, y0, b0, x1, y1, b1, ...] array.
//
// Three floats per knot, the layout envelope.h parses. Kept here rather than in
// a widget so the widget never has to know there IS a wire format.
// ---------------------------------------------------------------------------

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export function toFlat(knots: Knot[]): number[] {
  return knots.flatMap((k) => [r4(k.x), r4(k.y), r4(k.bend)]);
}

/** Parse, tolerantly. Anything unreadable becomes the identity ramp rather than
 * an empty curve -- a curve that failed to load and a curve the user drew flat
 * must not look the same. */
export function fromFlat(raw: unknown, b: KnotBounds = DEFAULT_BOUNDS): Knot[] {
  let nums: number[] = [];
  if (typeof raw === 'string') { try { nums = JSON.parse(raw); } catch { nums = []; } }
  else if (Array.isArray(raw)) nums = raw as number[];
  const out: Knot[] = [];
  for (let i = 0; i + 2 < nums.length; i += 3) {
    out.push({
      x: clamp(+nums[i] || 0, b.xMin, b.xMax),
      y: clamp(+nums[i + 1] || 0, b.yMin, b.yMax),
      bend: clamp(+nums[i + 2] || 0, -1, 1),
    });
  }
  if (out.length < 2) {
    return [{ x: b.xMin, y: b.yMin, bend: 0 }, { x: b.xMax, y: b.yMax, bend: 0 }];
  }
  out.sort((p, q) => p.x - q.x);
  return out;
}
