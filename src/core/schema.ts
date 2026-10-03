/**
 * Parameter descriptors, byte-compatible with nano-unit's schema JSON.
 *
 * This file is a CONTRACT, not a convenience. nano-unit's C++ `describe()`
 * emits exactly this shape (engine/include/nanounit/schema.h,
 * engine/src/runtime/schema_json.cpp), and the port onto it is only cheap if
 * our descriptors deserialize from that JSON untouched. Fields we do not use
 * yet are declared anyway, so a round-trip does not silently drop them.
 *
 * Note what `curve` is and is not: it is a DISPLAY/UI mapping only. Parameter
 * values stay in plain linear space everywhere — host, engine, smoothing,
 * persistence. A widget applies the curve to decide where the handle sits; it
 * never stores a curved value.
 */

export type CurveKind = 'linear' | 'skew' | 'log' | 'stepped';
export type SmoothingKind = 'none' | 'expo' | 'linear';

export type Unit =
  | 'generic' | 'percent' | 'ratio' | 'decibels' | 'hertz' | 'seconds'
  | 'milliseconds' | 'cents' | 'semitones' | 'radians' | 'indexed' | 'boolean';

export interface Curve { kind: CurveKind; a: number }
export interface Smoothing { kind: SmoothingKind; timeMs: number }
export interface Choice { value: number; label: string }

export interface ParamSpec {
  id: string;
  /** FNV-1a-32 of `id`. Stable across reorders, which is what keeps a host's
   * automation lanes valid when a param is inserted. */
  hash: number;
  name: string;
  shortName?: string;
  unit: Unit;
  min: number;
  max: number;
  init: number;
  flags: number;
  group?: string;
  /** printf-style, e.g. "%.2f x". The unit suffix lives HERE, not at the call
   * site — every hand-passed `decimals`/`unit` in the existing nano UIs is a
   * place this field was ignored. */
  display?: string;
  choices?: Choice[];
  curve: Curve;
  smoothing: Smoothing;
}

export interface Schema {
  schemaVersion: number;
  params: ParamSpec[];
  docFields?: { path: string; init: unknown }[];
  capabilities?: string[];
  factoryPresets?: { name: string; values: Record<string, number> }[];
}

/** FNV-1a-32, matching nano-unit's `params.h:16-23`. */
export function paramHash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const LINEAR: Curve = { kind: 'linear', a: 0 };
const EXPO20: Smoothing = { kind: 'expo', timeMs: 20 };

/** Terse authoring for the testbed's own patches. Fills the boilerplate the
 * C++ builder chain fills on the other side. */
export function param(id: string, o: Partial<ParamSpec> & { min: number; max: number; init: number }): ParamSpec {
  return {
    id,
    hash: paramHash(id),
    name: o.name ?? id,
    unit: o.unit ?? 'generic',
    flags: o.flags ?? 0,
    curve: o.curve ?? LINEAR,
    // Indexed and boolean params must not smooth: a ramp between two enum
    // values passes through states that mean nothing.
    smoothing: o.smoothing ?? (o.unit === 'indexed' || o.unit === 'boolean' ? { kind: 'none', timeMs: 0 } : EXPO20),
    ...o,
  };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Value -> normalized handle position [0,1].
 *
 * `log` requires min > 0 and falls back to linear otherwise rather than
 * returning NaN — a control that silently stops tracking is worse than one
 * with the wrong feel, and a zero-or-negative minimum on a log param is an
 * authoring error we would rather surface as a visibly linear knob.
 */
export function toPos(spec: ParamSpec, value: number): number {
  const { min, max, curve } = spec;
  if (!(max > min)) return 0;
  const t = clamp01((value - min) / (max - min));
  switch (curve.kind) {
    case 'log':
      if (min <= 0) return t;
      return clamp01(Math.log(value / min) / Math.log(max / min));
    case 'skew':
      return curve.a > 0 ? Math.pow(t, 1 / curve.a) : t;
    case 'stepped': {
      const n = Math.max(1, Math.round(curve.a));
      return Math.round(t * n) / n;
    }
    default:
      return t;
  }
}

/** Normalized handle position [0,1] -> value. Inverse of `toPos`. */
export function fromPos(spec: ParamSpec, pos: number): number {
  const { min, max, curve } = spec;
  const p = clamp01(pos);
  switch (curve.kind) {
    case 'log':
      if (min <= 0) return min + p * (max - min);
      return min * Math.pow(max / min, p);
    case 'skew':
      return min + Math.pow(p, curve.a > 0 ? curve.a : 1) * (max - min);
    case 'stepped': {
      const n = Math.max(1, Math.round(curve.a));
      return min + (Math.round(p * n) / n) * (max - min);
    }
    default:
      return min + p * (max - min);
  }
}
