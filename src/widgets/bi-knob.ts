/**
 * <bi-knob> -- the rotary scalar control, and the family's hero.
 *
 * Ported from nano-modules' scalar-knob.ts and device-encoder.ts, whose tuned
 * constants are carried over rather than re-guessed: a 270-degree sweep with
 * the gap at the bottom, and 160px of vertical travel for the full range. Those
 * two numbers are what make a knob feel like a knob, and they were arrived at
 * by use.
 *
 * ---------------------------------------------------------------------------
 * CRYSTAL AND JUICE, AND WHY IT IS ALL `screen`
 *
 * The first version of this was muddy, and the cause was compositing rather
 * than colour. A grey cap body with translucent juice and white washes over it
 * is ALPHA COMPOSITING, which behaves like paint: every layer drags the result
 * toward the average of what is beneath it, so a saturated tint over #1b1f27
 * lands on dull slate no matter how bright the tint. Turning the colours up
 * makes it a brighter slate.
 *
 * Light is not paint. Every luminous layer here blends with `screen` over a
 * near-black body, which is effectively additive: chroma survives, two glows
 * that overlap get BRIGHTER rather than dirtier, and the dark body stops
 * reading as grey plastic and starts reading as clear material with nothing
 * behind it. The colour authored is the colour seen.
 *
 *   `screen`, not `plus-lighter`. Over near-black the two are visually
 *   indistinguishable, and screen has no clipping and universal support --
 *   which matters because an unsupported blend mode does not degrade, it falls
 *   back to `normal` and paints an opaque blob. In a WKWebView that is not a
 *   risk worth taking for an invisible difference.
 *
 * The stack is isolated so the additive layers light each other and nothing
 * outside the control.
 *
 * WHAT MAKES IT READ AS CRYSTAL. Four cues, all cheap, none of them a filter:
 *
 *   1. NEAR-BLACK BODY. Clear material over a dark ground is dark. Everything
 *      visible about the cap is a highlight; there is no "surface colour".
 *   2. A HARD, THIN LIT RIM on the near edge, with a whisper of warmth on the
 *      shaded side opposite it. A real edge disperses what passes through, and
 *      that one warm note is most of what separates crystal from tinted
 *      plastic. It is a lens edge, not a rainbow.
 *   3. THE FAR INNER WALL. A bright arc low inside the dome -- light that went
 *      through the near face and caught the back of the volume. This is the cue
 *      that says THICK and transparent rather than flat and shiny, and it is
 *      the one most often left out.
 *   4. JUICE POOLED AT THE BASE, seen through the body. Liquid collects at the
 *      bottom and thins toward the top, so the cap is lit from the channel it
 *      sits in rather than tinted evenly.
 *
 * TWO RANKS. `lead` is the crystal described above -- juice inside the volume,
 * a filled arc, bloom. `counter` inverts it: the body is unlit, the pool and
 * the far wall are gone, and the value is a single juice hairline in a black
 * channel. The crystal cues that survive are the ones that need no light of
 * their own -- the silhouette, the facet, the specular -- so a counter knob
 * reads as the same material seen unlit rather than as a dimmed copy. See the
 * note on ScalarControl.rank for why this is an axis of its own.
 *
 * HOVER. The vessel catches the light before the liquid moves: the channel's
 * lip brightens all the way round, and a dim white rim appears at the cap's
 * edge -- at exactly the radius the press ring will light up. Sharing that
 * radius is the point. Hover puts an EDGE where press puts a FLAME, so the
 * press reads as that edge igniting rather than as a new object arriving, and
 * the two are never confused because one is chrome-white at a fifth of the
 * alpha and the other is juice with a bloom under it.
 *
 * It is the same rule the flat controls follow -- the well lights and its edge
 * sharpens -- applied to the one control that has no well. And it exists at all
 * because a plugin surface does not get to answer "can I click this?" with a
 * popup: the answer has to be the control itself.
 *
 * PRESS. The juice RISES in the crystal -- the pool climbs and brightens, its
 * bloom widens, the specular slides a few degrees as though the dome tilted.
 * Nothing changes size: a control that shrinks under the finger appears to
 * recede from it, which is the opposite of contact.
 *
 *   AND A CONTACT RING, which is the part that makes it READ. Everything above
 *   is soft -- a pool, a bloom, a slide -- and soft changes of soft things are
 *   invisible at 48px however large the numbers driving them are. Held, a hard
 *   juice hairline appears all the way around the cap, in the dark gap between
 *   the cap and its channel: the meniscus where the pressed volume meets the
 *   liquid it displaced.
 *
 *   Three properties are doing the work, and they are the three the earlier,
 *   too-subtle version had none of. It is HARD-EDGED, so it survives being
 *   small. It runs the WHOLE CIRCUMFERENCE, so it cannot be confused with the
 *   value arc, which never does. And it is BINARY -- absent, then present --
 *   rather than a brightening of something already there, so the eye is
 *   reporting an event instead of comparing two states it never saw together.
 *
 *   It is also the only press cue a COUNTER gets, and the only one it needs.
 *   A counter is juice on the EDGE of the glass, so a wet rim is already its
 *   vocabulary -- where a rising pool would have made it briefly a lead.
 *
 * ---------------------------------------------------------------------------
 * THE INK SKIN
 *
 * The same control printed rather than lit, and every crystal cue is deleted
 * rather than translated -- no dome, no specular, no rim, no bloom, no
 * dispersion. What is left is what a screenprint has: flat plates of nearly
 * pure ink, hard edges, and the places where two plates overlap.
 *
 *   OVERPRINT IS THE COMPOSITING LAW. Inks `multiply`, so where the modulation
 *   band crosses the value arc the result is a third, darker colour. That is
 *   not decoration -- it is the same information the crystal skin carries by
 *   getting brighter, arrived at from the opposite direction, and it means an
 *   overlap can never be mistaken for either of the things overlapping.
 *
 *   THE KEY PLATE IS THE REFERENCE, AND ONLY COLOUR DRIFTS. That is how
 *   registration actually works: a press is set up to the key, and the colour
 *   plates are what wander around it. The first version offset the juice one
 *   way and the CAP the other, which put two plates 1.8 units apart -- twice
 *   the drift either was meant to have -- and pulled them symmetrically away
 *   from a centre nothing was printed at. It also left the pointer, which is a
 *   knockout in the cap plate, registered to the key instead of to the plate it
 *   is cut from, so the mark inside the cap sat off its own centre. All three
 *   go away once the key is the reference: cap, key rule and knockout are one
 *   plate in register, and the value arc and mod band are the colour plate that
 *   moves.
 *
 *   AND THE COLOUR IS TRAPPED. If plates can shift, every colour shape needs
 *   enough margin inside the shape behind it that the shift can never leave it
 *   hanging over an edge. The well was 1.0 wider than the arc per side and the
 *   drift was 0.9, so the arc overhung its own trough -- visibly, at any size
 *   big enough to look at. The well's width is derived from the arc's now, so
 *   the two cannot drift apart in the source the way they do on the sheet.
 *
 *   MISREGISTRATION IS STATIC. The plates sit slightly out of register, as
 *   they do on a real machine, and they STAY there. Pressing used to pull them
 *   square, which sounded better than it looked: the slip is 0.9 viewBox units,
 *   about 0.4px on a 48px dial, so the animation was a subpixel wobble -- too
 *   small to read as registration, big enough to notice as a jitter. An effect
 *   that cannot be seen clearly enough to be understood is indistinguishable
 *   from a rendering bug, which is what it looked like. The same mistake as the
 *   seg chip's borrowed slip, arrived at from the other direction: there the
 *   offset was wrong in kind, here it was right in kind and too small to read.
 *
 *   The slip is SEEDED per instance, so a panel looks like a print run rather
 *   than like one shape stamped repeatedly, and it does not reshuffle on
 *   resize or re-render.
 *
 *   THE PRESS IS A DOUBLE HIT, AND THE HIT SPREADS. A screenprinter lays a
 *   second pass to get density, and pressing the plate harder makes the ink
 *   bleed outward -- dot gain. Both happen here: held, the value plate prints
 *   again AND wider, the cap's key rule thickens, the knocked-out pointer opens
 *   up, and a screened counter's dots fatten. Density, not motion, so there is
 *   nothing to jitter, and it reads at every size, which the 0.4px registration
 *   never could.
 *
 *   AREA, NOT A RING. The crystal skin's press is a contact ring, and the
 *   obvious move is to print one. It does not work, and the reason is worth
 *   keeping: a ring is a THIN mark, and crystal gets away with it only because
 *   the ring is luminous -- a hairline plus a screened bloom reads as a glow at
 *   any size. Ink has no bloom to lend it, so the same ring is 0.7px of flat
 *   key on a 48px dial, sitting right against the cap's own outline, and the
 *   two merge into one slightly heavier circle. So the ink press is expressed
 *   as AREA everywhere and as a ring nowhere. Neither skin can borrow the
 *   other's trick; that keeps being the finding.
 *
 *   RANK becomes solid versus HALFTONE. A lead prints at full density; a
 *   counter prints as a dot screen. Same plate, less ink -- which is exactly
 *   how the medium expresses emphasis, and it keeps rank a material property
 *   rather than an opacity.
 *
 * SVG rather than canvas: these are small crisp vector marks that need to
 * respond to CSS state (hover, focus, disabled, modulated), and rebuilding that
 * in a 2D context would mean reimplementing styling to gain nothing.
 */
import { html, svg, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { base } from '../theme/base';
import { toPos, type ParamSpec } from '../core/schema';
import { formatNumber, readingChars, unitOf } from '../core/format';
import { modBand, modArcAngles } from '../draw/modband';
import { arcSvg } from '../draw/marks';
import { ScalarControl, clamp01 } from './scalar-base';
import { rng } from '../draw/marks';

/** Degrees of rotation spanning the whole range, gap at the bottom. */
const SWEEP = 270;
const DEG0 = -135;
const DEG1 = DEG0 + SWEEP;

/** Vertical pixels of drag for one full min-to-max sweep. */
const DRAG_RANGE_PX = 160;

/** Geometry in the SVG's own 100x100 space. */
const CX = 50;
const CY = 50;
const R_MOD = 47;
const R_TRACK = 39;
const R_CAP = 28;
/** The specular sweep sits inside the rim, on the lit side. */
const R_SPEC = R_CAP * 0.76;
/**
 * The contact ring, in the dark gap between the cap and the channel. Crystal
 * only -- see inkPlates() for why the ink skin cannot use a ring for this.
 *
 * Outside the silhouette (which spans R_CAP-0.5 .. R_CAP+1.7 at its 2.2 stroke)
 * so it is not eaten by it, and well inside the channel's inner edge at
 * R_TRACK-3.25, so at no rank does it touch the value arc. That clearance is
 * the whole reason it can be juice-coloured without lying: colour is reserved
 * for signal here, and a mark that never overlaps the reading cannot be
 * mistaken for part of it.
 */
const R_CONTACT = R_CAP + 2.6;

/**
 * Plate drift, in viewBox units, and the trap that has to survive it.
 *
 * TRAP is a printing term and it is the thing that was missing: if plates can
 * shift relative to each other, every colour shape needs enough margin inside
 * the shape behind it that the shift can never expose a gap or leave the colour
 * hanging over an edge. The ink well was 1.0 wider than the value arc per side
 * and the drift was 0.9, so there was 0.1 of trap -- which is none, and the arc
 * visibly overhung its own trough at large sizes.
 *
 * Naming the relationship is the fix, not the numbers: the well's width is
 * DERIVED from the arc's, so the two can no longer drift apart in the source
 * the way the plates drift on the sheet.
 */
const SLIP = 0.7;
const TRAP = SLIP + 0.5;
/** Clear space between the track's outer edge and the modulation band. */
const MOD_GAP = 0.8;

/** The detent mark, placed inside the track. See detentTick(). */
const DETENT_GAP = 0.9;
const DETENT_LEN = 3.4;
const DETENT_MIN = 2.2;
/** The cap's outermost edge, which does not move. See inkPlates(). */
const R_CAP_EDGE = R_CAP + 0.9;

const SIZE_PX = { sm: 30, md: 48, lg: 76 } as const;

/**
 * Halftone ruling, in CSS px of dot pitch.
 *
 * The first attempt put the pattern cell in the SVG's 100-unit space, so it
 * scaled with the knob and collapsed to solid grey at any real size. The fix
 * was to hold the pitch constant in screen px -- correct -- but at 5px the
 * ruling was so open that a 48px cap carried five dots and read as polka dots
 * rather than as a tint. Both failures look like bugs, which is the giveaway
 * that the pitch was never the whole answer.
 *
 * 3.2px is the compromise: fine enough that a cap reads as toned rather than
 * patterned, coarse enough that the dots still resolve.
 */
const DOT_PITCH_PX = 3.2;

/**
 * Below this many dots across the cap, DO NOT SCREEN IT AT ALL.
 *
 * This is the part the pitch alone could not fix. A 30px cap is about 17px
 * wide; at any pitch that resolves, that is four or five dots, and four dots
 * is not a tint -- it is a small number of visible circles. There is no ruling
 * that reads as tone at that size, which is exactly why print does not screen
 * small elements either: below a certain reproduction size you drop the screen
 * and use line work.
 *
 * So a counter too small to screen prints UNFILLED, with the key rule it
 * already carries. Both treatments are obviously deliberate, both read as
 * quieter than a solid lead, and neither degrades into an accidental grey.
 */
const MIN_DOTS_ACROSS = 7;

let uid = 0;

@customElement('bi-knob')
export class BiKnob extends ScalarControl {
  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: var(--sp-1);
        /* Sized off the scale token so a host can zoom the whole surface. */
        --knob-px: calc(48px * var(--bi-scale));
        outline: none;
      }
      :host(:focus-visible) .dial {
        outline: 1px solid var(--juice-hot);
        outline-offset: 2px;
        border-radius: 50%;
      }
      .dial {
        width: var(--knob-px);
        height: var(--knob-px);
        cursor: ns-resize;
        touch-action: none;
        display: block;
        overflow: visible;
      }
      /* The channel: a dark groove cut into the panel, and the ONE part of the
       * control that is not additive -- it is an absence of light. */
      .channel { stroke: #05070b; }
      /* The groove under the pointer, and the knob's answer to the slider's
       * washed tube. AREA, because the two hairlines the lip gives are half a
       * pixel each on a 48px dial and half a pixel of anything is not an
       * affordance. The channel is the largest quiet shape the control owns,
       * which makes it the only place a wash can go. */
      .channel-hover { stroke: var(--hover-wash); }
      /* Opacity comes from JS, not from here: the lip is the one surface that
       * carries the whole hover-to-press continuum, and half of it in a :hover
       * rule and half in a spring would show the seam. */
      .channel-lip { stroke: #ffffff; }

      /* Every luminous layer. Screen over the near-black body, so overlaps add
       * instead of muddying -- see the file header. */
      .lit { mix-blend-mode: screen; }

      .bloom { stroke: var(--juice-pure); }
      .core { stroke: var(--juice-pure); }
      .hot { stroke: var(--juice-hot); }
      .mod-band { stroke: var(--app-mod-color); opacity: 0.3; }
      .mod-fill { stroke: var(--app-mod-color); }
      .detent { stroke: rgba(255, 255, 255, 0.4); }
      /* The meniscus at the pressed cap's edge, and its halo. */
      .contact { stroke: var(--juice-hot); fill: none; }
      .contact-bloom { stroke: var(--juice-pure); fill: none; }
      /* THE HOVER RING, at the same radius as the contact ring and made of the
       * opposite thing: a dim white rim-light where that one is bright juice.
       *
       * Sharing the radius is the point. Hover puts an edge where press will
       * light up, so the press reads as that edge IGNITING rather than as a new
       * object arriving -- and the two are never confused, because one is
       * chrome-white at a fifth of the alpha and the other is juice with a
       * bloom under it. It is the same "vessel catches the light before the
       * liquid moves" rule the flat controls follow, on the one control that
       * has no well to light. */
      .hover-ring { stroke: var(--hover-lip); fill: none; }
      /* Counter: unlit body, and a facet that catches less because there is no
       * light coming from inside it to help. */
      :host([rank='counter']) .spec { opacity: 0.7; }
      .cap-body { fill: var(--glass-body); }
      /* Light that came through the near face and caught the back of the
       * volume. It has passed THROUGH the juice, so it carries the juice's
       * colour -- a white version of this reads as a grey smudge, which is the
       * mud problem returning in a single layer. */
      .far-wall { stroke: var(--juice-pure); fill: none; stroke-linecap: round; }
      /* The silhouette. A crisp dark ring hugging the cap, UNDER every lit
       * layer and deliberately not screened -- it is an occlusion, not a light.
       * Without it the cap dissolves into the panel at its lower edge and the
       * whole control reads as soft; with it there is a definite object, which
       * is most of what "solid" and "confident" mean here. */
      .silhouette { fill: none; stroke: #04060a; }
      /* NOTE: an inner "table" facet was tried here and removed. On a 48px cap
       * a third pale mark on the dark upper face stops reading as a cut face
       * and starts reading as another smudge -- crystal is about FEW, HARD
       * marks, and every soft one costs more clarity than it adds. */
      .spec { stroke: #ffffff; stroke-linecap: round; fill: none; }
      .pointer-glow { stroke: var(--juice-pure); stroke-linecap: round; }
      .pointer { stroke: var(--juice-hot); stroke-linecap: round; }

      /* When modulation is driving the value, the SET value is no longer what
       * you are hearing. Dimming the pointer and its arc says which of the two
       * marks the number refers to. */
      :host([modulated]) .pointer { opacity: 0.4; }
      :host([modulated]) .core { opacity: 0.42; }
      :host([modulated]) .hot { opacity: 0.3; }

      /* ---- ink ---- */
      .ink-well { stroke: var(--app-bg-sunken); }
      /* Hover, printed: a wash of key ink laid over the trough. An AREA rather
       * than a ring, for the reason set out under the press -- ink has no glow
       * to make a hairline read, and the well is the largest quiet shape the
       * control owns. */
      .ink-hover { stroke: var(--hover-wash); }
      /* The blend comes from the SKIN, not from here.
       *
       * Under the light-stock ink skin it is multiply, so where two plates
       * cross the result is darker than either -- the subtractive counterpart
       * of the crystal skin's brightening.
       *
       * These said multiply outright, which is correct on white stock and
       * paints black on dark stock -- a transparent ink multiplied into black
       * is black, which is precisely why a printer switches to opaque inks for
       * dark card. The ink-dark header in tokens.css says so, and this file
       * ignored it, so the whole value arc vanished. Same class of mistake as
       * the literal hex troughs: a material decision written into a widget. */
      .ink-juice { stroke: var(--juice); mix-blend-mode: var(--chip-blend); }
      .ink-mod { stroke: var(--app-mod-color); mix-blend-mode: var(--chip-blend); }
      .ink-mod-well {
        stroke: var(--app-mod-color);
        opacity: 0.28;
        mix-blend-mode: var(--chip-blend);
      }
      .ink-cap { mix-blend-mode: var(--chip-blend); }
      .ink-key { stroke: var(--ink-key); fill: none; }
      /* A mark on a solid plate is not printed, it is left unprinted -- the
       * plate is cut away and the paper shows through. */
      .ink-knockout { stroke: var(--ink-stock); fill: none; }
      .dial.ink .detent { stroke: var(--ink-key); opacity: 0.55; }
      :host([rank='counter']) .ink-key { stroke: var(--app-text-color2); }

      .readout {
        display: flex;
        align-items: baseline;
        gap: 3px;
        line-height: 1;
      }
      /* A shadow root cannot select on :root[data-skin], so the skin reaches
       * widgets as an inherited custom property instead -- which is the same
       * mechanism the juice ramp uses, and the reason a widget needs no
       * plumbing to be skinned. */
      .value { color: var(--readout-color, var(--juice-hot)); }
      :host([rank='counter']) .value { color: var(--app-text-color2); }
      :host([rank='counter']) .units { color: var(--app-text-color3); }
      .edit {
        /* Sized off the SAME reservation the readout uses, so opening the
         * editor does not resize the control. A type-to-edit box narrower or
         * wider than the reading it replaces makes every neighbour jump the
         * instant you press a digit -- the same defect as a growing readout,
         * triggered by a keystroke instead of by a value.
         *
         * WIDTH, not min-width, and that distinction cost a measurement: an
         * <input> carries an intrinsic size of about twenty characters, so a
         * min-width below that does nothing at all and the box comes out at
         * the browser's default. Measured before the fix: the knob went from
         * 76px at rest to 117px while editing. */
        width: calc(var(--edit-ch, 8) * 1ch);
        font: inherit;
        font-size: var(--fs-xs);
        text-align: center;
        background: var(--app-bg-sunken);
        color: var(--app-text-color1);
        border: 1px solid var(--juice);
        border-radius: var(--app-r-3);
        padding: 1px 2px;
        outline: none;
      }
      /* compact drops the name: the knob is identified by its position and by
       * the group it sits in, and the label is the first thing to become
       * unreadable at this size anyway. */
      :host([density='compact']) .label { display: none; }
      :host([density='expanded']) .label { font-size: var(--fs-md); }
    `,
  ];

  @property({ type: String, reflect: true }) size: keyof typeof SIZE_PX = 'md';

  /** Gradient ids are document-global even from inside a shadow root in some
   * engines; a per-instance suffix costs nothing and removes the whole class of
   * "every knob on the page uses the first one's gradient" bug. */
  private readonly gid = `k${++uid}`;

  /** Read once at construction: switching is a reload. See theme/skins.ts. */

  /**
   * Rendered diameter in CSS px, for the halftone ruling. Measured rather than
   * derived from `size`, because --bi-scale multiplies it and a widget cannot
   * see the zoom its ancestor applied.
   */
  @state() private dialPx = 48;
  private ro: ResizeObserver | null = null;

  /**
   * This instance's COLOUR-PLATE drift, in viewBox units.
   *
   * One offset, applied to the colour plates only, because the key plate is the
   * reference -- see the registration note in the file header. It used to be
   * applied to the juice as +slip and to the cap as -slip, which is not how a
   * press misregisters: it put the two plates 1.8 units apart, twice the drift
   * either of them was supposed to have, and pulled them symmetrically away
   * from a centre nothing was actually printed at.
   *
   * Seeded from the instance id so a panel looks like a print run rather than
   * one shape stamped repeatedly, and so a re-render never reshuffles it.
   */
  private readonly slip = (() => {
    const r = rng(uid * 2654435761);
    const a = r() * Math.PI * 2;
    return { x: Math.cos(a) * SLIP, y: Math.sin(a) * SLIP };
  })();

  /** The channel/well stroke width for this skin and rank -- the one place the
   * track's size is decided, so everything positioned against it derives from
   * the same number. */
  private trackWidth(counter: boolean): number {
    return (counter ? 5 : 9) + 2 * TRAP;
  }

  protected positionFor(e: PointerEvent, delta: [number, number]): number {
    // Shift is a quarter of the travel, applied to the same gesture rather than
    // restarting it, so the modifier can be pressed and released mid-drag.
    const sens = e.shiftKey ? 0.25 : 1;
    return this.dragStartPos - (delta[1] / DRAG_RANGE_PX) * sens;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0 && Math.abs(w - this.dialPx) > 0.5) this.dialPx = w;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ro?.disconnect();
    this.ro = null;
  }

  protected firstUpdated(): void {
    const dial = this.renderRoot.querySelector('.dial');
    if (dial) this.ro?.observe(dial);
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has('size')) {
      this.style.setProperty('--knob-px', `calc(${SIZE_PX[this.size]}px * var(--bi-scale))`);
    }
  }

  render() {
    const s = this.spec;
    if (!s) return html`<span class="note caution">no spec: ${this.path}</span>`;

    const p = clamp01(this.pos);
    const angle = DEG0 + p * SWEEP;
    const held = this.press.value;
    const hov = this.hoverS.value;
    const counter = this.rank === 'counter';

    return html`
      <svg class="dial ink" viewBox="0 0 100 100" @pointerdown=${this.onPointerDown}>
        <defs>${this.halftone(held)}</defs>
        <g style="isolation: isolate">
          ${this.inkPlates(s, p, angle, held, hov, counter)}
        </g>
      </svg>
      ${this.footer(s)}
    `;
  }

/** The dot screen. A counter prints at half density rather than half opacity --
 * less ink, not paler ink, which is what keeps the two ranks reading as the
 * same material rather than as one faded copy of the other. */
  /** True when the cap is large enough that a screen reads as tone. */
  private get screenable(): boolean {
    const capPx = this.dialPx * ((R_CAP * 2) / 100);
    return capPx / DOT_PITCH_PX >= MIN_DOTS_ACROSS;
  }

  /** The dot screen. A counter prints at reduced density rather than reduced
   * opacity -- less ink, not paler ink, which is what keeps the two ranks
   * reading as the same material rather than as one faded copy of the other. */
  private halftone(held: number) {
    if (!this.screenable) return nothing;
    // Pitch is held constant in SCREEN px, not in viewBox units, so the ruling
    // opens up as the control shrinks. That is what print does -- a newspaper
    // runs 85 lpi where a magazine runs 150, because a fine ruling at small
    // size fills in.
    const cell = (100 * DOT_PITCH_PX) / Math.max(12, this.dialPx);
    // DOT GAIN is the press, on a screened plate. Pressed harder, ink spreads
    // and the dots fatten, so the tone deepens without the ruling changing --
    // which is what a printer means by density, and it is the same event the
    // solid plates get from their second hit. A halftoned counter had almost no
    // press state before this; now it has the medium's own one.
    const r = cell * (0.3 + held * 0.11);
    return svg`
      <pattern id=${`${this.gid}ht`} width=${cell.toFixed(3)} height=${cell.toFixed(3)}
               patternUnits="userSpaceOnUse">
        <circle cx=${(cell / 2).toFixed(3)} cy=${(cell / 2).toFixed(3)}
                r=${r.toFixed(3)} fill="var(--ink-key)" />
      </pattern>
    `;
  }

  /**
   * The ink skin, as plates.
   *
   * Drawn in printing order -- key plate last, as it is on press, because the
   * black outline is what pulls a slightly-misregistered set of colour plates
   * back into one legible object. Take the key plate away and the slip stops
   * looking deliberate.
   */
  private inkPlates(
    spec: ParamSpec,
    p: number,
    angle: number,
    held: number,
    hov: number,
    counter: boolean,
  ) {
    const filled = p > 0.002;
    const sx = this.slip.x;
    const sy = this.slip.y;
    const W = counter ? 5 : 9;
    const wellW = this.trackWidth(counter);

    const rad = ((angle - 90) * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);

    return svg`
      <!-- The unprinted well the ink sits in: a flat grey plate, no depth. -->
      <path class="ink-well" d=${arcSvg(CX, CY, R_TRACK, DEG0, DEG1)}
            fill="none" stroke-width=${wellW} stroke-linecap="butt" />
      ${hov > 0.004
        ? svg`<path class="ink-hover" d=${arcSvg(CX, CY, R_TRACK, DEG0, DEG1)}
                    fill="none" stroke-width=${wellW} stroke-linecap="butt"
                    opacity=${hov.toFixed(3)} />`
        : nothing}
      ${this.inkModPlate(spec, counter)}
      ${filled
        ? svg`
          <path class="ink-juice" d=${arcSvg(CX, CY, R_TRACK, DEG0, angle)}
                fill="none" stroke-width=${W} stroke-linecap="butt"
                transform=${`translate(${sx.toFixed(3)} ${sy.toFixed(3)})`} />
          ${held > 0.004
            ? svg`<path class="ink-juice" d=${arcSvg(CX, CY, R_TRACK, DEG0, angle)}
                        fill="none" stroke-width=${(W + held * 3.4).toFixed(2)}
                        stroke-linecap="butt" opacity=${held.toFixed(3)}
                        transform=${`translate(${sx.toFixed(3)} ${sy.toFixed(3)})`} />`
            : nothing}`
        : nothing}
      <!-- The cap prints in the KEY plate, not the colour plate.
           It was juice at first, and the value arc then vanished into it: two
           adjacent shapes in one ink, with the big one being the chrome. The
           rule that fixes it is the same one the crystal skin runs on -- COLOUR
           IS RESERVED FOR SIGNAL -- and it survives the change of medium
           intact, which is a good sign that it was a rule and not a look.
           So: black plate for the object, colour plate for the reading.
           A lead prints it solid; a counter prints the same plate as a dot
           screen. Less ink, not paler ink. -->
      <circle class="ink-cap" cx=${CX} cy=${CY} r=${R_CAP}
              fill=${counter
                ? this.screenable ? `url(#${this.gid}ht)` : 'none'
                : 'var(--ink-key)'} />
      ${this.detentTick(spec, R_TRACK - wellW / 2)}
      <!-- Key plate: the line work, printed last and in register, because it is
           what pulls a slightly-misregistered set of plates back into one
           legible object. -->
      <!-- THE OUTLINE THICKENS INWARD, and the radius is what makes it do so.
           A stroke is centred on its radius, so hover and press were widening
           the cap's SILHOUETTE as well as its rule -- 28.9 units out at rest,
           30.0 held. That is a four percent grow-on-touch, which is the mobile
           game idiom this family threw out, arriving through the back door as a
           side effect of a line weight. Pulling r in by half the extra weight
           pins the outer edge at R_CAP_EDGE and lets the rule eat into the cap
           instead, which is also what more ink actually does to a knocked-out
           shape. -->
      ${(() => {
        const w = 1.8 + hov * 0.9 + held * 2.2;
        return svg`<circle class="ink-key" cx=${CX} cy=${CY}
                           r=${(R_CAP_EDGE - w / 2).toFixed(3)} fill="none"
                           stroke-width=${w.toFixed(2)} />`;
      })()}
      <line class=${counter ? 'ink-key' : 'ink-knockout'}
            x1=${CX + c * (R_CAP * 0.28)} y1=${CY + sn * (R_CAP * 0.28)}
            x2=${CX + c * (R_CAP - 3.5)} y2=${CY + sn * (R_CAP - 3.5)}
            stroke-width=${(3.2 + held * 1.5).toFixed(2)} stroke-linecap="butt" />
    `;
  }

  /** The modulation plate. Same geometry function as the crystal skin -- only
   * the material differs, which is the point of keeping geometry out of the
   * material layer. */
  private inkModPlate(spec: ParamSpec, counter: boolean) {
    if (!this.mod) return nothing;
    const a = modArcAngles(modBand(spec, this.mod), DEG0, DEG1);
    // DERIVED, not R_MOD. The ink well is trapped and therefore wider than the
    // crystal channel, and at the shared radius its outer edge landed exactly
    // on the mod band's inner one -- two hard-edged plates touching with no
    // trough between them, which aliases into a single fatter ring at small
    // sizes and reads as one more thing that is not quite aligned. Placing it
    // off the track it has to clear is the same fix as the detent's.
    const MW = 4;
    const r = R_TRACK + this.trackWidth(counter) / 2 + MOD_GAP + MW / 2;
    // A colour plate, so it carries the same drift the value plate does --
    // both marks of the same plate, one offset. Leaving it in register was the
    // giveaway that the drift was being treated as decoration on one shape
    // rather than as a property of the plate.
    const t = `translate(${this.slip.x.toFixed(3)} ${this.slip.y.toFixed(3)})`;
    return svg`
      <g transform=${t}>
        <path class="ink-mod-well" d=${arcSvg(CX, CY, r, a.bandFrom, a.bandTo)}
              fill="none" stroke-width=${MW} stroke-linecap="butt" />
        <path class="ink-mod" d=${arcSvg(CX, CY, r, a.fillFrom, a.fillTo)}
              fill="none" stroke-width=${MW} stroke-linecap="butt" />
      </g>
    `;
  }

  /**
   * The default's landmark, INSIDE the track.
   *
   * It used to be a fixed 42..46, chosen against the crystal channel and then
   * inherited by everything else, and it collided with both neighbours:
   *
   *   the TRACK, whose outer edge is 41.25 to 44.50 depending on skin and rank
   *   -- so on an ink lead the mark spent its first 2.5 units buried in the
   *   trough and read as a smear on the arc rather than as a tick beside it;
   *
   *   the MOD BAND at 45.0..48.5, which the mark's far end ran into on every
   *   variant, so a modulated control drew a landmark through its own telemetry.
   *
   * Neither was visible in the skin it was tuned for, which is how a hardcoded
   * radius survives: it is correct in exactly one of the four cases somebody
   * looked at. So it is DERIVED now -- from the track's actual inner edge, on
   * the inside, where the gap between the track and the cap is unoccupied in
   * every skin and at every rank and there is nothing to collide with.
   *
   * If that gap is too small to hold a mark, it draws NOTHING rather than a
   * two-unit stub. A landmark too short to be read as deliberate is the same
   * failure as a halftone too coarse to be read as tone.
   */
  private detentTick(s: ParamSpec, trackInner: number) {
    const t = toPos(s, s.init);
    // Suppressed when the default sits at an end of the range: a tick under the
    // channel's own rounded cap reads as a rendering artefact, not a landmark.
    if (t < 0.02 || t > 0.98) return nothing;
    const outer = trackInner - DETENT_GAP;
    const inner = Math.max(R_CAP_EDGE + 0.5, outer - DETENT_LEN);
    if (outer - inner < DETENT_MIN) return nothing;
    const rad = ((DEG0 + t * SWEEP - 90) * Math.PI) / 180;
    const c = Math.cos(rad);
    const sn = Math.sin(rad);
    return svg`<line class="lit detent"
      x1=${(CX + c * inner).toFixed(2)} y1=${(CY + sn * inner).toFixed(2)}
      x2=${(CX + c * outer).toFixed(2)} y2=${(CY + sn * outer).toFixed(2)}
      stroke-width="1.4" stroke-linecap="round" />`;
  }

  private footer(s: ParamSpec) {
    if (this.editing) {
      return html`<input class="edit" type="text" spellcheck="false"
        @keydown=${this.onEditKey} @blur=${this.onEditBlur} />`;
    }
    const unit = unitOf(s);
    return html`
      ${this.density === 'compact' ? nothing : html`<span class="label">${this.displayName}</span>`}
      <span class="readout">
        <span class="value reading">${formatNumber(s, this.effective)}</span>
        ${unit ? html`<span class="value units">${unit}</span>` : nothing}
      </span>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-knob': BiKnob;
  }
}
