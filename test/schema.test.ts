/**
 * The curve is a DISPLAY mapping and nothing else.
 *
 * Values live in plain linear space everywhere -- host, engine, smoothing,
 * persistence -- and a widget applies the curve only to decide where its handle
 * sits. Everything here is about that boundary holding.
 */
import { describe, expect, it } from 'vitest';
import { fromPos, param, paramHash, toPos } from '../src/core/schema';

const CURVES = [
  { name: 'linear', spec: param('a', { min: 0, max: 10, init: 0 }) },
  { name: 'log', spec: param('b', { min: 20, max: 20000, init: 440, curve: { kind: 'log', a: 0 } }) },
  { name: 'skew', spec: param('c', { min: 0, max: 1, init: 0, curve: { kind: 'skew', a: 3 } }) },
] as const;

describe('toPos / fromPos round-trip', () => {
  for (const { name, spec } of CURVES) {
    it(name, () => {
      for (let i = 0; i <= 10; i++) {
        const p = i / 10;
        expect(toPos(spec, fromPos(spec, p))).toBeCloseTo(p, 9);
      }
    });
  }
});

describe('position is normalised, always', () => {
  it('pins the endpoints at 0 and 1', () => {
    for (const { spec } of CURVES) {
      expect(toPos(spec, spec.min)).toBe(0);
      expect(toPos(spec, spec.max)).toBe(1);
    }
  });

  it('clamps outside the range rather than extrapolating', () => {
    const s = param('a', { min: 0, max: 10, init: 0 });
    expect(toPos(s, -5)).toBe(0);
    expect(toPos(s, 99)).toBe(1);
    expect(fromPos(s, -1)).toBe(0);
    expect(fromPos(s, 2)).toBe(10);
  });
});

describe('a log curve is geometric, not just curved', () => {
  it('puts the geometric mean at the midpoint', () => {
    const hz = param('f', { min: 20, max: 20000, init: 440, curve: { kind: 'log', a: 0 } });
    expect(fromPos(hz, 0.5)).toBeCloseTo(Math.sqrt(20 * 20000), 6);
  });

  it('gives every octave equal travel', () => {
    const hz = param('f', { min: 20, max: 20480, init: 440, curve: { kind: 'log', a: 0 } });
    const step = toPos(hz, 40) - toPos(hz, 20);
    expect(toPos(hz, 80) - toPos(hz, 40)).toBeCloseTo(step, 9);
    expect(toPos(hz, 20480) - toPos(hz, 10240)).toBeCloseTo(step, 9);
  });

  it('falls back to linear when the range touches zero', () => {
    // log(0) is not a slow curve, it is -Infinity propagating into a handle
    // position. The spec is honoured by degrading, not by producing NaN.
    const s = param('f', { min: 0, max: 100, init: 0, curve: { kind: 'log', a: 0 } });
    expect(toPos(s, 50)).toBeCloseTo(0.5, 9);
    expect(Number.isFinite(fromPos(s, 0))).toBe(true);
  });
});

describe('a stepped curve has exactly the steps it declares', () => {
  const s = param('n', { min: 0, max: 4, init: 0, curve: { kind: 'stepped', a: 4 } });

  it('quantises position to the rungs', () => {
    expect(toPos(s, 1)).toBeCloseTo(0.25, 9);
    // Anything between two rungs lands on the nearer one.
    expect(fromPos(s, 0.24)).toBe(1);
    expect(fromPos(s, 0.26)).toBe(1);
  });

  it('never produces a value off a rung', () => {
    for (let i = 0; i <= 100; i++) {
      const v = fromPos(s, i / 100);
      expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-9);
    }
  });
});

describe('param() defaults', () => {
  it('refuses to smooth an enumerated parameter', () => {
    // A ramp between two enum values passes through states that mean nothing.
    expect(param('m', { min: 0, max: 3, init: 0, unit: 'indexed' }).smoothing.kind).toBe('none');
    expect(param('b', { min: 0, max: 1, init: 0, unit: 'boolean' }).smoothing.kind).toBe('none');
    expect(param('g', { min: 0, max: 1, init: 0 }).smoothing.kind).not.toBe('none');
  });

  it('hashes ids stably and distinctly', () => {
    expect(paramHash('osc.pitch')).toBe(paramHash('osc.pitch'));
    expect(paramHash('osc.pitch')).not.toBe(paramHash('osc.pitchh'));
    expect(paramHash('osc.pitch') >>> 0).toBe(paramHash('osc.pitch'));
  });
});
