/**
 * <bi-hint> -- a parameter's own card. PARKED: nothing triggers it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A TOOLTIP ANY MORE
 *
 * It was one, briefly: a singleton that followed the pointer, opened after a
 * cold delay, retargeted warm, and dropped a leader line to whatever control it
 * described. It worked, and it was the wrong thing to have built.
 *
 *   NO POPUPS ON HOVER. This is a house rule for plugin surfaces and it holds
 *   regardless of how good the popup is. A plugin lives in someone else's
 *   window, usually a small one, often over a timeline the user is reading; a
 *   panel that grows unrequested rectangles as the pointer crosses it covers
 *   the thing the user is looking at, and it does so at the exact moment they
 *   were on their way somewhere else. What a pointer needs is "this responds",
 *   which is a change to the CONTROL, not a new object on top of the window.
 *
 * So the trigger machinery is GONE -- deliberately, and it should not come back
 * by reflex. What hover does now lives in each widget's own material: the well
 * lights, its edge sharpens, the cap takes a rim. See the hover block in
 * theme/tokens.css.
 *
 * What is kept is the CARD -- the typography and the two materials, which are
 * good and which a click-invoked detail panel, an inspector column or a
 * parameter sheet would all want. It renders inline wherever it is put, has no
 * timers, no listeners and no opinion about position, and the gallery carries a
 * specimen row so it stays skinned, rendered and honest instead of rotting.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CARD IS PERMITTED TO SAY
 *
 * Worth keeping even though the trigger changed, because it is the rule that
 * stops this from becoming the place documentation goes to hide.
 *
 *   IT MAY ONLY CARRY WHAT THE CONTROL ALREADY IMPLIES.
 *
 * The full name behind an abbreviated label, the exact number behind a rounded
 * readout, the range and curve the sweep is a picture of, the set value a
 * modulated readout has hidden, the gestures. Every one is a MORE PRECISE view
 * of something already on screen.
 *
 * Nothing that changes a decision. If a parameter is dangerous, extrapolated,
 * or off its calibrated default, that belongs in a .note under the control,
 * where it is visible to somebody who never opens a card -- which is everybody
 * on a touchscreen and everybody reading a screenshot. theme/base.ts states the
 * same rule for the same reason.
 *
 * ---------------------------------------------------------------------------
 * THE ACCENT HOP
 *
 * The juice ramp in theme/base.ts derives from the --accent a widget inherits.
 * A card placed away from the control it describes inherits somebody else's, so
 * whoever renders it sets --accent on it. One explicit hop, same mechanism.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base } from '../theme/base';

/**
 * What a control has to say about itself.
 *
 * A structure rather than a string, so the card owns the typography and every
 * control produces the same shape. A caller that wants a bespoke layout here is
 * one that has stopped matching its siblings.
 */
export interface Hint {
  /** The full name. A label shows the short form; this is the long one. */
  title: string;
  /** The resolved reading -- what the control is worth right now, rounded no
   * further than the spec asks. */
  value?: string;
  /**
   * Width to reserve for `value`, in characters -- `readingChars(spec)` from
   * core/format.ts.
   *
   * The caller supplies it rather than the card deriving it, because the card
   * is handed a formatted STRING and a string cannot say how long its siblings
   * would have been. Every caller already has the spec, which can.
   *
   * Omitting it is fine for static content; a card showing a live or modulated
   * value without it will resize as the value crosses a digit, which is the
   * defect the .reading class exists to prevent -- see theme/base.ts.
   */
  valueChars?: number;
  /** Range, curve, and where a modulated control's SET value is hiding. */
  sub?: string;
  /** Gesture idioms, as key/meaning pairs. Only ones the control actually
   * implements: naming a gesture a widget ignores is a documented bug rather
   * than a hidden one. */
  keys?: [key: string, meaning: string][];
}

@customElement('bi-hint')
export class BiHint extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: inline-block;
        max-width: 260px;
      }
      .card {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 6px 9px 7px;
        /* The accent rule down the left edge: a card beside a cyan control and
         * one beside an amber control are visibly about different things before
         * a word is read. */
        border-left: 2px solid var(--juice);
      }
      /* CRYSTAL. A dark slab with a lit edge and the juice glowing behind it --
       * the same additive law the widgets run on, so it reads as another piece
       * of the same material rather than as system chrome.
       *
       * SOFT radius, not crisp. This sat on the 4px rung and read as a dialog
       * parked next to the group outlines, which are long continuous curves on
       * the 8/14/22 ladder. A container belongs on the soft ladder; the crisp
       * one is for chips and segment ends. */
      /* INK. A printed label: hard key rule all round and a solid offset
       * shadow, which is a second plate rather than a blur. On dark stock the
       * key ink is the light one and the offset comes out light -- correct,
       * because that is what an opaque ink on dark card does. */
      .card.ink {
        background: var(--app-bg-color2);
        border: 1.5px solid var(--ink-key);
        /* The shorthand above resets border-left-color, so the juice rule has
         * to be restated -- otherwise the ink card silently loses the one mark
         * that says which control it belongs to. On stock it reads as a spot
         * colour laid beside the key rule, which is what it is. */
        border-left: 3px solid var(--juice);
        border-radius: var(--app-r-4);
        box-shadow: 3px 3px 0 var(--ink-key);
      }

      .htitle {
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--app-text-color2);
        text-transform: uppercase;
        letter-spacing: var(--app-tr-3);
        white-space: nowrap;
      }
      .hvalue {
        font-size: var(--fs-lg);
        color: var(--readout-color, var(--juice-hot));
        white-space: nowrap;
        line-height: 1.15;
      }
      .hsub {
        font-size: var(--fs-xs);
        color: var(--app-text-color3);
        white-space: nowrap;
      }
      .hkeys {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 3px 7px;
        margin-top: 3px;
        padding-top: 5px;
        border-top: 1px solid var(--app-tint-2);
        font-size: var(--fs-xs);
        color: var(--app-text-color3);
      }
      .hkeys span {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        white-space: nowrap;
      }
      kbd {
        font: inherit;
        font-size: var(--fs-xs);
        color: var(--app-text-color2);
        background: var(--app-tint-2);
        border: 1px solid var(--app-tint-3);
        border-radius: var(--app-r-2);
        padding: 0 3px;
        line-height: 1.4;
      }
    `,
  ];

  /** The content. Nothing renders without it. */
  @property({ attribute: false }) content: Hint | null = null;

  render() {
    const h = this.content;
    if (!h) return nothing;
    return html`
      <div class="card ink">
        <div class="htitle">${h.title}</div>
        ${h.value
          ? html`<div class="hvalue"><span class="reading"
              style=${h.valueChars ? `--reading-ch:${h.valueChars}` : ''}>${h.value}</span></div>`
          : nothing}
        ${h.sub ? html`<div class="hsub">${h.sub}</div>` : nothing}
        ${h.keys?.length
          ? html`<div class="hkeys">
              ${h.keys.map(([k, m]) => html`<span><kbd>${k}</kbd>${m}</span>`)}
            </div>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-hint': BiHint;
  }
}
