/**
 * The formatting rules that were ARGUED FOR, not the ones that are obvious.
 *
 * Every case here stands in for a decision recorded elsewhere -- a finding in
 * docs/NANO-UNIT-NEEDS.md, or a measured layout bug -- so a failure means the
 * decision was undone, not that a number moved.
 */
import { describe, expect, it } from 'vitest';
import {
  displayScale, domainChars, formatHz, formatNumber, formatValue, parseValue,
  readingChars, unitOf,
} from '../src/core/format';
import { param } from '../src/core/schema';

describe('percent inference (NANO-UNIT-NEEDS #1)', () => {
  // nano-unit has no displayScale, so a percent stored in [0,1] renders as
  // "1 %" at half. The rule keys on the RANGE, not the value, so a param
  // genuinely authored in [0,100] is left alone.
  const fraction = param('mix', { min: 0, max: 1, init: 0.5, unit: 'percent' });
  const whole = param('mix100', { min: 0, max: 100, init: 50, unit: 'percent' });

  it('scales a [0,1] percent by 100', () => {
    expect(displayScale(fraction)).toBe(100);
    expect(formatNumber(fraction, 0.5)).toBe('50');
  });

  it('leaves a [0,100] percent alone', () => {
    expect(displayScale(whole)).toBe(1);
    expect(formatNumber(whole, 50)).toBe('50');
  });

  it('round-trips through the parser it printed for', () => {
    const printed = formatValue(fraction, 0.5);
    expect(parseValue(fraction, printed)).toBeCloseTo(0.5, 6);
  });
});

describe('a reading reserves its RANGE, not its value', () => {
  it('takes the wider of the two endpoints', () => {
    // Decibels print to one decimal: "-20.0" is five characters and "6.0" is
    // three. The reservation must be five, or the control resizes on the way
    // past zero -- and past -10, and past 0.
    const db = param('gain', { min: -20, max: 6, init: 0, unit: 'decibels' });
    expect(formatNumber(db, -20)).toBe('-20.0');
    expect(readingChars(db)).toBe('-20.0'.length);
  });

  it('reserves the widest enumerated label', () => {
    const mode = param('mode', {
      min: 0, max: 2, init: 0, unit: 'indexed',
      choices: [
        { value: 0, label: 'off' },
        { value: 1, label: 'triangle' },
        { value: 2, label: 'saw' },
      ],
    });
    expect(readingChars(mode)).toBe('triangle'.length);
  });

  it('samples the interior, because an arbitrary formatter can be widest there', () => {
    // readingChars may reason from the endpoints: decimals are fixed per unit,
    // so the integer digits peak at the larger endpoint and the sign only
    // appears below zero. A caller-supplied formatter owes us no such thing,
    // and this one is widest exactly in the middle.
    const wideInTheMiddle = (v: number) =>
      (v <= 0 || v >= 1 ? 'end' : `mid ${v.toFixed(2)}`);
    expect(domainChars(0, 1, wideInTheMiddle)).toBe('mid 0.50'.length);
  });

  it('covers formatHz across its unit switch', () => {
    // "20.0 Hz" is seven, "20.0 kHz" is eight, and nothing sampled between
    // them is wider. Pinned because the graph readout under a pointer sweep
    // moved 10.84px before this reservation existed.
    expect(domainChars(20, 20000, formatHz)).toBe(8);
  });
});

describe('the unit is separable from the number', () => {
  it('splits a printf display into parts that recombine', () => {
    const hz = param('freq', { min: 20, max: 20000, init: 440, unit: 'hertz' });
    expect(formatValue(hz, 440)).toBe(`${formatNumber(hz, 440)} ${unitOf(hz)}`);
  });

  it('never leaves a unit glyph inside the number', () => {
    const pct = param('mix', { min: 0, max: 1, init: 0.5, unit: 'percent', display: '%.0f%%' });
    expect(formatNumber(pct, 0.5)).toBe('50');
    expect(unitOf(pct)).toBe('%');
  });
});

describe('parseValue refuses rather than writing NaN', () => {
  const hz = param('freq', { min: 20, max: 20000, init: 440, unit: 'hertz' });
  it('returns null on junk', () => {
    expect(parseValue(hz, 'banana')).toBeNull();
    expect(parseValue(hz, '')).toBeNull();
  });
  it('tolerates the suffix it printed', () => {
    expect(parseValue(hz, '440 Hz')).toBeCloseTo(440, 6);
  });
});
