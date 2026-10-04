/**
 * The contract between a widget and whatever holds its value.
 *
 * Ported from nano-modules/web/src/widgets/field-editor.ts, which is the single
 * best structural decision in any of the prior art: widgets know how to render
 * and edit a value and NOTHING else. They do not know what a patch is, whether
 * they are inside a plugin or a gallery, or what an undo stack is. That is what
 * makes the same `<bi-knob>` work against a mock engine here and against
 * nano-unit's param store later, unmodified.
 *
 * The load-bearing idea is `ContinuousEditHandle`. A drag is not a stream of
 * sets — it is ONE edit with a live preview. `update()` previews without
 * touching undo; `accept()` commits the whole gesture as a single undo entry;
 * `cancel()` reverts to where the gesture started. Both existing nano UIs
 * skipped this and both consequently produce one undo entry per pointermove.
 *
 * It also maps exactly onto nano-unit's `param begin / set / end` gesture
 * events, which is what a host needs to record an automation pass as a gesture
 * rather than as noise.
 *
 * Deliberately NOT ported: the `?`-help layer and the multi-target `inUseValues`
 * from nano-modules. Both are real, both belong to a patching editor we do not
 * have yet, and an interface member nothing implements is a member that rots.
 */

/** Live modulation telemetry for one field. All values in the field's own units. */
export interface ModState {
  /** The effective value right now, after modulation. */
  value: number;
  /** The swing band the modulation can reach. */
  min: number;
  max: number;
  /** The anchor the filled bar grows FROM — the base value for additive
   * modulation, the range midpoint for bipolar replace, 0 for multiplicative.
   * Without it, fast modulation renders as a flickering dot instead of a
   * growing bar. */
  neutral: number;
}

export interface ContinuousEditHandle {
  /** Preview during the drag. No undo point. */
  update(value: number): void;
  /** Commit the gesture as exactly one undo point. */
  accept(): void;
  /** Revert to the pre-gesture value. */
  cancel(): void;
}

export interface MultiContinuousEditHandle {
  update(values: Record<string, number>): void;
  accept(): void;
  cancel(): void;
}

export interface FieldBinding {
  getValue(path: string): number;
  /** One-shot write. Creates its own undo point. */
  setValue(path: string, value: number): void;

  beginContinuousEdit(path: string, value: number): ContinuousEditHandle;

  /**
   * One gesture spanning SEVERAL fields — an XY pad, a vector paint, a matrix
   * cell drag. Required rather than convenient: only one long edit may be
   * active at a time, so two `beginContinuousEdit` calls cancel each other and
   * an XY drag would commit only its second axis.
   */
  beginContinuousEditMulti?(values: Record<string, number>): MultiContinuousEditHandle;

  /** Null when the field is not modulated. Optional — widgets must tolerate
   * its absence, since a plain gallery binding has no modulation at all. */
  getModulation?(path: string): ModState | null;

  /** Multi-target editing: the bound targets disagree about this field, so the
   * widget shows a "many" placeholder rather than one target's value. Absent on
   * single-target bindings; treat absence as false. */
  isMixed?(path: string): boolean;

  /** Multi-target editing: the values the bound targets hold between them (in
   * the field's own units -- an enum's choice values), so an enumerated widget
   * can mark every one in use rather than none. Absent: treat a mixed field as
   * using everything. */
  inUseValues?(path: string): number[];

  /** Descriptor lookup, so a widget needs no hand-passed min/max/unit/curve. */
  spec(path: string): import('./schema').ParamSpec | undefined;
}

/**
 * What a text field binds to, and why it is a SEPARATE interface.
 *
 * A parameter is a float. Not "usually" a float -- nano-unit's store is a
 * flat array of float32 and there is nowhere in it for a string to be, which
 * is correct: a host automates parameters, and a patch name is not something
 * you draw an automation lane for.
 *
 * But a patch HAS a name, and presets have names, and a scientific surface
 * accumulates annotations that have to survive a save. nano-unit's schema
 * already anticipates this -- `docFields: {path, init: unknown}[]`, a document
 * channel alongside the parameter channel -- so the shape exists and nothing
 * has used it yet.
 *
 * Keeping it off FieldBinding is deliberate. A FieldBinding whose getValue
 * might return a string is one every scalar control has to defend against, and
 * the defence would be spread across eight widgets. A store can implement both
 * interfaces -- ours does -- and a widget declares which half it needs.
 *
 * There is no continuous-edit handle here. A text edit is not a gesture with a
 * live preview; it is a draft the user is holding and then either commits or
 * throws away, and the draft lives in the input element where the user can see
 * it. Writing every keystroke through the store so it can be undone
 * keystroke-by-keystroke is the same mistake as one undo entry per pointermove.
 */
export interface TextBinding {
  getText(path: string): string;
  /** Commit. One undo point, like `setValue`. */
  setText(path: string, value: string): void;
  /** Optional descriptor -- label, placeholder, and whether the field is prose
   * or a single line. Absent means the widget's own attributes decide. */
  textSpec?(path: string): TextSpec | undefined;
}

export interface TextSpec {
  name?: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
}
