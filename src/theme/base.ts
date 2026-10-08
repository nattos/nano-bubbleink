/**
 * The shared style block every widget composes into its own `static styles`.
 *
 *   static styles = [base, css`...`];
 *
 * It carries the type ramp, the numeric-display discipline, and the two label
 * treatments — nothing positional. A widget that needs a token reads it with
 * var(); a widget that needs one on a CANVAS reads it with cssVar() below,
 * because there must not be a second copy of the palette in TypeScript.
 */
import { css } from 'lit';

export const base = css`
  :host {
    /* SCALED ALIASES. --bi-scale is the host zoom, and it has to move
     * typography and spacing as well as geometry -- a widget whose dial shrinks
     * to 40% while its label stays at 10px is not a smaller widget, it is a
     * broken one, and the gallery's 40% column exists precisely to catch that.
     * Widgets use these; only page chrome uses the raw --app-* tokens. */
    --fs-xs: calc(var(--app-fs-xs) * var(--bi-scale));
    --fs-sm: calc(var(--app-fs-sm) * var(--bi-scale));
    --fs-md: calc(var(--app-fs-md) * var(--bi-scale));
    --fs-lg: calc(var(--app-fs-lg) * var(--bi-scale));
    --sp-1: calc(var(--app-sp-1) * var(--bi-scale));
    --sp-2: calc(var(--app-sp-2) * var(--bi-scale));
    --sp-3: calc(var(--app-sp-3) * var(--bi-scale));
    --sp-4: calc(var(--app-sp-4) * var(--bi-scale));

    /* THE JUICE RAMP, derived per widget from the --accent it inherited.
     *
     * It cannot live in :root -- see the note in theme/tokens.css. A custom
     * property is substituted where it is DECLARED, so a :root derivation
     * freezes against :root's accent and every re-accented control comes out
     * half-colored. Declaring it here re-derives it at every widget boundary.
     *
     *   hot   the emissive core -- lit liquid, meniscus, the mark you read
     *   deep  the shadowed underside of a volume
     *   glow  the bloom around it
     *   wash  the tint glass picks up from juice behind it
     */
    --juice: var(--accent);
    /* LIFT and SINK are the two directions a juice can be pushed, and the SKIN
     * decides what they are -- which is the whole reason one derivation serves
     * two opposite materials. Under crystal, lifting a color means adding
     * light, so lift is white and sink is near-black. Under ink, lifting means
     * laying LESS pigment, so lift is the paper and sink is a dark ink. Mixing
     * toward white on paper would give chalk, not a lighter print. */
    --juice-hot: color-mix(in srgb, var(--accent) 55%, var(--juice-lift));
    --juice-deep: color-mix(in srgb, var(--accent) 72%, var(--juice-sink));
    --juice-glow: color-mix(in srgb, var(--accent) 40%, transparent);
    --juice-wash: color-mix(in srgb, var(--accent) 13%, transparent);

    /* THE CHIP, assembled here rather than in tokens.css.
     *
     * It has to be here for the same reason the ramp above does: these
     * reference --juice, and a custom property is substituted where it is
     * DECLARED. Written at :root -- where no --juice exists -- the whole
     * declaration becomes guaranteed-invalid and the chip silently paints
     * nothing. So the skin supplies only juice-INDEPENDENT scalars
     * (--chip-sink, --chip-sheen, --chip-far, --chip-disperse,
     * --chip-glow-size) and the composition happens once, here.
     *
     * --chip-sink: 0% collapses the gradient to a flat fill, which is how the
     * ink skin gets a printed plate without naming a color. */
    --chip-bg: linear-gradient(
      180deg,
      var(--juice) 0%,
      color-mix(in srgb, var(--juice-deep) var(--chip-sink), var(--juice)) 100%
    );
    --chip-shadow:
      inset 0 1px 0 var(--chip-sheen),
      inset 0 -1px 0 color-mix(in srgb, var(--juice-hot) var(--chip-far), transparent),
      inset 0 -3px 5px -2px var(--chip-disperse),
      0 0 var(--chip-glow-size) var(--juice-glow);
    /* For SCREEN-blended layers, where the alpha ramp is doing the shaping and
     * the color must stay at full chroma -- a pre-diluted color screened over
     * black is just a dimmer color, which is the muddy version again. */
    --juice-pure: var(--accent);

    box-sizing: border-box;
    font-family: var(--app-mono);
    font-size: var(--fs-md);
    color: var(--app-text-color1);
    /* Numerals must not dance while a value changes. Set once, at the root of
     * every widget, rather than per-readout where it is easy to forget. */
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
  }
  :host *,
  :host *::before,
  :host *::after {
    box-sizing: inherit;
  }

  /* A field's own name. Sentence case, secondary — it sits next to its value
   * and must not out-shout it. */
  .label {
    font-size: var(--fs-sm);
    color: var(--app-text-color2);
    letter-spacing: var(--app-tr-2);
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A structural heading — a section, a group, an axis. Uppercase and tracked;
   * these are signposts, not prose. */
  .heading {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--app-text-color2);
    text-transform: uppercase;
    letter-spacing: var(--app-tr-3);
    user-select: none;
  }

  .value {
    font-size: var(--fs-xs);
    color: var(--app-text-color1);
    user-select: none;
  }

  .units {
    color: var(--app-text-color3);
  }

  /*
   * A READING RESERVES ITS RANGE, NOT ITS VALUE.
   *
   * Put this on the span that holds a changing number and set --reading-ch from
   * core/format.ts's readingChars(). The box is then as wide as the widest
   * value the parameter can ever produce, from the first frame, so nothing
   * reflows when the value crosses a power of ten -- which on a knob (whose
   * width is max(dial, readout)) would otherwise re-lay-out the entire row.
   * The full reasoning, including why characters rather than pixels, is on
   * readingChars.
   *
   * RIGHT-ALIGNED, and that is not a style choice. Decimals are fixed, so
   * right-aligning pins the decimal point: 440.0 and 7040.0 line up on the
   * point and the digits after it never move. Centering would slide the point by
   * half a character per digit, which is the jitter this class exists to
   * remove, merely smaller.
   *
   * min-width rather than width, so a reading that somehow exceeds its declared
   * range -- a modulation band overshooting, a mixed-selection placeholder --
   * grows instead of being clipped. Reserve, do not clamp: a number that is
   * cut off is worse than a layout that moved.
   *
   * MEASURED, sweeping every parameter in the gallery over its full range and
   * watching all 438 widgets:
   *
   *   without the reservation   worst width change 11.59 px  (a whole digit)
   *   with it                   worst width change  0.02 px
   *
   * The 0.02 px residual is 1ch disagreeing with the glyph advance by about
   * three thousandths of a pixel per character -- a font-metric rounding
   * artifact, an order of magnitude below one device pixel at 2x, and in both
   * directions rather than accumulating. It is recorded here so the next
   * person knows it is a known bound rather than something nobody looked at.
   * Chasing it would mean a magic constant, which is a worse file.
   */
  .reading {
    display: inline-block;
    min-width: calc(var(--reading-ch, 0) * 1ch);
    text-align: right;
    white-space: nowrap;
  }

  /* Tertiary explanation that stays put. The house position is that a caveat
   * belongs under the control it qualifies, not behind a hover. */
  .note {
    font-size: var(--fs-xs);
    color: var(--app-text-color3);
    line-height: 1.5;
  }

  .caution {
    color: var(--app-caution);
  }

  :host([disabled]) {
    /* Reachability is the ONE thing alpha is allowed to mean. */
    opacity: 0.42;
    pointer-events: none;
  }
`;

/**
 * Read a design token as a concrete string, for canvas code.
 *
 * Canvas cannot resolve var(), so the alternative is a second copy of the
 * palette in TypeScript — and two tables that agree today are two tables that
 * disagree after one edit. Resolving from the live element keeps one source of
 * truth and picks up a per-instance --accent for free.
 *
 * Cached per (element, name): getComputedStyle forces style resolution, and a
 * draw loop that calls it per frame per colour is a measurable cost for a value
 * that changes approximately never. Call `clearCssVarCache()` if a theme swap
 * is ever added.
 */
const varCache = new WeakMap<Element, Map<string, string>>();

export function cssVar(el: Element, name: string, fallback = '#000'): string {
  let m = varCache.get(el);
  if (!m) {
    m = new Map();
    varCache.set(el, m);
  }
  const hit = m.get(name);
  if (hit !== undefined) return hit;
  const v = getComputedStyle(el).getPropertyValue(name).trim() || fallback;
  m.set(name, v);
  return v;
}

export function clearCssVarCache(el: Element): void {
  varCache.delete(el);
}
