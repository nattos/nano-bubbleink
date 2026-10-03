/**
 * A modulation range as one control: the destination's own value is the
 * CENTRE, a second parameter is the WIDTH, and the range is
 *   [centre - width/2, centre + width/2]
 * in the parameter's normalised position space (the space toPos/fromPos
 * map, so a width of 1 on a log cutoff is the whole log axis and the bar the
 * widget draws is the range the engine walks). One pure function, used by
 * <bi-modbar> to draw and by a host binding to turn an engine's live
 * modulated value into a ModState.
 */
import { clamp01, fromPos, toPos, type ParamSpec } from './schema';

export interface ModRange {
  /** Range ends, in the parameter's own units. */
  min: number;
  max: number;
  /** The same, as [0,1] positions. */
  lo: number;
  hi: number;
}

export function modRange(spec: ParamSpec, value: number, width: number): ModRange {
  const c = toPos(spec, value);
  const w = clamp01(width);
  const lo = clamp01(c - w / 2);
  const hi = clamp01(c + w / 2);
  return { min: fromPos(spec, lo), max: fromPos(spec, hi), lo, hi };
}
