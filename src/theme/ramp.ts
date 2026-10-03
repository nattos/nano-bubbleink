/**
 * The one colour function every canvas surface draws through.
 *
 * Ported from annotator/src/groove2_atlas_draw.ts, where twelve unrelated
 * drawing algorithms looked like one product for exactly this reason: they all
 * ramped from the same floor. The three laws it encodes are worth stating,
 * because breaking any one of them is what makes a data surface turn to mud:
 *
 *   HUE says which family. LIGHTNESS says how much.
 *     Colour cannot carry a category while lightness carries a magnitude AND
 *     alpha carries a third thing — the fades compound, and the dimmest end of
 *     each multiplies into the others until a quiet region is invisible.
 *
 *   ALPHA IS RESERVED FOR REACHABILITY.
 *     Out of range, unreachable, bypassed. Nothing else. The moment alpha also
 *     means "small value", a small reachable value and an unreachable one look
 *     the same, and the picture stops being able to say "nothing responds here".
 *
 *   NOTHING GOES TO BLACK.
 *     The floor is a desaturated blue-slate, not the background. An empty
 *     region reads as empty-and-measured rather than as a hole in the render.
 */

export type RGB = [number, number, number];

/** The floor every ramp starts from. */
export const SLATE: RGB = [64, 70, 92];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Slate -> `rgb`, with the floor. `t` outside [0,1] is clamped, not wrapped. */
export function ramp(rgb: RGB, t: number, alpha = 1): string {
  const k = clamp01(t);
  const r = Math.round(SLATE[0] + (rgb[0] - SLATE[0]) * k);
  const g = Math.round(SLATE[1] + (rgb[1] - SLATE[1]) * k);
  const b = Math.round(SLATE[2] + (rgb[2] - SLATE[2]) * k);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Lerp between two arbitrary colours. For diverging ramps, which have two
 * arms and so cannot both start at the slate floor. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function rgba(c: RGB, alpha = 1): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
}

/**
 * Re-alpha a colour that came out of a CSS custom property.
 *
 * Canvas has no color-mix, so a series that needs its accent at 16% for a fill
 * and 35% for a bloom has to do the arithmetic itself. Handles the two forms a
 * token actually resolves to -- a hex literal, or an rgb()/rgba() function --
 * and passes anything else through untouched, on the principle that a colour we
 * cannot parse should still paint as itself rather than disappear.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) return rgba(hexToRgb(c), alpha);
  const m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3) return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
  }
  return c;
}

export function hexToRgb(hex: string): RGB {
  const h = hex.trim().replace('#', '');
  const s = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Dimming for a region the control cannot reach.
 *
 * `mask` stops at the boundary and leaves the rest at the floor — the honest
 * one, and the only one that says "nothing here responds". `extend` makes no
 * distinction at all. `seam` (the default) keeps the outside a shade back, so
 * the boundary is findable without a hole being punched in the picture.
 *
 * The 0.42 floor is the load-bearing number: a PROPORTIONAL dim with a soft
 * floor, never a hard clip and never a hue change. A hue change would say the
 * region is a different KIND of thing; it is the same thing, out of reach.
 */
export type ReachMode = 'mask' | 'extend' | 'seam';

export function reach(mode: ReachMode, inside: number): number {
  return mode === 'mask' ? inside : mode === 'extend' ? 1 : 0.42 + 0.58 * inside;
}

/**
 * ORDINAL palette — ordered dark to bright, so the legend reads as a ladder and
 * the order itself carries meaning. For enumerated params whose values have a
 * natural sequence (slopes, oversampling factors, mode counts).
 */
export const ORDINAL: RGB[] = [
  [107, 107, 136], [61, 143, 214], [72, 201, 176], [242, 197, 61],
];

/**
 * CATEGORICAL palette — deliberately NOT ordered, so no adjacent pair reads as
 * a progression. For things that merely differ.
 */
export const CATEGORICAL: RGB[] = [
  [76, 155, 232], [232, 87, 74], [72, 201, 176], [242, 197, 61],
  [142, 107, 214], [224, 123, 57], [227, 119, 194], [143, 151, 168],
  [188, 189, 34], [23, 190, 207], [174, 199, 232], [255, 187, 120],
];

const VIRIDIS: RGB[] = [
  [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
];

const MAGMA: RGB[] = [
  [8, 8, 20], [80, 18, 100], [190, 55, 90], [245, 130, 50], [252, 235, 160],
];

function stops(table: RGB[], t: number): RGB {
  const x = clamp01(t) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(x));
  return mix(table[i], table[i + 1], x - i);
}

/** Perceptually uniform sequential ramp. For magnitude fields. */
export const viridis = (t: number): RGB => stops(VIRIDIS, t);
/** Sequential ramp with a dark floor. For spectrograms and density. */
export const magma = (t: number): RGB => stops(MAGMA, t);

/**
 * Diverging ramp for bipolar quantities — a coupling matrix cell, a detune, a
 * pan. `t` in [-1, 1]; zero lands on the slate floor so "no coupling" reads as
 * neutral rather than as a small amount of one polarity.
 */
export function diverging(t: number, neg: RGB, pos: RGB): RGB {
  const k = t < -1 ? -1 : t > 1 ? 1 : t;
  return k < 0 ? mix(SLATE, neg, -k) : mix(SLATE, pos, k);
}
