/**
 * Springs, stepped analytically. The motion layer.
 *
 * None of the four prior codebases has one at all — a handful of CSS
 * transitions, some rAF loops, one log-domain one-pole, and nothing else. This
 * is the part we are actually inventing, so the reasoning is written down.
 *
 * THE RULE: EASING IS FOR THE VIEW, NEVER FOR THE SIGNAL.
 *
 * The first cut of this drew the line at overshoot -- values could ease but not
 * bounce. That was still wrong, and wrong in the direction that matters.
 *
 * If a thing on screen REPRESENTS A TEMPORAL PROCESS, it must show that process
 * at time t and nothing else. A knob pointer easing toward a new value is
 * asserting a sweep the parameter never performed; ease an undo and you animate
 * a gesture the user did not make; ease a modulated value and the dial reports
 * a smoothed copy of a signal whose whole point is its shape. So value handles,
 * meters, scopes and modulation bands DO NOT USE THIS MODULE AT ALL. They are
 * assigned, every frame, from the number.
 *
 * What may ease is everything that is not the signal: a press state, a pip, a
 * sliding highlight, a panel arriving, an outline reflowing, a viewport
 * rescaling. None of those is a reading of anything, so their motion is free to
 * be expressive -- and that is where the tactility lives.
 *
 * STIFF, NOT LOOSE. Within that freedom the bias is hard: short settle times
 * and a small bounce, closer to a latch than to a bob. A 7% overshoot resolved
 * inside 110ms reads as mass; the same overshoot over 400ms reads as slack. The
 * tiers below are deliberately faster than they were.
 *
 * WHY ANALYTIC AND NOT EULER. A semi-implicit Euler integrator is conditionally
 * stable: at the stiffnesses that feel good here (omega ~ 74 rad/s) a single
 * dropped frame is a large enough dt to make it overshoot or diverge outright.
 * Browsers drop frames constantly, and a tab returning from the background
 * hands you a dt of seconds. The closed-form solution of
 *
 *     e'' + 2*zeta*w*e' + w^2*e = 0,   e = value - target
 *
 * is exact for any dt, so a 4-second stall resolves to "already settled"
 * instead of to a launch. Both damping regimes are solved in closed form below.
 *
 * WHY TIERS ARE SETTLE TIMES, NOT STIFFNESSES. A stiffness is not a designable
 * quantity — nobody has an intuition for 95 rad/s. A settle time is: it is how
 * long the motion takes. omega is derived from it and from zeta.
 *
 * ON SUBSTEPPING. A linear spring has a closed-form solution, so there is
 * nothing to substep: `tick` is exact at any dt and a 4-second stall resolves
 * correctly in one call. Substepping becomes necessary the moment a simulation
 * stops being linear — a liquid surface with a nonlinear restoring force, a
 * collision, a clamp inside the loop. Any such simulation added later should
 * substep at a fixed h and NOT reuse this class, rather than quietly making
 * this one approximate for everything that currently depends on it being not.
 */

/**
 * Step response of a CRITICALLY damped system decays as (1 + w t) exp(-w t).
 * Solving that for 1% of the initial displacement gives w*t = 6.6384.
 *
 * The (1 + w t) factor is easy to drop -- without it the root is 4.6052, and
 * with a transposed digit it is 7.6383. Both are wrong by enough to feel, and
 * neither is visible by inspection, which is why the gallery measures the
 * settle time it actually gets and prints it against the declared one rather
 * than trusting this number.
 */
const SETTLE_K = 6.6384;

/**
 * omega for a requested settle time at a given damping ratio.
 *
 * UNDERDAMPED (zeta < 1) the unit step response is
 *
 *     y(t) = exp(-z w t) [ cos(wd t) + (z / sqrt(1-z^2)) sin(wd t) ],  wd = w sqrt(1-z^2)
 *
 * and its extrema fall at wd*t = k*pi, where the bracket is exactly +/-1. So
 * the curve through the peaks -- the envelope that actually matters, the one a
 * settling criterion should be measured against -- is plain exp(-z w t), and
 *
 *     z*w*t = ln(100)   =>   w = 4.6052 / (z * settle)
 *
 * THE FIRST VERSION OF THIS WAS WRONG and the gallery caught it. Writing y in
 * amplitude-phase form gives a sin() with amplitude 1/sqrt(1-z^2), and that
 * factor looks like it belongs in the envelope; it does not, because sin() is
 * not at 1 where the extrema are -- it is at sqrt(1-z^2), which cancels it
 * exactly. Carrying the factor made every underdamped tier ~6% stiff.
 *
 * The critical case keeps its own constant: this expression diverges at z = 1.
 *
 * ONE HONEST CAVEAT. "Settle to 1%" is intrinsically coarse for an oscillating
 * system: the response crosses 1% somewhere between two extrema, so the real
 * crossing lands up to half an oscillation early. That granularity is a
 * property of underdamping, not an error, which is why the probe measures the
 * ENVELOPE DECAY RATE rather than the crossing time -- see halfPeriodFor.
 */
export function omegaFor(settleSeconds: number, zeta = 1): number {
  const s = Math.max(1e-3, settleSeconds);
  if (zeta >= 0.98) return SETTLE_K / s;
  const z = Math.max(0.05, zeta);
  return Math.log(100) / (z * s);
}

/** Half an oscillation, in seconds — the granularity of a 1% settle criterion
 * at this damping. Zero when critically damped, because there is no
 * oscillation to be coarse about. */
export function halfPeriodFor(settleSeconds: number, zeta: number): number {
  if (zeta >= 0.98) return 0;
  const w = omegaFor(settleSeconds, zeta);
  return Math.PI / (w * Math.sqrt(1 - zeta * zeta));
}

/** Peak overshoot of an underdamped step, as a fraction of the step. Exposed so
 * the gallery can print the value the tier table PROMISES next to the one it
 * measures — a tier whose bounce is a surprise is a tier nobody tuned. */
export const overshootFor = (zeta: number): number =>
  zeta >= 1 ? 0 : Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta));

export interface TierSpec {
  /** Seconds to settle within 1% of the step. */
  settle: number;
  /** Damping ratio. Below 1 overshoots — allowed only on chrome. */
  zeta: number;
  /** Why this tier exists, printed in the gallery header. */
  use: string;
}

/**
 * Named motion tiers. Widgets pick a tier; a widget that wants its own number
 * is a widget drifting out of the system.
 *
 * The zeta column IS the overshoot rule, made mechanical: `snap` and `drift`
 * carry values and cannot overshoot; `pop` and `settle` carry furniture and do.
 */
export const TIERS = {
  /** CHROME that must not overshoot: focus rings, a caret, anything whose
   * arrival point is also a hit target. Fast enough to read as a consequence of
   * the input rather than an animation of it. */
  snap: { settle: 0.07, zeta: 1, use: 'focus rings, hit targets — no overshoot' },

  /** CHROME, small and touched. Press states, toggle pips, the sliding segment
   * highlight. ~7% overshoot resolved in 110ms: one small bounce, visible, over
   * before it can be thought about. This is where the tactility lives. */
  pop: { settle: 0.11, zeta: 0.62, use: 'press, pip, sliding highlight — 8% bounce' },

  /** CHROME, large. Lab entry, panel moves, group outline reflow. Gentler,
   * because a 7% bounce on a 600px slide is a lurch where on a 12px pip it is
   * charm — but still short. */
  settle: { settle: 0.18, zeta: 0.8, use: 'panels, overlays, outline reflow — 2% bounce' },

  /** THE VIEW. Auto-zoom, axis rescale, camera moves. Not a value and not a
   * touched object: a transform of the frame the values are drawn in. It gets
   * the longest tier because the eye has to track the whole field through it,
   * and zero overshoot because a viewport that springs past makes the data
   * inside it appear to move. */
  drift: { settle: 0.35, zeta: 1, use: 'viewport and axis transforms — no overshoot' },
} as const satisfies Record<string, TierSpec>;

export type TierName = keyof typeof TIERS;

/** Back-compat / convenience: the settle times alone. */
export const TIER = {
  snap: TIERS.snap.settle,
  pop: TIERS.pop.settle,
  settle: TIERS.settle.settle,
  drift: TIERS.drift.settle,
} as const;

function resolve(tier: TierName | number | TierSpec): { w: number; z: number } {
  if (typeof tier === 'number') return { w: omegaFor(tier, 1), z: 1 };
  const t = typeof tier === 'string' ? TIERS[tier] : tier;
  return { w: omegaFor(t.settle, t.zeta), z: t.zeta };
}

/**
 * A dt this large means the tab was backgrounded, the thread stalled, or a
 * breakpoint was hit. The analytic step handles it correctly — it resolves to
 * "settled" — which is exactly right for a stall but wrong for a 200ms hitch
 * mid-gesture, where finishing the motion in one frame reads as a teleport.
 * Clamping treats a hitch as a slow frame and a stall as a stall.
 */
const MAX_DT = 0.1;

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private omega: number;
  private zeta: number;

  /** Absolute distance below which the spring snaps to target and goes idle.
   * Scale-dependent: a spring driving a normalized [0,1] position wants a much
   * smaller epsilon than one driving pixels. */
  epsilon: number;

  constructor(initial = 0, tier: TierName | number | TierSpec = 'snap', epsilon = 1e-4) {
    this.value = initial;
    this.target = initial;
    const r = resolve(tier);
    this.omega = r.w;
    this.zeta = r.z;
    this.epsilon = epsilon;
  }

  setTier(tier: TierName | number | TierSpec): void {
    const r = resolve(tier);
    this.omega = r.w;
    this.zeta = r.z;
  }

  /** True when the spring has nothing left to do. Draw loops check this to
   * stop scheduling frames — a widget that keeps a rAF alive forever to animate
   * nothing is the most common way a panel of these becomes expensive. */
  get idle(): boolean {
    return this.velocity === 0 && this.value === this.target;
  }

  /** Jump with no motion. For initialization and for adopting a value the user
   * is actively dragging — see `track`. */
  snapTo(v: number): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }

  /**
   * Follow a value 1:1, killing any motion.
   *
   * For a chrome spring that must temporarily stop being a spring — one being
   * dragged directly, one whose target is being scrubbed. A signal never needs
   * this, because a signal never had a spring to suspend.
   */
  track(v: number): void {
    this.snapTo(v);
  }

  /** Advance. Returns true while still moving, so a caller can drive its own
   * rAF from the return value. */
  tick(dt: number): boolean {
    if (this.idle) return false;
    const h = Math.min(Math.max(0, dt), MAX_DT);
    if (h === 0) return true;

    const w = this.omega;
    const z = this.zeta;
    const e0 = this.value - this.target;
    const v0 = this.velocity;

    let e: number;
    let v: number;
    if (z >= 0.98) {
      // Critical: e(t) = (A + B t) exp(-w t).
      const decay = Math.exp(-w * h);
      const b = v0 + w * e0;
      e = (e0 + b * h) * decay;
      v = (b - w * e0 - w * b * h) * decay;
    } else {
      // Underdamped: e(t) = exp(-z w t) (A cos(wd t) + B sin(wd t)).
      const wd = w * Math.sqrt(1 - z * z);
      const decay = Math.exp(-z * w * h);
      const a = e0;
      const b = (v0 + z * w * e0) / wd;
      const c = Math.cos(wd * h);
      const s = Math.sin(wd * h);
      e = decay * (a * c + b * s);
      v = decay * ((-z * w * a + b * wd) * c + (-z * w * b - a * wd) * s);
    }

    this.value = this.target + e;
    this.velocity = v;

    // Both tests are needed: an underdamped spring crosses its target with the
    // velocity still at full tilt, and testing position alone would freeze it
    // there — the bounce would never happen.
    if (Math.abs(e) < this.epsilon && Math.abs(v) < this.epsilon * w) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }
}

/**
 * A spring over a MULTIPLICATIVE quantity — a time span, a frequency axis, a
 * zoom factor.
 *
 * nano-lfo found this the hard way on its waveform axis: a linear one-pole
 * easing a 1s -> 8s zoom "crawls across the first octave and snaps across the
 * last", because equal linear steps are wildly unequal musical steps
 * (wave_axis.ts:241-251). Springing log(value) makes every octave take the same
 * time, which is what the eye expects of a zoom.
 *
 * Values must be strictly positive; log of a non-positive span is not a slow
 * animation, it is a NaN that propagates into the axis and blanks the display.
 */
export class LogSpring {
  private readonly inner: Spring;

  constructor(initial = 1, tier: TierName | number = 'drift', epsilon = 1e-4) {
    this.inner = new Spring(Math.log(Math.max(1e-9, initial)), tier, epsilon);
  }

  get value(): number {
    return Math.exp(this.inner.value);
  }

  get target(): number {
    return Math.exp(this.inner.target);
  }

  set target(v: number) {
    this.inner.target = Math.log(Math.max(1e-9, v));
  }

  get idle(): boolean {
    return this.inner.idle;
  }

  setTier(tier: TierName | number): void {
    this.inner.setTier(tier);
  }

  snapTo(v: number): void {
    this.inner.snapTo(Math.log(Math.max(1e-9, v)));
  }

  track(v: number): void {
    this.snapTo(v);
  }

  tick(dt: number): boolean {
    return this.inner.tick(dt);
  }
}

/**
 * A spring over an angle, taking the short way round.
 *
 * A plain spring from 350deg to 10deg travels 340 degrees backwards through the
 * whole dial. Phase readouts and rotary pointers past their wrap point need
 * this; a knob with a 270-degree sweep and a dead zone does not.
 */
export class AngleSpring {
  private readonly inner: Spring;

  constructor(initialRad = 0, tier: TierName | number = 'snap', epsilon = 1e-4) {
    this.inner = new Spring(initialRad, tier, epsilon);
  }

  get value(): number {
    return this.inner.value;
  }

  get idle(): boolean {
    return this.inner.idle;
  }

  /** Unwraps the target to whichever revolution is nearest the current value,
   * so the motion is always the short arc. */
  set target(rad: number) {
    const TAU = Math.PI * 2;
    const delta = ((rad - this.inner.value + Math.PI) % TAU + TAU) % TAU - Math.PI;
    this.inner.target = this.inner.value + delta;
  }

  snapTo(rad: number): void {
    this.inner.snapTo(rad);
  }

  track(rad: number): void {
    this.snapTo(rad);
  }

  tick(dt: number): boolean {
    return this.inner.tick(dt);
  }
}
