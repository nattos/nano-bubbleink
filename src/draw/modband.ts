/**
 * Modulation band geometry -- one pure function, rendered two different ways.
 *
 * Generalised from nano-modules' scalar-slider.ts:43-59. Every control in this
 * family is modulation-aware from day one because the geometry is computed once
 * here and then drawn as a 3px strip beneath a linear control or as an outer
 * arc around a rotary one. Two renderings, one source: if they ever disagree
 * about where a band sits, that is a bug in one drawing function, not a second
 * opinion about the data.
 *
 * THE NEUTRAL-ANCHORED FILL is the idea that makes this legible. The band shows
 * the swing the modulation can reach; the bright fill grows from the NEUTRAL
 * anchor to the live effective value. Filling from the band's edge instead
 * would make fast modulation read as a flickering dot rather than as a bar
 * breathing in and out, and the whole point is to see the shape of the motion
 * at a glance.
 *
 * Positions are curve-aware. A linear normalisation would put the band in
 * visibly the wrong place on a log-frequency control -- the exact controls where
 * a wide modulation range is most likely.
 */
import { toPos, type ParamSpec } from '../core/schema';
import type { ModState } from '../core/binding';

export interface ModBand {
  /** Band start and end, as [0,1] positions on the control's own axis. */
  lo: number;
  hi: number;
  span: number;
  /** The bright fill, from the neutral anchor to the effective value. */
  fillLo: number;
  fillSpan: number;
  /** Where the effective value currently sits -- the readout follows this,
   * not the set value, because it is what the engine is actually using. */
  value: number;
  /** Where the anchor sits, drawn as a hairline so the fill has a visible
   * origin even when it is momentarily zero-width. */
  neutral: number;
}

export function modBand(spec: ParamSpec, mod: ModState): ModBand {
  const at = (v: number) => toPos(spec, v);
  const lo = at(Math.min(mod.min, mod.max));
  const hi = at(Math.max(mod.min, mod.max));
  const value = at(mod.value);
  const neutral = at(mod.neutral);
  return {
    lo,
    hi,
    span: Math.max(0, hi - lo),
    fillLo: Math.min(neutral, value),
    fillSpan: Math.abs(value - neutral),
    value,
    neutral,
  };
}

/**
 * Draw the band as a strip along a linear track.
 *
 * `x0..x1` is the track in CSS px; `y` is the strip's top edge. The band is
 * drawn at low alpha and the fill at full -- the swing is context, the live
 * value is the signal, and inverting that emphasis makes a heavily modulated
 * control look like it is doing something it is not.
 */
export function drawModStrip(
  g: CanvasRenderingContext2D,
  b: ModBand,
  x0: number,
  x1: number,
  y: number,
  height: number,
  color: string,
): void {
  const w = x1 - x0;
  if (w <= 0) return;
  g.save();
  g.globalAlpha = 0.28;
  g.fillStyle = color;
  g.fillRect(x0 + b.lo * w, y, Math.max(1, b.span * w), height);
  g.globalAlpha = 1;
  // Floored to 1px: a fill that rounds to zero width vanishes entirely, and an
  // absent fill reads as "not modulated" rather than as "modulated to neutral".
  g.fillRect(x0 + b.fillLo * w, y, Math.max(1, b.fillSpan * w), height);
  g.restore();
}

/**
 * Draw the band as an arc outside a rotary control.
 *
 * `deg0`/`deg1` are the control's own sweep endpoints in the house rotary
 * convention (0 at twelve o'clock, clockwise), so the band lines up with the
 * value arc it annotates without either knowing the other's numbers.
 */
export function modArcAngles(
  b: ModBand,
  deg0: number,
  deg1: number,
): { bandFrom: number; bandTo: number; fillFrom: number; fillTo: number } {
  const sweep = deg1 - deg0;
  return {
    bandFrom: deg0 + b.lo * sweep,
    bandTo: deg0 + b.hi * sweep,
    fillFrom: deg0 + b.fillLo * sweep,
    fillTo: deg0 + (b.fillLo + b.fillSpan) * sweep,
  };
}
