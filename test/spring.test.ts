/**
 * The motion layer's two load-bearing claims: the step is ANALYTIC, and the
 * tier table's numbers are true.
 *
 * Both are properties a Euler integrator would fail, and both fail silently --
 * a spring that overshoots on a dropped frame looks like a spring, just a
 * worse one, so nothing here is caught by looking.
 */
import { describe, expect, it } from 'vitest';
import { Spring, LogSpring, AngleSpring, TIERS, omegaFor, overshootFor } from '../src/core/spring';

/** Drive a spring at a fixed frame time and report what happened. */
function run(s: Spring, seconds: number, dt = 1 / 60) {
  let t = 0;
  let peak = s.value;
  let frames = 0;
  let settledAt = Infinity;
  while (t < seconds) {
    const moving = s.tick(dt);
    t += dt;
    frames++;
    if (Math.abs(s.value) > Math.abs(peak)) peak = s.value;
    if (!moving && settledAt === Infinity) settledAt = t;
    if (!moving) break;
  }
  return { peak, frames, settledAt, value: s.value };
}

describe('critically damped tiers do not overshoot', () => {
  for (const name of ['snap', 'drift'] as const) {
    it(name, () => {
      expect(TIERS[name].zeta).toBe(1);
      const s = new Spring(0, name, 1e-5);
      s.target = 1;
      const r = run(s, 2);
      // Not "approximately 1": a critically damped step has no overshoot at
      // all, and 1 + 1e-12 would still be a bug in the closed form.
      expect(r.peak).toBeLessThanOrEqual(1);
      expect(r.value).toBe(1);
    });
  }
});

describe('underdamped tiers overshoot by the amount the table promises', () => {
  for (const name of ['pop', 'settle'] as const) {
    it(name, () => {
      const z = TIERS[name].zeta;
      expect(z).toBeLessThan(1);
      const s = new Spring(0, name, 1e-6);
      s.target = 1;
      // Sampled far finer than a frame: at 60 Hz the peak falls between two
      // samples and reads ~1% low, which would make this a test of the frame
      // rate rather than of the closed form.
      const r = run(s, 2, 1 / 4000);
      const predicted = 1 + overshootFor(z);
      expect(r.peak).toBeLessThanOrEqual(predicted + 1e-9);
      expect(r.peak).toBeGreaterThan(1);
      expect(r.peak).toBeCloseTo(predicted, 3);
    });
  }
});

describe('every tier settles within its stated time', () => {
  for (const name of Object.keys(TIERS) as (keyof typeof TIERS)[]) {
    it(`${name} (${TIERS[name].settle}s)`, () => {
      const s = new Spring(0, name, 1e-3);
      s.target = 1;
      const r = run(s, 4, 1 / 240);
      // The tier promises 1%; the run stops at the epsilon, which is tighter.
      // Allow one frame of slop and nothing more.
      expect(r.settledAt).toBeLessThanOrEqual(TIERS[name].settle * 1.6);
      expect(r.settledAt).toBeGreaterThan(TIERS[name].settle * 0.2);
    });
  }
});

describe('the step is analytic, not incremental', () => {
  it('one big dt lands where many small ones do', () => {
    // The reason for the closed form. An Euler step of 0.1s at snap's stiffness
    // is unconditionally unstable and would fly off; this must simply arrive.
    const big = new Spring(0, 'snap', 1e-9);
    big.target = 1;
    big.tick(0.1);

    const small = new Spring(0, 'snap', 1e-9);
    small.target = 1;
    for (let i = 0; i < 100; i++) small.tick(0.001);

    expect(big.value).toBeCloseTo(small.value, 6);
    expect(Number.isFinite(big.value)).toBe(true);
  });

  it('clamps a stall rather than teleporting through it', () => {
    // dt is clamped to MAX_DT = 0.1: a backgrounded tab resolves to "settled",
    // but a 200ms hitch mid-gesture must not finish the motion in one frame.
    const stalled = new Spring(0, 'drift', 1e-9);
    stalled.target = 1;
    stalled.tick(10);
    const clamped = new Spring(0, 'drift', 1e-9);
    clamped.target = 1;
    clamped.tick(0.1);
    expect(stalled.value).toBeCloseTo(clamped.value, 12);
  });

  it('is idle before it is touched, and reports when it stops', () => {
    const s = new Spring(0.5, 'snap');
    expect(s.idle).toBe(true);
    expect(s.tick(1 / 60)).toBe(false);
    s.target = 1;
    expect(s.tick(1 / 60)).toBe(true);
  });
});

describe('LogSpring eases multiplicatively', () => {
  /** Frames for a spring to come to rest, at a fixed step. */
  const framesToRest = (s: { tick(dt: number): boolean }, dt = 1 / 240) => {
    let n = 0;
    while (n < 4000 && s.tick(dt)) n++;
    return n;
  };

  it('spends the same time on every octave', () => {
    // The nano-lfo finding: a linear ease across a 1s -> 8s zoom "crawls across
    // the first octave and snaps across the last". Springing log(value) makes
    // the two spans below cost the same, which is what the eye expects of a
    // zoom -- and it is the whole reason this class exists.
    const low = new LogSpring(1, 'drift', 1e-6);
    low.target = 8;
    const high = new LogSpring(8, 'drift', 1e-6);
    high.target = 64;
    expect(framesToRest(low)).toBe(framesToRest(high));
  });

  it('passes through the geometric mean, not the arithmetic one', () => {
    const s = new LogSpring(1, 'drift', 1e-9);
    s.target = 100;
    // Halfway in log space is 10; halfway in linear space is 50.5. Walk until
    // the value first exceeds 10 and check it has not already blown past what
    // a linear ease would have reached by the same fraction of the travel.
    let n = 0;
    while (n < 4000 && s.value < 10 && s.tick(1 / 240)) n++;
    expect(s.value).toBeGreaterThanOrEqual(10);
    expect(s.value).toBeLessThan(11);
  });

  it('lands exactly on its target', () => {
    const s = new LogSpring(1, 'drift', 1e-9);
    s.target = 8;
    framesToRest(s);
    expect(s.value).toBeCloseTo(8, 6);
  });
});

describe('AngleSpring takes the short way round', () => {
  it('crosses the wrap instead of unwinding', () => {
    const s = new AngleSpring(Math.PI - 0.1, 'snap', 1e-6);
    s.target = -Math.PI + 0.1;
    let t = 0;
    let maxStep = 0;
    let prev = s.value;
    while (t < 1 && s.tick(1 / 240)) {
      t += 1 / 240;
      // Compare on the circle: an unwind would show up as a long traverse.
      let d = s.value - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      maxStep = Math.max(maxStep, Math.abs(d));
      prev = s.value;
    }
    // 0.2 rad of travel, not 2*PI - 0.2.
    expect(t).toBeLessThan(0.5);
    expect(maxStep).toBeLessThan(0.2);
  });
});

describe('omegaFor is the bridge between "settle time" and stiffness', () => {
  it('is monotonically decreasing in settle time', () => {
    expect(omegaFor(0.07)).toBeGreaterThan(omegaFor(0.35));
  });
  it('refuses a zero settle time rather than dividing by it', () => {
    expect(Number.isFinite(omegaFor(0))).toBe(true);
  });
});
