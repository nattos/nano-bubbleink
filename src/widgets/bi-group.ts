/**
 * <bi-group> -- the lasso, and the tab strip that grows out of it.
 *
 * The brief asked for "large prominent dials, coupled with smaller ones,
 * visually arranged and grouped / lasso'd", and separately for outlines that
 * "playfully curve and hug", with header labels "budding off". Those are the
 * same widget.
 *
 * WHAT IT IS. One continuous outline around a hero control and its satellites,
 * with the group's name growing out of the top edge on concave fillets rather
 * than sitting above it as a caption. The label is part of the silhouette, so
 * the grouping is carried by shape instead of by a heavier border -- which
 * matters in a plugin window, where every additional box line costs contrast
 * that the data surfaces need.
 *
 * WHY NOT A FIELDSET. A fieldset's notched legend interrupts the border; the
 * eye reads a broken box plus a floating word. A bud reads as one object. The
 * geometry is in draw/bud.ts and the reasoning for it is there.
 *
 * WHY THE OUTLINE IS SVG AND NOT border-radius. Two reasons that both bite.
 * border-radius cannot do a concave joint at all, so the bud is simply not
 * expressible. And even for the plain corners, CSS gives circular ones only,
 * with the curvature discontinuity that makes a rounded box read as drawn
 * rather than moulded. One path solves both and animates as one thing.
 *
 * HERO HUGGING. With `hero` set, the left end's corner radius becomes half the
 * body height, so the outline swells into a capsule around the large dial and
 * tapers back down over the satellites. That single parameter is what makes the
 * outline look like it is hugging its contents rather than containing them.
 *
 * ---------------------------------------------------------------------------
 * TABS, AND WHY THEY ARE THE SAME OBJECT
 *
 * One bud was always a special case of several. `budPanelPath` has taken a LIST
 * of buds since it was written -- the group just never passed more than one --
 * so a tab strip costs geometry it already had. What it needed was a meaning.
 *
 *   A PANEL TAB IS PART OF THE GROUP. It buds off the outline on the same
 *   concave fillets the single label used, so the strip and the body are one
 *   silhouette, and selecting a tab changes what the group CONTAINS.
 *
 *   AN ACTION TAB IS NOT. It is drawn as a detached capsule sitting on the top
 *   edge with a hairline of clearance under it, and it carries a glyph. Nothing
 *   about it merges with the body, because it does not lead anywhere inside the
 *   body -- it pops the subject out into a different view.
 *
 * That distinction is TOPOLOGICAL, not decorative, and it is the point. In a
 * detail hierarchy the difference a user needs to predict before clicking is
 * "does this change what is in front of me, or does it take me somewhere
 * else?", and here the two answers look like two different kinds of object
 * while still being made of the same material. A colour or an icon alone would
 * have to be learned; attached-versus-detached does not.
 *
 * THE SELECTION TRAVELS. The active tab is marked by a juice bar along the base
 * of its bud, on the seg's two-spring idiom -- leading edge fast, trailing edge
 * slow, so the bar stretches across the gap and gathers itself on arrival. It
 * is the same object as the seg's pill doing the same job, so it moves the same
 * way; a second, differently-tuned travel animation for the same idea is how a
 * system stops feeling like one.
 */
import { LitElement, html, svg, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import { budPanelPath, smoothRect, type Bud } from '../draw/bud';
import { Spring, type TierSpec } from '../core/spring';
import { FrameLoop } from '../core/canvas';

/**
 * One entry in the strip.
 *
 * `panel` selects and shows the slot named by `id`; `action` fires an event and
 * never becomes active. Declaration order is render order -- actions are not
 * silently shuffled to the end, because a strip that reorders itself is a strip
 * whose markup no longer tells you what you will see.
 */
export interface GroupTab {
  /** Also the name of the slot this tab shows, for `panel` tabs. */
  id: string;
  label: string;
  kind?: 'panel' | 'action';
  /** Trailing mark on an action. Defaults to the pop-out arrow. */
  glyph?: string;
  disabled?: boolean;
}

/** The active bar's two edges, on the seg's tiers -- same object, same motion.
 * See the note in bi-seg.ts for why the trailing edge is slower. */
const LEAD: TierSpec = { settle: 0.15, zeta: 0.7, use: 'group tab bar leading edge' };
const TRAIL: TierSpec = { settle: 0.26, zeta: 0.85, use: 'group tab bar trailing edge' };

/** Unscaled geometry, in CSS px at --bi-scale: 1. */
const G = {
  /** Bud protrusion. Must clear the label's line box with room for the fillet
   * to curve into; below ~15px the tab pinches and the fillets meet. */
  tabDepth: 17,
  /** Horizontal breathing room inside the bud, either side of the text. Lives
   * in CSS as the button's padding and is measured back, so it is named here
   * only for the reader -- the layout never adds it. */
  tabPadX: 9,
  /** The bud's own outer radius. Kept close to tabDepth/2 so the tab is nearly
   * a capsule -- a sharper tab reads as a folder, which is the filing metaphor
   * this is trying to get away from. */
  tabRadius: 9,
  /** The concave joint. See BudPanelOptions.fillet -- this is the whole effect. */
  fillet: 8,
  /** Valley between adjacent buds. Narrower than two full fillets on purpose:
   * the runs clamp against each other and the joint comes out as one S-curve
   * down to the edge and back up, which is what makes a strip of tabs read as
   * a scalloped edge rather than as separate lumps in a row. */
  tabGap: 12,
  /** Extra clearance either side of a detached action capsule, so the break in
   * the strip is legible as a break. */
  actionGap: 7,
  /** The hairline of daylight under an action capsule. This is the entire
   * signal that it is not part of the group, so it must survive 40%: below
   * about 1.5px it closes up and the action reads as a panel tab. */
  actionClear: 2.5,
  /** Body corner radius, the --app-r-5 rung. */
  radius: 14,
  /** Cap on the hero capsule radius, so a very tall group does not become an
   * oval. */
  heroMax: 44,
  /** Gutter between the hero and the satellites, matched to the flex gap so the
   * shoulder falls in the visual gap rather than across a control. */
  heroGap: 14,
  /** Ceiling on how far the outline draws in over the satellites. Past this the
   * taper stops reading as a shoulder and starts reading as two shapes. */
  taperMax: 20,
  /** Extra protrusion of the tab under the pointer, springing on `pop`. */
  hotLift: 2,
} as const;

interface Placed {
  tab: GroupTab;
  action: boolean;
  /** Along-edge extent in body coordinates. */
  x0: number;
  x1: number;
}

@customElement('bi-group')
export class BiGroup extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: block;
        position: relative;
        /* Top padding clears the bud; the rest is the inner gutter. The bud
         * lives INSIDE the host box rather than overflowing it, so a grid of
         * groups lays out on its actual bounds and nothing clips. */
        padding: calc((17px + 9px) * var(--bi-scale)) calc(13px * var(--bi-scale))
                 calc(13px * var(--bi-scale));
        min-width: 0;
      }
      .outline {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        /* The outline is decoration over which the contents must stay
         * clickable. */
        pointer-events: none;
        overflow: visible;
        display: block;
        /* An absolutely-positioned box paints ABOVE static in-flow siblings
         * regardless of document order, so without these the outline covers
         * the very controls it is drawn around -- and because the surface is
         * usually transparent, the symptom is not "a panel is on top" but
         * "the knobs are gone". */
        z-index: 0;
      }
      /* SVG's initial fill is BLACK, not none. A path meant to be invisible
       * until selected must say so explicitly or it paints a solid blob over
       * the group's background. */
      .tint { fill: transparent; }
      .surface {
        fill: var(--group-fill, transparent);
        stroke: var(--group-stroke, var(--app-outline));
        stroke-width: 1;
      }
      /* The detached capsule. Same stroke as the body so the two read as one
       * material; the daylight underneath is what separates them. */
      .action-shape {
        fill: var(--group-fill, transparent);
        stroke: var(--group-stroke, var(--app-outline));
        stroke-width: 1;
      }
      /* variant=card fills; variant=lasso (the default) is outline only, which
       * is what keeps a panel of eight groups from turning into eight boxes. */
      :host([variant='card']) {
        --group-fill: var(--app-bg-color2);
      }
      :host([variant='well']) {
        --group-fill: var(--app-bg-sunken);
      }
      /* Selection LAYERS over the surface rather than replacing it -- the
       * recorded nano-modules bug where a selected card went 88% transparent. */
      :host([selected]) {
        --group-stroke: var(--accent);
      }
      :host([selected]) .tint {
        fill: color-mix(in srgb, var(--accent) 10%, transparent);
      }

      /* A tab. The button IS the bud: its padding is the bud's horizontal
       * breathing room and its measured width is the bud's width, so there is
       * one number rather than a CSS padding and a layout constant that have to
       * be kept equal by hand. */
      .tab {
        position: absolute;
        z-index: 2;
        top: 0;
        display: inline-flex;
        align-items: center;
        gap: calc(4px * var(--bi-scale));
        height: calc(17px * var(--bi-scale));
        padding: 0 calc(9px * var(--bi-scale));
        border: 0;
        background: transparent;
        border-radius: calc(9px * var(--bi-scale));
        /* Measured for the bud width, so nothing here may depend on the bud it
         * is sizing -- no % widths, no flex growth. */
        font: inherit;
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--app-text-color3);
        text-transform: uppercase;
        letter-spacing: var(--app-tr-3);
        white-space: nowrap;
        cursor: pointer;
        user-select: none;
        outline: none;
        transition: color 90ms linear;
      }
      /* The single-label case, which is not a control and must not pretend to
       * be one. */
      .tab.plain {
        pointer-events: none;
        color: var(--app-text-color2);
        cursor: default;
      }
      .tab:hover,
      .tab:focus-visible {
        color: var(--app-text-color1);
      }
      .tab:focus-visible {
        outline: 1px solid var(--juice-hot);
        outline-offset: 1px;
      }
      .tab.on {
        color: var(--readout-color, var(--juice-hot));
      }
      .tab.action {
        color: var(--app-text-color2);
      }
      .tab[disabled] {
        opacity: 0.42;
        cursor: default;
        pointer-events: none;
      }
      /* OPTICALLY CENTERED, NOT BOX CENTERED.
       *
       * Flex centers each item's line box, and an arrow glyph is not drawn in
       * the same part of its em box that uppercase Latin is -- it sits low, on
       * roughly the x-height band, so box-centering lands its ink on the caps'
       * BASELINE instead of on their middle. Measured against the real font at
       * the real sizes by scanning rendered pixels: the arrow's ink center came
       * out 1.72px below the caps' at 9px, which is the -0.19em below.
       *
       * A per-font constant, which is what optical alignment always is. The
       * direction is stable across the fallback stack even if the magnitude
       * shifts a little, so this is right-ish everywhere and exactly right in
       * JetBrains Mono. */
      .glyph {
        font-size: var(--fs-xs);
        opacity: 0.75;
        transform: translateY(-0.19em);
      }
      :host([selected]) .tab.plain { color: var(--app-text-color1); }

      /* The traveling selection. A bar rather than a pill, because a tab's
       * bud already has the pill's silhouette -- filling it as well would state
       * the same thing twice. It sits on the bud's base, so it reads as the lit
       * seam where the active tab joins the body. */
      .bar {
        position: absolute;
        z-index: 2;
        height: calc(2px * var(--bi-scale));
        background: var(--juice);
        border-radius: 999px;
        pointer-events: none;
        box-shadow: 0 0 var(--chip-glow-size) var(--juice-glow);
      }

      /* The contents. A hero, if present, sits at the left and the panels flow
       * beside it -- the arrangement the outline is shaped around. */
      .body {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        gap: calc(14px * var(--bi-scale));
        min-width: 0;
      }
      .panel {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: calc(10px * var(--bi-scale)) calc(12px * var(--bi-scale));
        min-width: 0;
      }
      /* display:none rather than not rendering the slot: the panel's contents
       * are the HOST's light DOM, and unassigning them would tear down whatever
       * state they hold. Switching tabs must not reset a control. */
      .panel.off { display: none; }
      ::slotted([slot='hero']) { flex: none; }
    `,
  ];

  /** The single-label case, unchanged. Ignored when `tabs` is set. */
  @property({ type: String }) label = '';
  /** The strip. Empty means "use `label`". */
  @property({ attribute: false }) tabs: GroupTab[] = [];
  /** Which panel tab is showing. Reflected so a host can style on it; settable
   * so a host can drive the group instead of letting it drive itself. */
  @property({ type: String, reflect: true }) active = '';
  /** `lasso` (default) draws outline only; `card` and `well` fill. */
  @property({ type: String, reflect: true }) variant: 'lasso' | 'card' | 'well' = 'lasso';
  @property({ type: Boolean, reflect: true }) hero = false;
  @property({ type: Boolean, reflect: true }) selected = false;

  @state() private w = 0;
  @state() private h = 0;
  @state() private rev = 0;
  /** Measured bud widths, one per entry in `strip`. */
  @state() private tabW: number[] = [];
  /** Right edge of the hero, and how much shorter the satellites are than it.
   * Both in CSS px relative to the host box. */
  @state() private heroRight = 0;
  @state() private satDrop = 0;

  /** Hover lift, per tab. One spring each rather than one shared: the strip's
   * whole job is that its entries are separate things, and a shared spring
   * would drop one tab as it lifted the next. */
  private lifts: Spring[] = [];
  /** The active bar's edges. */
  private readonly barL = new Spring(0, LEAD, 0.05);
  private readonly barR = new Spring(0, LEAD, 0.05);
  private barPlaced = false;

  private readonly loop = new FrameLoop((dt) => {
    let moving = false;
    for (const s of this.lifts) moving = s.tick(dt) || moving;
    moving = this.barL.tick(dt) || moving;
    moving = this.barR.tick(dt) || moving;
    this.rev++;
    return moving;
  });

  private ro: ResizeObserver | null = null;
  private observed: Element[] = [];
  private scale = 1;

  connectedCallback(): void {
    super.connectedCallback();
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(this);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ro?.disconnect();
    this.ro = null;
    this.observed = [];
    this.loop.stop();
  }

  protected firstUpdated(): void {
    this.syncTabObservers();
    this.measure();
  }

  /** Keep the ResizeObserver pointed at whatever tabs currently exist, and
   * measure once whenever that set changes. */
  private syncTabObservers(): void {
    const els = [...this.renderRoot.querySelectorAll('.tab')];
    const same = els.length === this.observed.length
      && els.every((e, i) => e === this.observed[i]);
    if (same) return;
    for (const e of this.observed) this.ro?.unobserve(e);
    for (const e of els) this.ro?.observe(e);
    this.observed = els;
    this.measure();
  }

  /**
   * The strip, resolved.
   *
   * `label` is not a second mechanism -- it becomes a one-entry strip that is
   * marked non-interactive, so every downstream calculation has exactly one
   * shape to handle. The alternative is an `if (tabs.length)` in the layout, the
   * measurement, the path builder and the renderer, which is four places for
   * the two cases to drift apart.
   */
  private get strip(): GroupTab[] {
    if (this.tabs.length) return this.tabs;
    return this.label ? [{ id: '', label: this.label }] : [];
  }

  private get interactive(): boolean {
    return this.tabs.length > 0;
  }

  private get panels(): GroupTab[] {
    return this.strip.filter((t) => t.kind !== 'action');
  }

  /** The showing panel. Falls back to the first one rather than showing
   * nothing, so a group with no `active` set is not a blank box. */
  private get activeId(): string {
    const p = this.panels;
    if (!p.length) return '';
    return p.some((t) => t.id === this.active) ? this.active : p[0].id;
  }

  protected updated(changed: PropertyValues): void {
    // A spring per entry, rebuilt only when the count changes -- rebuilding on
    // every render would restart every lift mid-travel.
    if (this.lifts.length !== this.strip.length) {
      this.lifts = this.strip.map(() => new Spring(0, 'pop', 1e-3));
    }
    // OBSERVE THE TABS THEMSELVES, and re-measure the moment the set of them
    // changes.
    //
    // There is a chicken-and-egg here and it bit immediately: on the first
    // render the host's width is still 0, so the strip does not fit, so it is
    // not rendered, so firstUpdated's measurement finds no tabs and every bud
    // comes out zero-wide -- which budPanelPath filters away, leaving a plain
    // rectangle with every label stacked at the same x. The widths only become
    // measurable on the pass AFTER the one that decided to draw them.
    //
    // Measuring unconditionally in updated() also fixes it and was tried; it
    // forces a synchronous layout on every frame of every spring, which on a
    // page of a dozen groups is a hang. Watching the elements is the version
    // that costs nothing when nothing is happening.
    this.syncTabObservers();

    const need = this.layout().minW;
    // +2: minW is the BODY width, and the body is inset half a pixel from the
    // host box at each end so the 1px stroke lands on the pixel grid.
    const px = need > 0 ? `${Math.ceil(need) + 2}px` : '';
    if (this.style.minWidth !== px) this.style.minWidth = px;

    this.placeBar(!this.barPlaced);
  }

  // ---- tab interaction ----

  private onTabEnter(i: number): void {
    const s = this.lifts[i];
    if (!s) return;
    s.target = 1;
    this.loop.wake();
  }

  private onTabLeave(i: number): void {
    const s = this.lifts[i];
    if (!s) return;
    s.target = 0;
    this.loop.wake();
  }

  private onTabClick(t: GroupTab): void {
    if (t.disabled) return;
    if (t.kind === 'action') {
      this.dispatchEvent(new CustomEvent('bi-tab-action', {
        detail: { id: t.id }, bubbles: true, composed: true,
      }));
      return;
    }
    if (t.id === this.activeId) return;
    const previous = this.activeId;
    this.active = t.id;
    this.dispatchEvent(new CustomEvent('bi-tab-select', {
      detail: { id: t.id, previous }, bubbles: true, composed: true,
    }));
  }

  /**
   * Arrows step between PANEL tabs and skip actions.
   *
   * Skipping is the whole subtlety. An action in the middle of the strip is not
   * a stop on the way from one panel to the next -- arrowing onto it would
   * either fire it, which is destructive, or select nothing, which strands the
   * keyboard. Tab still reaches it, because it is a button and it should be
   * reachable; the arrows just do not treat it as a sibling of the panels.
   *
   * Clamps rather than wrapping, for the reason bi-seg does: these are views
   * of one subject with a first and a last, not a carousel.
   */
  private onKeyDown = (e: KeyboardEvent): void => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir || !this.interactive) return;
    const p = this.panels.filter((t) => !t.disabled);
    if (p.length < 2) return;
    e.preventDefault();
    const i = p.findIndex((t) => t.id === this.activeId);
    const next = Math.min(Math.max((i < 0 ? 0 : i) + dir, 0), p.length - 1);
    if (next === i) return;
    this.onTabClick(p[next]);
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>('.tab.on')?.focus();
    });
  };

  /**
   * Size from getBoundingClientRect, never clientWidth/clientHeight.
   *
   * All four prior codebases converged on this after the same bug: a hi-dpi
   * backing store feeding a flex parent's intrinsic size is a runaway growth
   * loop. Here the SVG is absolutely positioned so it cannot feed back, but the
   * habit is cheap and the failure is not.
   */
  private measure(): void {
    const r = this.getBoundingClientRect();
    // --bi-scale is read live rather than cached: the gallery drives it from a
    // slider, and a cached copy would leave the outline sized for the old zoom.
    const s = parseFloat(getComputedStyle(this).getPropertyValue('--bi-scale')) || 1;

    // Bud widths. The buttons are content-sized, so measuring them cannot
    // depend on where the layout puts them and there is no feedback loop.
    const els = [...this.renderRoot.querySelectorAll<HTMLElement>('.tab')];
    const tabW = els.map((e) => e.getBoundingClientRect().width);

    // THE TAPER MEASUREMENT. The outline can only hug what it can see, and what
    // it needs to see is two numbers: where the hero ends, and how much shorter
    // the satellites are. Both come from laid-out geometry rather than from
    // declared sizes, because the satellites are arbitrary slotted content and
    // may wrap.
    const heroEl = this.renderRoot
      .querySelector<HTMLSlotElement>('slot[name="hero"]')
      ?.assignedElements()[0] as HTMLElement | undefined;
    const panelEl = this.renderRoot.querySelector<HTMLElement>('.panel:not(.off)');
    let heroRight = 0;
    let satDrop = 0;
    if (heroEl) {
      const hr = heroEl.getBoundingClientRect();
      const sr = panelEl?.getBoundingClientRect();
      heroRight = hr.right - r.left;
      if (sr && sr.height > 0) satDrop = Math.max(0, (hr.height - sr.height) / 2);
    }

    const sameTabs = tabW.length === this.tabW.length
      && tabW.every((v, i) => v === this.tabW[i]);
    if (r.width === this.w && r.height === this.h && sameTabs && s === this.scale
        && heroRight === this.heroRight && satDrop === this.satDrop) return;
    this.w = r.width;
    this.h = r.height;
    this.tabW = tabW;
    this.scale = s;
    this.heroRight = heroRight;
    this.satDrop = satDrop;
  }

  /**
   * All outline geometry, in one place.
   *
   * Extracted because the minimum width the host must have and the path it
   * draws are the same computation, and computing them separately is how a
   * group ends up wide enough for a tab it is not drawing.
   */
  private layout() {
    const s = this.scale;
    const g = {
      tabDepth: G.tabDepth * s,
      tabRadius: G.tabRadius * s,
      fillet: G.fillet * s,
      tabGap: G.tabGap * s,
      actionGap: G.actionGap * s,
      actionClear: G.actionClear * s,
      radius: G.radius * s,
      heroMax: G.heroMax * s,
    };

    // Half-pixel inset so a 1px stroke lands on the pixel grid instead of
    // straddling two and rendering as a 2px smear.
    const x = 0.5;
    const y = g.tabDepth + 0.5;
    const w = Math.max(0, this.w - 1);
    const h = Math.max(0, this.h - g.tabDepth - 1);

    // With a hero, the left end becomes a capsule that hugs the round dial.
    const left = this.hero ? Math.min(h / 2, g.heroMax * 1.2) : g.radius;
    const radius: [number, number, number, number] = [left, g.radius, g.radius, left];

    // The strip must start clear of the top-left corner's run, or the first
    // fillet lands inside the corner curve and the joint kinks. The run is the
    // radius times the squircle factor, which is why this is not simply
    // `radius`.
    const stripX0 = left * 1.35 + g.fillet * 0.5;

    const strip = this.strip;
    const placed: Placed[] = [];
    let cursor = stripX0;
    for (let i = 0; i < strip.length; i++) {
      const tab = strip[i];
      const action = tab.kind === 'action';
      const tw = this.tabW[i] ?? 0;
      if (action && placed.length) cursor += g.actionGap;
      placed.push({ tab, action, x0: cursor, x1: cursor + tw });
      cursor += tw + g.tabGap + (action ? g.actionGap : 0);
    }
    const stripW = placed.length ? placed[placed.length - 1].x1 - stripX0 : 0;

    // The narrowest the body may be and still carry its own strip, plus a
    // corner at each end for the fillets to land clear of.
    const minW = placed.length ? stripX0 + stripW + g.radius * 2 : 0;

    // THE STRIP IS ALWAYS RENDERED, AND ONLY THE SHAPES ARE GATED.
    //
    // The first cut gated the whole strip on "does it fit", and that is a
    // feedback loop with itself: the widths come from measuring the buttons, so
    // not rendering them measures zero, which makes the strip look narrow
    // enough to fit, which renders it, which measures wide, which hides it.
    // The page hung. The single-label version never had this because the label
    // was rendered unconditionally and only the BUD was suppressed.
    //
    // So the rule is: measurement must never depend on a decision that
    // measurement makes. Buttons always render; a bud is dropped only if it
    // would run past the body's right corner, which is a comparison between two
    // already-measured numbers and cannot oscillate. In practice it never
    // fires, because minW below grows the host to fit -- it is the backstop for
    // a parent that overrides that.
    const budLimit = w - g.radius;
    const buds: Bud[] = [];
    // `t` is the spring's 0..1 value and `lift` is that in pixels. Both, and
    // named apart, because handing the pixel one to a percentage is exactly the
    // bug below.
    const actions: { x0: number; x1: number; t: number; lift: number }[] = [];
    placed.forEach((p, i) => {
      if (p.x1 <= 0 || p.x1 > budLimit) return;
      const t = this.lifts[i]?.value ?? 0;
      const lift = t * G.hotLift * s;
      if (p.action) actions.push({ x0: p.x0, x1: p.x1, t, lift });
      else buds.push({ x0: p.x0, x1: p.x1, depth: g.tabDepth + lift, r: g.tabRadius });
    });

    // THE TAPER. With a hero, the outline stands tall around the big dial and
    // draws in over the shorter satellite row, joined by a convex/concave pair
    // that reads as one shoulder. This is the difference between an outline
    // that CONTAINS its contents and one that hugs them: a rectangle says "these
    // things are in the same box", a silhouette that changes height says "this
    // one is the big one and those are its".
    //
    // Suppressed below ~6px, where the shoulder is shorter than its own corner
    // radii and degrades into a wobble in the top edge.
    const taper = this.hero ? Math.min(this.satDrop - 4 * s, G.taperMax * s) : 0;
    const shoulderAt = this.heroRight + (G.heroGap * s) / 2;
    const stripEnd = stripX0 + stripW;
    const shoulder = taper > 6 * s && shoulderAt > stripEnd && shoulderAt < w - g.radius * 2
      ? { at: shoulderAt, drop: taper, run: taper * 1.5, r: Math.min(taper, 12 * s) }
      : null;

    const d = w > 0 && h > 0
      ? budPanelPath(x, y, w, h, {
          radius, buds, fillet: g.fillet, smoothing: 1,
          shoulder: shoulder ?? undefined,
        })
      : '';

    // THE STRIP HAS ONE TOP LINE.
    //
    // The capsules were inset equally at top and bottom, which centred them in
    // the band and left their top edge 2.5px below every bud's -- so the strip
    // read as a row of tabs plus something that had slipped, rather than as one
    // row containing a different kind of thing. Two signals were being sent
    // where one was meant: the daylight UNDERNEATH is the whole statement, and
    // it says it on its own.
    //
    // So a capsule starts where a bud starts and stops short of the body edge.
    // Because the tops now agree, every label -- action or not -- sits the same
    // distance below the top of the shape it is in, with no adjustment
    // anywhere: the buttons are all one box and the capsule is simply shorter
    // at the bottom, which is the entire thing it is trying to say.
    const capTop = y - g.tabDepth;
    const capH = g.tabDepth - g.actionClear;
    const caps = capH > 4
      ? actions.map((a) => ({
          t: a.t,
          d: smoothRect(
            x + a.x0, capTop - a.lift, a.x1 - a.x0, capH,
            Math.min(g.tabRadius, capH / 2), 1,
          ),
        }))
      : [];

    return { d, caps, minW, placed, tabDepth: g.tabDepth };
  }

  /** Put the active bar under the active tab, on the seg's two-spring travel. */
  private placeBar(immediate: boolean): void {
    if (!this.interactive) return;
    const { placed } = this.layout();
    const hit = placed.find((p) => !p.action && p.tab.id === this.activeId);
    if (!hit || hit.x1 <= hit.x0) return;
    const l = hit.x0 + 2;
    const r = hit.x1 - 2;
    if (immediate) {
      this.barL.snapTo(l);
      this.barR.snapTo(r);
      this.barPlaced = true;
      this.rev++;
      return;
    }
    if (l === this.barL.target && r === this.barR.target) return;
    // Whichever edge is moving INTO new territory leads; the other lags.
    const goingRight = l > this.barL.target;
    this.barL.setTier(goingRight ? TRAIL : LEAD);
    this.barR.setTier(goingRight ? LEAD : TRAIL);
    this.barL.target = l;
    this.barR.target = r;
    this.loop.wake();
  }

  render() {
    const { d, caps, placed, tabDepth } = this.layout();
    const activeId = this.activeId;
    // ONLY PANEL TABS LIGHT THE BODY. Hovering an action brightened the whole
    // group outline, which says the opposite of what the detached capsule is
    // there to say -- the thing the pointer is on is precisely the one that
    // does NOT belong to this outline. Each capsule brightens itself instead.
    const strokeHot = Math.max(0, ...placed.map(
      (p, i) => (p.action ? 0 : this.lifts[i]?.value ?? 0),
    ));
    // CLAMPED, and the clamp is not defensive padding -- it is the fix for a
    // real failure. This was handed a 0..2 pixel lift where it wanted a 0..1
    // ratio, which produced `color-mix(..., -100%, ...)`. An out-of-range
    // percentage does NOT fall back to the class rule: the declaration parses
    // (var() resolves later), so it wins the cascade, and then resolves to
    // guaranteed-invalid, which makes the property inherit -- and `stroke`
    // inherits `none` from the <svg>. The capsule vanished on hover, silently,
    // with no error anywhere. Same family of trap as the :root custom-property
    // note in theme/tokens.css: invalid-at-computed-value-time is not an error,
    // it is an inherit.
    const hot = (t: number) => {
      const pct = Math.round(Math.min(1, Math.max(0, t)) * 100);
      return `stroke: color-mix(in srgb, var(--group-stroke, var(--app-outline)) ${
        100 - pct
      }%, var(--app-outline-hot))`;
    };

    return html`
      <svg class="outline" width=${this.w} height=${this.h} aria-hidden="true">
        ${d
          ? svg`<path class="tint" d=${d} stroke="none" />
                <path class="surface" d=${d} style=${hot(strokeHot)} />`
          : nothing}
        ${caps.map((c) => svg`<path class="action-shape" d=${c.d} style=${hot(c.t)} />`)}
      </svg>

      ${this.tabStrip(placed, activeId)}
      ${this.interactive ? this.activeBar(tabDepth, placed) : nothing}

      <div class="body">
        <slot name="hero"></slot>
        ${this.tabs.length
          ? this.panels.map(
              (t) => html`<div class=${`panel${t.id === activeId ? '' : ' off'}`}>
                <slot name=${t.id}></slot>
              </div>`,
            )
          : html`<div class="panel"><slot></slot></div>`}
      </div>
    `;
  }

  private tabStrip(placed: Placed[], activeId: string) {
    return placed.map((p, i) => {
      const t = p.tab;
      const lift = (this.lifts[i]?.value ?? 0) * G.hotLift * this.scale;
      const cls = [
        'tab',
        this.interactive ? '' : 'plain',
        p.action ? 'action' : '',
        // Only when there is something to select. A single `label` resolves to
        // a one-entry strip whose id is '' and which therefore matched the
        // (also empty) activeId -- so every plain group's name came out in
        // juice, claiming a selection state it has no way to leave.
        this.interactive && !p.action && t.id === activeId ? 'on' : '',
      ].filter(Boolean).join(' ');
      // EVERY BUTTON IS THE SAME BOX, actions included. Sizing the action's
      // button to its shorter capsule was tried and is worse: it centres the
      // label in the capsule, which moves it a pixel off the line its
      // neighbours sit on, and a row of three labels is exactly where the eye
      // catches a ragged baseline.
      //
      // Leaving the box alone lands the action's label the SAME distance below
      // the capsule's top as every other label sits below its bud's top --
      // because the tops now agree. The capsule is simply shorter at the
      // bottom, which is the entire thing it is trying to say.
      const style = `left: ${p.x0.toFixed(1)}px; top: ${(-lift).toFixed(1)}px`;
      const inner = html`${t.label}${p.action
        ? html`<span class="glyph">${t.glyph ?? '↗'}</span>`
        : nothing}`;

      if (!this.interactive) {
        return html`<span class=${cls} style=${style}>${inner}</span>`;
      }
      return html`<button
        class=${cls}
        style=${style}
        ?disabled=${t.disabled}
        @click=${() => this.onTabClick(t)}
        @keydown=${this.onKeyDown}
        @pointerenter=${() => this.onTabEnter(i)}
        @pointerleave=${() => this.onTabLeave(i)}
      >${inner}</button>`;
    });
  }

  private activeBar(tabDepth: number, placed: Placed[]) {
    const i = placed.findIndex((p) => !p.action && p.tab.id === this.activeId);
    if (i < 0) return nothing;
    const lift = (this.lifts[i]?.value ?? 0) * G.hotLift * this.scale;
    const l = this.barL.value;
    const wpx = Math.max(0, this.barR.value - l);
    const top = tabDepth - 2 * this.scale - lift;
    return html`<span class="bar"
      style=${`left: ${l.toFixed(1)}px; width: ${wpx.toFixed(1)}px; top: ${top.toFixed(1)}px`}
    ></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-group': BiGroup;
  }
}
