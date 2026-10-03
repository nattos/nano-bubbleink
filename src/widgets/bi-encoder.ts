/**
 * <bi-encoder> -- the LED ring. A rotary for quantities you COUNT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A SECOND KNOB
 *
 * <bi-knob> draws a continuous arc, which is the right picture for a
 * continuous quantity: you read an angle, you compare two of them, you sweep.
 * An angle is not a picture you can count, and a lot of what this model exposes
 * is countable -- mode index, harmonic number, how many partials, which of six
 * banks. On a knob those become "somewhere around a third of the way round",
 * and the user then reads the number underneath, which means the dial was
 * decoration.
 *
 * A ring of discrete lamps is the same gesture with a readable answer:
 *
 *   FOUR LIT OUT OF TWELVE is a fact you can take in without reading a digit,
 *   and it is still a fact at 40% zoom, where an arc's angle is not.
 *
 * That is the whole distinction, and it is why both exist. Knob for how much,
 * encoder for which.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE LAMPS DO NOT FIT, THERE ARE NO LAMPS
 *
 * The ring has a fixed circumference and the lamps do not shrink below the
 * point where they stop being separable -- so at some size, or at some step
 * count, a twelve-lamp ring is twelve smudges with eleven invisible gaps, which
 * reads as a bad arc rather than as a good ring.
 *
 * So below MIN_LED_PITCH_PX the ring is drawn as ONE CONTINUOUS ARC. Not a
 * compressed set of lamps, and not a lamp count silently reduced to whatever
 * fits: a ring whose lamp count depends on zoom is a ring you cannot count,
 * which is the entire reason to have used one. Falling back to the arc is the
 * honest degradation -- it says "too small to count" by looking like the
 * control that never claimed you could.
 *
 * This is minMark applied to a set rather than to a mark. A mark too small to
 * see is indistinguishable from a bug; a set too dense to count is
 * indistinguishable from a smear.
 *
 * ---------------------------------------------------------------------------
 * BIPOLAR RINGS FILL FROM ZERO
 *
 * A detune, a tilt, a bipolar coupling: its meaningful origin is the middle,
 * not the left end, and a ring that fills from the end draws "half lit" for a
 * value of nothing. Any range that straddles zero anchors there, so the lit run
 * grows outward in whichever direction the value went and an untouched control
 * is visibly dark.
 */
import { html, css, svg, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base } from '../theme/base';
import { ScalarControl, clamp01 } from './scalar-base';
import { arcSvg, minMark } from '../draw/marks';
import { modBand, modArcAngles } from '../draw/modband';
import { formatNumber, formatValue, readingChars, unitOf } from '../core/format';
import { toPos, type ParamSpec } from '../core/schema';

/** The house rotary convention: 270 degrees, gap at the bottom. Shared with
 * bi-knob deliberately -- two rotaries with different sweeps on one panel is
 * two conventions the user has to hold at once. */
const SWEEP = 270;
const DEG0 = -135;
const DEG1 = DEG0 + SWEEP;

/** Vertical pixels of drag for the whole range, and the fine multiplier.
 * Both the knob's -- see bi-number for why the family shares one feel. */
const DRAG_RANGE_PX = 160;
const FINE = 0.25;

/** Geometry in the SVG's own 100x100 space. */
const CX = 50;
const CY = 50;
const R_MOD = 47;
const R_RING = 39;
const R_CAP = 25;

/** Lamp stroke width, and the angular gap between two lamps. */
const LED_W = 6;
const LED_GAP_DEG = 2.2;

/**
 * Minimum lamp pitch, in SCREEN px, below which the ring becomes an arc.
 *
 * A lamp plus its gap. At 4px a lamp is ~2.5px of ink with ~1.5px of ground
 * either side, which is the coarsest thing that still resolves as separate
 * objects on a 1x display -- and this control has to survive the gallery's 40%
 * column, where a 48px encoder is 19px across.
 */
const MIN_LED_PITCH_PX = 4;

/** Default lamp count for a plain continuous parameter. Twelve is the largest
 * count most people subitise against a familiar layout -- it is a clock face --
 * and it divides the 270-degree sweep into whole degrees. */
const DEFAULT_STEPS = 12;

const SIZE_PX = { sm: 30, md: 48, lg: 76 } as const;

@customElement('bi-encoder')
export class BiEncoder extends ScalarControl {
  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-1);
        --enc-px: calc(48px * var(--bi-scale));
        outline: none;
      }
      :host(:focus-visible) .dial {
        outline: 1px solid var(--juice-hot);
        outline-offset: 2px;
        border-radius: 50%;
      }
      .dial {
        width: var(--enc-px);
        height: var(--enc-px);
        cursor: ns-resize;
        touch-action: none;
        display: block;
        overflow: visible;
      }

      /* THE UNLIT LAMPS ARE THE DENOMINATOR.
       *
       * First pass drew them as a near-black recess, which is materially
       * right -- an off LED IS a dark lens in a dark panel -- and completely
       * defeated the widget: on the near-black crystal ground the unlit run
       * vanished, so a five-of-twelve ring read as a five-segment arc floating
       * in space. "Four lit out of twelve" needs the twelve.
       *
       * So the recess is still cut, but a grey LENS sits in it. Bright enough
       * to count against, far enough below the juice that it can never be
       * mistaken for a lit one -- the difference is a factor of eight in
       * luminance, not a shade.
       */
      .slot { stroke: #05070b; }
      .slot-lens { stroke: var(--app-tint-4); }
      :host(:hover:not([disabled])) .slot-lens { stroke: var(--app-tint-5); }
      .lit { mix-blend-mode: var(--chip-blend, screen); }
      .lamp-core { stroke: var(--juice-pure); }
      .lamp-glow { stroke: var(--juice-glow); }
      .lamp-hot { stroke: var(--juice-hot); }
      /* counter: the lamp is an EDGE rather than a volume, same inversion the
       * knob's ranks use -- juice on the glass instead of inside it. */
      :host([rank='counter']) .lamp-core { stroke: var(--meniscus, var(--juice-hot)); }

      /* The cap is NOT the reading here, and it took a render to see it: with
       * the knob's full-white rim the cap outshouted the lamps, which is
       * exactly backwards for a control whose entire argument is that you read
       * the ring. On a knob the cap is the object you grip and the arc is a
       * gauge beside it; on an encoder the ring is the instrument and the cap
       * is the thing you turn it with. */
      .cap-body { fill: var(--glass-body, #171b23); stroke: var(--app-tint-5); }
      .cap-sky { fill: var(--glass-sky, rgba(255, 255, 255, 0.06)); }
      .pointer { stroke: var(--app-text-color1); stroke-linecap: round; }
      .mod-band { stroke: var(--app-mod-color); opacity: 0.3; }
      .mod-fill { stroke: var(--app-mod-color); }

      /* INK. Subtractive, and the translation is not the obvious one: an
       * unlit lamp cannot be "the same block unfilled", because these lamps are
       * STROKED arcs and an unstroked arc is nothing at all. Outlining each one
       * would mean twelve tiny hairline boxes, which at this size is lace.
       *
       * So the difference is INK COLOUR, not ink presence: every lamp prints
       * as a solid block, the lit ones in the spot colour and the unlit ones in
       * a light key grey. Which is what a printed panel legend actually does --
       * you do not omit the off states from the artwork, you print them dead. */
      .dial.ink .slot { stroke: none; }
      .dial.ink .ink-slot { stroke: var(--ink-key); fill: none; opacity: 0.42; }
      .dial.ink .ink-lamp { stroke: var(--juice); }
      .dial.ink .ink-lamp-key { stroke: var(--ink-key); opacity: 0.6; }
      .dial.ink .cap-body { fill: var(--ink-stock); stroke: var(--ink-key); }
      .dial.ink .pointer { stroke: var(--ink-key); }
      /* A counter ring drops the spot plate entirely and prints its lit lamps
       * in key. Same rule as the counter knob's halftone -- the accompaniment
       * gets less ink, not paler ink -- and here "less" means one plate rather
       * than two, which on press is literally a cheaper print. */
      :host([rank='counter']) .dial.ink .ink-lamp { stroke: var(--app-text-color2); }

      .readout {
        display: flex;
        align-items: baseline;
        gap: 3px;
        line-height: 1;
      }
      .value { color: var(--readout-color, var(--juice-hot)); }
      :host([rank='counter']) .value { color: var(--app-text-color2); }
      .edit {
        width: calc(var(--edit-ch, 8) * 1ch);
        font: inherit;
        font-size: var(--fs-xs);
        text-align: center;
        background: var(--app-bg-sunken);
        color: var(--app-text-color1);
        border: 1px solid var(--juice);
        border-radius: var(--app-r-3);
        padding: 1px 2px;
        outline: none;
      }
      :host([density='compact']) .label { display: none; }
      :host([density='expanded']) .label { font-size: var(--fs-md); }
      /* The count, spelled out. Only where there is room for it -- see the
       * countable getter for why it is not simply always on. */
      .count {
        font-size: var(--fs-xs);
        color: var(--app-text-color3);
      }
      :host(:not([density='expanded'])) .count { display: none; }
    `,
  ];

  @property({ type: String, reflect: true }) size: keyof typeof SIZE_PX = 'md';
  /** Lamp count. 0 derives it from the spec -- see `steps`. */
  @property({ type: Number }) leds = 0;


  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('size')) {
      this.style.setProperty('--enc-px', `calc(${SIZE_PX[this.size]}px * var(--bi-scale))`);
    }
  }

  protected positionFor(e: PointerEvent, delta: [number, number]): number {
    const sens = e.shiftKey ? FINE : 1;
    return this.dragStartPos - (delta[1] / DRAG_RANGE_PX) * sens;
  }

  /**
   * How many lamps.
   *
   * An enumerated or stepped parameter gets ONE LAMP PER STATE, always -- that
   * is the case the widget exists for, and a six-bank selector with twelve
   * lamps is a control that cannot say which bank it is on. Everything else
   * gets the default clock face.
   */
  private get steps(): number {
    if (this.leds > 0) return Math.round(this.leds);
    const s = this.spec;
    if (!s) return DEFAULT_STEPS;
    if (s.choices?.length) return s.choices.length;
    if (s.curve.kind === 'stepped') return Math.max(2, Math.round(s.curve.a) + 1);
    if (s.unit === 'indexed') return Math.max(2, Math.round(s.max - s.min) + 1);
    return DEFAULT_STEPS;
  }

  /** The dial's drawn size in CSS px, for the pitch test. */
  private get dialPx(): number {
    return this.getBoundingClientRect().width || 48;
  }

  /**
   * Are the lamps separable at this size?
   *
   * Measured on the RING's arc length rather than on the dial's width, because
   * the ring is 78% of the box and using the box would claim a fifth more room
   * than the lamps actually have.
   */
  private get countable(): boolean {
    const arcPx = ((R_RING * 2 * Math.PI) / 100) * this.dialPx * (SWEEP / 360);
    return arcPx / this.steps >= MIN_LED_PITCH_PX;
  }

  render() {
    const s = this.spec;
    if (!s) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const p = clamp01(this.pos);
    const ink = true;
    return html`
      <svg class=${`dial${ink ? ' ink' : ''}`} viewBox="0 0 100 100"
           @pointerdown=${this.onPointerDown}>
        <g style="isolation: isolate">
          ${this.modArc(s)}
          ${this.countable ? this.lamps(s, p, ink) : this.fallbackArc(p, ink)}
          ${this.cap(p)}
        </g>
      </svg>
      ${this.footer(s)}
    `;
  }

  /**
   * The lamp run: which lamps are lit, from where to where.
   *
   * Returned as a half-open [from, to) index pair so the bipolar case is the
   * same code as the unipolar one -- a unipolar ring is simply one whose anchor
   * happens to be lamp zero.
   */
  private run(s: ParamSpec, p: number): [number, number] {
    const n = this.steps;
    const here = Math.round(p * (n - 1));
    // Straddles zero, and zero is not already an endpoint: anchor there.
    const bipolar = s.min < 0 && s.max > 0;
    if (!bipolar) return [0, here + 1];
    const zero = Math.round(toPos(s, 0) * (n - 1));
    return here >= zero ? [zero, here + 1] : [here, zero + 1];
  }

  private lampAngles(i: number): [number, number] {
    const n = this.steps;
    const span = SWEEP / n;
    const a0 = DEG0 + i * span;
    return [a0 + LED_GAP_DEG / 2, a0 + span - LED_GAP_DEG / 2];
  }

  private lamps(s: ParamSpec, p: number, ink: boolean) {
    const n = this.steps;
    const [from, to] = this.run(s, p);
    const held = this.press.value;
    const hov = this.hoverS.value;
    // Floored the same way every mark in this family is, but the floor has to
    // be stated in SCREEN px and converted, because the stroke width is in
    // viewBox units and a viewBox unit is a different size at every zoom. A
    // lamp that rounds to nothing reads as a missing lamp, which is a
    // different reading entirely.
    const w = minMark(LED_W, (1.4 * 100) / Math.max(12, this.dialPx));
    const out = [];
    for (let i = 0; i < n; i++) {
      const [a0, a1] = this.lampAngles(i);
      const d = arcSvg(CX, CY, R_RING, a0, a1);
      const on = i >= from && i < to;
      if (ink) {
        out.push(on
          ? svg`<path class="ink-lamp" d=${d} fill="none" stroke-width=${w}
                      stroke-linecap="butt" />
                <path class="ink-lamp-key" d=${d} fill="none" stroke-width=${w + 1.1}
                      stroke-linecap="butt" opacity="0.35" />`
          : svg`<path class="ink-slot" d=${d} fill="none" stroke-width=${w}
                      stroke-linecap="butt" />`);
        continue;
      }
      // The recess, then the lens in it. Both drawn for lit lamps too: the
      // juice is screened OVER the lens, so a lit lamp is a lit version of the
      // same object rather than a different object in the same place.
      out.push(svg`<path class="slot" d=${d} fill="none" stroke-width=${w + 1.8}
                         stroke-linecap="butt" />`);
      out.push(svg`<path class="slot-lens" d=${d} fill="none" stroke-width=${w}
                         stroke-linecap="butt" opacity=${(0.9 + hov * 0.1).toFixed(3)} />`);
      if (!on) continue;
      out.push(svg`
        <path class="lit lamp-glow" d=${d} fill="none"
              stroke-width=${(w + 5 + held * 2).toFixed(2)} stroke-linecap="butt"
              opacity=${(0.3 + held * 0.15).toFixed(3)} />
        <path class="lit lamp-core" d=${d} fill="none" stroke-width=${w}
              stroke-linecap="butt" />
        <path class="lit lamp-hot" d=${d} fill="none" stroke-width=${(w * 0.42).toFixed(2)}
              stroke-linecap="butt" opacity=${(0.7 + held * 0.3).toFixed(3)} />`);
    }
    return out;
  }

  /** Too small to count -- see the header. One arc, no pretence of steps. */
  private fallbackArc(p: number, ink: boolean) {
    const angle = DEG0 + p * SWEEP;
    const track = arcSvg(CX, CY, R_RING, DEG0, DEG1);
    const val = arcSvg(CX, CY, R_RING, DEG0, angle);
    if (ink) {
      return svg`
        <path class="ink-slot" d=${track} fill="none" stroke-width="5" stroke-linecap="round" />
        <path class="ink-lamp" d=${val} fill="none" stroke-width="5" stroke-linecap="round" />`;
    }
    return svg`
      <path class="slot" d=${track} fill="none" stroke-width="6.8" stroke-linecap="round" />
      <path class="slot-lens" d=${track} fill="none" stroke-width="5" stroke-linecap="round"
            opacity="0.75" />
      <path class="lit lamp-glow" d=${val} fill="none" stroke-width="10"
            stroke-linecap="round" opacity="0.3" />
      <path class="lit lamp-core" d=${val} fill="none" stroke-width="5" stroke-linecap="round" />`;
  }

  private cap(p: number) {
    const angle = ((DEG0 + p * SWEEP) * Math.PI) / 180;
    const x1 = CX + Math.sin(angle) * (R_CAP - 4);
    const y1 = CY - Math.cos(angle) * (R_CAP - 4);
    const x2 = CX + Math.sin(angle) * (R_CAP - 13);
    const y2 = CY - Math.cos(angle) * (R_CAP - 13);
    return svg`
      <circle class="cap-body" cx=${CX} cy=${CY} r=${R_CAP} stroke-width="1" />
      <circle class="cap-sky" cx=${CX} cy=${CY - R_CAP * 0.28} r=${R_CAP * 0.66} />
      <line class="pointer" x1=${x2.toFixed(2)} y1=${y2.toFixed(2)}
            x2=${x1.toFixed(2)} y2=${y1.toFixed(2)} stroke-width="2.4" />`;
  }

  private modArc(s: ParamSpec) {
    if (!this.mod) return nothing;
    const a = modArcAngles(modBand(s, this.mod), DEG0, DEG1);
    return svg`
      <path class="mod-band" d=${arcSvg(CX, CY, R_MOD, a.bandFrom, a.bandTo)}
            fill="none" stroke-width="3" stroke-linecap="round" />
      <path class="mod-fill" d=${arcSvg(CX, CY, R_MOD, a.fillFrom, a.fillTo)}
            fill="none" stroke-width="3" stroke-linecap="round" />`;
  }

  private footer(s: ParamSpec) {
    if (this.editing) {
      return html`<input class="edit" type="text" spellcheck="false"
        @keydown=${this.onEditKey} @blur=${this.onEditBlur} />`;
    }
    const unit = unitOf(s);
    // An enumerated encoder prints its LABEL, not its index. The index is
    // already on the ring, in lamps; printing "2" under two lit lamps says the
    // same thing twice and leaves the name of the thing nowhere.
    const enumerated = !!s.choices?.length;
    const [from, to] = this.run(s, clamp01(this.pos));
    return html`
      ${this.density === 'compact' ? nothing
        : html`<span class="label">${this.displayName}</span>`}
      <span class="readout">
        ${enumerated
          ? html`<span class="value reading">${formatValue(s, this.effective)}</span>`
          : html`<span class="value reading">${formatNumber(s, this.effective)}</span>
                 ${unit ? html`<span class="value units">${unit}</span>` : nothing}`}
      </span>
      ${this.countable && this.typeLegible
        // The lit count reserves the digits of the TOTAL, twice: it runs from
        // 1/12 to 12/12 and a ring that changes width as you turn it is the
        // same defect as a readout that does.
        ? html`<span class="count"><span class="reading"
                 style=${`--reading-ch:${String(this.steps).length}`}>${to - from}</span
               >&#8202;/&#8202;${this.steps}</span>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-encoder': BiEncoder;
  }
}
