/**
 * <bi-slider> -- the linear scalar control.
 *
 * A merge of the two prior implementations, taking the better half of each.
 *
 * FROM nano-modules' scalar-slider.ts: absolute positioning. Pressing anywhere
 * on the track jumps the value to the cursor. On a bar this is right -- the
 * track is a picture of the range, and clicking a point in it should mean that
 * point. (A knob is the opposite: it has no visible range to click into, so it
 * is relative.)
 *
 * FROM nano-lfo's nano-slider: the fill is translucent AND carries a 2px solid
 * edge at the value. The comment there is worth keeping -- "the fill alone
 * reads as approximate". A soft-ended bar tells you roughly where the value is;
 * the hard edge tells you exactly.
 *
 * MATERIAL. The slider is the clearest case in the family for the juice/glass
 * split, because it is literally a tube with liquid in it: a dark glass channel
 * with a capsule profile, a saturated fill lit from above, and a bright meniscus
 * at the leading edge. The capsule is a deliberate exception to "crisp radii for
 * data" -- the TUBE is glass and may be soft; what has to stay hard is the
 * meniscus, because that is the part carrying the reading.
 *
 * THE THUMB (2026-09-24). The meniscus is a knockout -- on the ink skins a
 * dark hairline -- and at a value near zero there is no fill for it to
 * knock out of, so the reading vanished. The value now also carries a pill in
 * the text's colour, ringed in the well's, standing proud of the tube: it
 * reads on the fill and on the empty well alike. The pointer lands on a band
 * HIT px above and below the tube (padding cancelled by a negative margin,
 * so no layout moves), not on the 14px tube alone.
 *
 * PRESS. The fill blooms rather than the bar growing. An earlier version scaled
 * the track 14% vertically on press, which is the same shrink-on-touch idiom the
 * knob had and reads the same way; light responding to contact does not.
 *
 * DOM, not canvas: this is four rectangles and some text, and building it in
 * the DOM gets hover, focus, transitions and text rendering for free.
 */
import { html, css, nothing } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { base } from '../theme/base';
import { formatNumber, readingChars, unitOf } from '../core/format';
import { modBand } from '../draw/modband';
import { toPos, type ParamSpec } from '../core/schema';
import { ScalarControl, clamp01 } from './scalar-base';

/** Fine adjust is a tenth of the pointer's movement. */
const FINE = 0.1;

@customElement('bi-slider')
export class BiSlider extends ScalarControl {
  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: calc(60px * var(--bi-scale));
        outline: none;
      }
      :host(:focus-visible) .track {
        outline: 1px solid var(--juice-hot);
        outline-offset: 2px;
      }
      .readout .value { color: var(--readout-color, var(--juice-hot)); }
      .head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--sp-3);
        min-width: 0;
      }
      .readout {
        display: flex;
        align-items: baseline;
        gap: 3px;
        flex: none;
      }
      .hit {
        /* less above than below: above is the label, and a press there
         * should not land on the tube */
        padding: calc(0.6 * var(--hit)) 0 var(--hit);
        margin: calc(-0.6 * var(--hit)) 0 calc(-1 * var(--hit));
        cursor: ew-resize;
        touch-action: none;
        --hit: calc(8px * var(--bi-scale));
      }
      .rail { position: relative; }
      .thumb {
        position: absolute;
        top: calc(-3px * var(--bi-scale));
        bottom: calc(-3px * var(--bi-scale));
        width: calc(6px * var(--bi-scale));
        margin-left: calc(-3px * var(--bi-scale));
        border-radius: 999px;
        background: var(--thumb, var(--app-text-color1));
        box-shadow: 0 0 0 1.5px var(--well-bg);
        pointer-events: none;
      }
      :host(:hover:not([disabled])) .thumb, :host(:focus-visible) .thumb { background: var(--juice-hot, var(--app-text-color1)); }
      :host([rank='counter']) .thumb { opacity: 0.7; }
      :host([density='compact']) .hit { --hit: calc(5px * var(--bi-scale)); }
      /* The glass tube. Dark, capsule-ended, with a lit top inner edge -- the
       * inset shadow says "channel", the top highlight says "glass". */
      .track {
        position: relative;
        height: calc(14px * var(--bi-scale));
        background: var(--well-bg);
        border: 1px solid var(--well-edge);
        box-shadow: var(--well-lip);
        border-radius: 999px;
        cursor: ew-resize;
        touch-action: none;
        overflow: hidden;
        /* Discrete colour state, well under 150ms -- the one thing the house
         * rules let CSS time. Nothing here is positional. */
        transition: border-color 90ms linear, background-color 90ms linear;
      }
      /* THE WELL LIGHTS UNDER THE POINTER.
       *
       * The edge goes from a hairline you have to look for to one you cannot
       * miss, and a wash lands in the tube. The wash is painted as the TRACK's
       * background, so the fill -- a child, painted after it -- covers the part
       * of the tube that holds juice. The hover mark therefore lives only in
       * the EMPTY part of the tube and can never be read as the value moving.
       * That is the whole reason it is safe to light a control this brightly.
       *
       * :focus-visible gets the same treatment plus the ring: a keyboard user
       * should see the affordance the pointer user sees, not only the ring. */
      :host(:hover:not([disabled])) .track,
      :host(:focus-visible) .track {
        border-color: var(--hover-edge);
        background-image: linear-gradient(var(--hover-wash), var(--hover-wash));
      }
      .track::after {
        /* The glass over the whole tube: a single top-lit sheen, above the
         * juice, so the liquid looks like it is INSIDE something. */
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: linear-gradient(180deg, var(--glass-top), transparent 55%);
        pointer-events: none;
      }
      /* The bloom. Sits under the fill and widens on press -- the juice
       * responding to contact, in place of the bar changing size. */
      .glow {
        position: absolute;
        inset: -6px auto -6px -6px;
        background: var(--juice-glow);
        filter: none;
        border-radius: 999px;
      }
      /* The liquid. Same four crystal cues as the seg chip, in box-shadow:
       * lit top facet, far inner wall along the base, a dispersion note on the
       * shaded side, and a denser base than top. */
      .fill {
        position: absolute;
        inset: 0 auto 0 0;
        background: var(--chip-bg);
        box-shadow: var(--chip-shadow);
        mix-blend-mode: var(--chip-blend);
      }
      :host([rank='counter']) .fill {
        background: var(--juice-wash);
        box-shadow: inset 0 -2px 0 var(--juice);
      }
      :host([rank='counter']) .glow { display: none; }
      :host([rank='counter']) .edge { opacity: 0.5; }
      /* The meniscus. Without a hard leading edge the fill reads as an
       * approximation of the value rather than as the value, so this is the one
       * part of the tube that stays crisp. */
      .edge {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        margin-left: -1px;
        background: var(--meniscus, #fff);
        opacity: 0.85;
      }
      /* Modulation rides a strip along the bottom of the track rather than
       * recolouring the fill, so the set value stays legible underneath it. */
      .mod {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 3px;
      }
      .mod-band,
      .mod-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        background: var(--app-mod-color);
      }
      .mod-band { opacity: 0.28; }
      .mod-fill { box-shadow: 0 0 4px var(--app-mod-color); }
      .detent {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: var(--app-text-color3);
        opacity: 0.6;
      }
      :host([modulated]) .fill { opacity: 0.4; }

      .edit {
        font: inherit;
        font-size: var(--fs-xs);
        text-align: right;
        /* Same reservation as the readout it replaces -- see the note on
         * .edit in bi-knob.ts, including why this is width and not
         * min-width. */
        width: calc(var(--edit-ch, 8) * 1ch);
        background: var(--app-bg-sunken);
        color: var(--app-text-color1);
        border: 1px solid var(--juice);
        border-radius: var(--app-r-3);
        padding: 0 2px;
        outline: none;
      }
      :host([density='compact']) .track { height: calc(9px * var(--bi-scale)); }
      :host([density='compact']) .head { display: none; }
      :host([density='expanded']) .track { height: calc(20px * var(--bi-scale)); }
    `,
  ];

  @query('.track') private trackEl?: HTMLElement;

  /** Press-to-jump: the value should land under the cursor on pointerdown, so
   * waiting for a 5px threshold would make the first press feel dead. */
  protected get trackImmediately(): boolean {
    return true;
  }

  /**
   * Fine adjust anchors where the modifier was pressed, not where the gesture
   * began.
   *
   * The ported version measured fine movement from the gesture's start, which
   * means pressing Shift halfway through a drag snaps the value back to where
   * you started. Anchoring on the modifier keeps the value put and makes the
   * next pixel a fine one. Releasing Shift returns to absolute, so the handle
   * jumps to the cursor -- which is what absolute means, and is predictable
   * once you know the control is absolute.
   */
  private fineAnchor: { pos: number; dx: number } | null = null;

  protected positionFor(e: PointerEvent, delta: [number, number]): number {
    const r = this.trackEl?.getBoundingClientRect();
    if (!r || r.width <= 0) return this.dragStartPos;

    if (e.shiftKey) {
      if (!this.fineAnchor) this.fineAnchor = { pos: this.pos, dx: delta[0] };
      return this.fineAnchor.pos + ((delta[0] - this.fineAnchor.dx) / r.width) * FINE;
    }
    this.fineAnchor = null;
    return (e.clientX - r.left) / r.width;
  }

  render() {
    const s = this.spec;
    if (!s) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const p = clamp01(this.pos);
    const pct = (p * 100).toFixed(3);

    return html`
      <div class="head">
        <span class="label">${this.displayName}</span>
        ${this.editing
          ? html`<input class="edit" type="text" spellcheck="false"
              @keydown=${this.onEditKey} @blur=${this.onEditBlur} />`
          : this.readout(s)}
      </div>
      <div class="hit" @pointerdown=${this.onPointerDown}>
        <div class="rail">
          <div class="track">
            <div class="glow" style=${this.glowStyle(p)}></div>
            <div class="fill" style="width:${pct}%"></div>
            <div class="edge" style="left:${pct}%"></div>
            ${this.detent(s)}
            ${this.modStrip(s)}
          </div>
          <div class="thumb" style="left:${pct}%"></div>
        </div>
      </div>
    `;
  }

  /**
   * The press response: the juice behind the fill brightens and spreads.
   *
   * Opacity and a few pixels of spread, both clipped by the tube -- so what the
   * eye sees is the liquid lighting up inside a container that has not moved.
   * Nothing here changes the control's size or its layout.
   */
  private glowStyle(p: number): string {
    const held = this.press.value;
    const w = p * 100;
    return `width: calc(${w.toFixed(3)}% + ${(6 + held * 8).toFixed(1)}px);` +
      ` opacity: ${(0.35 + held * 0.55).toFixed(3)}`;
  }

  private readout(s: ParamSpec) {
    const unit = unitOf(s);
    return html`<span class="readout">
      <span class="value reading">${formatNumber(s, this.effective)}</span>
      ${unit ? html`<span class="value units">${unit}</span>` : nothing}
    </span>`;
  }

  private detent(s: ParamSpec) {
    // Curve-aware, like every other position in this control: a linear
    // normalisation would put the detent visibly off its own value on a
    // log-curved parameter.
    const t = toPos(s, s.init);
    // Suppressed at the ends, where a tick sits under the track border and
    // reads as a rendering artefact rather than as a landmark.
    if (!(t > 0.02 && t < 0.98)) return nothing;
    return html`<div class="detent" style="left:${(t * 100).toFixed(3)}%"></div>`;
  }

  private modStrip(s: ParamSpec) {
    if (!this.mod) return nothing;
    const b = modBand(s, this.mod);
    // Floored to a hairline: a fill that rounds to zero width vanishes, and an
    // absent fill reads as "not modulated" rather than "modulated to neutral".
    return html`<div class="mod">
      <div class="mod-band"
           style="left:${(b.lo * 100).toFixed(3)}%;width:${Math.max(0.5, b.span * 100).toFixed(3)}%"></div>
      <div class="mod-fill"
           style="left:${(b.fillLo * 100).toFixed(3)}%;width:${Math.max(0.5, b.fillSpan * 100).toFixed(3)}%"></div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-slider': BiSlider;
  }
}
