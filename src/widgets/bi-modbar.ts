/**
 * <bi-modbar> -- a parameter and its modulation range as ONE control.
 *
 * The prior art separates "the value" from "how much modulation" into two
 * knobs and a routing page, and the range a modulation actually reaches is
 * something you compute in your head. Here the bar is the range: the
 * destination's own value is the CENTRE (a hard edge, the slider's meniscus),
 * an inner bar shows [centre - width/2, centre + width/2] in the parameter's
 * own position space, and the live modulated value fills from the centre out,
 * the family's neutral-anchored fill (draw/modband.ts).
 *
 * ONE DRAG, TWO AXES. Horizontal moves the centre -- the value, exactly what
 * the slider does. Vertical changes the width: up widens, down narrows, and
 * the pointer never has to leave the bar. Both land through one
 * beginContinuousEditMulti, so a gesture that moved both is one undo point
 * and one host gesture. Shift is fine on both axes.
 *
 * THE THUMB. The centre is a pill in the text's colour, ringed in the well's,
 * standing proud of the tube -- it reads on the empty well, on the range and
 * on the fill alike, and it is there when no modulation is routed, which is
 * when a hairline had nothing around it to be seen against.
 *
 * TARGETS BIGGER THAN THE MARKS. The tube is 14px and the lamp 10px; the
 * pointer lands on a band around each (HIT px above and below the tube, a
 * square around the lamp) that costs no layout -- padding cancelled by a
 * negative margin -- so the control is as easy to hit as it is to see.
 *
 * THE LED. Left of the bar, a lamp in the colour of the channel feeding the
 * modulation -- off, or one of the source's channels (--app-ch-*). Clicking
 * it steps to the next channel. It is the routing, and it is where you look
 * to see what a control is listening to.
 *
 * SOURCES IN GROUPS (2026-09-25, the cycle synth's four generators). With
 * `groupSize` set, the channel param counts off first and then `groupSize`
 * channels a source, source by source (1 + groupSize g + c), and `group` is
 * the source the panel is showing. A lamp on that source is filled, as
 * ever, and clicking steps through its channels and back to off; a lamp on
 * any other source is only a dashed ring in its channel's colour -- routed,
 * but not to what is in front of you -- and clicking it takes the control
 * to the shown source's first channel, where it fills.
 *
 * The three parameters are `path`, `path + '.mod.width'` and `path +
 * '.mod.ch'` unless told otherwise; the channel param's choices are the
 * channel names, in order, off first.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { base } from '../theme/base';
import { formatNumber, unitOf } from '../core/format';
import { PointerDragOp } from '../core/drag';
import { modBand } from '../draw/modband';
import { modRange } from '../core/modrange';
import { clamp01, fromPos, toPos, type ParamSpec } from '../core/schema';
import type { FieldBinding, ModState, MultiContinuousEditHandle } from '../core/binding';
import type { Density } from './scalar-base';

/** Vertical travel, in px, for the whole width range. */
const WIDTH_PX = 120;
const FINE = 0.1;

@customElement('bi-modbar')
export class BiModbar extends LitElement {
  static styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; gap: 2px; min-width: calc(80px * var(--bi-scale)); outline: none; }
      :host(:focus-visible) .track { outline: 1px solid var(--juice-hot); outline-offset: 2px; }
      .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); min-width: 0; }
      .readout { display: flex; align-items: baseline; gap: 3px; flex: none; }
      .readout .value { color: var(--readout-color, var(--juice-hot)); }
      .row { display: flex; align-items: center; gap: calc(2px * var(--bi-scale)); }
      /* The lamp's hit square: 22px around a 10px bead. */
      .led-hit {
        flex: none;
        display: grid;
        place-items: center;
        width: calc(22px * var(--bi-scale));
        height: calc(22px * var(--bi-scale));
        margin: calc(-6px * var(--bi-scale)) 0 calc(-6px * var(--bi-scale)) calc(-6px * var(--bi-scale));
        padding: 0;
        border: none;
        background: none;
        cursor: pointer;
      }
      .led-hit:hover .led { border-color: var(--hover-edge); }
      /* The tube's hit band. */
      .hit {
        position: relative;
        flex: 1;
        /* less above than below: above is the label, and a press there
         * should not land on the tube */
        padding: calc(0.6 * var(--hit)) 0 var(--hit);
        margin: calc(-0.6 * var(--hit)) 0 calc(-1 * var(--hit));
        cursor: move;
        touch-action: none;
        --hit: calc(8px * var(--bi-scale));
      }
      .rail { position: relative; }
      /* The lamp. A bead in the channel's colour; off is the text's dimmest
       * grey, so a routed control is the lit one at a glance. */
      /* routed to a source the panel is not showing: a dashed ring */
      .led.away {
        background: transparent;
        border: 1.5px dashed var(--led, var(--app-ch-off));
        box-shadow: none;
      }
      .led {
        flex: none;
        width: calc(10px * var(--bi-scale));
        height: calc(10px * var(--bi-scale));
        border-radius: 50%;
        border: 1.5px solid var(--well-edge);
        background: var(--led, var(--app-ch-off));
        box-shadow: 0 0 calc(6px * var(--bi-scale)) var(--led-glow, transparent);
        transition: background-color 90ms linear, box-shadow 90ms linear;
      }
      .track {
        position: relative;
        height: calc(14px * var(--bi-scale));
        background: var(--well-bg);
        border: 1px solid var(--well-edge);
        box-shadow: var(--well-lip);
        border-radius: 999px;
        overflow: hidden;
        transition: border-color 90ms linear;
      }
      :host(:hover:not([disabled])) .track, :host(:focus-visible) .track { border-color: var(--hover-edge); }
      /* The range: the inner bar, in the channel's colour, translucent. */
      .range { position: absolute; top: 3px; bottom: 3px; border-radius: 999px; background: var(--led, var(--app-ch-off)); opacity: 0.32; }
      /* The live fill: from the centre to where the engine is, full colour. */
      .fill { position: absolute; top: 3px; bottom: 3px; background: var(--led, var(--app-ch-off)); box-shadow: 0 0 4px var(--led, transparent); }
      /* The centre: the value, a pill proud of the tube (THE THUMB). */
      .thumb {
        position: absolute;
        top: calc(-3px * var(--bi-scale));
        bottom: calc(-3px * var(--bi-scale));
        width: calc(6px * var(--bi-scale));
        margin-left: calc(-3px * var(--bi-scale));
        border-radius: 999px;
        background: var(--thumb, var(--app-text-color1));
        box-shadow: 0 0 0 1.5px var(--well-bg), 0 0 5px var(--led-glow, transparent);
        pointer-events: none;
      }
      :host(:hover:not([disabled])) .thumb, :host(:focus-visible) .thumb { background: var(--juice-hot, var(--app-text-color1)); }
      .detent { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--app-text-color3); opacity: 0.6; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
      :host([density='compact']) .track { height: calc(9px * var(--bi-scale)); }
      :host([density='compact']) .hit { --hit: calc(5px * var(--bi-scale)); }
      :host([density='compact']) .head { display: none; }
      :host([density='expanded']) .track { height: calc(20px * var(--bi-scale)); }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) path = '';
  @property({ type: String }) widthPath = '';
  @property({ type: String }) chPath = '';
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** CSS colour per channel index; index 0 is off. Defaults to --app-ch-*.
   *  With `groupSize`, indexed by the channel within its source (1 + c). */
  @property({ attribute: false }) colors: string[] = [];
  /** Channels a source; 0 is one flat list of channels (SOURCES IN GROUPS). */
  @property({ type: Number }) groupSize = 0;
  /** The source the panel shows, with `groupSize`; -1 is none. */
  @property({ type: Number }) group = -1;
  /** Names the sources in the lamp's title, with `groupSize`. */
  @property({ attribute: false }) groupNames: string[] = [];

  @state() private rev = 0;
  @state() private mod: ModState | null = null;
  @query('.track') private trackEl?: HTMLElement;

  private unsubscribe: (() => void) | null = null;
  private drag: PointerDragOp | null = null;
  private handle: MultiContinuousEditHandle | null = null;
  private raf = 0;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.rev++) ?? null;
    const poll = () => {
      const m = this.binding?.getModulation?.(this.path) ?? null;
      if (!sameMod(m, this.mod)) this.mod = m;
      this.raf = requestAnimationFrame(poll);
    };
    this.raf = requestAnimationFrame(poll);
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    cancelAnimationFrame(this.raf);
    this.drag?.dispose();
  }

  private get wPath(): string { return this.widthPath || `${this.path}.mod.width`; }
  private get cPath(): string { return this.chPath || `${this.path}.mod.ch`; }

  private colorFor(ch: number): string {
    const r = this.route(ch);
    if (r) ch = 1 + r.c;
    if (this.colors[ch]) return this.colors[ch];
    const names = ['off', 'main', 'a', 'b', 'c', 'd', 'e', 'f'];
    return `var(--app-ch-${names[ch] ?? 'off'})`;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0) return;
    const spec = this.binding.spec(this.path);
    const r = this.trackEl?.getBoundingClientRect();
    if (!spec || !r || r.width <= 0) return;
    e.preventDefault();
    this.focus();
    const c0 = toPos(spec, this.binding.getValue(this.path));
    const w0 = clamp01(this.binding.getValue(this.wPath));
    this.handle = this.binding.beginContinuousEditMulti
      ? this.binding.beginContinuousEditMulti({ [this.path]: this.binding.getValue(this.path), [this.wPath]: w0 })
      : null;
    let anchor: { dx: number; dy: number; c: number; w: number } | null = null;
    this.drag = new PointerDragOp(e, this, {
      callMoveImmediately: true,
      move: (ev, d) => {
        // fine anchors where shift was pressed, as the slider's does
        if (ev.shiftKey) {
          if (!anchor) anchor = { dx: d[0], dy: d[1], c: c0 + d[0] / r.width, w: w0 - d[1] / WIDTH_PX };
        } else anchor = null;
        const c = anchor ? anchor.c + ((d[0] - anchor.dx) / r.width) * FINE : c0 + d[0] / r.width;
        const w = anchor ? anchor.w - ((d[1] - anchor.dy) / WIDTH_PX) * FINE : w0 - d[1] / WIDTH_PX;
        this.handle?.update({ [this.path]: fromPos(spec, clamp01(c)), [this.wPath]: clamp01(w) });
      },
      accept: () => this.handle?.accept(),
      cancel: () => this.handle?.cancel(),
      complete: () => { this.handle = null; this.drag = null; },
    });
  };

  /** The channel param's value as a source and a channel within it. */
  private route(ch: number): { g: number; c: number } | null {
    if (!(ch > 0) || this.groupSize <= 0) return null;
    return { g: Math.floor((ch - 1) / this.groupSize), c: (ch - 1) % this.groupSize };
  }
  private away(ch: number): boolean {
    const r = this.route(ch);
    return !!r && this.group >= 0 && r.g !== this.group;
  }

  private cycleChannel = (e: Event): void => {
    e.stopPropagation();
    const spec = this.binding.spec(this.cPath);
    if (!spec) return;
    const v = Math.round(this.binding.getValue(this.cPath));
    if (this.groupSize > 0 && this.group >= 0) {
      // off or elsewhere: the shown source's first channel; on it: the next, then off
      const r = this.route(v);
      const first = 1 + this.group * this.groupSize;
      let next = first;
      if (r && r.g === this.group) next = r.c + 1 < this.groupSize ? v + 1 : 0;
      this.binding.setValue(this.cPath, next);
      return;
    }
    const n = spec.choices?.length ?? Math.round(spec.max - spec.min) + 1;
    this.binding.setValue(this.cPath, spec.min + ((v - spec.min + 1) % n));
  };

  private onDblClick = (): void => {
    const spec = this.binding.spec(this.path);
    if (spec) this.binding.setValue(this.path, spec.init);
  };

  render() {
    const s = this.binding?.spec(this.path);
    if (!s) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const value = this.binding.getValue(this.path);
    const width = clamp01(this.binding.getValue(this.wPath));
    const ch = Math.round(this.binding.getValue(this.cPath));
    const color = this.colorFor(ch);
    const range = modRange(s, value, width);
    const c = toPos(s, value);
    const mod = ch > 0 ? this.mod : null;
    const band = mod ? modBand(s, mod) : null;
    const effective = mod ? mod.value : value;
    const name = this.label || s.shortName || s.name;
    const unit = unitOf(s);
    const route = this.route(ch);
    const away = this.away(ch);
    const chName = route && this.groupNames[route.g]
      ? `${this.groupNames[route.g]} · ${this.binding.spec(this.cPath)?.choices?.find((o) => o.value === ch)?.label?.split(' ').pop() ?? route.c}`
      : this.binding.spec(this.cPath)?.choices?.find((o) => o.value === ch)?.label ?? String(ch);
    const hint = away ? `modulation: ${chName} (click: the shown source instead)` : `modulation: ${chName} (click to change)`;
    const pct = (p: number) => (p * 100).toFixed(3);
    return html`
      ${this.density === 'compact' ? nothing : html`
      <div class="head">
        <span class="label">${name}</span>
        <span class="readout">
          <span class="value reading">${formatNumber(s, effective)}</span>
          ${unit ? html`<span class="value units">${unit}</span>` : nothing}
        </span>
      </div>`}
      <div class="row" style="--led: ${color}; --led-glow: ${ch > 0 && !away ? color : 'transparent'}">
        <button class="led-hit" title=${hint} @click=${this.cycleChannel}><span class="led ${away ? 'away' : ''}"></span></button>
        <div class="hit" @pointerdown=${this.onPointerDown} @dblclick=${this.onDblClick}>
          <div class="rail">
            <div class="track">
              ${this.detent(s)}
              ${ch > 0 && width > 0 ? html`<div class="range" style="left:${pct(range.lo)}%;width:${Math.max(0.5, (range.hi - range.lo) * 100).toFixed(3)}%"></div>` : nothing}
              ${band ? html`<div class="fill" style="left:${pct(band.fillLo)}%;width:${Math.max(0.5, band.fillSpan * 100).toFixed(3)}%"></div>` : nothing}
            </div>
            <div class="thumb" style="left:${pct(c)}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  private detent(s: ParamSpec) {
    const t = toPos(s, s.init);
    if (!(t > 0.02 && t < 0.98)) return nothing;
    return html`<div class="detent" style="left:${(t * 100).toFixed(3)}%"></div>`;
  }
}

function sameMod(a: ModState | null, b: ModState | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.value === b.value && a.min === b.min && a.max === b.max && a.neutral === b.neutral;
}

declare global {
  interface HTMLElementTagNameMap { 'bi-modbar': BiModbar; }
}
