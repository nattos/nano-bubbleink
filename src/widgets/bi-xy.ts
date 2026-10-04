/**
 * <bi-xy> -- a pad over two parameters, with a picture behind it.
 *
 * The first FieldBinding member nothing implemented -- beginContinuousEditMulti
 * -- was written for this: one gesture, two paths, one undo point. The pad is
 * a square; x runs left to right and y runs BOTTOM to top, because the pad is
 * a plane and up is up.
 *
 * The backdrop is whatever the host wants under the handle: a scatter of
 * points (a manifold's embedding), or nothing. It is drawn once to a canvas
 * and redrawn only when the points change, so a thousand dots cost nothing
 * per frame. Markers are the small lit dots a host puts wherever it likes
 * (a source's satellites); they follow the host, not the pointer.
 *
 * A host with a LIVE picture (a preview the effect itself renders) slots it as
 * `backdrop`: it fills the pad under the dots and the handle and never takes
 * the pointer. `--xy-aspect` shapes the pad (square by default).
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { pipBeside, type FieldAnchors, type AnchorPoint } from '../core/anchors';
import { base, cssVar } from '../theme/base';
import { withAlpha } from '../theme/ramp';
import { PointerDragOp } from '../core/drag';
import { clamp01, fromPos, toPos } from '../core/schema';
import type { FieldBinding, MultiContinuousEditHandle } from '../core/binding';
import type { Density } from './scalar-base';

export interface XyMarker { x: number; y: number; color?: string; label?: string }

@customElement('bi-xy')
export class BiXy extends LitElement implements FieldAnchors {
  static styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; gap: 2px; min-width: 0; outline: none; }
      :host(:focus-visible) .pad { outline: 1px solid var(--juice-hot); outline-offset: 2px; }
      .pad {
        position: relative;
        aspect-ratio: var(--xy-aspect, 1 / 1);
        width: 100%;
        background: var(--well-bg);
        border: 1px solid var(--well-edge);
        box-shadow: var(--well-lip);
        border-radius: var(--app-r-3);
        overflow: hidden;
        cursor: crosshair;
        touch-action: none;
        transition: border-color 90ms linear;
      }
      :host(:hover:not([disabled])) .pad, :host(:focus-visible) .pad { border-color: var(--hover-edge); }
      canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
      ::slotted([slot='backdrop']) {
        position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
      }
      .handle {
        position: absolute;
        width: calc(14px * var(--bi-scale));
        height: calc(14px * var(--bi-scale));
        margin: calc(-7px * var(--bi-scale)) 0 0 calc(-7px * var(--bi-scale));
        border-radius: 50%;
        background: var(--juice);
        border: 2px solid var(--meniscus, #fff);
        box-shadow: 0 0 8px var(--juice-glow);
        pointer-events: none;
      }
      .marker {
        position: absolute;
        width: calc(8px * var(--bi-scale));
        height: calc(8px * var(--bi-scale));
        margin: calc(-4px * var(--bi-scale)) 0 0 calc(-4px * var(--bi-scale));
        border-radius: 50%;
        border: 1px solid var(--well-bg);
        pointer-events: none;
      }
      .spoke { position: absolute; left: 0; top: 0; height: 1px; transform-origin: 0 0; opacity: 0.35; pointer-events: none; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
      :host([density='compact']) .label { display: none; }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) pathX = '';
  @property({ type: String }) pathY = '';
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Points in [0,1]^2, y up. */
  @property({ attribute: false }) backdrop: readonly (readonly [number, number])[] = [];
  @property({ attribute: false }) markers: XyMarker[] = [];

  @state() private rev = 0;
  @query('.pad') private padEl?: HTMLElement;
  @query('canvas') private canvas?: HTMLCanvasElement;

  private unsubscribe: (() => void) | null = null;
  private drag: PointerDragOp | null = null;
  private handle: MultiContinuousEditHandle | null = null;
  private ro: ResizeObserver | null = null;
  private drawn: unknown = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.rev++) ?? null;
    this.ro = new ResizeObserver(() => { this.drawn = null; this.paint(); });
    this.ro.observe(this);
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ro?.disconnect();
    this.drag?.dispose();
  }

  protected updated(): void {
    this.paint();
  }

  private paint(): void {
    const c = this.canvas;
    if (!c) return;
    if (this.drawn === this.backdrop && c.width) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width <= 0) return;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    const dot = cssVar(this, '--plot-grid-major', 'rgba(255,255,255,0.15)');
    g.fillStyle = withAlpha(cssVar(this, '--app-text-color2', '#b3a898'), 0.35) || dot;
    const rad = 1.4 * dpr;
    for (const [x, y] of this.backdrop) {
      g.beginPath();
      g.arc(x * c.width, (1 - y) * c.height, rad, 0, Math.PI * 2);
      g.fill();
    }
    this.drawn = this.backdrop;
  }

  private posAt(e: PointerEvent): [number, number] {
    const r = this.padEl!.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)];
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0) return;
    const sx = this.binding.spec(this.pathX), sy = this.binding.spec(this.pathY);
    if (!sx || !sy || !this.padEl) return;
    e.preventDefault();
    this.focus();
    const [x, y] = this.posAt(e);
    const values = { [this.pathX]: fromPos(sx, x), [this.pathY]: fromPos(sy, y) };
    this.handle = this.binding.beginContinuousEditMulti
      ? this.binding.beginContinuousEditMulti(values) : null;
    if (!this.handle) {
      this.binding.setValue(this.pathX, values[this.pathX]);
      this.binding.setValue(this.pathY, values[this.pathY]);
    }
    this.drag = new PointerDragOp(e, this, {
      callMoveImmediately: true,
      move: (ev) => {
        const [nx, ny] = this.posAt(ev);
        this.handle?.update({ [this.pathX]: fromPos(sx, nx), [this.pathY]: fromPos(sy, ny) });
      },
      accept: () => this.handle?.accept(),
      cancel: () => this.handle?.cancel(),
      complete: () => { this.handle = null; this.drag = null; },
    });
  };

  // ---- The anchor contract (core/anchors.ts). Two fields, one label: the
  // label selects X (the pad's first field); both pips sit beside it, Y's a
  // line lower so the two stay separately grabbable. ----
  anchorPaths(): string[] { return [this.pathX, this.pathY].filter(Boolean); }
  selectionRegion(): Element | null { return this.renderRoot.querySelector('.label'); }
  inputPipAnchor(path?: string): AnchorPoint | null {
    const p = pipBeside(this.selectionRegion(), this);
    return path === this.pathY ? { x: p.x, y: p.y + 10 } : p;
  }
  fullRect(): DOMRect { return this.getBoundingClientRect(); }

  render() {
    const sx = this.binding?.spec(this.pathX), sy = this.binding?.spec(this.pathY);
    if (!sx || !sy) return html`<span class="note caution">no spec: ${this.pathX} / ${this.pathY}</span>`;
    const x = toPos(sx, this.binding.getValue(this.pathX));
    const y = toPos(sy, this.binding.getValue(this.pathY));
    const name = this.label || `${sx.shortName || sx.name} / ${sy.shortName || sy.name}`;
    return html`
      ${this.density === 'compact' ? nothing : html`<span class="label">${name}</span>`}
      <div class="pad" @pointerdown=${this.onPointerDown}>
        <slot name="backdrop"></slot>
        <canvas></canvas>
        ${this.markers.map((m) => {
          const dx = (m.x - x) * 100, dy = ((1 - m.y) - (1 - y)) * 100;
          const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
          return html`
            <div class="spoke" style="left:${(x * 100).toFixed(2)}%;top:${((1 - y) * 100).toFixed(2)}%;width:${len.toFixed(2)}%;transform:rotate(${ang.toFixed(2)}deg);background:${m.color ?? 'var(--juice)'}"></div>
            <div class="marker" title=${m.label ?? ''} style="left:${(m.x * 100).toFixed(2)}%;top:${((1 - m.y) * 100).toFixed(2)}%;background:${m.color ?? 'var(--juice)'}"></div>`;
        })}
        <div class="handle" style="left:${(x * 100).toFixed(2)}%;top:${((1 - y) * 100).toFixed(2)}%"></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'bi-xy': BiXy; }
}
