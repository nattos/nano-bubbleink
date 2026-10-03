/**
 * Pure drawing primitives. No DOM, no component state, no imports from
 * `widgets/`.
 *
 * That constraint is the portability contract, and it is not stylistic. The
 * annotator codebase states the reason plainly: the same drawing code has to
 * back the lab page, the product panel, and eventually a plugin, and "a texture
 * that had to be reimplemented to move would not survive the move." Everything
 * here takes a context and plain numbers and returns nothing.
 */

/**
 * The cursor / handle / playhead mark.
 *
 * A dark 3.5px ring UNDER a white 1.5px ring, both on the same circle. This is
 * the house technique for a marker that must read on any background -- over a
 * bright texture the dark halo carries it, over a dark ground the white core
 * does, and there is no background it can vanish into. Every alternative
 * (single stroke, drop shadow, blend mode) fails on some field.
 */
export function drawCursor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r = 6.5,
  color = '#ffffff',
): void {
  g.save();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 3.5;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** The same halo treatment for a straight line -- playheads, thresholds,
 * crosshairs. Same reasoning, same two passes. */
export function drawHaloLine(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color = '#ffffff',
): void {
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.restore();
}

/**
 * Minimum mark size.
 *
 * A bar, tick or glyph whose natural width rounds below a pixel does not draw
 * faintly -- it disappears, and an absent mark reads as an absent DATUM. Floor
 * every computed mark dimension through this. The floor is above 1.0 because a
 * 1px mark on a fractional boundary still antialiases away to nothing.
 */
export const minMark = (w: number, floor = 1.5): number => Math.max(floor, w);

/** Snap to a half-pixel so a 1px stroke lands on one crisp pixel row rather
 * than spread across two at half intensity. */
export const crisp = (v: number): number => Math.round(v) + 0.5;

/**
 * Deterministic PRNG (mulberry32).
 *
 * MANDATORY for anything textured. A surface that reshuffles its own grain on a
 * resize -- or on every redraw -- is unusable: the eye reads the change as data
 * moving. A seeded generator costs nothing and makes a texture a property of
 * the data rather than of when it happened to be drawn.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint a per-pixel field at a capped internal resolution, then scale it up.
 *
 * Every field this system draws is smooth by construction -- a bilinear read of
 * a coarse grid, or an analytic function -- so evaluating it at display
 * resolution buys nothing and costs a great deal on a large surface. Capped and
 * bilinear-upscaled, a whole panel of them redraws in a frame.
 *
 * `fn` receives normalized coordinates with **y up**, matching the axis
 * convention every plot in this system uses, and returns RGBA 0-255.
 */
export function paintField(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  cap: number,
  fn: (nx: number, ny: number) => [number, number, number, number],
): void {
  const pw = Math.max(8, Math.min(cap, Math.round(w)));
  const ph = Math.max(8, Math.round((pw * h) / w));
  const img = new ImageData(pw, ph);
  const d = img.data;
  for (let py = 0; py < ph; py++) {
    // y up: row 0 of the bitmap is the TOP, which is ny = 1.
    const ny = 1 - (py + 0.5) / ph;
    for (let px = 0; px < pw; px++) {
      const nx = (px + 0.5) / pw;
      const [r, gg, b, a] = fn(nx, ny);
      const i = (py * pw + px) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
  const off = document.createElement('canvas');
  off.width = pw;
  off.height = ph;
  off.getContext('2d')!.putImageData(img, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.drawImage(off, 0, 0, w, h);
  g.restore();
}

/**
 * An arc path in the rotary convention this system uses everywhere: degrees,
 * 0 at twelve o'clock, increasing clockwise.
 *
 * Canvas's native convention is radians from three o'clock, which is correct
 * for mathematics and wrong for a knob -- every control here is authored as
 * "270 degrees of sweep starting from the bottom-left", and converting at each
 * call site is how a family of dials ends up with three of them subtly rotated.
 */
export function arcPath(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  deg0: number,
  deg1: number,
): void {
  const a0 = ((deg0 - 90) * Math.PI) / 180;
  const a1 = ((deg1 - 90) * Math.PI) / 180;
  g.beginPath();
  g.arc(cx, cy, r, a0, a1, deg1 < deg0);
}

/** The same convention as an SVG path string, for widgets drawing in SVG. */
export function arcSvg(cx: number, cy: number, r: number, deg0: number, deg1: number): string {
  const p = (a: number): [number, number] => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x0, y0] = p(deg0);
  const [x1, y1] = p(deg1);
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  const sweep = deg1 >= deg0 ? 1 : 0;
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}
