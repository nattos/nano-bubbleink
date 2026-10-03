/**
 * <bi-grid> -- a segmented selector with rows, for an enum too big for a bar.
 *
 * The seg shows a small vocabulary at once; past a dozen options it wraps into
 * something that is neither a bar nor a list. This is the honest shape for
 * fifty: a grid of cells, `cols` wide, every option visible, the selection a
 * lit cell. Two things it does that a seg does not:
 *
 *   DRAG SELECTS. Pointer down picks the cell under the pointer and dragging
 *   across the grid keeps picking, so a bank of sounds can be auditioned by
 *   sweeping a finger over it. The whole sweep is ONE continuous edit -- one
 *   undo point, one host gesture -- because a sweep is one decision that
 *   happened to visit forty cells on the way.
 *
 *   GROUPS. `groups` names the values that begin a run (the fits a set of
 *   paths belong to); the grid opens a gap before each, so the eye reads the
 *   structure without a label per group. `marks` puts a glyph on a cell --
 *   the ear's star.
 *
 * Options come from the spec's `choices`, as on the seg; a host that learns
 * its vocabulary late (a payload it loads) fills them in and the grid follows.
 *
 *   MARKERS (2026-09-20). `markers` are other parameters over the same
 *   vocabulary, each drawn as a lettered handle on the cell its value names
 *   and dragged onto another cell -- the vertices of the cycle synth's
 *   triangle. With two or more, the edges between them are drawn in order
 *   and closed, and `cursor` puts a dot part-way along one edge (where a
 *   scan is). The handles are the only part of the overlay that takes the
 *   pointer, so the grid's own drag-select is what it was everywhere else.
 */
import { LitElement, html, svg, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import { PointerDragOp } from '../core/drag';
import type { ContinuousEditHandle, FieldBinding } from '../core/binding';
import type { Choice } from '../core/schema';
import type { Density } from './scalar-base';

/** A marker on a cell: a bound parameter's value, drawn as a handle. */
export interface GridMarker { path: string; label: string; color?: string; }
/** A dot `t` of the way along the edge from marker `from` to marker `to`. */
export interface GridCursor { from: number; to: number; t: number; }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

@customElement('bi-grid')
export class BiGrid extends LitElement {
  static styles = [
    base,
    css`
      :host { display: flex; flex-direction: column; gap: 2px; min-width: 0; outline: none; }
      :host(:focus-visible) .grid { outline: 1px solid var(--juice-hot); outline-offset: 2px; }
      .grid {
        position: relative;
        display: grid;
        gap: 2px;
        padding: 3px;
        border: 1px solid var(--well-edge);
        border-radius: var(--app-r-3);
        background: var(--well-bg);
        box-shadow: var(--well-lip);
        touch-action: none;
        user-select: none;
        transition: border-color 90ms linear;
      }
      :host(:hover:not([disabled])) .grid, :host(:focus-visible) .grid { border-color: var(--hover-edge); }
      .cell {
        position: relative;
        min-width: 0;
        height: calc(30px * var(--bi-scale));
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border-radius: calc(var(--app-r-3) - 2px);
        color: var(--app-text-color2);
        font-size: calc(var(--fs-xs) * 0.95);
        text-transform: uppercase;
        letter-spacing: 0;
        white-space: nowrap;
        overflow: hidden;
        cursor: pointer;
        transition: color 90ms linear, background-color 90ms linear;
      }
      /* The gap before a group: the cell steps in from its column's left
       * edge, and the grid's own gap shows through as a seam. */
      .cell.group { border-left: 2px solid var(--app-border-color); }
      .cell:hover:not(.on) { background: var(--hover-wash); color: var(--app-text-color1); }
      .cell.on {
        background: var(--chip-bg);
        box-shadow: var(--chip-shadow);
        mix-blend-mode: var(--chip-blend);
        color: #06080c;
        font-weight: 600;
      }
      .cell > span { max-width: 100%; padding: 0 2px; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; }
      .mark { position: absolute; top: 0; right: 3px; font-size: var(--fs-xs); opacity: 0.8; }
      .cell.on .mark { color: #06080c; }
      .sub { font-size: calc(var(--fs-xs) * 0.78); opacity: 0.65; text-transform: none; letter-spacing: 0; }
      .overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
      .overlay .edges { fill: none; stroke: var(--app-text-color1); stroke-width: 1.5; stroke-opacity: 0.55; stroke-linejoin: round; }
      .overlay .cursor { fill: var(--app-text-color1); stroke: #06080c; stroke-width: 1; }
      .overlay .handle { pointer-events: auto; cursor: grab; }
      .overlay .handle.dragging { cursor: grabbing; }
      .overlay .handle circle { stroke: #06080c; stroke-width: 1.5; }
      .overlay .handle text { font: 700 10px var(--app-mono, ui-monospace, monospace); fill: #06080c; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
      :host([density='compact']) .cell { height: calc(20px * var(--bi-scale)); }
      :host([density='compact']) .label, :host([density='compact']) .sub { display: none; }
      :host([density='expanded']) .cell { height: calc(40px * var(--bi-scale)); }
    `,
  ];

  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) path = '';
  @property({ type: String }) label = '';
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Number }) cols = 8;
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** A glyph per value: the ear's mark on a cell. */
  @property({ attribute: false }) marks: Record<number, string> = {};
  /** A second, smaller line per value. */
  @property({ attribute: false }) subs: Record<number, string> = {};
  /** A title (hover text) per value. */
  @property({ attribute: false }) titles: Record<number, string> = {};
  /** Values that begin a group; the cell before each gets a seam. */
  @property({ attribute: false }) groups: number[] = [];
  /** Handles over cells, one bound parameter each; edges between them. */
  @property({ attribute: false }) markers: GridMarker[] = [];
  /** A dot on the edge between two markers. */
  @property({ attribute: false }) cursor: GridCursor | null = null;

  @state() private rev = 0;
  @state() private geomRev = 0;
  @state() private dragging = '';

  private unsubscribe: (() => void) | null = null;
  private drag: PointerDragOp | null = null;
  private handle: ContinuousEditHandle | null = null;
  private last = NaN;
  // the cells' boxes in the grid's own pixels, for the overlay
  private boxes = new Map<number, [number, number, number, number]>();
  private geomKey = '';
  private ro: ResizeObserver | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.rev++) ?? null;
    if (typeof ResizeObserver !== 'undefined') this.ro = new ResizeObserver(() => this.measure());
  }
  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.drag?.dispose();
    this.ro?.disconnect();
  }

  protected updated(): void {
    const grid = this.shadowRoot?.querySelector<HTMLElement>('.grid');
    if (grid && this.ro && !(grid as HTMLElement & { _observed?: boolean })._observed) {
      (grid as HTMLElement & { _observed?: boolean })._observed = true;
      this.ro.observe(grid);
    }
    if (this.markers.length) this.measure();
  }

  /** Where each cell sits, measured; a change re-renders the overlay. */
  private measure(): void {
    const grid = this.shadowRoot?.querySelector<HTMLElement>('.grid');
    if (!grid || !this.markers.length) return;
    const g = grid.getBoundingClientRect();
    const m = new Map<number, [number, number, number, number]>();
    grid.querySelectorAll<HTMLElement>('.cell').forEach((c) => {
      const r = c.getBoundingClientRect();
      m.set(Number(c.dataset.value), [r.left - g.left - grid.clientLeft, r.top - g.top - grid.clientTop, r.width, r.height]);
    });
    const key = [...m.entries()].map(([v, b]) => `${v}:${b.map((x) => x.toFixed(1)).join(',')}`).join(' ');
    if (key === this.geomKey) return;
    this.geomKey = key;
    this.boxes = m;
    this.geomRev++;
  }

  /** The cell nearest a client-space point, by the measured boxes. */
  private cellNear(x: number, y: number): number | null {
    const grid = this.shadowRoot?.querySelector<HTMLElement>('.grid');
    if (!grid) return null;
    const g = grid.getBoundingClientRect();
    const px = x - g.left - grid.clientLeft, py = y - g.top - grid.clientTop;
    let best: number | null = null, bd = Infinity;
    for (const [v, [bx, by, w, h]] of this.boxes) {
      const dx = Math.max(bx - px, 0, px - (bx + w)), dy = Math.max(by - py, 0, py - (by + h));
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  private onHandleDown(e: PointerEvent, m: GridMarker): void {
    if (this.disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.focus();
    const v0 = Math.round(this.binding.getValue(m.path));
    let last = v0;
    const handle = this.binding.beginContinuousEdit(m.path, v0);
    this.handle = handle;
    this.dragging = m.path;
    this.drag = new PointerDragOp(e, this, {
      callMoveImmediately: true,
      move: (ev) => {
        const nv = this.cellNear(ev.clientX, ev.clientY);
        if (nv === null || nv === last) return;
        last = nv;
        handle.update(nv);
      },
      accept: () => handle.accept(),
      cancel: () => handle.cancel(),
      complete: () => { this.handle = null; this.drag = null; this.dragging = ''; },
    });
  }

  private overlay() {
    if (!this.markers.length) return nothing;
    const pts: { m: GridMarker; v: number; x: number; y: number }[] = [];
    for (const m of this.markers) {
      const v = Math.round(this.binding.getValue(m.path));
      const b = this.boxes.get(v);
      if (!b) return nothing;   // not measured yet; updated() will
      pts.push({ m, v, x: b[0] + b[2] / 2, y: b[1] + b[3] / 2 });
    }
    // handles on one cell fan out, so each stays visible and grabbable
    const seen = new Map<number, number>();
    for (const p of pts) { const k = seen.get(p.v) ?? 0; seen.set(p.v, k + 1); p.x += k * 11; }
    const edges = pts.length >= 2
      ? svg`<polygon class="edges" points=${pts.map((p) => `${p.x},${p.y}`).join(' ')}></polygon>` : nothing;
    const c = this.cursor;
    const a = c ? pts[c.from] : undefined, b = c ? pts[c.to] : undefined;
    const dot = c && a && b
      ? svg`<circle class="cursor" cx=${a.x + (b.x - a.x) * clamp01(c.t)} cy=${a.y + (b.y - a.y) * clamp01(c.t)} r="3.5"></circle>`
      : nothing;
    const handles = pts.map((p) => svg`<g class="handle ${this.dragging === p.m.path ? 'dragging' : ''}"
        transform="translate(${p.x} ${p.y})" @pointerdown=${(e: PointerEvent) => this.onHandleDown(e, p.m)}>
      <circle r="8" fill=${p.m.color ?? 'var(--juice-hot)'}></circle><text>${p.m.label}</text></g>`);
    return html`<svg class="overlay" data-rev=${this.geomRev}>${edges}${dot}${handles}</svg>`;
  }

  private get choices(): Choice[] {
    return this.binding?.spec(this.path)?.choices ?? [];
  }

  private valueAt(e: PointerEvent): number | null {
    const el = this.shadowRoot?.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest<HTMLElement>('.cell');
    if (!cell || !cell.dataset.value) return null;
    return Number(cell.dataset.value);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.disabled || e.button !== 0) return;
    const v = this.valueAt(e);
    if (v === null) return;
    e.preventDefault();
    this.focus();
    this.last = v;
    this.handle = this.binding.beginContinuousEdit(this.path, v);
    this.drag = new PointerDragOp(e, this, {
      callMoveImmediately: true,
      move: (ev) => {
        const nv = this.valueAt(ev);
        if (nv === null || nv === this.last) return;
        this.last = nv;
        this.handle?.update(nv);
      },
      accept: () => this.handle?.accept(),
      cancel: () => this.handle?.cancel(),
      complete: () => { this.handle = null; this.drag = null; },
    });
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const opts = this.choices;
    if (!opts.length) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowDown' ? this.cols : e.key === 'ArrowUp' ? -this.cols : 0;
    if (!step) return;
    e.preventDefault();
    const v = Math.round(this.binding.getValue(this.path));
    const i = opts.findIndex((o) => o.value === v);
    const next = Math.min(Math.max((i < 0 ? 0 : i) + step, 0), opts.length - 1);
    if (next !== i) this.binding.setValue(this.path, opts[next].value);
  };

  render() {
    const spec = this.binding?.spec(this.path);
    if (!spec) return html`<span class="note caution">no spec: ${this.path}</span>`;
    const opts = this.choices;
    if (!opts.length) return html`<span class="note caution">no choices: ${this.path}</span>`;
    const current = Math.round(this.binding.getValue(this.path));
    const name = this.label || spec.shortName || spec.name;
    const groups = new Set(this.groups);
    return html`
      ${this.density === 'compact' ? nothing : html`<span class="label">${name}</span>`}
      <div class="grid" role="listbox" style="grid-template-columns: repeat(${this.cols}, minmax(0, 1fr))"
           @pointerdown=${this.onPointerDown}>
        ${opts.map((o) => html`<div class="cell ${o.value === current ? 'on' : ''} ${groups.has(o.value) ? 'group' : ''}"
            data-value=${o.value} title=${this.titles[o.value] ?? o.label} role="option" aria-selected=${o.value === current}>
          <span>${o.label}</span>
          ${this.subs[o.value] ? html`<span class="sub">${this.subs[o.value]}</span>` : nothing}
          ${this.marks[o.value] ? html`<span class="mark">${this.marks[o.value]}</span>` : nothing}
        </div>`)}
        ${this.overlay()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { 'bi-grid': BiGrid; }
}
