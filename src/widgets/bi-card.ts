/**
 * <bi-card> -- a device in a chain: something with an identity, an on/off,
 * and a body you can put away.
 *
 * NOT the same object as <bi-group>, and the distinction is worth stating
 * because both draw a box round some controls. A group is a LASSO: it says
 * "these belong together", it has no state of its own, and a panel can carry
 * eight of them without any of them being a thing. A card is a THING: it is
 * selectable, it can be bypassed, it can be collapsed, it sits in a stack with
 * its siblings, and removing it removes something from the signal path.
 *
 * ---------------------------------------------------------------------------
 * SELECTION FIRES ON pointerdown, NOT click
 *
 * Ported deliberately from column-group.ts, where it is load-bearing:
 *
 *   A CARD IS ALSO A DRAG HANDLE. The user presses it either to select it or
 *   to reorder it, and they have not decided which yet at the moment of
 *   contact. Selecting on `click` means the card only becomes selected if the
 *   gesture turns out NOT to be a drag -- so dragging an unselected card
 *   either moves the wrong thing or moves nothing.
 *
 *   AND A CAPTURED POINTER NEVER PRODUCES A click. The moment any drag crosses
 *   its threshold and captures, the click event is gone. A `click` listener on
 *   an ancestor of a draggable thing is a listener that silently stops firing.
 *
 * So: down selects, and the drag (when there is one) begins from an already
 * correct selection. core/drag.ts's CancelReason.NoChange exists to name the
 * other half of this -- "released below the threshold" IS the click path.
 *
 * ---------------------------------------------------------------------------
 * A HIDDEN NON-DEFAULT MUST ANNOUNCE ITSELF
 *
 * The rule this card is really built around, and it generalises something the
 * prior art did once, for one control: nano-modules lights its gear button
 * when the blend mode behind it is not Normal, "so a hidden non-Normal blend is
 * never invisible".
 *
 * That is not a fact about blend modes. It is a fact about ANY affordance that
 * hides state:
 *
 *   IF A CONTROL IS OFF ITS DEFAULT AND YOU CANNOT SEE IT, THE THING THAT HID
 *   IT HAS TO SAY SO.
 *
 * A card has two such affordances -- the gear panel and collapse -- so both
 * carry the same mark, driven by the same comparison against each field's own
 * `spec.init`. One rule, two places, and it extends to any third we add,
 * because it is expressed as "which of my fields are dirty" rather than as a
 * special case per hiding mechanism.
 *
 * Without it, a patch that sounds wrong has a cause the user cannot find by
 * looking, which is the exact failure that makes people rebuild presets from
 * scratch rather than debug them.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import type { FieldBinding } from '../core/binding';
import type { Density } from './scalar-base';

@customElement('bi-card')
export class BiCard extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: block;
        min-width: 0;
        --card-accent: var(--accent);
      }
      .card {
        position: relative;
        background: var(--app-bg-color2);
        border: 1px solid var(--app-outline);
        /* SOFT radius: this is a container, and the house ladder puts
         * containers on 8/14/22 and data-carrying chrome on the crisp one. */
        border-radius: var(--app-r-5);
        overflow: hidden;
        transition: border-color 120ms linear, background-color 120ms linear;
      }
      /* THE ACCENT RULE. A colour band down the leading edge, not a coloured
       * border all round: a full coloured outline competes with the outlines of
       * every neighbouring card, and a stack of six of them turns into the
       * confetti the palette notes warn about. One edge is enough to sort a
       * stack by family at a glance.
       *
       * And the category hue stops at the rule and the pip. It is deliberately
       * NOT pushed down into --accent for the controls inside: recolouring
       * every knob in every card by its device family is precisely the
       * confetti the note is about, and it would also spend the accent channel
       * -- which each control needs for its own juice -- on a fact the card
       * has already stated. */
      .card::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: calc(3px * var(--bi-scale));
        background: var(--card-accent);
        opacity: 0.85;
      }
      /* SELECTION LAYERS, IT DOES NOT REPLACE. The recorded nano-modules bug:
       * swapping the surface for the selection colour left a selected card 88%
       * see-through. A tint composited over the existing ground cannot do
       * that. */
      :host([selected]) .card {
        border-color: var(--card-accent);
        background-color: color-mix(in srgb, var(--card-accent) 9%, var(--app-bg-color2));
      }
      :host([bypassed]) .body,
      :host([bypassed]) .name {
        /* Reachability is the ONE thing alpha is allowed to mean, and a
         * bypassed device is precisely "in the layout, not in the signal". */
        opacity: 0.42;
      }

      .header {
        display: flex;
        align-items: center;
        gap: calc(5px * var(--bi-scale));
        padding: calc(4px * var(--bi-scale)) calc(7px * var(--bi-scale));
        padding-left: calc(9px * var(--bi-scale));
        cursor: default;
        user-select: none;
        min-height: calc(22px * var(--bi-scale));
      }
      :host(:not([selected])) .header:hover {
        background: var(--hover-wash);
      }
      .name {
        flex: 1 1 auto;
        min-width: 0;
        font-size: var(--fs-sm);
        color: var(--app-text-color1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* NO CATEGORY DOT. The prior art has one -- a 6px hue dot between the
       * bypass toggle and the name -- and putting it here alongside the accent
       * rule drew the same colour twice, three pixels apart, which reads as an
       * unfinished layout rather than as two facts. The rule wins: it runs the
       * full height, so it survives the card being collapsed to a strip and it
       * is what the eye follows down a stack.
       */

      /* THE BYPASS PIP, and it is deliberately quiet in BOTH states.
       *
       * First pass gave the active state the full chip treatment -- saturated
       * fill and a bloom -- and a stack of six active devices read as six
       * alarms. The reasoning was backwards: ACTIVE IS THE RESTING STATE. Most
       * devices in most patches are in the path most of the time, so the lit
       * pip is the thing you see hundreds of and it must cost nothing to look
       * at. The exception is bypass, and bypass is already shouted by the body
       * going to 42% -- which is the one thing alpha is allowed to mean.
       *
       * So: a small solid dot when active, a hollow socket when not. No glow
       * on either. The pip is a status LED on a rack unit, not a button that
       * wants pressing. */
      .pip {
        flex: none;
        width: calc(8px * var(--bi-scale));
        height: calc(8px * var(--bi-scale));
        border-radius: 50%;
        border: 1px solid var(--well-edge);
        background: var(--well-bg);
        cursor: pointer;
        padding: 0;
        transition: background 120ms linear, border-color 120ms linear;
      }
      :host(:not([bypassed])) .pip {
        background: color-mix(in srgb, var(--card-accent) 80%, transparent);
        border-color: color-mix(in srgb, var(--card-accent) 55%, transparent);
      }
      .pip:hover { border-color: var(--hover-edge); }

      .btn {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        width: calc(16px * var(--bi-scale));
        height: calc(16px * var(--bi-scale));
        padding: 0;
        border: none;
        background: none;
        color: var(--app-text-color3);
        font: inherit;
        font-size: var(--fs-sm);
        line-height: 1;
        cursor: pointer;
        border-radius: var(--app-r-2);
      }
      .btn:hover { color: var(--app-text-color1); background: var(--hover-wash); }
      .btn[data-open] { color: var(--app-text-color1); }
      /* THE MARK. See the file header: a hidden non-default has to be visible
       * from outside whatever is hiding it. Juice, because it is state the user
       * set; a dot rather than a colour change on the glyph, because a colour
       * change is only legible if you know what the other colour looked like. */
      .btn[data-dirty]::after {
        content: '';
        position: absolute;
        top: calc(1px * var(--bi-scale));
        right: calc(1px * var(--bi-scale));
        width: calc(4px * var(--bi-scale));
        height: calc(4px * var(--bi-scale));
        border-radius: 50%;
        background: var(--juice-hot);
        /* The bloom radius comes from the SKIN, which is how a widget stays
         * skinned without knowing which skin it is in: crystal declares a
         * size, both ink skins declare 0px, and a halo around a printed dot --
         * which is what light coming off paper would be -- never renders. */
        box-shadow: 0 0 var(--chip-glow-size) var(--juice-glow);
      }
      .chev {
        display: inline-block;
        transition: transform 120ms linear;
      }
      :host([collapsed]) .chev { transform: rotate(-90deg); }

      .gear {
        padding: calc(4px * var(--bi-scale)) calc(9px * var(--bi-scale));
        border-top: 1px solid var(--app-tint-2);
        background: var(--app-bg-sunken);
      }
      .body {
        padding: calc(6px * var(--bi-scale)) calc(9px * var(--bi-scale))
                 calc(8px * var(--bi-scale));
      }
      :host([collapsed]) .body,
      :host([collapsed]) .gear { display: none; }
      /* A COLLAPSED CARD MUST STILL BE A CARD. At the ladder's card radius a
       * header-height box is exactly a capsule, and a capsule among rectangles
       * reads as a different kind of object -- so two collapsed devices in a
       * stack of six stop looking like devices. One rung down keeps the same
       * family of rounding without the shape changing meaning. */
      :host([collapsed]) .card { border-radius: var(--app-r-4); }
      :host([density='compact']) .header { min-height: calc(18px * var(--bi-scale)); }
      :host([density='compact']) .body {
        padding: calc(4px * var(--bi-scale)) calc(6px * var(--bi-scale));
      }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
    `,
  ];

  /** Optional -- the card reads bypass and dirtiness through it. A purely
   * presentational card (a layout demo, a placeholder) works without one. */
  @property({ attribute: false }) binding?: FieldBinding;
  @property({ type: String }) label = '';
  /** A palette category name, e.g. "filter". Renders as the 6px dot and sets
   * the accent rule, so a stack sorts by family without a legend. */
  @property({ type: String }) category = '';
  /** Boolean param driving the bypass pip. Absent hides the pip entirely --
   * a control for a thing that cannot happen is worse than no control. */
  @property({ type: String }) bypassPath = '';
  /** Fields in the BODY, for the collapse mark. */
  @property({ attribute: false }) fields: string[] = [];
  /** Fields behind the gear, for the gear mark. */
  @property({ attribute: false }) gearFields: string[] = [];

  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ type: Boolean, reflect: true }) bypassed = false;
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;

  @state() private gearOpen = false;
  @state() private rev = 0;

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => {
      this.syncBypass();
      this.rev++;
    }) ?? null;
    if (this.category) {
      this.style.setProperty('--card-accent', `var(--app-cat-${this.category}, var(--accent))`);
    }
    this.syncBypass();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private syncBypass(): void {
    if (!this.bypassPath || !this.binding) return;
    this.bypassed = this.binding.getValue(this.bypassPath) >= 0.5;
  }

  /** Which of these fields are off the value their own spec declares. See the
   * file header -- this is the whole basis of both hidden-state marks, and it
   * asks each field's OWN spec so a mark can never disagree with what a reset
   * would actually do. */
  private dirty(paths: string[]): boolean {
    const b = this.binding;
    if (!b) return false;
    return paths.some((p) => {
      const s = b.spec(p);
      return !!s && b.getValue(p) !== Math.fround(s.init);
    });
  }

  private onHeaderDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0) return;
    // A control inside the header owns its own press. Without this, hitting
    // the bypass pip also selects the card, which is a different action.
    if ((e.target as HTMLElement).closest('.btn, .pip')) return;
    this.select(e);
  };

  private select(e: PointerEvent): void {
    this.dispatchEvent(new CustomEvent('bi-select', {
      // The two multi-select gestures every list in the prior art uses, passed
      // through rather than interpreted: what "additive" means to a chain and
      // to a matrix are different, and the card is not the one that knows.
      detail: { additive: e.metaKey || e.ctrlKey, range: e.shiftKey },
      bubbles: true,
      composed: true,
    }));
  }

  private toggleBypass = (e: Event): void => {
    e.stopPropagation();
    if (!this.bypassPath || !this.binding) return;
    this.binding.setValue(this.bypassPath, this.bypassed ? 0 : 1);
    this.syncBypass();
  };

  private toggleGear = (e: Event): void => {
    e.stopPropagation();
    this.gearOpen = !this.gearOpen;
  };

  private toggleCollapse = (e: Event): void => {
    e.stopPropagation();
    this.collapsed = !this.collapsed;
    this.dispatchEvent(new CustomEvent('bi-collapse', {
      detail: { collapsed: this.collapsed }, bubbles: true, composed: true,
    }));
  };

  /** Double-clicking the header collapses -- the prior art's idiom, and the one
   * gesture that is reliably free on a row whose single click already means
   * select. Not on a control inside the header, which has its own meaning. */
  private onDblClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest('.btn, .pip')) return;
    this.toggleCollapse(e);
  };

  render() {
    const hasGear = this.gearFields.length > 0 || !!this.querySelector('[slot="gear"]');
    // Each mark asks about the fields ITS affordance is hiding, and only while
    // it is actually hiding them. A gear that is open is not concealing
    // anything, so it does not claim to be.
    const gearDirty = !this.gearOpen && this.dirty(this.gearFields);
    const bodyDirty = this.collapsed && this.dirty([...this.fields, ...this.gearFields]);

    return html`
      <div class="card">
        <div class="header" @pointerdown=${this.onHeaderDown} @dblclick=${this.onDblClick}>
          ${this.bypassPath
            ? html`<button class="pip" title=${this.bypassed ? 'Bypassed' : 'Active'}
                           @click=${this.toggleBypass}></button>`
            : nothing}
          <span class="name">${this.label}</span>
          <slot name="header"></slot>
          ${hasGear
            ? html`<button class="btn" ?data-open=${this.gearOpen} ?data-dirty=${gearDirty}
                     title=${gearDirty ? 'Options (one is not at its default)' : 'Options'}
                     @click=${this.toggleGear}>&#9881;</button>`
            : nothing}
          <button class="btn" ?data-dirty=${bodyDirty}
                  title=${this.collapsed ? 'Expand' : 'Collapse'}
                  @click=${this.toggleCollapse}>
            <span class="chev">&#9662;</span>
          </button>
        </div>
        ${this.gearOpen ? html`<div class="gear"><slot name="gear"></slot></div>` : nothing}
        <div class="body"><slot></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-card': BiCard;
  }
}
