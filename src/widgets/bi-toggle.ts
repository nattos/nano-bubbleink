/**
 * <bi-toggle> -- the boolean control, and the family's clearest piece of
 * tactility.
 *
 * Three densities in ONE element rather than three elements, following
 * nano-modules' field-toggle. The variants are not different controls; they are
 * the same control at different information densities, and splitting them would
 * mean a panel that changes density has to swap element types.
 *
 *   compact   pip only, label suppressed -- for a dense strip
 *   normal    label on the left, pip on the right
 *   expanded  the whole row is the button, label inside it
 *
 * MATERIAL. Glass tube, juice inside, glass bead travelling in it. Off, the
 * tube is dark and the bead is a plain grey lens; on, the tube floods with
 * juice and the bead picks the colour up through it. So the state change is a
 * change of MATERIAL rather than of colour alone, which is what makes it read
 * across a panel at a glance.
 *
 * WHY THIS ONE GETS A CAPSULE. The house radius rule says crisp edges for
 * anything carrying data and soft ones for containers, and a control is
 * normally crisp. A switch is the exception, and deliberately: it is the one
 * control in the family whose entire job is to look like a physical object that
 * travels. A capsule track with a round pip is the idiom every hand already
 * knows, and a square pip sliding in a square slot reads as a state indicator
 * rather than as a thing that was thrown.
 *
 * WHY THE PIP IS SPRUNG AND SQUASHED. It was a CSS linear transition, which is
 * correct in the sense that nothing is wrong with it and dead in the sense that
 * nobody would ever call it tactile. A pip carries no reading -- nobody
 * measures anything off its position -- so by the overshoot rule in
 * core/spring.ts it is allowed to bounce, and it takes the `pop` tier: ~7%
 * past the end, back, done in 160ms.
 *
 * The squash is driven by the spring's own VELOCITY rather than by a keyframe.
 * That is the difference between an animation and a simulation: interrupt the
 * toggle mid-travel and the squash resolves correctly because it was never a
 * timeline in the first place, it was a readout of how fast the thing is
 * currently moving.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import { Spring } from '../core/spring';
import { FrameLoop } from '../core/canvas';
import type { FieldBinding } from '../core/binding';
import type { Density } from './scalar-base';
import { installLabelAnchors, type FieldAnchors } from '../core/anchors';

/** Unscaled pip geometry. Travel is derived so the pip always ends flush. */
const TRACK_W = 26;
const TRACK_H = 14;
const PIP = 10;
const INSET = 2;

/**
 * Velocity-to-squash gain. The pop tier peaks near 47 normalized units/second,
 * so this tops out around 0.28 -- a visible stretch along travel, nowhere near
 * the cartoon range where the pip stops reading as round.
 */
const SQUASH_GAIN = 0.006;
const SQUASH_MAX = 0.3;

@customElement('bi-toggle')
export class BiToggle extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: block;
        min-width: 0;
        outline: none;
      }
      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sp-3);
        cursor: pointer;
        user-select: none;
        min-width: 0;
      }
      .track {
        flex: none;
        position: relative;
        width: calc(26px * var(--bi-scale));
        height: calc(14px * var(--bi-scale));
        border: 1px solid var(--well-edge);
        /* Capsule -- see the file header. */
        border-radius: 999px;
        background: var(--well-bg);
        transition: background 120ms linear, border-color 120ms linear,
          box-shadow 120ms linear;
      }
      /* The glass over the tube, above the juice. */
      .track::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: linear-gradient(180deg, var(--glass-top), transparent 60%);
        pointer-events: none;
      }
      /* The bead. A lens, not a dot: lit from above, with its own tiny
       * specular, so it reads as a solid object travelling in the tube. */
      :host([mixed]) .pip { opacity: 0.45; }
      .pip {
        position: absolute;
        z-index: 1;
        top: calc(2px * var(--bi-scale) - 1px);
        left: calc(2px * var(--bi-scale) - 1px);
        width: calc(10px * var(--bi-scale));
        height: calc(10px * var(--bi-scale));
        border-radius: 50%;
        border: var(--bead-border, 0 solid transparent);
        background: var(--bead-bg, radial-gradient(circle at 34% 28%, #b9c2d0, #6b7482 62%, #4a515c));
        /* Transform is set per-frame from the spring; anything CSS-timed here
         * would fight it. */
        transition: background 120ms linear, box-shadow 120ms linear;
        will-change: transform;
      }
      :host([on]) .track {
        background: var(--chip-bg);
        box-shadow: var(--chip-shadow);
        border-color: color-mix(in srgb, var(--juice-hot) 70%, transparent);
      }
      :host([on]) .pip {
        background: var(--bead-on-bg,
          radial-gradient(circle at 34% 28%, #ffffff, var(--juice-hot) 58%, var(--juice)));
        box-shadow: var(--bead-on-shadow, 0 0 calc(5px * var(--bi-scale)) var(--juice-glow));
      }
      :host(:focus-visible) .track {
        outline: 1px solid var(--juice-hot);
        outline-offset: 2px;
      }
      /* The well lights, and the BEAD picks up a rim.
       *
       * The track alone is not enough here: a toggle is 26px wide and its edge
       * is most of a millimetre of hairline, so the bead -- the only solid
       * object in the control, and the thing a click actually moves -- carries
       * the other half. A hard ring rather than a glow, because at 30px a glow
       * is a smudge; this is the same rim-light the knob's cap takes, from the
       * same token. */
      :host(:hover:not([disabled])) .track,
      :host(:focus-visible) .track {
        border-color: var(--hover-edge);
      }
      :host(:hover:not([disabled])) .pip {
        box-shadow: 0 0 0 1px var(--hover-lip);
      }
      :host([on]:hover:not([disabled])) .pip {
        box-shadow: var(--bead-on-shadow, 0 0 calc(5px * var(--bi-scale)) var(--juice-glow)),
          0 0 0 1px var(--hover-lip);
      }

      /* expanded: the whole row becomes the button. */
      :host([density='expanded']) .row {
        border: 1px solid var(--app-tint-4);
        border-radius: var(--app-r-4);
        padding: calc(6px * var(--bi-scale)) calc(9px * var(--bi-scale));
        background: var(--app-bg-color2);
        transition: background 120ms linear, border-color 120ms linear;
      }
      :host([density='expanded'][on]) .row {
        background: linear-gradient(180deg, var(--juice-wash), transparent),
          var(--app-bg-color2);
        border-color: color-mix(in srgb, var(--juice) 60%, transparent);
      }
      /* AFTER the [on] rule, not before: the on-state uses the background
       * shorthand, so an earlier hover rule loses both the colour and the
       * border and an expanded toggle that is switched on stops responding to
       * the pointer entirely. Setting background-color only leaves the on-state
       * gradient in place and tints the ground behind it. */
      :host([density='expanded']:hover:not([disabled])) .row,
      :host([density='expanded']:focus-visible) .row {
        border-color: var(--hover-edge);
        background-color: var(--hover-wash);
      }
      :host([density='compact']) .label { display: none; }
      :host([density='compact']) .row { justify-content: flex-start; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) path = '';
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Reflected so the CSS state lives in one place. */
  @property({ type: Boolean, reflect: true }) on = false;

  @state() private rev = 0;

  /** Normalized pip travel, 0 = off end, 1 = on end. */
  private readonly t = new Spring(0, 'pop', 1e-3);
  private readonly loop = new FrameLoop((dt) => {
    const moving = this.t.tick(dt);
    this.rev++;
    return moving;
  });

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.sync()) ?? null;
    this.sync(true);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.loop.stop();
  }

  private sync(immediate = false): void {
    this.on = (this.binding?.getValue(this.path) ?? 0) >= 0.5;
    const target = this.on ? 1 : 0;
    if (immediate) {
      this.t.snapTo(target);
      this.rev++;
    } else {
      this.t.target = target;
      this.loop.wake();
    }
  }

  private toggle = (): void => {
    if (this.disabled) return;
    // Mixed aligns every target to ON.
    this.binding.setValue(this.path, this.on && !this.hasAttribute('mixed') ? 0 : 1);
    this.sync();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.toggle();
    }
  };

  /**
   * Pip transform: travel from the spring's position, squash from its velocity.
   *
   * The pip stretches ALONG travel and thins across it, conserving apparent
   * area the way a thrown object does. Signed velocity is not used -- a pip
   * moving left stretches leftward and a pip moving right stretches rightward,
   * and both are the same shape.
   */
  private pipStyle(): string {
    const s = this.scaleFactor;
    const travel = (TRACK_W - PIP - INSET * 2) * s;
    const x = (this.hasAttribute('mixed') ? 0.5 : this.t.value) * travel;
    const squash = Math.min(SQUASH_MAX, Math.abs(this.t.velocity) * SQUASH_GAIN);
    return `transform: translateX(${x.toFixed(2)}px) scale(${(1 + squash).toFixed(3)}, ${(
      1 - squash * 0.6
    ).toFixed(3)})`;
  }

  private get scaleFactor(): number {
    return parseFloat(getComputedStyle(this).getPropertyValue('--bi-scale')) || 1;
  }

  render() {
    const spec = this.binding?.spec(this.path);
    if (!spec) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const name = this.label || spec.shortName || spec.name;
    // Multi-target: the targets disagree. The pip sits between, dim -- neither
    // state -- and a click aligns them all to ON.
    const mixed = this.binding.isMixed?.(this.path) ?? false;
    if (mixed !== this.hasAttribute('mixed')) this.toggleAttribute('mixed', mixed);
    return html`
      <div class="row" @click=${this.toggle}>
        ${this.density === 'compact' ? nothing : html`<span class="label">${name}</span>`}
        <div class="track"><div class="pip" style=${this.pipStyle()}></div></div>
      </div>
    `;
  }
}

/** The anchor contract (core/anchors.ts): the label selects, the pip sits beside it. */
installLabelAnchors(BiToggle);
export interface BiToggle extends FieldAnchors {}

declare global {
  interface HTMLElementTagNameMap {
    'bi-toggle': BiToggle;
  }
}
