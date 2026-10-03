/**
 * Skins: one medium (ink) on two stocks, switchable, with one set of widgets.
 *
 *   ink-dark  opaque inks on black stock -- the default, and the skin for
 *             video and event tools, which live on black.
 *   ink       transparent inks multiplied into paper -- kept for other
 *             products.
 *
 * (A third, "crystal" -- juice as emitted light -- lived here in aal and was
 * deleted on the way into bubbleink.)
 *
 * MECHANISM. A skin is a TOKEN SET on <html data-skin>; a widget in any shadow
 * root inherits it through custom properties without plumbing. ink-dark is
 * also what a page gets with no attribute at all (tokens.css puts it on
 * `:root:not([data-skin='ink'])`), so a consumer that never thinks about skins
 * still renders correctly.
 *
 * Widgets read TOKENS ONLY -- never a literal colour or face -- so a new skin
 * (or a re-themed app) is a new token block, not a code change. `skinOf` stays
 * for the rare structural variant a future skin might need.
 */
export type Skin = 'ink' | 'ink-dark';

export const SKINS: Skin[] = ['ink-dark', 'ink'];

/**
 * What a page gets when nothing says otherwise.
 *
 * Named once and used by both readers below, because the two disagreeing is a
 * bug with no symptom worth noticing: `applySkinFromUrl` sets the attribute
 * and `skinOf` falls back when there is none, so a mismatch shows up only on
 * a page that never called the first -- as widgets structurally built for one
 * material wearing the other's tokens.
 *
 * ink-dark: the dark stock.
 */
export const DEFAULT_SKIN: Skin = 'ink-dark';

/** The skin in force for this element. Reads the document, so one attribute
 * switches everything; a widget may still override with its own `skin`. */
export function skinOf(_el: Element): Skin {
  const d = document.documentElement.dataset.skin;
  return d === 'ink' || d === 'ink-dark' ? d : DEFAULT_SKIN;
}

/**
 * Apply `?skin=` before first paint.
 *
 * Called from the entry module rather than from a component, because a skin
 * applied after the first render is a visible flash of the other material.
 */
export function applySkinFromUrl(): Skin {
  const q = new URLSearchParams(location.search).get('skin');
  const skin: Skin =
    q === 'ink' || q === 'ink-dark' ? q : DEFAULT_SKIN;
  document.documentElement.dataset.skin = skin;
  return skin;
}
