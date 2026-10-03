/**
 * The ANCHOR contract: where a field widget's parts are, for the things that
 * draw around widgets rather than inside them -- selection, wiring pips, learn
 * and connect outlines, and the wire-options lens.
 *
 * A host app needs four answers from every field widget, custom ones
 * included, and must not have to hit-test a widget's private DOM to get them:
 *
 *   selectionRegion   what SELECTS the field without editing it -- the label.
 *                     null when the widget shows none (compact density): the
 *                     host then selects by modifier-click on the full rect.
 *   inputPipAnchor    where the input pip sits while the field is selected, in
 *                     viewport px.
 *   fullRect          the whole widget for that field: learn/connect outlines
 *                     and the lens anchor.
 *   outputAnchors     published outputs, for widgets that have them.
 *
 * Every method takes an optional `path` so one element can carry several
 * fields (an XY pad is two). A single-field widget ignores it.
 *
 * Rects are read LIVE (getBoundingClientRect at call time): the callers are
 * per-frame overlays that already re-resolve geometry each rAF, and a cached
 * rect is wrong the moment anything scrolls.
 */

export interface AnchorPoint { x: number; y: number }

export interface FieldAnchors {
  /** The field paths this element edits. */
  anchorPaths(): string[];
  selectionRegion(path?: string): Element | null;
  inputPipAnchor(path?: string): AnchorPoint | null;
  fullRect(path?: string): DOMRect;
  outputAnchors?(): { path: string; at: AnchorPoint }[];
}

export function hasFieldAnchors(el: unknown): el is FieldAnchors & Element {
  return !!el && typeof (el as FieldAnchors).anchorPaths === 'function'
    && typeof (el as FieldAnchors).fullRect === 'function';
}

/** The pip's place beside a label: just left of its first glyph, centred on
 * the line. Falls back to the host's left edge when there is no label. */
export function pipBeside(label: Element | null, host: Element): AnchorPoint {
  const r = (label ?? host).getBoundingClientRect();
  return { x: r.left - 7, y: r.top + r.height / 2 };
}

interface SingleFieldHost extends HTMLElement {
  path: string;
  readonly renderRoot: HTMLElement | DocumentFragment;
}

/**
 * The default for a single-field widget whose label is a `.label` in its
 * shadow root: install it on the class's prototype once.
 *
 *     installLabelAnchors(BiToggle);
 *     export interface BiToggle extends FieldAnchors {}
 */
export function installLabelAnchors(cls: { prototype: SingleFieldHost }): void {
  const proto = cls.prototype as unknown as SingleFieldHost & FieldAnchors;
  const label = (el: SingleFieldHost): Element | null => {
    const l = el.renderRoot?.querySelector?.('.label') ?? null;
    // A label hidden by density CSS has no box; it selects nothing.
    return l && (l as HTMLElement).getClientRects().length > 0 ? l : null;
  };
  proto.anchorPaths = function (this: SingleFieldHost) { return this.path ? [this.path] : []; };
  proto.selectionRegion = function (this: SingleFieldHost) { return label(this); };
  proto.inputPipAnchor = function (this: SingleFieldHost) { return pipBeside(label(this), this); };
  proto.fullRect = function (this: SingleFieldHost) { return this.getBoundingClientRect(); };
}
