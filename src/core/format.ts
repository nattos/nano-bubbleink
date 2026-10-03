/**
 * Value formatting, driven by the schema rather than by the call site.
 *
 * Every hand-passed `decimals` / `unit` / `log` argument in the existing nano
 * UIs is a place where `ParamSpec.display`, `.unit` and `.curve` already held
 * the answer and were ignored -- so the same parameter reads "0.50" in one
 * panel and "50 %" in another. Formatting lives here, reads the spec, and
 * widgets pass nothing.
 *
 * The house conventions, observed consistently across the prior art:
 *   - fixed precision per QUANTITY TYPE, not per call
 *   - multipliers always render with their glyph: `1.00 x`, never bare
 *   - every count is accompanied by its normalised rate
 *   - the middle dot separates co-located data
 */
import type { ParamSpec, Unit } from './schema';

/** The separator for co-located data. U+00B7, used everywhere in the prior art. */
export const DOT = '·';

export const join = (...parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(` ${DOT} `);

/** Default precision and suffix per unit, used when a spec declares no
 * `display` string. These are the conventions, in one place. */
const UNIT_STYLE: Record<Unit, { decimals: number; suffix: string }> = {
  generic: { decimals: 2, suffix: '' },
  percent: { decimals: 0, suffix: '%' },
  ratio: { decimals: 2, suffix: 'x' },
  decibels: { decimals: 1, suffix: 'dB' },
  hertz: { decimals: 0, suffix: 'Hz' },
  seconds: { decimals: 2, suffix: 's' },
  milliseconds: { decimals: 0, suffix: 'ms' },
  cents: { decimals: 1, suffix: 'ct' },
  semitones: { decimals: 2, suffix: 'st' },
  radians: { decimals: 3, suffix: 'rad' },
  indexed: { decimals: 0, suffix: '' },
  boolean: { decimals: 0, suffix: '' },
};

/**
 * The printf subset nano-unit's `display` field actually uses: `%.Nf` with
 * optional literal text either side, e.g. `"%.2f x"` or `"%.0f%%"`.
 *
 * Deliberately not a general printf. nano-unit's testbed implements exactly
 * this one pattern too, and matching its coverage means a display string that
 * renders here renders identically there. Anything richer would work in the
 * gallery and silently degrade in the plugin, which is worse than not
 * supporting it.
 */
const PRINTF = /^(.*?)%\.(\d+)f(.*)$/;

export function formatWith(display: string, v: number): string | null {
  const m = PRINTF.exec(display);
  if (!m) return null;
  return `${m[1]}${v.toFixed(Number(m[2]))}${m[3].replace(/%%/g, '%')}`;
}

/**
 * PERCENT SCALING.
 *
 * A percent parameter is conventionally stored in [0,1] -- nano-unit's own
 * `Unit::Percent` params use `range(0,1)` -- but a percentage is by definition
 * a number out of a hundred. nano-unit's testbed prints the raw value, so a
 * half-open mix reads "0.50"; give it a "%.0f%%" display string instead and it
 * reads "1 %", which is worse, because it is wrong rather than merely unhelpful.
 *
 * So: a `percent` unit whose range fits inside [0,1] is displayed multiplied by
 * 100, and parsed back divided by 100. The condition is on the RANGE, not on
 * the value, so a param genuinely authored in [0,100] is left alone.
 *
 * This is a deliberate divergence from nano-unit and is logged in
 * docs/NANO-UNIT-NEEDS.md -- the general fix there is a display scale on the
 * spec, which would let the engine declare the intent instead of the UI
 * inferring it.
 */
export function displayScale(spec: ParamSpec | undefined): number {
  if (spec?.unit === 'percent' && spec.max <= 1.0000001) return 100;
  return 1;
}

/** The number alone, at the right precision, with no unit. */
export function formatNumber(spec: ParamSpec | undefined, value: number): string {
  const v = value * displayScale(spec);
  if (spec?.display) {
    const s = formatWith(spec.display, v);
    // Strip a trailing unit the display string carried, so callers that want
    // the parts separately still get them.
    if (s) return s.replace(/[^\d.\-+]+$/, '').trim();
  }
  const decimals = spec ? UNIT_STYLE[spec.unit].decimals : 2;
  return v.toFixed(decimals);
}

/** The unit glyph alone. Rendered in a dimmer colour than the number, which is
 * why it is separable at all. */
export function unitOf(spec: ParamSpec | undefined): string {
  if (!spec) return '';
  if (spec.display) {
    const m = PRINTF.exec(spec.display);
    if (m) return m[3].replace(/%%/g, '%').trim();
  }
  return UNIT_STYLE[spec.unit].suffix;
}

/** Number and unit together, for a single-string readout. */
export function formatValue(spec: ParamSpec | undefined, value: number): string {
  if (spec?.choices) {
    const c = spec.choices.find((o) => o.value === Math.round(value));
    if (c) return c.label;
  }
  if (spec?.unit === 'boolean') return value >= 0.5 ? 'on' : 'off';
  if (spec?.display) {
    const s = formatWith(spec.display, value * displayScale(spec));
    if (s) return s;
  }
  const u = unitOf(spec);
  return u ? `${formatNumber(spec, value)} ${u}` : formatNumber(spec, value);
}

/**
 * Parse typed input back to a value. Tolerates the unit suffix the readout
 * printed, because a user who selects the text and retypes it will retype the
 * unit too, and rejecting their own display string is indefensible.
 *
 * Returns null on anything unparseable so the caller can keep the old value
 * rather than write NaN into the store.
 */
export function parseValue(spec: ParamSpec | undefined, text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (spec?.choices) {
    const c = spec.choices.find((o) => o.label.toLowerCase() === t.toLowerCase());
    if (c) return c.value;
  }
  if (spec?.unit === 'boolean') {
    if (/^(on|true|1|yes)$/i.test(t)) return 1;
    if (/^(off|false|0|no)$/i.test(t)) return 0;
  }
  const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(t);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v / displayScale(spec) : null;
}

/**
 * How many characters the WIDEST reading of this parameter can occupy.
 *
 * ---------------------------------------------------------------------------
 * A READING RESERVES ITS RANGE, NOT ITS VALUE
 *
 * This is the fix for a defect that is easy to ship and unpleasant to use: a
 * readout is sized by the string currently in it, so the moment the value
 * crosses 999.9 the control gets a character wider, and everything to its right
 * moves. On a knob -- whose width is max(dial, readout) -- turning ONE dial
 * past a power of ten re-lays-out the whole row. Nobody can point at it while
 * it is happening, and everybody can feel that the panel is unsettled.
 *
 * The parameter's DOMAIN is known before anything is rendered: `min`, `max`,
 * the decimals implied by `unit` or `display`, and the enumerated labels. So
 * the width the reading will ever need is computable up front, exactly, and it
 * never has to change. Not a guessed `min-width` in pixels, which is either too
 * small (and still jumps) or too large (and wastes the space this family is
 * always short of).
 *
 * WHY CHARACTERS AND NOT PIXELS. The whole family is set in `--app-mono`, and
 * base.ts puts `font-variant-numeric: tabular-nums` on every widget root. In a
 * monospace face `1ch` is the advance of every glyph, so a character count IS a
 * width, resolved by CSS at whatever font-size the span actually inherits --
 * which no amount of measuring in TypeScript would get right across three
 * densities and a scale slider. If a proportional fallback ever loads, digits
 * are still tabular and every other character in a number is narrower than a
 * digit, so the reservation stays an upper bound rather than becoming a clip.
 *
 * WHY THE ENDPOINTS ARE ENOUGH. Decimals are fixed per unit, so a reading is
 * (sign)(integer digits)(point)(decimals). The integer digits are maximised at
 * the endpoint of larger magnitude and the sign appears only below zero -- both
 * of which are endpoints. An interior value cannot beat them.
 */
export function readingChars(spec: ParamSpec | undefined): number {
  // A control with no spec renders an error, not a reading; the fallback only
  // has to be non-zero so a caller need not special-case it.
  if (!spec) return 6;
  if (spec.choices?.length) {
    return spec.choices.reduce((n, c) => Math.max(n, c.label.length), 1);
  }
  if (spec.unit === 'boolean') return 3;
  return Math.max(formatNumber(spec, spec.min).length, formatNumber(spec, spec.max).length);
}

/**
 * The same reservation for an arbitrary formatter over a numeric domain -- for
 * graph readouts, where the domain is an axis rather than a ParamSpec and the
 * formatter may be anything the caller supplied.
 *
 * Interior points ARE sampled here, unlike `readingChars`: a caller-supplied
 * formatter is free to switch units mid-range (formatHz does, at 1 kHz), so the
 * endpoint argument above does not hold and the honest answer is to ask.
 */
export function domainChars(min: number, max: number, f: (v: number) => string): number {
  let n = 0;
  for (let i = 0; i <= 8; i++) n = Math.max(n, f(min + ((max - min) * i) / 8).length);
  return n;
}

/**
 * A count with its normalised rate, per the house habit that a bare count is
 * not enough context to judge -- "48 onsets (3.0/bar)".
 */
export function countWithRate(n: number, per: number, perLabel: string): string {
  if (!(per > 0)) return String(n);
  return `${n} (${(n / per).toFixed(1)}/${perLabel})`;
}

/**
 * Frequency, at the precision the magnitude deserves: sub-kilohertz values want
 * whole hertz, above that they want kilohertz to one place. A fixed precision
 * either prints "12000 Hz" where "12.0 kHz" was meant, or "0 Hz" for 0.4.
 */
export function formatHz(hz: number): string {
  const a = Math.abs(hz);
  if (a >= 10000) return `${(hz / 1000).toFixed(1)} kHz`;
  if (a >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  if (a >= 100) return `${hz.toFixed(0)} Hz`;
  if (a >= 10) return `${hz.toFixed(1)} Hz`;
  return `${hz.toFixed(2)} Hz`;
}

/** Seconds, rendered in whichever of ms / s reads without leading zeros. */
export function formatTime(seconds: number): string {
  const a = Math.abs(seconds);
  if (a < 1) return `${(seconds * 1000).toFixed(a < 0.01 ? 2 : 0)} ms`;
  return `${seconds.toFixed(2)} s`;
}

/** Always signed. For deltas, detunes and bipolar readouts, where the absence
 * of a plus sign reads as "unsigned quantity" rather than as "positive". */
export function signed(v: number, decimals = 2): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}`;
}
