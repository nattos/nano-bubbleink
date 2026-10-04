/**
 * <bi-knob> -- the rotary scalar control: how MUCH (an encoder says which).
 *
 * Ported from nano-modules' scalar-knob.ts and device-encoder.ts, whose tuned
 * constants are carried over rather than re-guessed: a 270-degree sweep with
 * the gap at the bottom, and 160px of vertical travel for the full range. Those
 * two numbers are what make a knob feel like a knob, and they were arrived at
 * by use.
 *
 * ---------------------------------------------------------------------------
 * THE SLIDER, BENT ROUND (2026-10-04)
 *
 * The knob had grown its own material -- a crystal cap, then a screenprint of
 * misregistered plates and halftoned counters -- while the slider, the seg and
 * the toggle settled on one: a dark WELL with an edge, juice poured into it, a
 * hard meniscus at the reading, and a thumb in the text's colour standing
 * proud of it. A panel mixing knobs with sliders read as two families. So the
 * knob is now exactly the slider's anatomy on an arc, and nothing of its own
 * but the cap you turn it by:
 *
 *   the TUBE      --well-bg in a --well-edge hairline, capsule-ended (round
 *                 caps), everything inside it masked to it as the slider's
 *                 overflow clips.
 *   the JUICE     --juice from the start of the sweep, under the chip blend;
 *                 a glow ahead of it that blooms on press (the slider's).
 *   the MENISCUS  a hard --meniscus line across the tube at the value.
 *   the THUMB     a --thumb pill across the tube, ringed in the well, juice-hot
 *                 under the pointer -- it reads on the fill and on the empty
 *                 well alike.
 *   MODULATION    a 3-unit strip along the tube's inner edge (the slider's
 *                 bottom strip), the fill dimmed while modulated.
 *   the DETENT    a hairline across the tube at the default.
 *   HOVER         the edge brightens and a wash lands in the EMPTY tube.
 *   COUNTER       juice-wash with a juice hairline on the outer edge; no glow.
 *   the CAP       bi-trigger's key: --app-bg-color2 in the well's edge, washed
 *                 under the pointer, with a pointer tick so it reads as turned.
 *
 * SVG rather than canvas: these are small crisp vector marks that need to
 * respond to CSS state (hover, focus, disabled, modulated).
 */
import { html, svg, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import { toPos, type ParamSpec } from '../core/schema';
import { formatNumber, readingChars, unitOf } from '../core/format';
import { modBand, modArcAngles } from '../draw/modband';
import { arcSvg } from '../draw/marks';
import { ScalarControl, clamp01 } from './scalar-base';

/** Degrees of rotation spanning the whole range, gap at the bottom. */
const SWEEP = 270;
const DEG0 = -135;
const DEG1 = DEG0 + SWEEP;

/** Vertical pixels of drag for one full min-to-max sweep. */
const DRAG_RANGE_PX = 160;

/** Geometry in the SVG's own 100x100 space. */
const CX = 50;
const CY = 50;
/** The tube's centre line and width. */
const R_TRACK = 38;
const TUBE_W = 11;
/** The cap: the key you turn it by. */
const R_CAP = 23;
/** The thumb stands this far past the tube on each side, in CSS px. */
const THUMB_PROUD_PX = 2.5;
const THUMB_W_PX = 5;

const SIZE_PX = { sm: 30, md: 48, lg: 76 } as const;

let uid = 0;

@customElement('bi-knob')
export class BiKnob extends ScalarControl {
  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-1);
        /* Sized off the scale token so a host can zoom the whole surface. */
        --knob-px: calc(48px * var(--bi-scale));
        outline: none;
      }
      :host(:focus-visible) .dial {
        outline: 1px solid var(--juice-hot);
        outline-offset: 2px;
        border-radius: 50%;
      }
      .dial {
        width: var(--knob-px);
        height: var(--knob-px);
        cursor: ns-resize;
        touch-action: none;
        display: block;
        overflow: visible;
      }
      .edge { stroke: var(--well-edge); transition: stroke 90ms linear; }
      .well { stroke: var(--well-bg); }
      .wash { stroke: var(--hover-wash); opacity: 0; }
      :host(:hover:not([disabled])) .edge, :host(:focus-visible) .edge { stroke: var(--hover-edge); }
      :host(:hover:not([disabled])) .wash, :host(:focus-visible) .wash { opacity: 1; }
      .glow { stroke: var(--juice-glow); }
      .fill { stroke: var(--juice); mix-blend-mode: var(--chip-blend); }
      .meniscus { stroke: var(--meniscus, #fff); opacity: 0.85; }
      .detent { stroke: var(--app-text-color3); opacity: 0.6; }
      .mod-band { stroke: var(--app-mod-color); opacity: 0.28; }
      .mod-fill { stroke: var(--app-mod-color); }
      :host([modulated]) .fill { opacity: 0.4; }
      :host([rank='counter']) .fill { stroke: var(--juice-wash); mix-blend-mode: normal; }
      .rim { stroke: var(--juice); }
      :host([rank='counter']) .glow { display: none; }
      :host([rank='counter']) .meniscus { opacity: 0.5; }
      .thumb-ring { stroke: var(--well-bg); }
      .thumb { stroke: var(--thumb, var(--app-text-color1)); }
      :host(:hover:not([disabled])) .thumb, :host(:focus-visible) .thumb { stroke: var(--juice-hot, var(--app-text-color1)); }
      :host([rank='counter']) .thumb { opacity: 0.7; }
      .cap { fill: var(--app-bg-color2); stroke: var(--well-edge); transition: stroke 90ms linear; }
      .cap-wash { fill: var(--hover-wash); opacity: 0; pointer-events: none; }
      :host(:hover:not([disabled])) .cap { stroke: var(--hover-edge); }
      :host(:hover:not([disabled])) .cap-wash { opacity: 1; }
      .pointer { stroke: var(--app-text-color2); stroke-linecap: round; }

      .readout {
        display: flex;
        align-items: baseline;
        gap: 3px;
        line-height: 1;
      }
      /* A shadow root cannot select on :root[data-skin], so the skin reaches
       * widgets as an inherited custom property instead -- which is the same
       * mechanism the juice ramp uses, and the reason a widget needs no
       * plumbing to be skinned. */
      .value { color: var(--readout-color, var(--juice-hot)); }
      :host([rank='counter']) .value { color: var(--app-text-color2); }
      :host([rank='counter']) .units { color: var(--app-text-color3); }
      .edit {
        /* Sized off the SAME reservation the readout uses, so opening the
         * editor does not resize the control. A type-to-edit box narrower or
         * wider than the reading it replaces makes every neighbour jump the
         * instant you press a digit -- the same defect as a growing readout,
         * triggered by a keystroke instead of by a value.
         *
         * WIDTH, not min-width, and that distinction cost a measurement: an
         * <input> carries an intrinsic size of about twenty characters, so a
         * min-width below that does nothing at all and the box comes out at
         * the browser's default. Measured before the fix: the knob went from
         * 76px at rest to 117px while editing. */
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
      /* compact drops the name: the knob is identified by its position and by
       * the group it sits in, and the label is the first thing to become
       * unreadable at this size anyway. */
      :host([density='compact']) .label { display: none; }
      :host([density='expanded']) .label { font-size: var(--fs-md); }
    `,
  ];

  @property({ type: String, reflect: true }) size: keyof typeof SIZE_PX = 'md';

  /** Mask ids are document-global even from inside a shadow root in some
   * engines; a per-instance suffix removes the whole class of "every knob uses
   * the first one's mask" bug. */
  private readonly gid = `k${++uid}`;

  /** Rendered diameter in CSS px: the thumb and the bloom are sized in screen
   * px (as the slider's are), and --bi-scale multiplies the dial. */
  @state() private dialPx = 48;
  private ro: ResizeObserver | null = null;

  protected positionFor(e: PointerEvent, delta: [number, number]): number {
    // Shift is a quarter of the travel, applied to the same gesture rather than
    // restarting it, so the modifier can be pressed and released mid-drag.
    const sens = e.shiftKey ? 0.25 : 1;
    return this.dragStartPos - (delta[1] / DRAG_RANGE_PX) * sens;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0 && Math.abs(w - this.dialPx) > 0.5) this.dialPx = w;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ro?.disconnect();
    this.ro = null;
  }

  protected firstUpdated(): void {
    const dial = this.renderRoot.querySelector('.dial');
    if (dial) this.ro?.observe(dial);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('size')) {
      this.style.setProperty('--knob-px', `calc(${SIZE_PX[this.size]}px * var(--bi-scale))`);
    }
  }

  /** CSS px to viewBox units at the current size. */
  private px(n: number): number {
    return (n * 100) / Math.max(12, this.dialPx);
  }

  render() {
    const s = this.spec;
    if (!s) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const p = clamp01(this.pos);
    const angle = DEG0 + p * SWEEP;
    const held = this.press.value;
    const track = arcSvg(CX, CY, R_TRACK, DEG0, DEG1);
    const counter = this.rank === 'counter';
    // The juice starts past the tube's rounded end so the mask, not a butt cap,
    // shapes it -- the slider's overflow does the same for its capsule.
    const lead = ((TUBE_W / 2 / R_TRACK) * 180) / Math.PI + 2;
    const bloomDeg = ((this.px(6 + held * 8) / R_TRACK) * 180) / Math.PI;
    const inner = R_TRACK - TUBE_W / 2;
    const outer = R_TRACK + TUBE_W / 2;
    return html`
      <svg class="dial" viewBox="0 0 100 100" @pointerdown=${this.onPointerDown}>
        <defs>
          <mask id=${`${this.gid}tube`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <path d=${track} fill="none" stroke="#fff" stroke-width=${TUBE_W} stroke-linecap="round" />
          </mask>
        </defs>
        <path class="edge" d=${track} fill="none" stroke-width=${TUBE_W + 2} stroke-linecap="round" />
        <g mask=${`url(#${this.gid}tube)`}>
          <path class="well" d=${track} fill="none" stroke-width=${TUBE_W + 2} />
          <path class="wash" d=${track} fill="none" stroke-width=${TUBE_W + 2} />
          ${p > 0.001 || held > 0.004
            ? svg`<path class="glow" d=${arcSvg(CX, CY, R_TRACK, DEG0 - lead, Math.min(DEG1 + lead, angle + bloomDeg))}
                        fill="none" stroke-width=${TUBE_W + 2} opacity=${(0.35 + held * 0.55).toFixed(3)} />`
            : nothing}
          ${p > 0.001
            ? svg`<path class="fill" d=${arcSvg(CX, CY, R_TRACK, DEG0 - lead, angle)} fill="none"
                        stroke-width=${TUBE_W + 2} />
                  ${counter ? svg`<path class="rim" d=${arcSvg(CX, CY, outer - 1, DEG0 - lead, angle)} fill="none"
                                        stroke-width="2" />` : nothing}`
            : nothing}
          ${this.radial('meniscus', angle, inner - 1, outer + 1, this.px(2))}
          ${this.detent(s, inner, outer)}
          ${this.modStrip(s, inner)}
        </g>
        ${this.radial('thumb-ring', angle, inner - this.px(THUMB_PROUD_PX), outer + this.px(THUMB_PROUD_PX),
          this.px(THUMB_W_PX + 3), 'round')}
        ${this.radial('thumb', angle, inner - this.px(THUMB_PROUD_PX), outer + this.px(THUMB_PROUD_PX),
          this.px(THUMB_W_PX), 'round')}
        <circle class="cap" cx=${CX} cy=${CY} r=${R_CAP} stroke-width="1.2" />
        <circle class="cap-wash" cx=${CX} cy=${CY} r=${R_CAP} />
        ${this.radial('pointer', angle, R_CAP * 0.35, R_CAP - 4, 3, 'round')}
      </svg>
      ${this.footer(s)}
    `;
  }

  /** A mark across the tube (or the cap) along the radius at `deg`. */
  private radial(cls: string, deg: number, r0: number, r1: number, w: number, cap: 'butt' | 'round' = 'butt') {
    const rad = ((deg - 90) * Math.PI) / 180;
    const c = Math.cos(rad), sn = Math.sin(rad);
    // A round cap adds half the width at each end; pull the ends in so the
    // pill spans exactly r0..r1.
    const k = cap === 'round' ? w / 2 : 0;
    return svg`<line class=${cls}
      x1=${(CX + c * (r0 + k)).toFixed(3)} y1=${(CY + sn * (r0 + k)).toFixed(3)}
      x2=${(CX + c * (r1 - k)).toFixed(3)} y2=${(CY + sn * (r1 - k)).toFixed(3)}
      stroke-width=${w.toFixed(3)} stroke-linecap=${cap} />`;
  }

  /** The default's landmark: a hairline across the tube, curve-aware, and
   * suppressed at the ends where it would sit under the rounded cap. */
  private detent(s: ParamSpec, inner: number, outer: number) {
    const t = toPos(s, s.init);
    if (!(t > 0.02 && t < 0.98)) return nothing;
    return this.radial('detent', DEG0 + t * SWEEP, inner, outer, this.px(1));
  }

  /** Modulation rides a strip along the tube's inner edge -- the slider's strip
   * along its bottom -- so the set value stays legible beside it. */
  private modStrip(s: ParamSpec, inner: number) {
    if (!this.mod) return nothing;
    const a = modArcAngles(modBand(s, this.mod), DEG0, DEG1);
    const r = inner + 1.5;
    // Floored to a hairline: an absent fill reads as "not modulated".
    const floor = (from: number, to: number) => (to - from < 1 ? [from, from + 1] : [from, to]);
    const [b0, b1] = floor(a.bandFrom, a.bandTo);
    const [f0, f1] = floor(a.fillFrom, a.fillTo);
    return svg`
      <path class="mod-band" d=${arcSvg(CX, CY, r, b0, b1)} fill="none" stroke-width="3" />
      <path class="mod-fill" d=${arcSvg(CX, CY, r, f0, f1)} fill="none" stroke-width="3" />`;
  }

  private footer(s: ParamSpec) {
    if (this.editing) {
      return html`<input class="edit" type="text" spellcheck="false"
        @keydown=${this.onEditKey} @blur=${this.onEditBlur} />`;
    }
    const unit = unitOf(s);
    return html`
      ${this.density === 'compact' ? nothing : html`<span class="label">${this.displayName}</span>`}
      <span class="readout" title="Double-click to type a value" @dblclick=${this.onReadoutDblClick}>
        <span class="value reading">${formatNumber(s, this.effective)}</span>
        ${unit ? html`<span class="value units">${unit}</span>` : nothing}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-knob': BiKnob;
  }
}
