/**
 * <bi-number> -- the exact value, as a control.
 *
 * Every other scalar in the family is a PICTURE of a value: an arc, a filled
 * track, a lit segment. Pictures are how you compare, aim and sweep, and they
 * are hopeless for the one thing a scientific surface asks constantly -- "what
 * is it, exactly, and can I put it back". This is the widget for that: the
 * number is the control, and the control is the number.
 *
 * It is a ScalarControl, so it is the same object as the knob underneath --
 * same continuous-edit protocol, same reset, same type-to-edit, same jog. Only
 * the geometry differs, and the geometry is: there isn't any.
 *
 * ---------------------------------------------------------------------------
 * THE THREE WAYS IN, AND WHY ALL THREE
 *
 *   SCRUB    vertical drag, relative, 160px for the whole range. The coarse
 *            way, and the one that makes a numeric field feel like a control
 *            rather than a form.
 *   JOG      arrow keys, 2% a press, one undo point per autorepeat run. The
 *            way you land on a round number.
 *   TYPE     a digit, or Enter, opens the box. The way you enter a value
 *            somebody read out to you.
 *
 * A field with only the third is a form field, and a form field in a plugin is
 * where a mouse goes to die. A field with only the first is a knob wearing a
 * number. The prior art's `editable-number` has jog and type but no scrub; its
 * jog emits one store write per press, which is one undo entry per press --
 * fixed for the whole family in scalar-base rather than here.
 *
 * ---------------------------------------------------------------------------
 * WHAT A MODULATED FIELD SHOWS
 *
 * Both numbers, and this is the one place in the family where there is room to.
 *
 * A knob shows the modulated value in its readout and the set value at its
 * pointer, and the two are different KINDS of mark, so no one confuses them. A
 * bare number has no second mark available, and printing only the live one
 * hides the value the user actually set -- which is the value they are trying
 * to type, reset, or write down. So the effective value is the big number and
 * the set value follows it, dimmed, prefixed with the "from" arrow.
 *
 * Only when they differ. A "set 0.50" hanging off every unmodulated field is
 * noise that trains the eye to skip the place the important number lives.
 */
import { html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base } from '../theme/base';
import { ScalarControl } from './scalar-base';
import { formatNumber, readingChars, unitOf } from '../core/format';

/** Vertical pixels of drag for one full min-to-max sweep. Same as the knob's:
 * a scrub and a rotary are the same gesture with a different picture over it,
 * and two sensitivities for one motion is how a family stops feeling like one. */
const DRAG_RANGE_PX = 160;
/** Shift multiplier. The knob's, for the same reason. */
const FINE = 0.25;

@customElement('bi-number')
export class BiNumber extends ScalarControl {
  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        flex-direction: column;
        gap: calc(2px * var(--bi-scale));
        min-width: 0;
        outline: none;
        /* ONE size for the number and for the box you type it into.
         *
         * These were two rules that had to be kept equal by hand, and they
         * were not: compact shrank the readout to --fs-sm and left the editor
         * at --fs-md, so a reservation counted in CHARACTERS came out 3.6px
         * wider in the editor -- the count was right and the character was a
         * different size. Naming the size once makes the class of bug
         * unrepresentable rather than fixing this instance of it. */
        --num-fs: var(--fs-md);
      }
      :host([density='compact']) { --num-fs: var(--fs-sm); }
      .field {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: calc(3px * var(--bi-scale));
        padding: calc(2px * var(--bi-scale)) calc(6px * var(--bi-scale));
        min-width: calc(56px * var(--bi-scale));
        /* A well, not a box. Same sunken plate the slider's track and the
         * toggle's tube are cut into, so a row of mixed controls reads as one
         * surface with different things set into it. */
        background: var(--well-bg);
        border: 1px solid var(--well-edge);
        /* CRISP. The house rule: soft radii are for containers, crisp ones for
         * anything carrying data, and this is nothing but data. */
        border-radius: var(--app-r-2);
        cursor: ns-resize;
        touch-action: none;
        user-select: none;
        transition: border-color 120ms linear, background-color 120ms linear;
      }
      /* Hover is a change to the CONTROL. The well lights and its edge
       * sharpens; nothing appears over the host window. */
      :host(:hover:not([disabled])) .field,
      :host(:focus-visible) .field {
        border-color: var(--hover-edge);
        background-color: var(--hover-wash);
      }
      :host(:focus-visible) .field {
        outline: 1px solid var(--juice-hot);
        outline-offset: 1px;
      }
      .num {
        font-size: var(--num-fs);
        /* .reading supplies the reservation and the right alignment; the field
         * itself is already flex-end, so the two agree. */
        color: var(--readout-color, var(--juice-hot));
        line-height: 1.2;
        white-space: nowrap;
      }
      /* counter: the number is text, not signal. Same inversion as everywhere
       * else -- the lead field emits, the counter field is merely legible. */
      :host([rank='counter']) .num { color: var(--app-text-color1); }
      :host([rank='counter']) .field { background: transparent; }

      /* The set value, behind a modulated reading. Deliberately smaller AND
       * dimmer: it must be findable without competing, and one of the two axes
       * alone leaves it either shouting or invisible. */
      .set {
        font-size: var(--fs-xs);
        color: var(--app-text-color3);
        white-space: nowrap;
      }
      .range {
        font-size: var(--fs-xs);
        color: var(--app-text-color3);
        text-align: right;
        white-space: nowrap;
      }
      /*
       * THE EDITOR SITS IN THE WELL; IT DOES NOT REPLACE IT.
       *
       * Every other control in the family swaps its whole readout for a boxed
       * input, and that is fine there because the readout is a caption under a
       * dial. Here the readout IS the control -- a well with a border, padding,
       * a unit and (when modulated) a second number -- and swapping the lot for
       * a bare box moves all of it.
       *
       * Sizing a replacement box to match was tried and comes out 8.9px wide,
       * because the unit is set at --fs-xs while the number is at --fs-md, so a
       * reservation counted in the number's characters over-pays for the unit
       * by the ratio of the two sizes. Chasing that with a fudge factor would
       * have worked and would have been wrong: the box was never the thing that
       * needed to match.
       *
       * So the input takes the NUMBER's place and nothing else moves. The unit
       * stays visible beside what you are typing, which is also just better --
       * you can see the units you are entering.
       */
      .edit {
        font: inherit;
        font-size: var(--num-fs);
        color: var(--app-text-color1);
        text-align: right;
        width: calc(var(--reading-ch, 6) * 1ch);
        /* A flex item's min-width:auto is its intrinsic minimum, and a form
         * control's intrinsic minimum is its ~20-character default size -- so
         * without this the declared width above is a floor the input never
         * comes down to. Worth 3.6px of drift, measured. */
        min-width: 0;
        flex: none;
        background: none;
        border: none;
        padding: 0;
        outline: none;
        line-height: 1.2;
      }
      /* The well takes the focus ring instead, so the control still announces
       * that it is being typed into. */
      .field.editing {
        border-color: var(--juice);
        background: var(--app-bg-sunken);
      }
      /* compact drops the name and the range: in a dense strip the field is
       * identified by what it sits next to, and the number is the point. */
      :host([density='compact']) .label,
      :host([density='compact']) .range { display: none; }
      :host(:not([density='expanded'])) .range { display: none; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
    `,
  ];

  /** Widen the field so a column of them lines up on the decimal point even
   * when the values have different digit counts. In unscaled px. */
  @property({ type: Number }) width = 0;

  /**
   * Relative vertical scrub. UP increases, which is the direction every other
   * relative control in this family and in all four prior repos agrees on --
   * and the one place a numeric field is tempted to disagree, because text
   * reads downward.
   */
  protected positionFor(e: PointerEvent, delta: [number, number]): number {
    const sens = e.shiftKey ? FINE : 1;
    return this.dragStartPos - (delta[1] / DRAG_RANGE_PX) * sens;
  }

  render() {
    const s = this.spec;
    if (!s) return html`<span class="note caution">no spec: ${this.path}</span>`;

    const unit = unitOf(s);
    const w = this.width > 0 ? `min-width: calc(${this.width}px * var(--bi-scale))` : nothing;
    /*
     * The set value whenever the field is MODULATED -- not "whenever the two
     * differ", which is what this said first and which flickers.
     *
     * A modulated value sweeps THROUGH its set value, several times a second
     * on anything periodic. Gating on inequality means the second number
     * appears and vanishes on every crossing, and since it is a whole span in
     * the flex row, the live number jumps sideways each time. The condition was
     * trying to keep unmodulated fields quiet, and `modulated` alone already
     * does that.
     */
    const live = formatNumber(s, this.effective);
    const set = formatNumber(s, this.value);

    return html`
      ${this.density === 'compact' ? nothing
        : html`<span class="label">${this.displayName}</span>`}
      <div class=${`field${this.editing ? ' editing' : ''}`} style=${w}
           @pointerdown=${this.onPointerDown}>
        ${this.modulated
          ? html`<span class="set">&#8592;&#8202;<span class="reading">${set}</span></span>`
          : nothing}
        ${this.editing
          ? html`<input class="edit" type="text" spellcheck="false"
              @keydown=${this.onEditKey} @blur=${this.onEditBlur} />`
          : html`<span class="num reading">${live}</span>`}
        ${unit ? html`<span class="value units">${unit}</span>` : nothing}
      </div>
      ${this.density === 'expanded' && this.typeLegible
        ? html`<span class="range">${formatNumber(s, s.min)}&#8202;&#8230;&#8202;${
            formatNumber(s, s.max)}${s.curve.kind === 'log' ? ' log' : ''}</span>`
        : nothing}
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'bi-number': BiNumber;
  }
}
