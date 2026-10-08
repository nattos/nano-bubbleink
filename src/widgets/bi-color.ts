/**
 * <bi-color> -- a colour: three or four channel PARAMETERS, read as one swatch.
 *
 * A colour is not a new kind of value here. The store holds floats, so a
 * colour is `paths` -- R, G, B and optionally A, each an ordinary 0..1
 * parameter a wire or an automation lane can address on its own -- and this
 * control is the picture of them together:
 *
 *   the ROW       label, the swatch (over a checker when there is alpha), the
 *                 hex reading, and a caret.
 *   the SWATCH    opens the platform picker; every drag of the picker is ONE
 *                 gesture across all the channels (beginContinuousEditMulti),
 *                 so a colour change is one undo point, not three.
 *   the CHANNELS  under the caret: one painted <bi-slider> per channel, its
 *                 tube printed with that channel's sweep through the current
 *                 colour, so the thumb sits on the colour it would make. They
 *                 are what give each channel an anchor of its own.
 *
 * The swatch is the reading, so nothing here is juice: colour is the signal.
 */
import { html, css, nothing, unsafeCSS, LitElement, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import type { FieldBinding, MultiContinuousEditHandle } from '../core/binding';
import type { Density } from './scalar-base';
import { installLabelAnchors, type FieldAnchors } from '../core/anchors';
import './bi-slider';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
const CHANNEL = ['R', 'G', 'B', 'A'];
const CHECKER = 'repeating-conic-gradient(var(--app-tint-4) 0 25%, transparent 0 50%) 0 0 / 8px 8px';

@customElement('bi-color')
export class BiColor extends LitElement {
  static styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; gap: var(--sp-2); min-width: 0; }
      .row { display: flex; align-items: center; gap: var(--sp-3); min-width: 0; }
      .row .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .swatch {
        position: relative;
        width: calc(34px * var(--bi-scale));
        height: calc(16px * var(--bi-scale));
        border-radius: var(--app-r-3);
        border: 1px solid var(--well-edge);
        /* The checker stops at the border (which is translucent): a solid well
           under it, never a ring of checker round the color. */
        background: ${unsafeCSS(CHECKER)} padding-box, var(--well-bg);
        cursor: pointer;
        overflow: hidden;
        flex: none;
        transition: border-color 90ms linear;
      }
      .swatch:hover, .swatch:focus-within { border-color: var(--hover-edge); }
      .swatch .ink { position: absolute; inset: 0; }
      .swatch input { position: absolute; inset: 0; opacity: 0; cursor: pointer; border: 0; padding: 0; }
      .hex { color: var(--readout-color, var(--app-text-color1)); font-size: var(--fs-xs); flex: none; }
      .caret {
        all: unset; cursor: pointer; color: var(--app-text-color2); font-size: var(--fs-xs);
        padding: 0 2px; flex: none;
      }
      .caret:hover, .caret:focus-visible { color: var(--app-text-color1); }
      .channels { display: grid; gap: var(--sp-2); padding-left: var(--sp-3); }
      :host([density='compact']) .row .label, :host([density='compact']) .hex { display: none; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  /** The channel parameters, in R G B (A) order. */
  @property({ attribute: false }) paths: string[] = [];
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** The channel sliders are shown. */
  @property({ type: Boolean, reflect: true }) open = false;

  /** The single-field anchor contract reads `path`: the first channel. */
  get path(): string { return this.paths[0] ?? ''; }

  @state() private rev = 0;
  private unsubscribe: (() => void) | null = null;
  private pick: MultiContinuousEditHandle | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.rev++) ?? null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.pick?.accept();
    this.pick = null;
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('binding') && this.isConnected) {
      this.unsubscribe?.();
      const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
      this.unsubscribe = store?.changed?.subscribe(() => this.rev++) ?? null;
    }
  }

  private get rgba(): number[] {
    const v = this.paths.map((p) => clamp01(this.binding?.getValue(p) ?? 0));
    while (v.length < 3) v.push(0);
    return v;
  }

  private css(c: number[], alpha = true): string {
    const [r, g, b] = c.map((x) => Math.round(clamp01(x) * 255));
    return alpha && c.length > 3 ? `rgb(${r} ${g} ${b} / ${clamp01(c[3]).toFixed(3)})` : `rgb(${r} ${g} ${b})`;
  }

  // ---- the picker: one gesture across the channels ----

  private onPick = (e: Event): void => {
    const hex = (e.target as HTMLInputElement).value;
    const vals: Record<string, number> = {};
    for (let i = 0; i < 3 && i < this.paths.length; i++) {
      vals[this.paths[i]] = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    }
    if (this.pick) { this.pick.update(vals); return; }
    // The first move of the picker opens the gesture AT its value, as bi-xy's
    // press does; later moves update it.
    if (this.binding.beginContinuousEditMulti) {
      this.pick = this.binding.beginContinuousEditMulti(vals);
    } else {
      // No multi edit: the channels land as separate writes.
      for (const [p, v] of Object.entries(vals)) this.binding.setValue(p, v);
    }
  };

  private onPickDone = (): void => {
    this.pick?.accept();
    this.pick = null;
  };

  /** A channel's sweep through the current colour: what the thumb would make. */
  private paint(i: number): string {
    const c = this.rgba;
    if (i === 3) {
      // Over the dark well, so transparent reads as the well itself.
      return `linear-gradient(90deg, ${this.css([c[0], c[1], c[2], 0])}, ${this.css([c[0], c[1], c[2], 1])})`;
    }
    const lo = [...c.slice(0, 3)]; lo[i] = 0;
    const hi = [...c.slice(0, 3)]; hi[i] = 1;
    return `linear-gradient(90deg, ${this.css(lo, false)}, ${this.css(hi, false)})`;
  }

  render() {
    void this.rev;
    const c = this.rgba;
    const hex = `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
    const name = this.label || this.binding?.spec(this.path)?.name || this.path;
    return html`
      <div class="row">
        <span class="label">${name}</span>
        <label class="swatch" title="Pick a color">
          <span class="ink" style="background:${this.css(c)}"></span>
          <input type="color" .value=${hex} @input=${this.onPick} @change=${this.onPickDone} />
        </label>
        <span class="hex reading">${hex}${c.length > 3 ? html`<span> ${Math.round(c[3] * 100)}%</span>` : nothing}</span>
        <button class="caret" aria-expanded=${this.open ? 'true' : 'false'}
                title=${this.open ? 'Hide the channels' : 'Show each channel'}
                @click=${() => { this.open = !this.open; }}>${this.open ? '▾' : '▸'}</button>
      </div>
      ${this.open
        ? html`<div class="channels">${this.paths.map((p, i) => html`
            <bi-slider painted .binding=${this.binding} path=${p} label=${CHANNEL[i] ?? p}
                       density=${this.density === 'compact' ? 'compact' : 'normal'}
                       style=${`--track-paint:${this.paint(i)}`}></bi-slider>`)}</div>`
        : nothing}
    `;
  }
}

/** The anchor contract (core/anchors.ts): the label selects, the pip sits beside it. */
installLabelAnchors(BiColor);
export interface BiColor extends FieldAnchors {}

declare global {
  interface HTMLElementTagNameMap {
    'bi-color': BiColor;
  }
}
