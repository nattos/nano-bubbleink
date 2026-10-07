/**
 * <bi-seg> -- the segmented enum control.
 *
 * The default UI for any parameter that declares `choices`. A native <select>
 * hides every option but one behind a click; a segmented bar shows the whole
 * vocabulary at once, which for a small enum is both faster and more
 * informative. The prior art reaches for <select> only when the list is long
 * enough that showing it all would cost more than it gives.
 *
 * The CSS is ported from nanonome_player.ts, which is the only genuinely
 * custom-styled control in any of the prior repos, and it carries a real
 * WKWebView workaround worth keeping:
 *
 *   Block-level flex, and NO overflow:hidden. WebKit can compute an
 *   inline-flex + overflow:hidden bar to zero height and clip the whole
 *   control away. Since the eventual host is a WKWebView, that is not a
 *   hypothetical.
 *
 * The wrap threshold is ported from nano-modules' column-group.ts:225-233 --
 * more than five options, or more than thirty characters of labels, and the bar
 * wraps rather than crushing each segment to unreadability.
 *
 * ---------------------------------------------------------------------------
 * MATERIAL: THE SAME CRYSTAL, FLATTENED
 *
 * The bar is a black trough and the selection is a chip of juice-filled glass
 * sliding in it. The knob's four crystal cues all survive the change of shape,
 * which is what makes the two read as one system:
 *
 *   the trough is near-black, so the chip is the only lit thing;
 *   the chip carries a hard lit edge along its top and a dispersion note on
 *     the shaded bottom-right;
 *   a bright hairline low inside the chip is the far wall of the volume;
 *   the fill is denser at the base than the top, as liquid is.
 *
 * All of it is box-shadow and gradients rather than extra elements -- inset
 * shadows give the far wall and the lit edge for free, and a segmented bar with
 * six children does not want four more per child.
 *
 * RANK, as on the knob: `lead` floods the chip, `counter` empties it and leaves
 * a juice underline. Same inversion, so a secondary bank of enums sits under a
 * primary one without competing.
 *
 * ---------------------------------------------------------------------------
 * THE SLIDING SELECTION, AND WHY ITS TWO EDGES DISAGREE
 *
 * The ported version swapped a background colour on click. That is correct and
 * it is inert: nothing connects the option you left to the option you chose, so
 * the selection appears to teleport and the bar reads as four separate lamps
 * rather than as one switch with four positions.
 *
 * Here the selection is a single pill that travels. It carries no reading, so
 * by the overshoot rule it may bounce, and it does.
 *
 * The detail that makes it feel made rather than tweened: THE LEADING AND
 * TRAILING EDGES RUN ON DIFFERENT SPRINGS. The edge moving into the new segment
 * is fast; the edge leaving the old one lags. The pill therefore stretches
 * across the gap during travel and gathers itself at the end -- the same
 * squash-and-stretch the toggle pip gets from its velocity, expressed as a
 * shape instead of a scale. Both edges are still springs, so interrupting a
 * travel halfway through resolves correctly rather than snapping to a keyframe.
 *
 * ---------------------------------------------------------------------------
 * DRAGGING ACROSS IT
 *
 * A press picks the segment under the pointer, and while it is held the
 * selection follows the pointer to whichever segment is NEAREST -- measured in
 * two dimensions, so a wrapped bar works, and past either end the end segment
 * holds. It is one gesture: a continuous edit (live, one undo point on
 * release, Escape puts the value back), the same contract a slider drag uses.
 * The pill shows the dragged value at once, whether or not the binding can
 * preview it.
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { base } from '../theme/base';
import { Spring, type TierSpec } from '../core/spring';
import { FrameLoop } from '../core/canvas';
import type { ContinuousEditHandle, FieldBinding } from '../core/binding';
import type { Choice } from '../core/schema';
import type { Density } from './scalar-base';
import { installLabelAnchors, type FieldAnchors } from '../core/anchors';

function needsWrap(options: Choice[]): boolean {
  if (options.length > 5) return true;
  return options.reduce((n, o) => n + o.label.length, 0) > 30;
}

/** The pill's two edges. `LEAD` is the `pop` tier; `TRAIL` is deliberately
 * slower and softer, which is what produces the stretch. */
const LEAD: TierSpec = { settle: 0.15, zeta: 0.7, use: 'seg pill leading edge' };
const TRAIL: TierSpec = { settle: 0.26, zeta: 0.85, use: 'seg pill trailing edge' };

@customElement('bi-seg')
export class BiSeg extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        outline: none;
      }
      /* The host became focusable when arrow stepping was added, and a
       * focusable element with no visible focus is worse than an unfocusable
       * one: the keyboard goes somewhere and nothing on screen says where.
       * Same ring as the knob, on the track rather than the host, so it hugs
       * the control instead of the label stacked above it. */
      :host(:focus-visible) .seg {
        outline: 1px solid var(--juice-hot);
        outline-offset: 2px;
        border-radius: var(--app-r-3);
      }
      /* Block-level flex + no overflow:hidden -- see the file header. */
      .seg {
        position: relative;
        display: flex;
        flex-wrap: nowrap;
        border: 1px solid var(--well-edge);
        border-radius: var(--app-r-3);
        /* The well. What it is made of is the skin's business -- see the
         * material contract in theme/tokens.css. */
        background: var(--well-bg);
        box-shadow: var(--well-lip);
        transition: border-color 90ms linear;
      }
      /* Same well-lights rule as the slider, at two levels, because a seg has
       * two hit targets: the CONTAINER says "this strip is live", and the
       * SEGMENT says "and this is the one you would get". Container-only would
       * leave a six-option bar telling you nothing about where the click
       * lands, which is the actual question a pointer is asking here. */
      :host(:hover:not([disabled])) .seg,
      :host(:focus-visible) .seg {
        border-color: var(--hover-edge);
      }
      :host([wrap]) .seg { flex-wrap: wrap; }

      /* The travelling selection, under the labels. */
      /* The chip. One element, four crystal cues, all in box-shadow:
       *   inset 0 1px  -- the lit facet along the top edge
       *   inset 0 -1px -- the far inner wall, seen through the near face
       *   inset 0 -3px (warm) -- the dispersion note on the shaded side
       *   outer glow   -- the bloom the juice throws into the trough
       * The vertical gradient is the liquid: denser at the base than the top. */
      .pill {
        position: absolute;
        border-radius: calc(var(--app-r-3) - 1px);
        background: var(--chip-bg);
        box-shadow: var(--chip-shadow);
        mix-blend-mode: var(--chip-blend);
        pointer-events: none;
        will-change: transform;
      }
      /* Rendered before the first measurement, and while a multi-target edit is
       * mixed. Both mean "there is no one segment to point at", and a pill left
       * at its last position would be pointing at a segment that is not the
       * answer. The class was in the template with no rule behind it, which is
       * the quiet kind of wrong. */
      .pill.hidden { display: none; }
      /* Counter: the chip empties out and the juice retreats to an edge --
       * the same inversion the knob makes between a filled arc and a hairline.
       * See ScalarControl.rank. */
      :host([rank='counter']) .pill {
        background: var(--juice-wash);
        box-shadow: inset 0 -2px 0 var(--juice);
      }
      :host([rank='counter']) button.on { color: var(--juice-hot); font-weight: 600; }

      button {
        position: relative;
        flex: 1 0 auto;
        min-width: calc(34px * var(--bi-scale));
        -webkit-appearance: none;
        appearance: none;
        border: 0;
        border-right: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 0;
        background: transparent;
        color: var(--app-text-color2);
        padding: calc(4px * var(--bi-scale)) calc(9px * var(--bi-scale));
        font: inherit;
        font-size: var(--fs-sm);
        text-transform: uppercase;
        letter-spacing: var(--app-tr-1);
        cursor: pointer;
        white-space: nowrap;
        /* Colour only, and short. Anything positional in this system is
         * spring-driven; this is a discrete state change, not motion. */
        transition: color 90ms linear, background-color 90ms linear;
      }
      button:last-child { border-right: 0; }
      /* A drag in progress: the pointer is captured, so no segment is
       * "hovered" -- the pill alone says where it is. */
      .seg.dragging button:hover:not(.on) { background: transparent; }
      /* Not on the selected segment: a button is positioned and paints AFTER
       * the absolutely-positioned pill, so a background here would cover the
       * selection it is supposed to be sitting on. The selected segment is
       * already unmistakably the target, and it still gets the container edge.
       *
       * The wash is the well's own hover colour, so a segment under the pointer
       * reads as a lit patch of the trough rather than as a new material. */
      button:hover { color: var(--app-text-color1); }
      button:hover:not(.on) { background: var(--hover-wash); }
      /* Dark on bright, not white on bright. The juice is a light saturated
       * colour and white text on it is close to unreadable; near-black reads as
       * ink on a lit chip and is the higher contrast of the two. */
      button.on { color: #06080c; font-weight: 600; }
      /* Multi-target editing: this option is in use by SOME of the selection.
       * A grey wash rather than the accent, because it is not "the" value, and
       * a static one rather than the pill, because the pill means "here". */
      button.partial { background: var(--app-tint-5); color: var(--app-text-color1); }
      /* NO MISREGISTRATION HERE, and the reason is worth keeping.
       *
       * The knob's plates sit slightly out of register and pull square when
       * pressed, which reads as craft. Copying that to the seg chip was a
       * mistake: on the knob the offset is between two plates of ONE printed
       * object, but the seg chip is a highlight whose whole job is to coincide
       * with a label. Offset by the same 1px it does not read as registration,
       * it reads as a misaligned highlight -- and it jumped on click, because
       * :host(:active) snapped it square instantly with no motion at all.
       *
       * The rule: misregistration is legible only where the offset plates form
       * one object. Where one plate points at another, it is just wrong.
       */

      :host([disabled]) { opacity: 0.42; pointer-events: none; }
      :host([density='compact']) .label { display: none; }
      :host([density='compact']) button {
        padding: calc(2px * var(--bi-scale)) calc(6px * var(--bi-scale));
        font-size: var(--fs-xs);
        min-width: calc(24px * var(--bi-scale));
      }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) path = '';
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  /** See ScalarControl.rank -- the same counterpoint, on a flat control. */
  @property({ type: String, reflect: true }) rank: 'lead' | 'counter' = 'lead';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) wrap = false;

  @state() private rev = 0;
  @state() private measured = false;
  /** One row did not fit the width it was given: wrap, until the width comes
   * back to `natural` (the one-row width measured when it overflowed). */
  @state() private overflowWrap = false;
  private natural = 0;

  @query('.seg') private segEl?: HTMLElement;

  private readonly left = new Spring(0, LEAD, 0.05);
  private readonly right = new Spring(0, LEAD, 0.05);
  private readonly top = new Spring(0, LEAD, 0.05);
  private height = 0;

  private readonly loop = new FrameLoop((dt) => {
    const a = this.left.tick(dt);
    const b = this.right.tick(dt);
    const c = this.top.tick(dt);
    this.rev++;
    return a || b || c;
  });

  private unsubscribe: (() => void) | null = null;
  private ro: ResizeObserver | null = null;

  /** A press held on the bar: the value it started from, the one under the
   * pointer, and the edit (opened once the value first moves). */
  private drag: { pointer: number; start: number; value: number; edit: ContinuousEditHandle | null } | null = null;
  /** The dragged value, shown before (and whether or not) the binding has it. */
  @state() private dragValue: number | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.rev++) ?? null;
    this.ro = new ResizeObserver(() => { this.fitRow(); this.placePill(true); });
    this.ro.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ro?.disconnect();
    this.ro = null;
    this.loop.stop();
    this.endDrag(false);
  }

  /**
   * Re-place the pill after every render.
   *
   * This has to be an updated() hook and not a call inside pick(): the pill is
   * measured from the LAID-OUT button that carries `.on`, and at pick() time
   * that class is still on the old segment. Anything that changes the selection
   * -- a click, an arrow key, the store changing under us, a schema swap -- ends
   * in a render, so hooking the render covers all four with one call and cannot
   * be skipped by a path that forgets it. (It was, once: the hover pass removed
   * this hook and the selection stopped following the value, silently, because
   * a stale pill is a plausible-looking pill.)
   */
  /**
   * Wrap when one row does not fit. The option count and label length decide
   * up front (needsWrap); this catches the rest -- a three-way enum in half a
   * two-column inspector -- by measuring, and unwraps once the width returns.
   */
  private fitRow(): void {
    const seg = this.segEl;
    if (!seg) return;
    if (!this.overflowWrap) {
      if (seg.scrollWidth > seg.clientWidth + 1) {
        this.natural = seg.scrollWidth;
        this.overflowWrap = true;
      }
    } else if (seg.clientWidth >= this.natural) {
      this.overflowWrap = false;
    }
  }

  protected updated(changed: PropertyValues): void {
    if (!this.wrap) this.fitRow();
    // First placement must not animate: a pill springing in from the left edge
    // on first paint reads as "the value just changed", which it did not.
    this.placePill(!this.measured || changed.has('binding') || changed.has('path'));
  }

  private get choices(): Choice[] {
    return this.binding?.spec(this.path)?.choices ?? [];
  }

  /**
   * Arrow-key stepping.
   *
   * Added because listing this control's gestures was the first time anyone
   * asked what its keyboard idiom WAS, and it had none -- the
   * segments are plain buttons and the host was not focusable, so a seg was the
   * only control in the family a keyboard could not reach. That is not an
   * accessibility feature so much as a missing half of the control; every
   * sibling already has an arrow/typing path and this one was simply skipped.
   *
   * It CLAMPS rather than wrapping. An enum's ends are meaningful -- these are
   * banks and modes, not a carousel -- and a keyboard user holding Right should
   * arrive at the last option and stay there rather than silently reappearing
   * at the first.
   */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.drag) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.endDrag(false); }
      return;
    }
    const opts = this.choices;
    if (!opts.length) return;
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
      : 0;
    if (!dir) return;
    e.preventDefault();
    const v = this.binding.getValue(this.path);
    const i = opts.findIndex((o) => o.value === v);
    const next = Math.min(Math.max((i < 0 ? 0 : i) + dir, 0), opts.length - 1);
    if (next !== i) this.pick(opts[next].value);
  };

  private pick(v: number): void {
    // A one-shot write, not a continuous edit: an enum has no intermediate
    // states worth previewing, and each pick is its own undo point.
    this.binding.setValue(this.path, v);
  }

  /** The choice whose segment is nearest the point (inside one: that one). */
  private choiceAt(x: number, y: number): number | undefined {
    const opts = this.choices;
    const buttons = [...(this.segEl?.querySelectorAll<HTMLElement>('button') ?? [])];
    let best = -1;
    let bestD = Infinity;
    buttons.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best >= 0 ? opts[best]?.value : undefined;
  }

  private onSegDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.disabled || this.drag) return;
    const v = this.choiceAt(e.clientX, e.clientY);
    if (v === undefined) return;
    const mixed = this.binding.isMixed?.(this.path) ?? false;
    // Mixed: no one value to start from -- any pick is a change.
    const start = mixed ? NaN : Math.round(this.binding.getValue(this.path));
    this.drag = { pointer: e.pointerId, start, value: start, edit: null };
    try { this.segEl?.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    // The release ends it wherever it lands -- even if something on the way
    // down stops the event before it reaches the captured bar.
    window.addEventListener('pointerup', this.onSegUp, true);
    window.addEventListener('pointercancel', this.onSegUp, true);
    this.dragTo(v);
  };

  private onSegMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    const v = this.choiceAt(e.clientX, e.clientY);
    if (v !== undefined) this.dragTo(v);
  };

  private onSegUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    this.endDrag(e.type === 'pointerup');
  };

  private dragTo(v: number): void {
    const d = this.drag!;
    if (v === d.value) return;
    d.value = v;
    this.dragValue = v;
    if (d.edit) d.edit.update(v);
    else d.edit = this.binding.beginContinuousEdit(this.path, v);
  }

  /** Release (commit) or cancel: back where it started is no edit at all. */
  private endDrag(commit: boolean): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dragValue = null;
    window.removeEventListener('pointerup', this.onSegUp, true);
    window.removeEventListener('pointercancel', this.onSegUp, true);
    try { if (this.segEl?.hasPointerCapture(d.pointer)) this.segEl.releasePointerCapture(d.pointer); } catch { /* gone */ }
    if (!d.edit) return;
    if (commit && d.value !== d.start) d.edit.accept();
    else d.edit.cancel();
  }

  /**
   * Move the pill onto the selected button.
   *
   * Measured from laid-out geometry rather than computed from index and width,
   * because segments are `flex: 1 0 auto` over labels of different lengths and
   * are therefore NOT equal width -- and because when the bar wraps, position
   * is genuinely two-dimensional.
   */
  private placePill(immediate = false): void {
    const seg = this.segEl;
    if (!seg) return;
    const on = seg.querySelector<HTMLElement>('button.on');
    if (!on) return;

    const l = on.offsetLeft;
    const r = on.offsetLeft + on.offsetWidth;
    const t = on.offsetTop;
    this.height = on.offsetHeight;

    if (immediate) {
      this.left.snapTo(l);
      this.right.snapTo(r);
      this.top.snapTo(t);
      this.measured = true;
      this.rev++;
      return;
    }
    if (l === this.left.target && r === this.right.target && t === this.top.target) return;

    // Whichever edge is moving INTO new territory leads; the other lags.
    const goingRight = l > this.left.target;
    this.left.setTier(goingRight ? TRAIL : LEAD);
    this.right.setTier(goingRight ? LEAD : TRAIL);

    this.left.target = l;
    this.right.target = r;
    this.top.target = t;
    this.loop.wake();
  }

  render() {
    const spec = this.binding?.spec(this.path);
    if (!spec) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const opts = this.choices;
    if (!opts.length) return html`<span class="note caution">no choices: ${this.path}</span>`;

    // Reflected so the attribute selector can drive the wrap, and computed
    // rather than authored so a schema change cannot leave it stale.
    const shouldWrap = needsWrap(opts) || this.overflowWrap;
    if (shouldWrap !== this.wrap) this.wrap = shouldWrap;

    const dragging = this.dragValue !== null;
    const current = dragging ? this.dragValue! : Math.round(this.binding.getValue(this.path));
    const mixed = !dragging && (this.binding.isMixed?.(this.path) ?? false);
    // Mixed: every choice a target holds is marked, none is "the" value.
    const inUse = mixed ? this.binding.inUseValues?.(this.path) : undefined;
    const name = this.label || spec.shortName || spec.name;

    const pill = `left: ${this.left.value.toFixed(2)}px; top: ${this.top.value.toFixed(2)}px;` +
      ` width: ${Math.max(0, this.right.value - this.left.value).toFixed(2)}px;` +
      ` height: ${this.height}px`;

    return html`
      ${this.density === 'compact' ? nothing : html`<span class="label">${name}</span>`}
      <div class="seg ${dragging ? 'dragging' : ''}" role="group"
        @pointerdown=${this.onSegDown} @pointermove=${this.onSegMove}
        @pointerup=${this.onSegUp} @pointercancel=${this.onSegUp} @lostpointercapture=${this.onSegUp}>
        <div class="pill ${this.measured && !mixed ? '' : 'hidden'}" style=${pill}></div>
        ${opts.map(
          (o) => html`<button data-choice=${o.label}
            class=${mixed ? (!inUse || inUse.includes(o.value) ? 'partial' : '') : o.value === current ? 'on' : ''}
            ?disabled=${this.disabled}
            @click=${(e: MouseEvent) => { if (e.detail === 0) this.pick(o.value); }}
          >${o.label}</button>`,
        )}
      </div>
    `;
  }
}

/** The anchor contract (core/anchors.ts): the label selects, the pip sits beside it. */
installLabelAnchors(BiSeg);
export interface BiSeg extends FieldAnchors {}

declare global {
  interface HTMLElementTagNameMap {
    'bi-seg': BiSeg;
  }
}
