/**
 * <bi-trigger> -- the momentary button. Writes 1 while held, 0 when released.
 *
 * ---------------------------------------------------------------------------
 * THE BUG IT FIXES, WHICH IS NOT A UI BUG
 *
 * The ported `field-trigger` sets 1 on mousedown and 0 on mouseup, and that is
 * correct in a UI whose consumer is JavaScript. Ours is an audio engine, which
 * does not see a parameter -- it samples one, once per block.
 *
 *   A fast tap is about 40 ms of contact.
 *   One 2048-frame block at 44.1 kHz is 46 ms.
 *
 * So a tap can begin and end entirely between two samples of the parameter and
 * the engine never sees it. Not rarely: a deliberate, sharp, confident tap is
 * the SHORTEST one, so the failure lands preferentially on the user who is
 * doing it right, and it is intermittent, which is the worst way for a bug to
 * present. Nobody would ever file it as "the button doesn't work"; they would
 * file it as "sometimes it doesn't work", and it would sit in the tracker.
 *
 * So the parameter is held at 1 for at least MIN_ON_MS regardless of how
 * briefly the pointer was down. This is not smoothing and it is not debouncing
 * -- it does not delay, merge or drop anything. It widens a pulse so that a
 * sampler running at the engine's rate cannot miss it, which is what a
 * one-shot has to do whenever the reader is slower than the writer.
 *
 * The proper fix is a sample-accurate event channel, and it is logged in
 * docs/NANO-UNIT-NEEDS.md. Until there is one, a parameter is what we have and
 * a parameter has to be held long enough to be read.
 *
 * ---------------------------------------------------------------------------
 * TWO STATES THAT ARE NOT THE SAME STATE
 *
 * Which means the widget has two things to show, and showing one of them twice
 * would be a lie in one direction or the other:
 *
 *   THE CAP comes up when your finger does. It is a physical object under a
 *   physical finger and it must never appear stuck.
 *   THE LAMP goes out when the parameter does. It is the engine's state, and
 *   during the tail of a very fast tap the engine is genuinely still on.
 *
 * On any press longer than 60 ms -- which is most of them -- the two coincide
 * and there is nothing to notice. On a fast tap the lamp outlives the cap by a
 * few frames, and that is not a glitch, it is the widget telling the truth
 * about a pulse the user made shorter than the medium can carry.
 *
 * ---------------------------------------------------------------------------
 * WHY POINTER EVENTS AND NOT click
 *
 * The same reason bi-card selects on pointerdown: a captured pointer never
 * produces a click, and a momentary control must respond on the way DOWN
 * anyway. `pointerup` is taken on the WINDOW, because releasing off the button
 * is normal and a button left stuck at 1 because the finger slid off is a note
 * that never ends.
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import { Spring } from '../core/spring';
import { FrameLoop } from '../core/canvas';
import type { FieldBinding } from '../core/binding';
import type { Density } from './scalar-base';
import { installLabelAnchors, type FieldAnchors } from '../core/anchors';

/**
 * Minimum time the parameter stays at 1, in ms.
 *
 * One 2048-frame block at 44.1 kHz is 46.4 ms and 2048 is the largest block
 * size a host is likely to hand us; 60 ms clears it with margin and is still
 * well under the ~120 ms at which a held button starts to feel sticky. It is
 * deliberately a duration and not a block count: the UI does not know the
 * engine's block size and must not pretend to.
 */
const MIN_ON_MS = 60;

@customElement('bi-trigger')
export class BiTrigger extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        align-items: center;
        gap: var(--sp-3);
        min-width: 0;
        outline: none;
      }
      .btn {
        flex: 1 1 auto;
        min-width: 0;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: calc(2px * var(--bi-scale));
        padding: calc(4px * var(--bi-scale)) calc(10px * var(--bi-scale));
        /* CRISP, unlike the toggle's capsule. A switch is a thing that travels
         * and earns its capsule; a trigger is a key you strike, and a key is
         * rectangular in every instrument anyone has ever built. */
        border-radius: var(--app-r-3);
        border: 1px solid var(--well-edge);
        background: var(--app-bg-color2);
        color: var(--app-text-color1);
        font: inherit;
        font-size: var(--fs-sm);
        line-height: 1.15;
        cursor: pointer;
        user-select: none;
        touch-action: none;
        white-space: nowrap;
        /* Position is set per-frame from the press spring; a CSS transition on
         * transform would fight it. Colour is not sprung -- it is discrete
         * state, and the house allows a <=150ms transition for that. */
        transition: border-color 120ms linear, background-color 120ms linear;
        will-change: transform;
      }
      :host(:hover:not([disabled])) .btn,
      :host(:focus-visible) .btn {
        border-color: var(--hover-edge);
        background-color: var(--hover-wash);
      }
      :host(:focus-visible) .btn {
        outline: 1px solid var(--juice-hot);
        outline-offset: 1px;
      }
      /* LIT. The parameter is at 1: the key floods with juice, on the same
       * chip material the toggle's tube and the seg's pill use. */
      :host([on]) .btn {
        background: var(--chip-bg);
        box-shadow: var(--chip-shadow);
        border-color: color-mix(in srgb, var(--juice-hot) 70%, transparent);
        color: var(--app-text-color1);
      }
      .glyph {
        font-size: calc(var(--fs-lg) * 1.05);
        line-height: 1;
      }
      /* compact: the glyph alone, square. A dense strip of these is a pad. */
      :host([density='compact']) .label { display: none; }
      :host([density='compact']) .btn {
        padding: calc(3px * var(--bi-scale));
        min-width: calc(22px * var(--bi-scale));
      }
      /* expanded: the button IS the label, full width, glyph stacked above it
       * -- the prior art's tall mode, which is the one that reads as a pad
       * rather than as a form control. */
      :host([density='expanded']) {
        display: block;
      }
      :host([density='expanded']) .btn {
        width: 100%;
        min-height: calc(40px * var(--bi-scale));
      }
      :host([density='expanded']) > .label { display: none; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
      :host([fill]) { display: block; width: 100%; height: 100%; gap: 0; }
      :host([fill]) > .label { display: none; }
      :host([fill]) .btn { width: 100%; height: 100%; padding: 0; min-width: 0; min-height: 0; box-sizing: border-box; }
      :host([fill]) .glyph { font-size: min(var(--fs-sm), 70cqh); }
      :host([fill]) .btn { container-type: size; }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) path = '';
  @property({ type: String }) label = '';
  /** A mark on the key. One character -- this is a glyph slot, not an icon
   * font, and a family that needs an icon font has stopped being terse.
   * Defaults to the play triangle, so a key is never blank. */
  @property({ type: String }) glyph = '\u25B8';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** The key fills the host's box (a pad on a hardware surface): no padding,
   *  no minimum, no name beside it. */
  @property({ type: Boolean, reflect: true }) fill = false;
  /** The PARAMETER's state, not the pointer's. Reflected so the lamp is CSS. */
  @property({ type: Boolean, reflect: true }) on = false;

  @state() private rev = 0;

  /** The cap's depression, 0 released to 1 struck. Chrome, so it may bounce:
   * `pop`, same tier as the toggle's bead. */
  private readonly depress = new Spring(0, 'pop', 1e-3);
  private readonly loop = new FrameLoop((dt) => {
    const moving = this.depress.tick(dt);
    this.rev++;
    return moving;
  });

  /** When the pointer went down, so a release can be held to MIN_ON_MS. */
  private downAt = 0;
  private releaseTimer = 0;
  private pointerId = -1;

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('keyup', this.onKeyUp);
    // The lamp is the ENGINE's: a parameter set elsewhere (a hardware pad, a
    // wire) lights the key too. Values live outside Lit -- see core/store.ts.
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.follow()) ?? null;
    this.follow();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('binding') || changed.has('path')) this.follow();
  }

  /** Adopt the parameter's state, unless our own press is holding it. */
  private follow(): void {
    if (this.pointerId >= 0 || this.releaseTimer) return;
    const on = (this.binding?.getValue(this.path) ?? 0) >= 0.5;
    if (on !== this.on) this.on = on;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.removeEventListener('keyup', this.onKeyUp);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.detach();
    // A widget torn down mid-press must put the parameter back. A trigger left
    // at 1 by a panel that closed is a stuck note with nothing left on screen
    // to release it.
    if (this.on) this.write(false);
    this.loop.stop();
  }

  // ---- the parameter ----

  private write(on: boolean): void {
    this.on = on;
    this.binding?.setValue(this.path, on ? 1 : 0);
  }

  private strike(): void {
    if (this.disabled) return;
    if (this.releaseTimer) {
      // A re-strike inside the hold window: cancel the pending release rather
      // than letting it turn this press off mid-way.
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
    }
    this.downAt = performance.now();
    this.depress.target = 1;
    this.loop.wake();
    if (!this.on) this.write(true);
  }

  private release(): void {
    // The cap comes up now, whatever the parameter does.
    this.depress.target = 0;
    this.loop.wake();
    const held = performance.now() - this.downAt;
    if (held >= MIN_ON_MS) {
      this.write(false);
      return;
    }
    this.releaseTimer = window.setTimeout(() => {
      this.releaseTimer = 0;
      this.write(false);
    }, MIN_ON_MS - held);
  }

  // ---- pointer ----

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0 || this.pointerId >= 0) return;
    e.preventDefault();
    this.focus();
    this.pointerId = e.pointerId;
    // Capture immediately -- unlike a drag, there is no threshold to wait for
    // and nothing downstream that needs the click event to survive.
    try { this.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    this.strike();
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.detach();
    this.release();
  };

  private detach(): void {
    if (this.pointerId < 0) return;
    try { this.releasePointerCapture(this.pointerId); } catch { /* never held */ }
    this.pointerId = -1;
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }

  // ---- keyboard ----

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    // Autorepeat would re-strike thirty times a second. A held key is one
    // press, exactly as a held pointer is.
    if (e.repeat) return;
    this.strike();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    this.release();
  };

  /**
   * Depression, from the spring.
   *
   * A key travels DOWN and slightly IN -- 1.2px at scale 1, which is a hair
   * under a millimetre on a typical display and enough to read as travel
   * without the button appearing to leave its slot. Explicitly not a scale:
   * shrink-on-touch is the mobile-game idiom this family has ruled out.
   */
  private capStyle(): string {
    const d = this.depress.value;
    if (d < 1e-3) return '';
    return `transform: translateY(${(d * 1.2).toFixed(2)}px)`;
  }

  render() {
    const spec = this.binding?.spec(this.path);
    const name = this.label || spec?.shortName || spec?.name || this.path;
    const glyph = this.glyph
      ? html`<span class="glyph">${this.glyph}</span>` : nothing;
    /*
     * WHAT IS ON THE KEY, per density.
     *
     *   compact   the glyph. The name is carried by the strip around it, and
     *             at this size there is room for one character.
     *   normal    the name on the left, the glyph on the key -- the layout
     *             every other control uses, so a mixed row lines up.
     *   expanded  the key IS the label: glyph above name, full width. The
     *             prior art's tall mode, and the one that reads as a pad.
     *
     * The ported version put the literal word "Trigger" on the key at normal
     * density, which is the control's TYPE rather than its name or its verb --
     * a row of eight of them says "Trigger" eight times and nothing about what
     * any of them do.
     */
    return html`
      ${this.density === 'normal'
        ? html`<span class="label">${name}</span>` : nothing}
      <div class="btn" style=${this.capStyle()} @pointerdown=${this.onPointerDown}>
        ${glyph}${this.density === 'expanded' ? html`<span>${name}</span>` : nothing}
      </div>
    `;
  }
}

/** The anchor contract (core/anchors.ts): the label selects, the pip sits beside it. */
installLabelAnchors(BiTrigger);
export interface BiTrigger extends FieldAnchors {}

declare global {
  interface HTMLElementTagNameMap {
    'bi-trigger': BiTrigger;
  }
}
