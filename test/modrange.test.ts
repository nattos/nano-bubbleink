/**
 * The one control that is three parameters: the range an <bi-modbar> draws
 * is the range the engine folds, so both sides compute it here.
 */
import { describe, expect, it } from 'vitest';
import { modRange } from '../src/core/modrange';
import { param } from '../src/core/schema';

const lin = param('pos', { min: 0, max: 1, init: 0.5 });
const cut = param('cut', { min: 20, max: 20000, init: 1000, curve: { kind: 'log', a: 0 } });

describe('modRange', () => {
  it('is centred on the value, width in position space', () => {
    const r = modRange(lin, 0.5, 0.5);
    expect(r.lo).toBeCloseTo(0.25);
    expect(r.hi).toBeCloseTo(0.75);
    expect(r.min).toBeCloseTo(0.25);
    expect(r.max).toBeCloseTo(0.75);
  });
  it('clamps at the ends instead of folding back', () => {
    const r = modRange(lin, 0.9, 0.5);
    expect(r.lo).toBeCloseTo(0.65);
    expect(r.hi).toBe(1);
  });
  it('a width of 1 centred on a log axis is the whole axis', () => {
    const r = modRange(cut, 632.4555, 1);
    expect(r.min).toBeCloseTo(20, 3);
    expect(r.max).toBeCloseTo(20000, 0);
  });
  it('a width of 1 off centre is clamped, not folded', () => {
    const r = modRange(cut, 1000, 1);
    expect(r.max).toBeCloseTo(20000, 0);
    expect(r.min).toBeGreaterThan(20);
  });
  it('a half width on a log axis is symmetric in octaves, not in hertz', () => {
    const r = modRange(cut, 632.4555, 0.5);
    expect(r.max / 632.4555).toBeCloseTo(632.4555 / r.min, 3);
  });
  it('a width of 0 is the value itself', () => {
    const r = modRange(cut, 440, 0);
    expect(r.min).toBeCloseTo(440, 6);
    expect(r.max).toBeCloseTo(440, 6);
  });
});
