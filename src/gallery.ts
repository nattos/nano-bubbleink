/**
 * <bi-gallery> -- the lab page.
 *
 * The idiom is lifted from annotator's groove2_atlas_lab, which exists to make
 * a design decision rather than to demonstrate a finished thing. Its three
 * layout invariants apply here unchanged:
 *
 *   TWO SIZES, SIDE BY SIDE. A widget that reads at full size and is mud at 40%
 *   is the failure this whole exercise can walk into, and the only way to catch
 *   it is to have both in one eyeful. Every row renders twice.
 *
 *   EVERY DENSITY, NOT THE FLATTERING ONE. compact / normal / expanded are the
 *   same control at three information densities. A family that only ever gets
 *   looked at in `normal` will have two broken densities and nobody will know.
 *
 *   THE CONTROLS ARE THE DISPLAY DECISIONS, NOT CORRECTIONS. Scale, accent and
 *   modulation are choices we have not made yet, so they are adjustable. The
 *   things that ARE decided -- the motion tiers, the tint ladder, the rotary
 *   sweep -- are printed in the header and NOT adjustable, because a knob next
 *   to a decided constant invites relitigating it by feel.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import { base } from './theme/base';
import { applySkinFromUrl, SKINS } from './theme/skins';
import { ParamStore } from './core/param-store';
import { param, fromPos } from './core/schema';
import { modRange } from './core/modrange';
import { TIERS, Spring, omegaFor, overshootFor, halfPeriodFor, type TierName } from './core/spring';
import { FrameLoop } from './core/canvas';
import { rng } from './draw/marks';
import { DOT } from './core/format';
import type { Hint } from './widgets/bi-hint';
import type { GroupTab } from './widgets/bi-group';
import type { Series } from './widgets/graph-series';
import { type Knot } from './core/curve';

import './widgets/bi-knob';
import './widgets/bi-grid';
import './widgets/bi-modbar';
import './widgets/bi-xy';
import './widgets/bi-slider';
import './widgets/bi-seg';
import './widgets/bi-toggle';
import './widgets/bi-group';
import './widgets/bi-hint';
import './widgets/bi-graph';
import './widgets/bi-number';
import './widgets/bi-trigger';
import './widgets/bi-encoder';
import './widgets/bi-text';
import './widgets/bi-card';

// Before any component renders: a skin applied after first paint is a visible
// flash of the other material.
const SKIN = applySkinFromUrl();

/**
 * The demo parameter set.
 *
 * Chosen to exercise the awkward cases rather than the easy ones: a log-curved
 * frequency spanning eight octaves (where a linear normalisation would be
 * visibly wrong), a bipolar value whose default is mid-range (so the detent has
 * somewhere to be), a percent, a multiplier, an enum, and a boolean.
 *
 * ---------------------------------------------------------------------------
 * DEFAULTS MUST LAND ON AN ANGLE SOMEBODY CHOSE.
 *
 * Frequency was 20 Hz .. 12 kHz with a 440 default, which on a log curve puts
 * the pointer at position 0.483 -- four and a half degrees off vertical. Nobody
 * reads that as "the default is a bit below the middle of the range"; they read
 * it as a dial that failed to centre, because ALMOST vertical is the one thing
 * a rotary control must never be. A default belongs either exactly at twelve
 * o'clock or far enough away to be obviously deliberate.
 *
 * Every log range here is now chosen so its default is the GEOMETRIC MEAN of
 * its endpoints, which is what puts it dead centre on a log curve:
 *
 *   freq   A0 .. A8, so concert A sits at twelve o'clock -- sqrt(27.5*7040)=440
 *   ratio  +/- three octaves around unity -- sqrt(0.125*8) = 1
 *   temp   two decades around 0.1 -- sqrt(0.01*1) = 0.1
 *
 * Drive is the deliberate off-centre case: 8 of 0..24 is exactly one third of
 * the sweep, which lands at -45 degrees. A clean angle, obviously chosen, and
 * proof the rule is "intentional" rather than "always centred".
 */
function demoStore(): ParamStore {
  return new ParamStore([
    param('osc.freq', {
      name: 'Frequency', shortName: 'Freq', unit: 'hertz',
      min: 27.5, max: 7040, init: 440,
      curve: { kind: 'log', a: 0 }, display: '%.1f Hz',
    }),
    param('osc.drive', {
      name: 'Drive', unit: 'generic', min: 0, max: 24, init: 8, display: '%.2f',
    }),
    param('osc.tilt', {
      name: 'Tilt', unit: 'generic', min: -1, max: 1, init: 0, display: '%.3f',
    }),
    param('osc.mix', {
      name: 'Mix', unit: 'percent', min: 0, max: 1, init: 0.5, display: '%.0f%%',
    }),
    param('osc.ratio', {
      name: 'Ratio', unit: 'ratio', min: 0.125, max: 8, init: 1,
      curve: { kind: 'log', a: 0 }, display: '%.2f x',
    }),
    param('osc.temp', {
      name: 'Temperature', shortName: 'Temp', unit: 'generic',
      min: 0.01, max: 1, init: 0.1,
      curve: { kind: 'log', a: 0 }, display: '%.3f',
    }),
    param('osc.mode', {
      name: 'Mode', unit: 'indexed', min: 0, max: 3, init: 1,
      choices: [
        { value: 0, label: 'sine' }, { value: 1, label: 'relax' },
        { value: 2, label: 'sync' }, { value: 3, label: 'chaos' },
      ],
    }),
    param('osc.bank', {
      name: 'Bank', unit: 'indexed', min: 0, max: 5, init: 0,
      choices: [
        { value: 0, label: 'kick' }, { value: 1, label: 'tom' },
        { value: 2, label: 'metal' }, { value: 3, label: 'string' },
        { value: 4, label: 'reed' }, { value: 5, label: 'noise' },
      ],
    }),
    param('osc.bypass', { name: 'Bypass', unit: 'boolean', min: 0, max: 1, init: 0 }),
    param('osc.retrig', { name: 'Retrigger', shortName: 'Retrig', unit: 'boolean', min: 0, max: 1, init: 0 }),
    param('osc.partials', {
      name: 'Partials', unit: 'indexed', min: 1, max: 12, init: 5, display: '%.0f',
    }),
    // The grid, the modbar and the pad (2026-09-16, the cycle synth): a
    // large enum with groups and marks; a destination with its width and
    // channel beside it; two axes.
    param('osc.cell', {
      name: 'Cell', unit: 'indexed', min: 0, max: 17, init: 4, curve: { kind: 'stepped', a: 17 },
      choices: ['pwm', 'growl', 'comb', 'stutter', 'peaks', 'pwm', 'syncwin', 'comb', 'growl',
                'peaks', 'pwm', 'stutter', 'cheb', 'comb', 'syncwin', 'peaks', 'pwm', 'stutter']
        .map((label, value) => ({ value, label })),
    }),
    param('osc.pos', { name: 'Position', unit: 'percent', min: 0, max: 1, init: 0.5 }),
    param('osc.pos.mod.width', { name: 'Position width', unit: 'percent', min: 0, max: 1, init: 0.5 }),
    param('osc.pos.mod.ch', {
      name: 'Position channel', unit: 'indexed', min: 0, max: 4, init: 1, curve: { kind: 'stepped', a: 4 },
      choices: ['off', 'main', 'a', 'b', 'c'].map((label, value) => ({ value, label })),
    }),
    param('osc.cut', { name: 'Cutoff', unit: 'hertz', min: 20, max: 20000, init: 1200, curve: { kind: 'log', a: 0 } }),
    param('osc.cut.mod.width', { name: 'Cutoff width', unit: 'percent', min: 0, max: 1, init: 0.3 }),
    param('osc.cut.mod.ch', {
      name: 'Cutoff channel', unit: 'indexed', min: 0, max: 4, init: 2, curve: { kind: 'stepped', a: 4 },
      choices: ['off', 'main', 'a', 'b', 'c'].map((label, value) => ({ value, label })),
    }),
    param('osc.x', { name: 'X', unit: 'percent', min: 0, max: 1, init: 0.35 }),
    param('osc.y', { name: 'Y', unit: 'percent', min: 0, max: 1, init: 0.6 }),
  ]);
}

/**
 * The document channel, alongside the parameters.
 *
 * Separate from demoStore() only so the two channels are visibly two things --
 * they share one store and one undo stack, which is the point of
 * core/binding.ts's TextBinding note.
 */
function withDocs(s: ParamStore): ParamStore {
  /*
   * The card row's own two parameters, and they are SEEDED OFF THEIR DEFAULTS
   * on purpose.
   *
   * The card's whole argument is that an affordance which hides state has to
   * announce a non-default behind it -- and a demo of a warning that never
   * fires is a demo of nothing, which the graph's clip fringe already taught
   * us once. With everything at init both marks are dark and the row proves
   * the opposite of what it claims. So these two start moved, and the gear
   * pip and the collapse pip are visible in the very first screenshot.
   */
  s.add(param('fx.tone', {
    name: 'Tone', unit: 'percent', min: 0, max: 1, init: 0.5, display: '%.0f%%',
  }));
  s.add(param('fx.shape', {
    name: 'Shape', unit: 'indexed', min: 0, max: 2, init: 0,
    choices: [{ value: 0, label: 'soft' }, { value: 1, label: 'hard' },
              { value: 2, label: 'fold' }],
  }));
  s.seed({ 'fx.tone': 0.82, 'fx.shape': 2 });

  s.addText('doc.name', 'Bowed metal 3', { name: 'Patch name', placeholder: 'Untitled' });
  s.addText('doc.notes',
    'Fitted from 4 takes. cf row 2 is doing most of the work; the '
    + 'reed-like attack only survives above temp 0.06.',
    { name: 'Notes', placeholder: 'What is this patch for?', multiline: true });
  return s;
}

/**
 * The category hues, as the theme defines them. Not re-typed here as hex --
 * a second copy of the palette in TypeScript is exactly the drift theme/base's
 * cssVar() exists to prevent -- but read from the live tokens at module load,
 * AFTER the skin is applied, so each skin's inks are the ones shown.
 */
const CATEGORY = [
  'source', 'color', 'filter', 'warp', 'composite', 'motion', 'mod',
].map((name) => ({
  name,
  hex: getComputedStyle(document.documentElement)
    .getPropertyValue(`--app-cat-${name}`).trim() || '#22d3ee',
}));

/** Keep every other query param when switching skin, so a close-up of one row
 * stays on that row across the comparison -- which is the only way an A/B of
 * two materials is actually an A/B. */
function skinHref(k: string): string {
  const q = new URLSearchParams(location.search);
  q.set('skin', k);
  return `?${q.toString()}`;
}

/** What each skin believes a colour IS -- printed in the header because it is
 * the one thing that distinguishes them, and it is not visible from a
 * screenshot of any single control. */
const SKIN_LAW: Record<string, string> = {
  ink: 'juice as pigment \u00b7 multiply into paper \u00b7 overlaps darken',
  'ink-dark': 'juice as opaque ink \u00b7 laid on dark stock \u00b7 no overprint',
};

interface Row {
  tag: string;
  /** The design axis this widget answers -- what KIND of question it is for.
   * Borrowed from the atlas lab, where grouping variants by axis is what made
   * twelve of them comparable. */
  axis: string;
  note: string;
  render: (store: ParamStore, density: string) => unknown;
}

/**
 * The parked card's specimen content.
 *
 * A literal rather than a live control's state, because nothing produces one of
 * these any more -- see the header of widgets/bi-hint.ts. It sits in the
 * gallery so the two materials stay rendered and skinned; a style kept only in
 * a file is a style that is broken the next time anyone looks at it.
 */
const HINT_SPECIMEN: Hint = {
  title: 'Frequency',
  value: '440.0 Hz',
  // readingChars for osc.freq's range, plus " Hz". A specimen that does not
  // demonstrate the house rule is a specimen that will be copied without it.
  valueChars: 9,
  sub: `27.5\u20137040.0 Hz ${DOT} log`,
  keys: [
    ['\u2195', 'drag'],
    ['\u21e7', 'fine'],
    ['\u232b', 'reset'],
    ['0\u20139', 'type'],
  ],
};

/**
 * The tab strips the gallery exercises.
 *
 * Deliberately awkward: a two-panel group, a four-panel one whose strip is
 * wider than its contents (so the group's min-width has to grow for its own
 * tabs, the failure the single-label case already taught us), and an action
 * sitting in the MIDDLE rather than tidily at the end -- because arrow stepping
 * has to skip it and the detached capsule has to read as a break in the strip
 * rather than as the end of it.
 */
const TABS_PAIR: GroupTab[] = [
  { id: 'shape', label: 'Shape' },
  { id: 'drive', label: 'Drive' },
];
const TABS_LAB: GroupTab[] = [
  { id: 'macro', label: 'Macro' },
  { id: 'mod', label: 'Mod' },
  { id: 'lab', label: 'Lab', kind: 'action' },
];
const TABS_WIDE: GroupTab[] = [
  { id: 'a', label: 'Modes' },
  { id: 'b', label: 'Triggers' },
  { id: 'c', label: 'Readout' },
  { id: 'pop', label: 'Pop out', kind: 'action' },
];


/**
 * Graph specimens.
 *
 * Chosen the same way the parameter set was -- for the awkward cases. A trace
 * with twenty times more samples than pixels (so column decimation is on show
 * rather than assumed), amplitude deliberately past the axis (so the clip
 * fringe has something to announce), a log-curved parameter behind the
 * drag-to-shape gesture, and a curve whose default bends are non-zero, because
 * a curve editor demoed on straight lines is a curve editor whose curvature
 * nobody looked at.
 */
const WAVE = (() => {
  const n = 4096;
  const d = new Float32Array(n);
  const r = rng(7);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // A saw with a decaying partial and a little grain, scaled so it peaks
    // around +/-1.19 -- OUTSIDE the +/-1 frame on purpose, so the clip fringe
    // has something real to announce. (Measured, not guessed: the first attempt
    // used a factor that looked generous and peaked at 0.82, because the saw's
    // peak and the partial's do not coincide. A demo of a warning that never
    // fires is a demo of nothing.)
    d[i] = 1.65 * ((2 * ((t * 7) % 1) - 1) * 0.7 + Math.sin(t * Math.PI * 2 * 21) * 0.25 * (1 - t))
      + (r() - 0.5) * 0.06;
  }
  return d;
})();

const HARMONICS = Float32Array.from(
  Array.from({ length: 24 }, (_, i) => Math.exp(-i * 0.22) * (i % 3 === 0 ? 1 : 0.55)),
);

/** The activation the patch's triggers actually use, as a family over its
 * temperature -- so the band behind the live curve is every curve the parameter
 * can produce, not decoration. */
const act = (x: number, temp: number) => Math.tanh(x / Math.max(1e-3, temp));

/**
 * A host for an editable curve.
 *
 * <bi-graph> is a CONTROLLED component: it draws the knots it is given and
 * reports edits, it does not own them. That is the same contract every other
 * widget here has with its FieldBinding, and it is why this three-line host
 * exists in the gallery rather than a `standalone` mode existing in the widget
 * -- a widget that can hold its own value is a widget that will eventually
 * disagree with the engine about it.
 */
@customElement('curve-host')
class CurveHost extends LitElement {
  static styles = css`:host { display: block; min-width: 0; }`;
  @property({ type: String }) density = 'normal';
  @state() private knots: Knot[] = [
    { x: 0, y: 0, bend: 0.55 },
    { x: 0.42, y: 0.78, bend: -0.4 },
    { x: 0.72, y: 0.35, bend: 0 },
    { x: 1, y: 1, bend: 0 },
  ];

  render() {
    const series: Series[] = [
      { kind: 'curve', f: (x) => x, rank: 'counter', accent: '#8a8f9c', fill: false, label: 'unity' },
      {
        kind: 'knots', label: 'shape', knots: this.knots, edit: true,
        onChange: (k) => { this.knots = k; },
      },
    ];
    return html`<bi-graph label="Response" density=${this.density}
                           .series=${series}></bi-graph>`;
  }
}

/** A deterministic scatter for the pad's backdrop: what a manifold looks like. */
const SCATTER: [number, number][] = (() => {
  const r = rng(7);
  const pts: [number, number][] = [];
  for (let i = 0; i < 400; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.45;
    pts.push([0.5 + Math.cos(a) * d * (0.8 + 0.4 * r()), 0.5 + Math.sin(a) * d]);
  }
  return pts;
})();

const ROWS: Row[] = [
  {
    tag: 'bi-knob', axis: 'rotary scalar',
    note: '270deg sweep, 160px full travel. Relative drag: no visible range to click into. Detent at the default.',
    render: (s, d) => html`
      <bi-knob .binding=${s} path="osc.freq" size="lg" density=${d}></bi-knob>
      <bi-knob .binding=${s} path="osc.drive" size="md" density=${d}></bi-knob>
      <bi-knob .binding=${s} path="osc.tilt" size="sm" density=${d}></bi-knob>`,
  },
  {
    tag: 'bi-slider', axis: 'linear scalar',
    note: 'Absolute: the track is a picture of the range, so pressing a point in it means that point. Translucent fill plus a hard edge.',
    render: (s, d) => html`
      <bi-slider .binding=${s} path="osc.mix" density=${d}></bi-slider>
      <bi-slider .binding=${s} path="osc.temp" density=${d}></bi-slider>`,
  },
  {
    tag: 'bi-slider', axis: 'painted / vertical',
    note: '`painted`: the tube prints the host\'s --track-paint (a hue, a colour channel) and the thumb is the reading. `vertical`: a fader, filling from the bottom, the reading underneath -- the device surfaces\' hardware faders.',
    render: (s, d) => html`
      <bi-slider painted label="Hue" style="--track-paint: linear-gradient(90deg, hsl(0 75% 55%), hsl(60 75% 55%), hsl(120 75% 55%), hsl(180 75% 55%), hsl(240 75% 55%), hsl(300 75% 55%), hsl(330 75% 55%))"
                 .binding=${s} path="osc.mix" density=${d}></bi-slider>
      <div style="display:flex;gap:14px;height:120px">
        <bi-slider vertical .binding=${s} path="osc.mix" density=${d}></bi-slider>
        <bi-slider vertical rank="counter" .binding=${s} path="osc.tilt" density=${d}></bi-slider>
        <bi-slider vertical .binding=${s} path="osc.temp" density=${d}></bi-slider>
      </div>`,
  },
  {
    tag: 'bi-seg', axis: 'enumerated',
    note: 'The trough is black and the chip is juice-filled glass -- the knob\'s crystal cues flattened into box-shadow. Second row is `counter` (and over the 30-char wrap floor).',
    render: (s, d) => html`
      <bi-seg .binding=${s} path="osc.mode" density=${d}></bi-seg>
      <bi-seg rank="counter" .binding=${s} path="osc.bank" density=${d}></bi-seg>`,
  },
  {
    tag: 'bi-toggle', axis: 'boolean',
    note: 'Three densities in one element, because a panel that changes density must not have to swap element types. The pip springs on `pop` and squashes from its own velocity -- a simulation, so an interrupted travel resolves rather than snapping.',
    render: (s, d) => html`
      <bi-toggle .binding=${s} path="osc.bypass" density=${d}></bi-toggle>`,
  },
  {
    tag: 'bi-number', axis: 'exact scalar',
    note: 'The number IS the control: scrub it vertically, jog it with the arrows, or type it. A field with only the third is a form, and a form in a plugin is where a mouse goes to die. Arrow autorepeat is ONE undo point -- the ported editable-number writes one per press. Expanded prints the range, because a value with no range beside it cannot be judged.',
    render: (s, d) => html`
      <bi-number .binding=${s} path="osc.freq" density=${d}></bi-number>
      <bi-number .binding=${s} path="osc.tilt" density=${d}></bi-number>
      <bi-number rank="counter" .binding=${s} path="osc.mix" density=${d}></bi-number>`,
  },
  {
    tag: 'bi-trigger', axis: 'momentary',
    note: 'Holds the parameter at 1 for at least 60ms however briefly you tap. A sharp tap is ~40ms and one 2048-frame block at 44.1kHz is 46ms, so a tap can begin and end between two samples of the parameter -- and the failure lands preferentially on the user who taps confidently. The cap still comes up when your finger does: the key is the pointer\'s state, the lamp is the engine\'s.',
    render: (s, d) => html`
      <bi-trigger .binding=${s} path="osc.retrig" density=${d}></bi-trigger>
      <bi-trigger .binding=${s} path="osc.retrig" label="Panic" glyph="&#9632;"
                   density=${d}></bi-trigger>`,
  },
  {
    tag: 'bi-encoder', axis: 'countable rotary',
    note: 'A knob is for how much; an encoder is for which. Four lit out of twelve is a fact you can take in without reading a digit, and it stays a fact at 40% where an arc\'s angle does not. Below the pitch at which lamps stop being separable the ring becomes ONE ARC rather than a set of smudges -- a lamp count that depends on zoom is a count you cannot rely on. The bipolar ring fills from zero.',
    render: (s, d) => html`
      <bi-encoder .binding=${s} path="osc.partials" size="lg" density=${d}></bi-encoder>
      <bi-encoder .binding=${s} path="osc.bank" size="md" density=${d}></bi-encoder>
      <bi-encoder rank="counter" .binding=${s} path="osc.tilt" size="md" density=${d}></bi-encoder>
      <bi-encoder .binding=${s} path="osc.drive" size="sm" density=${d}></bi-encoder>`,
  },
  {
    tag: 'bi-graph', axis: 'parametric curve, editable',
    note: 'Drag a node to move it, drag the line between two nodes to BEND that segment, double-click to add or remove. Bending cannot move a node -- the warp is exact at both ends by construction -- so the two gestures share one surface without interfering. The grey line is the same widget as a `counter` reference layer.',
    render: (_s, d) => html`<curve-host density=${d}></curve-host>`,
  },
  {
    tag: 'bi-graph', axis: 'analytic curve, one control',
    note: 'The curve IS the control: drag anywhere (right or up increases) to edit a log-curved parameter through the usual continuous-edit protocol. The band behind is every curve the parameter can reach, so the live one is read against its own family rather than against nothing. The dot is the live operating point.',
    render: (s, d) => html`<bi-graph label="Activation" density=${d}
      .binding=${s} .xAxis=${{ min: -1, max: 1, label: 'drive' }}
      .yAxis=${{ min: -1, max: 1 }} .cursor=${s.getValue('osc.tilt')}
      .series=${[
        { kind: 'band', accent: '#8a8f9c',
          lo: (x: number) => Math.min(act(x, 1), act(x, 0.01)),
          hi: (x: number) => Math.max(act(x, 1), act(x, 0.01)) },
        { kind: 'curve', label: 'g', f: (x: number) => act(x, s.getValue('osc.temp')),
          drag: { path: 'osc.temp' } },
      ] as Series[]}></bi-graph>`,
  },
  {
    tag: 'bi-graph', axis: 'dense data',
    note: '4096 samples in ~300 pixels. Decimated to a min/max envelope per column, never by stride -- stride sampling beats against periodicity in the signal and invents slow ripples that move when you resize the panel. The amber ticks are the clip fringe -- one per column the data left through, so it reads as \'here, here and here\' rather than a bar across the whole width. A flat run along a rail must never be mistaken for a limit in the data.',
    render: (_s, d) => html`<bi-graph label="Frame" density=${d}
      .xAxis=${{ min: 0, max: 1, label: 'frame' }} .yAxis=${{ min: -1, max: 1 }}
      .series=${[{ kind: 'trace', label: 'x', data: WAVE }] as Series[]}></bi-graph>`,
  },
  {
    tag: 'bi-graph', axis: 'vector',
    note: 'One bar per element, floored through minMark so a bar narrower than a pixel still draws -- an absent mark reads as an absent datum, not a small one. Ink fills with a 45-degree screen rather than an alpha wash, because on paper there is no such thing as half a pigment.',
    render: (_s, d) => html`<bi-graph label="Harmonics" density=${d}
      .xAxis=${{ min: 0, max: 24, label: 'partial' }} .yAxis=${{ min: 0, max: 1 }}
      .series=${[{ kind: 'bars', label: 'a', data: HARMONICS }] as Series[]}></bi-graph>`,
  },
  {
    tag: 'bi-graph[roll]', axis: 'live scalar',
    note: 'The compact column IS the sparkline -- same element, frame removed. Worth checking the three side by side: a separate small chart is how the prior art ended up with a worse graph in the small size that nobody was looking at. autoY rescales on the `drift` tier, the one tier that moves a viewport rather than a value.',
    render: (s, d) => html`<bi-graph label="Mix" density=${d} autoY
      .xAxis=${{ min: 0, max: 1, label: 'time' }} .yAxis=${{ min: 0, max: 1 }}
      .series=${[{ kind: 'roll', label: 'live', samples: 128,
        poll: () => s.getValue('osc.mix') + Math.sin(performance.now() / 420) * 0.12 } as Series]}
      ></bi-graph>`,
  },
  {
    tag: 'bi-text', axis: 'document field',
    note: 'The only widget here that does not edit a number, because a parameter is a float32 in an array a host automates and nobody draws an automation lane for a patch name. It rides the same store and the same undo stack through TextBinding. No continuous-edit handle: a text edit is a DRAFT the user can already see, so it commits once on Enter or blur -- writing every keystroke through the store is one undo entry per pointermove wearing different clothes. The IME guard is ported verbatim; without it, fast typing in a composing input garbles and slow typing does not, which is why it reads as a performance bug.',
    render: (s, d) => html`
      <bi-text .binding=${s} path="doc.name" density=${d}></bi-text>
      <bi-text .binding=${s} path="doc.notes" multiline density=${d}></bi-text>`,
  },
  {
    tag: 'bi-card', axis: 'a device in a chain',
    note: 'A group says "these belong together"; a card is a THING -- selectable, bypassable, collapsible, and removing it removes something from the signal path. Selection fires on pointerdown, because a card is also a drag handle and a captured pointer never produces a click. The gear and the collapse chevron both carry the same mark when what they are hiding is off its default: an affordance that hides state has to say so, or a patch that sounds wrong has a cause you cannot find by looking. Collapse the second card to see it.',
    render: (s, d) => html`
      <bi-card label="Resonator" category="filter" bypassPath="osc.bypass"
                .binding=${s} .fields=${['osc.freq', 'osc.ratio']}
                .gearFields=${['fx.shape']} density=${d}>
        <bi-knob .binding=${s} path="osc.freq" size="md" density=${d}></bi-knob>
        <bi-knob rank="counter" .binding=${s} path="osc.ratio" size="sm" density=${d}></bi-knob>
        <bi-seg slot="gear" rank="counter" .binding=${s} path="fx.shape"
                 density=${d}></bi-seg>
      </bi-card>
      <bi-card label="Drive" category="warp" selected collapsed
                .binding=${s} .fields=${['fx.tone', 'osc.temp']} density=${d}>
        <bi-knob .binding=${s} path="fx.tone" size="md" density=${d}></bi-knob>
        <bi-number rank="counter" .binding=${s} path="osc.temp" density=${d}></bi-number>
      </bi-card>`,
  },
  {
    tag: 'bi-grid', axis: 'large enumerated',
    note: 'A seg with rows, for fifty options. Drag ACROSS it: one continuous edit, one undo point, every cell visited on the way. Seams open before each group; the mark is the ear\'s star.',
    render: (s, d) => html`
      <bi-grid .binding=${s} path="osc.cell" density=${d} cols="9"
        .groups=${[0, 5, 9, 12, 16]} .marks=${{ 4: '★', 11: '★', 16: '·' }}
        .subs=${{ 0: '405b61f2', 1: '405b61f2', 2: '405b61f2', 3: '405b61f2', 4: '405b61f2', 5: '6b1c0c44' }}></bi-grid>`,
  },
  {
    tag: 'bi-modbar', axis: 'modulated scalar',
    note: 'A parameter and its modulation range as one control. Drag right/left: the value (the hard edge). Drag up/down: the width (the inner bar). The LED is the channel; click it to step. Switch modulation on to see the fill breathe inside the range.',
    render: (s, d) => html`
      <bi-modbar .binding=${s} path="osc.pos" density=${d}></bi-modbar>
      <bi-modbar .binding=${s} path="osc.cut" density=${d}></bi-modbar>`,
  },
  {
    tag: 'bi-xy', axis: 'two axes',
    note: 'One gesture, two parameters, one undo point -- the first thing beginContinuousEditMulti was written for. The backdrop is the host\'s picture (a manifold\'s scatter); the markers follow the host, not the pointer.',
    render: (s, d) => html`
      <div style="width: 180px"><bi-xy .binding=${s} pathX="osc.x" pathY="osc.y" density=${d}
        .backdrop=${SCATTER} .markers=${[{ x: 0.6, y: 0.75, color: '#aaff44' }, { x: 0.15, y: 0.5, color: '#44ccff' }, { x: 0.5, y: 0.3, color: '#ff9944' }]}></bi-xy></div>`,
  },
  {
    tag: 'bi-group', axis: 'grouping / lasso',
    note: 'The label is part of the silhouette, not a caption above it -- it buds off the top edge on concave fillets. Squircled corners throughout: curvature ramps in rather than switching on.',
    render: (s, d) => html`
      <bi-group label="Shape">
        <bi-knob .binding=${s} path="osc.drive" size="md" density=${d}></bi-knob>
        <bi-knob rank="counter" .binding=${s} path="osc.tilt" size="sm" density=${d}></bi-knob>
      </bi-group>`,
  },
  {
    tag: 'bi-group[hero]', axis: 'hierarchy',
    note: 'With a hero the left end becomes a capsule sized to the body, so the outline swells around the big dial and tapers over its satellites. One parameter, and it is the difference between containing and hugging.',
    render: (s, d) => html`
      <bi-group label="Oscillator" hero>
        <bi-knob slot="hero" .binding=${s} path="osc.freq" size="lg" density=${d}></bi-knob>
        <bi-knob rank="counter" .binding=${s} path="osc.ratio" size="sm" density=${d}></bi-knob>
        <bi-knob rank="counter" .binding=${s} path="osc.temp" size="sm" density=${d}></bi-knob>
        <bi-toggle .binding=${s} path="osc.bypass" density=${d}></bi-toggle>
      </bi-group>`,
  },
  {
    tag: 'rank', axis: 'hierarchy',
    note: 'Eight controls that all shout equally average out to a wash. `counter` is not a dimmer `lead` -- it is the same crystal with figure and ground exchanged: juice inside the glass becomes juice on its edge. One or two leads per group, everything else counter.',
    render: (s, d) => html`
      <div class="rankdemo">
        <span class="tag">all lead</span>
        <div class="body">
          <bi-knob .binding=${s} path="osc.freq" size="md" density=${d}></bi-knob>
          <bi-knob .binding=${s} path="osc.drive" size="md" density=${d}></bi-knob>
          <bi-knob .binding=${s} path="osc.ratio" size="md" density=${d}></bi-knob>
          <bi-knob .binding=${s} path="osc.temp" size="md" density=${d}></bi-knob>
        </div>
      </div>
      <div class="rankdemo">
        <span class="tag">one lead, three counter</span>
        <div class="body">
          <bi-knob .binding=${s} path="osc.freq" size="md" density=${d}></bi-knob>
          <bi-knob rank="counter" .binding=${s} path="osc.drive" size="md" density=${d}></bi-knob>
          <bi-knob rank="counter" .binding=${s} path="osc.ratio" size="md" density=${d}></bi-knob>
          <bi-knob rank="counter" .binding=${s} path="osc.temp" size="md" density=${d}></bi-knob>
        </div>
      </div>`,
  },
  {
    tag: 'accent', axis: 'material',
    note: 'Juice is derived from --accent PER WIDGET, so a category hue recolours the whole material -- fill, bloom, meniscus, the tint the glass picks up -- rather than just the fill. Set on the element, nothing else changes.',
    render: (s, d) => html`${CATEGORY.map(
      (c) => html`<div class="swatch">
        <bi-knob style=${`--accent:${c.hex}`} .binding=${s} path="osc.drive"
                  size="md" density=${d} label=${c.name}></bi-knob>
      </div>`,
    )}`,
  },
  {
    tag: 'bi-group', axis: 'variants',
    note: 'lasso (outline only) is the default and the one that survives being used eight times on a page; card and well fill, and are for when a section really is a surface.',
    render: (s, d) => html`
      <bi-group label="Lasso">
        <bi-knob .binding=${s} path="osc.drive" size="sm" density=${d}></bi-knob>
      </bi-group>
      <bi-group label="Card" variant="card">
        <bi-knob .binding=${s} path="osc.drive" size="sm" density=${d}></bi-knob>
      </bi-group>
      <bi-group label="Selected" variant="card" selected>
        <bi-knob .binding=${s} path="osc.drive" size="sm" density=${d}></bi-knob>
      </bi-group>`,
  },
  {
    tag: 'bi-group[tabs]', axis: 'tabbed area',
    note: 'A panel tab is PART of the group -- it buds off the outline on concave fillets and switches what the group contains. An action tab is not: it is a detached capsule with daylight under it and a glyph, because it does not lead anywhere inside the body, it pops the subject out. Attached-versus-detached is a difference you can predict before clicking; a colour would have to be learned.',
    render: (s, d) => html`
      <bi-group .tabs=${TABS_PAIR} active="shape">
        <bi-knob slot="shape" .binding=${s} path="osc.freq" size="md" density=${d}></bi-knob>
        <bi-knob slot="shape" rank="counter" .binding=${s} path="osc.tilt" size="sm" density=${d}></bi-knob>
        <bi-knob slot="drive" .binding=${s} path="osc.drive" size="md" density=${d}></bi-knob>
        <bi-knob slot="drive" rank="counter" .binding=${s} path="osc.temp" size="sm" density=${d}></bi-knob>
      </bi-group>
      <bi-group hero .tabs=${TABS_LAB} active="macro"
                 @bi-tab-action=${(e: CustomEvent) => console.log('action', e.detail.id)}>
        <bi-knob slot="hero" .binding=${s} path="osc.freq" size="lg" density=${d}></bi-knob>
        <bi-knob slot="macro" rank="counter" .binding=${s} path="osc.drive" size="sm" density=${d}></bi-knob>
        <bi-knob slot="macro" rank="counter" .binding=${s} path="osc.ratio" size="sm" density=${d}></bi-knob>
        <bi-knob slot="mod" rank="counter" .binding=${s} path="osc.temp" size="sm" density=${d}></bi-knob>
      </bi-group>`,
  },
  {
    tag: 'bi-group[tabs] wide', axis: 'strip drives width',
    note: 'Four tabs and one satellite: the strip is wider than anything it contains, so the group has to grow for its own tabs. The single-label case already taught us this -- when the tab does not fit, the outline suppresses it and the label renders anyway as the floating caption the widget exists to replace.',
    render: (s, d) => html`
      <bi-group .tabs=${TABS_WIDE} active="a" variant="card">
        <bi-knob slot="a" rank="counter" .binding=${s} path="osc.ratio" size="sm" density=${d}></bi-knob>
        <bi-knob slot="b" rank="counter" .binding=${s} path="osc.temp" size="sm" density=${d}></bi-knob>
        <bi-toggle slot="c" .binding=${s} path="osc.bypass" density=${d}></bi-toggle>
      </bi-group>`,
  },
  {
    tag: 'bi-hint', axis: 'parked specimen',
    note: 'The parameter card, kept for a click-invoked detail panel and NOT wired to hover -- no popups on hover in a plugin window. Hover is a change to the control, not a new object over the host. Here so the material stays rendered and skinned rather than rotting in a file.',
    render: () => html`<bi-hint .content=${HINT_SPECIMEN}></bi-hint>`,
  },
];

const DENSITIES = ['compact', 'normal', 'expanded'] as const;

@customElement('bi-gallery')
export class BiGallery extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: block;
        background: var(--app-bg-color1);
        min-height: 100vh;
        padding: 14px 18px 80px;
      }
      h1 {
        font-size: var(--app-fs-lg);
        letter-spacing: var(--app-tr-5);
        text-transform: uppercase;
        color: var(--app-text-color2);
        font-weight: 600;
        margin: 0 0 4px;
      }
      .sub { max-width: 92ch; margin-bottom: 12px; }
      .sub b { color: var(--app-text-color1); font-weight: 600; }

      .bar {
        display: flex;
        gap: var(--app-sp-6);
        align-items: center;
        flex-wrap: wrap;
        padding: 9px 12px;
        background: var(--app-bg-color2);
        border: 1px solid var(--app-border-color);
        border-radius: var(--app-r-3);
        margin-bottom: var(--app-sp-6);
        position: sticky;
        top: 0;
        z-index: 2;
      }
      .bar label { display: flex; gap: var(--app-sp-3); align-items: center; color: var(--app-text-color2); }
      .bar input[type='range'] { width: 110px; accent-color: var(--accent); }
      .bar button {
        background: var(--app-bg-color1);
        color: var(--app-text-color1);
        border: 1px solid var(--app-tint-4);
        border-radius: var(--app-r-2);
        padding: 3px 8px;
        font: inherit;
        font-size: var(--app-fs-sm);
        cursor: pointer;
      }
      .bar button:hover { background: var(--app-tint-3); }
      .skinpick { display: flex; gap: 1px; }
      .skinpick a {
        padding: 3px 9px;
        font-size: var(--app-fs-sm);
        color: var(--app-text-color2);
        text-decoration: none;
        border: 1px solid var(--app-tint-4);
        background: var(--app-bg-color1);
      }
      .skinpick a:first-child { border-radius: var(--app-r-2) 0 0 var(--app-r-2); }
      .skinpick a:last-child { border-radius: 0 var(--app-r-2) var(--app-r-2) 0; }
      .skinpick a.on { background: var(--accent); border-color: var(--accent); color: var(--app-bg-color1); }
      .bar button.on { background: var(--accent); border-color: var(--accent); color: #fff; }

      .row {
        display: flex;
        gap: var(--app-sp-6);
        align-items: flex-start;
        padding: var(--app-sp-5) 0;
        border-top: 1px solid var(--app-tint-2);
      }
      .name { width: 190px; flex: 0 0 190px; }
      .name b { color: var(--app-text-color1); font-weight: 600; display: block; }
      .name .ax {
        color: var(--app-caution);
        font-size: var(--app-fs-sm);
        letter-spacing: var(--app-tr-4);
        text-transform: uppercase;
        margin: 2px 0;
        display: block;
      }
      .sizes { display: flex; gap: var(--app-sp-6); align-items: flex-start; flex: 1; min-width: 0; }
      .size { min-width: 0; }
      .size > .heading { margin-bottom: var(--app-sp-3); display: block; }
      .shrunk { --bi-scale: 0.4; }
      .dens { display: flex; gap: var(--app-sp-5); align-items: flex-start; flex-wrap: wrap; }
      .cell {
        display: flex;
        flex-direction: column;
        gap: var(--app-sp-2);
        padding: var(--app-sp-3);
        border: 1px dashed var(--app-tint-1);
        border-radius: var(--app-r-2);
        min-width: 108px;
      }
      .cell > .tag {
        font-size: var(--app-fs-xs);
        color: var(--app-text-color3);
        text-transform: uppercase;
        letter-spacing: var(--app-tr-2);
      }
      .cell .body { display: flex; gap: var(--app-sp-4); align-items: flex-start; flex-wrap: wrap; }
      .swatch { display: flex; }
      .rankdemo { display: flex; flex-direction: column; gap: var(--app-sp-2); }
      .rankdemo > .tag {
        font-size: var(--app-fs-xs); color: var(--app-text-color3);
        text-transform: uppercase; letter-spacing: var(--app-tr-2);
      }

      .decided {
        display: flex;
        gap: var(--app-sp-5);
        flex-wrap: wrap;
        font-size: var(--app-fs-xs);
        color: var(--app-text-color3);
        margin-bottom: var(--app-sp-5);
      }
      .decided b { color: var(--app-text-color2); font-weight: 600; }
    `,
  ];

  private readonly store = withDocs(demoStore());

  /**
   * `?row=group` renders only the matching rows.
   *
   * Added while iterating on the outline geometry: judging a 7px fillet means
   * looking at it magnified, and every way of magnifying a full page either
   * crops the row of interest out or produces an image too large to read. A
   * substring filter costs three lines and turns the lab into an instrument for
   * looking at ONE thing, which is most of what it gets used for.
   */
  private get rows(): Row[] {
    const q = new URLSearchParams(location.search).get('row');
    if (!q) return ROWS;
    // Comma-separated, because the useful comparison is usually a HANDFUL of
    // rows rather than one -- five new widgets reviewed together, or a knob
    // beside the encoder that has to justify existing next to it.
    const terms = q.split(',').map((t) => t.trim()).filter(Boolean);
    const hits = ROWS.filter((r) => terms.some((t) => r.tag.includes(t) || r.axis.includes(t)));
    return hits.length ? hits : ROWS;
  }

  @state() private scale = 1;
  @state() private accent = '#22d3ee';
  @state() private modulating = false;
  @state() private rev = 0;

  /** A fake LFO, so the modulation band is visible and MOVING. A static band
   * proves the geometry; only a moving one proves the poller, the change key,
   * and the neutral-anchored fill actually behave. */
  private readonly modLoop = new FrameLoop(() => {
    const t = performance.now() / 1000;
    const spec = this.store.spec('osc.drive')!;
    const base = this.store.getValue('osc.drive');
    const swing = (spec.max - spec.min) * 0.25;
    this.store.setModulation('osc.drive', {
      value: Math.max(spec.min, Math.min(spec.max, base + Math.sin(t * 2.1) * swing)),
      min: base - swing, max: base + swing, neutral: base,
    });
    const mspec = this.store.spec('osc.mix')!;
    const mbase = this.store.getValue('osc.mix');
    const mswing = 0.3;
    this.store.setModulation('osc.mix', {
      value: Math.max(mspec.min, Math.min(mspec.max, mbase + Math.sin(t * 0.8) * mswing)),
      min: mbase - mswing, max: mbase + mswing, neutral: mbase,
    });
    // the modbar's destinations: the range is the widget's own, from its
    // width, so the fill lands inside the bar it draws
    for (const [id, rate] of [['osc.pos', 1.3], ['osc.cut', 0.6]] as const) {
      const ps = this.store.spec(id)!;
      const pb = this.store.getValue(id);
      const r = modRange(ps, pb, this.store.getValue(`${id}.mod.width`));
      const u = 0.5 + 0.5 * Math.sin(t * rate);
      this.store.setModulation(id, { value: fromPos(ps, r.lo + (r.hi - r.lo) * u), min: r.min, max: r.max, neutral: pb });
    }
    return this.modulating;
  });

  connectedCallback(): void {
    super.connectedCallback();
    this.store.changed.subscribe(() => this.rev++);
  }

  private toggleMod(): void {
    this.modulating = !this.modulating;
    if (this.modulating) {
      this.modLoop.wake();
    } else {
      this.modLoop.stop();
      this.store.setModulation('osc.drive', null);
      this.store.setModulation('osc.mix', null);
      this.store.setModulation('osc.pos', null);
      this.store.setModulation('osc.cut', null);
    }
  }

  render() {
    return html`
      <h1>bubbleink widget lab</h1>
      <div class="sub note">
        Every widget at <b>ship size</b> and at <b>40%</b>, in all three densities, in one
        eyeful. Right-click or press Delete on any control to reset it to its own default;
        drag with Shift for fine adjust; type a digit to enter a value. One drag is
        <b>one undo entry</b> ${DOT} depth <b>${this.store.undoDepth}</b>.
      </div>

      <div class="decided">
        <span><b>decided, not tunable:</b></span>
        <span>rotary sweep <b>270deg</b> / travel <b>160px</b></span>
        <span>tint ladder <b>.03 .06 .08 .12 .15</b></span>
        <span>radius: crisp <b>1/2/4</b> ${DOT} soft <b>8/14/22</b></span>
        <span>easing: <b>view only, never the signal</b></span>
        <span>skin: <b>${SKIN}</b> ${DOT} ${SKIN_LAW[SKIN]}</span>
        <span>ghost after <b>500ms</b></span>
        <span>hover: <b>the control responds</b> ${DOT} never a popup</span>
      </div>

      <div class="bar" style="--accent:${this.accent}">
        <label>scale
          <input type="range" min="0.6" max="1.8" step="0.05" .value=${String(this.scale)}
            @input=${(e: Event) => { this.scale = +(e.target as HTMLInputElement).value; }} />
          ${this.scale.toFixed(2)}x
        </label>
        <label>accent
          <input type="color" .value=${this.accent}
            @input=${(e: Event) => { this.accent = (e.target as HTMLInputElement).value; }} />
        </label>
        <button class=${this.modulating ? 'on' : ''} @click=${this.toggleMod}>
          ${this.modulating ? 'modulating' : 'modulate'}
        </button>
        <span class="skinpick">${SKINS.map(
          (k) => html`<a class=${k === SKIN ? 'on' : ''} href=${skinHref(k)}>${k}</a>`,
        )}</span>
        <button @click=${() => this.store.undo()}>undo</button>
        <button @click=${() => this.store.redo()}>redo</button>
        <span class="note">undo depth ${this.store.undoDepth}</span>
      </div>

      <div style="--bi-scale:${this.scale}; --accent:${this.accent}">
        ${this.rows.map((r) => this.row(r))}
        ${this.motionProbe()}
      </div>
    `;
  }

  private row(r: Row) {
    return html`
      <div class="row">
        <div class="name">
          <b>&lt;${r.tag}&gt;</b>
          <span class="ax">${r.axis}</span>
          <span class="note">${r.note}</span>
        </div>
        <div class="sizes">
          ${this.sizeBlock(r, 'ship size', '')}
          ${this.sizeBlock(r, '40%', 'shrunk')}
        </div>
      </div>
    `;
  }

  private sizeBlock(r: Row, title: string, cls: string) {
    return html`
      <div class="size ${cls}">
        <span class="heading">${title}</span>
        <div class="dens">
          ${DENSITIES.map(
            (d) => html`<div class="cell">
              <span class="tag">${d}</span>
              <div class="body">${r.render(this.store, d)}</div>
            </div>`,
          )}
        </div>
      </div>
    `;
  }

  /**
   * The motion probe.
   *
   * The tier table claims settle times; this measures them. A spring whose
   * measured settle drifts from its declared one means either the analytic step
   * is wrong or the epsilon is doing the stopping instead of the physics -- both
   * are silent failures that would otherwise show up only as "the UI feels a bit
   * off", which is unfalsifiable.
   */
  private motionProbe() {
    return html`
      <div class="row">
        <div class="name">
          <b>motion</b>
          <span class="ax">verification</span>
          <span class="note">
            Measured settle and overshoot per tier against what the table declares. Note
            that NO VALUE USES THESE: handles, meters and modulation bands are assigned
            from the number every frame. These four move chrome and the viewport only. Underdamped settle is measured from the ENVELOPE DECAY RATE, not
            from the 1% crossing -- the crossing is quantized by half an oscillation
            (the T/2 column), which is a property of underdamping and not an error.
          </span>
        </div>
        <div class="sizes"><motion-probe></motion-probe></div>
      </div>
    `;
  }
}

@customElement('motion-probe')
class MotionProbe extends LitElement {
  static styles = [
    base,
    css`
      table { border-collapse: collapse; font-size: var(--app-fs-sm); }
      th {
        color: var(--app-text-color2); font-weight: 400; text-align: right;
        padding: 1px 10px; border-bottom: 1px solid var(--app-tint-3); white-space: nowrap;
      }
      th:first-child, td:first-child { text-align: left; color: var(--app-text-color1); }
      td { padding: 1px 10px; text-align: right; color: var(--app-text-color2); }
      td.ok { color: var(--app-ok); }
      td.bad { color: var(--app-error); }
    `,
  ];

  @state() private results: {
    tier: TierName; zeta: number; omega: number; declared: number; measured: number;
    overshoot: number; wantOvershoot: number; halfT: number; use: string;
  }[] = [];

  connectedCallback(): void {
    super.connectedCallback();
    this.results = (Object.keys(TIERS) as TierName[]).map((k) => {
      const spec = TIERS[k];
      const s = new Spring(0, k, 1e-9);
      s.target = 1;
      // Fixed 1ms steps rather than real frames: the question is whether the
      // integrator is right, not whether this machine is busy. Real frame
      // timing would make the measurement about the browser.
      const dt = 0.001;
      let t = 0;
      let peak = 0;
      let firstCross = -1;
      // Local maxima of |value - target|: the points the decay envelope passes
      // through exactly. See the derivation in core/spring.ts.
      const extrema: { t: number; m: number }[] = [];
      let prev = 1;
      let curr = Math.abs(s.value - 1);
      while (t < 4) {
        s.tick(dt);
        t += dt;
        const next = Math.abs(s.value - 1);
        peak = Math.max(peak, s.value);
        if (curr >= prev && curr >= next && curr > 1e-7) extrema.push({ t: t - dt, m: curr });
        prev = curr;
        curr = next;
        if (firstCross < 0 && next < 0.01) firstCross = t;
      }

      let measured: number;
      if (spec.zeta >= 0.98) {
        // No oscillation, so the 1% crossing is unambiguous and is the thing
        // the tier declares.
        measured = firstCross * 1000;
      } else {
        // MEASURE THE ENVELOPE, NOT THE CROSSING. An underdamped response
        // crosses 1% somewhere between two extrema, so a crossing measurement
        // is quantized by half an oscillation and would report a correctly
        // tuned tier as up to 40% fast. The decay RATE has no such ambiguity:
        // fit it across the extrema and convert back to a 1% settle time.
        const a = extrema[0];
        const b = extrema[extrema.length - 1];
        const rate = Math.log(a.m / b.m) / (b.t - a.t);
        measured = (Math.log(100) / rate) * 1000;
      }

      return {
        tier: k, zeta: spec.zeta, omega: omegaFor(spec.settle, spec.zeta),
        declared: spec.settle * 1000, measured,
        overshoot: Math.max(0, peak - 1), wantOvershoot: overshootFor(spec.zeta),
        halfT: halfPeriodFor(spec.settle, spec.zeta) * 1000,
        use: spec.use,
      };
    });
  }

  render() {
    return html`
      <table>
        <tr>
          <th>tier</th><th>zeta</th><th>omega</th><th>settle</th><th>measured</th>
          <th>&plusmn;T/2</th><th>bounce</th><th>measured</th><th></th>
        </tr>
        ${this.results.map((r) => {
          const err = Math.abs(r.measured - r.declared) / r.declared;
          // Absolute tolerance, not relative: a tier that should not bounce at
          // all has a target of zero, and a relative test against zero either
          // divides by it or passes everything.
          const bounceOk = Math.abs(r.overshoot - r.wantOvershoot) < 0.005;
          return html`<tr>
            <td>${r.tier}</td>
            <td>${r.zeta.toFixed(2)}</td>
            <td>${r.omega.toFixed(1)}</td>
            <td>${r.declared.toFixed(0)} ms</td>
            <td class=${err < 0.03 ? 'ok' : 'bad'}>${r.measured.toFixed(1)} ms</td>
            <td>${r.halfT > 0 ? `${r.halfT.toFixed(0)} ms` : '--'}</td>
            <td>${(r.wantOvershoot * 100).toFixed(1)}%</td>
            <td class=${bounceOk ? 'ok' : 'bad'}>${(r.overshoot * 100).toFixed(1)}%</td>
            <td style="text-align:left;color:var(--app-text-color3)">${r.use}</td>
          </tr>`;
        })}
      </table>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-gallery': BiGallery;
    'motion-probe': MotionProbe;
  }
}
