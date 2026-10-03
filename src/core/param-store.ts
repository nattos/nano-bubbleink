/**
 * The concrete FieldBinding for this testbed: a flat param store with undo.
 *
 * FLOAT32, DELIBERATELY. nano-unit's parameter store is float32 and a client
 * that sets a parameter is never told the value that was actually kept, so a
 * UI holding the float64 it typed slowly disagrees with the engine. nano-lfo
 * measured 1.8e-8 of drift between its editor's grid and the engine's before
 * it started rounding at the call site (plugin/ui/app.ts:283-303). Quantizing
 * HERE, on the way in, means every widget reads back exactly what the engine
 * would have — and we find any place that assumed otherwise now, in a gallery,
 * rather than later against a real host.
 */
import { Emitter } from './store';
import { fromPos, toPos, type ParamSpec } from './schema';
import type {
  ContinuousEditHandle, FieldBinding, ModState, MultiContinuousEditHandle,
  TextBinding, TextSpec,
} from './binding';

/** What a host needs to record an automation pass as a gesture, not as noise.
 * Mirrors nano-unit's `param` channel events. */
export type GestureEvent =
  | { kind: 'begin'; ids: string[] }
  | { kind: 'end'; ids: string[] };

/**
 * One undo point.
 *
 * Values and document text share ONE stack, and that is the whole reason
 * ParamStore implements both interfaces rather than there being a second store
 * next to it. Two stacks means Cmd-Z sometimes undoes the rename you did three
 * actions ago instead of the knob you just turned, which is not a smaller bug
 * for being an obvious one.
 */
interface UndoEntry {
  before: Record<string, number>;
  after: Record<string, number>;
  /** Text fields touched by this entry, when there are any. */
  textBefore?: Record<string, string>;
  textAfter?: Record<string, string>;
}

const f32 = (v: number) => Math.fround(v);

export class ParamStore implements FieldBinding, TextBinding {
  readonly changed = new Emitter();
  readonly specs = new Map<string, ParamSpec>();

  private values = new Map<string, number>();
  private texts = new Map<string, string>();
  private textSpecs = new Map<string, TextSpec>();
  private mod = new Map<string, ModState>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  /** The gesture currently in flight. Only one at a time — that constraint is
   * the whole reason `beginContinuousEditMulti` exists. */
  private active: { before: Record<string, number>; ids: string[] } | null = null;

  private gestureSink: ((e: GestureEvent) => void) | null = null;

  constructor(specs: ParamSpec[] = []) {
    for (const s of specs) this.add(s);
  }

  add(spec: ParamSpec): void {
    this.specs.set(spec.id, spec);
    if (!this.values.has(spec.id)) this.values.set(spec.id, f32(spec.init));
  }

  spec(path: string): ParamSpec | undefined {
    return this.specs.get(path);
  }

  /** Route gesture boundaries somewhere — a host bridge, or a test. */
  onGesture(fn: ((e: GestureEvent) => void) | null): void {
    this.gestureSink = fn;
  }

  getValue(path: string): number {
    const v = this.values.get(path);
    if (v !== undefined) return v;
    // An unknown path resolves to its spec's init rather than 0. A missing
    // param that silently reads zero plots a perfectly plausible wrong answer;
    // reading the declared default at least matches what the engine booted to.
    return f32(this.specs.get(path)?.init ?? 0);
  }

  /** Position on the widget's own axis, [0,1], with the spec's curve applied. */
  getPos(path: string): number {
    const s = this.specs.get(path);
    return s ? toPos(s, this.getValue(path)) : 0;
  }

  /** Inverse of `getPos`; what a drag handler converts its pointer into. */
  valueAtPos(path: string, pos: number): number {
    const s = this.specs.get(path);
    return s ? fromPos(s, pos) : pos;
  }

  setValue(path: string, value: number): void {
    const before = { [path]: this.getValue(path) };
    if (!this.write(path, value)) return;
    this.pushUndo({ before, after: { [path]: this.getValue(path) } });
    this.changed.emit();
  }

  // ---- the document channel (TextBinding) ----

  /** Declare a text field. Like `add`, the initial value is only taken if the
   * field is not already present, so restoring a document before declaring its
   * schema does not wipe it. */
  addText(path: string, init = '', spec?: TextSpec): void {
    if (spec) this.textSpecs.set(path, spec);
    if (!this.texts.has(path)) this.texts.set(path, init);
  }

  getText(path: string): string {
    return this.texts.get(path) ?? '';
  }

  setText(path: string, value: string): void {
    const before = this.getText(path);
    if (before === value) return;
    this.texts.set(path, value);
    this.pushUndo({ before: {}, after: {}, textBefore: { [path]: before },
                    textAfter: { [path]: value } });
    this.changed.emit();
  }

  textSpec(path: string): TextSpec | undefined {
    return this.textSpecs.get(path);
  }

  beginContinuousEdit(path: string, value: number): ContinuousEditHandle {
    const multi = this.beginMulti({ [path]: value });
    return {
      update: (v) => multi.update({ [path]: v }),
      accept: () => multi.accept(),
      cancel: () => multi.cancel(),
    };
  }

  beginContinuousEditMulti(values: Record<string, number>): MultiContinuousEditHandle {
    return this.beginMulti(values);
  }

  getModulation(path: string): ModState | null {
    return this.mod.get(path) ?? null;
  }

  /** Push live modulation telemetry. In the real plugin this arrives on a
   * diff channel from the engine; here the mock engine writes it. */
  setModulation(path: string, m: ModState | null): void {
    if (m) this.mod.set(path, m);
    else this.mod.delete(path);
    // No emit: modulation moves every frame, and a store-wide notification per
    // frame would re-render the whole panel. Controls poll it in their own rAF
    // and only re-render when it actually changes — see `ModPoller`.
  }

  undo(): void {
    const e = this.undoStack.pop();
    if (!e) return;
    for (const [k, v] of Object.entries(e.before)) this.write(k, v);
    for (const [k, v] of Object.entries(e.textBefore ?? {})) this.texts.set(k, v);
    this.redoStack.push(e);
    this.changed.emit();
  }

  redo(): void {
    const e = this.redoStack.pop();
    if (!e) return;
    for (const [k, v] of Object.entries(e.after)) this.write(k, v);
    for (const [k, v] of Object.entries(e.textAfter ?? {})) this.texts.set(k, v);
    this.undoStack.push(e);
    this.changed.emit();
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  /**
   * Set boot state WITHOUT an undo entry.
   *
   * A patch loaded from disk, a preset recalled, a demo authored off its
   * defaults: none of those are edits the user made, and putting them on the
   * undo stack means the first Cmd-Z of a session silently reverts the file
   * they just opened. `restore` is the one that IS an edit -- it is what a
   * preset BUTTON does, mid-session, and that the user does want back.
   */
  seed(values: Record<string, number>): void {
    let dirty = false;
    for (const [k, v] of Object.entries(values)) dirty = this.write(k, v) || dirty;
    if (dirty) this.changed.emit();
  }

  /** Snapshot / restore, for presets and for the gallery's reset button. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  restore(v: Record<string, number>): void {
    const before = this.snapshot();
    for (const [k, val] of Object.entries(v)) this.write(k, val);
    this.pushUndo({ before, after: this.snapshot() });
    this.changed.emit();
  }

  // ---- internals ----

  /** Returns false when the value did not actually move, so a no-op drag does
   * not manufacture an undo entry. Clamped and quantized on the way in. */
  private write(path: string, value: number): boolean {
    const s = this.specs.get(path);
    let v = value;
    if (s) v = Math.max(s.min, Math.min(s.max, v));
    v = f32(v);
    if (!Number.isFinite(v)) return false;
    if (this.values.get(path) === v) return false;
    this.values.set(path, v);
    return true;
  }

  private beginMulti(values: Record<string, number>): MultiContinuousEditHandle {
    // A second gesture starting while one is live means a widget forgot to
    // finish. Accept the old one rather than dropping it: the user's completed
    // drag becoming a silent no-op is the worse failure.
    if (this.active) this.finish(true);

    const ids = Object.keys(values);
    const before: Record<string, number> = {};
    for (const id of ids) before[id] = this.getValue(id);
    this.active = { before, ids };
    this.gestureSink?.({ kind: 'begin', ids });

    let dirty = false;
    for (const [k, v] of Object.entries(values)) dirty = this.write(k, v) || dirty;
    if (dirty) this.changed.emit();

    return {
      update: (next) => {
        if (this.active === null) return;
        let moved = false;
        for (const [k, v] of Object.entries(next)) moved = this.write(k, v) || moved;
        if (moved) this.changed.emit();
      },
      accept: () => this.finish(true),
      cancel: () => this.finish(false),
    };
  }

  private finish(commit: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = null;

    if (!commit) {
      for (const [k, v] of Object.entries(a.before)) this.write(k, v);
    } else {
      const after: Record<string, number> = {};
      let moved = false;
      for (const id of a.ids) {
        after[id] = this.getValue(id);
        if (after[id] !== a.before[id]) moved = true;
      }
      // A gesture that ended where it started is not an undo entry.
      if (moved) this.pushUndo({ before: a.before, after });
    }
    this.gestureSink?.({ kind: 'end', ids: a.ids });
    this.changed.emit();
  }

  private pushUndo(e: UndoEntry): void {
    this.undoStack.push(e);
    // A new edit invalidates the redo branch.
    this.redoStack.length = 0;
    if (this.undoStack.length > 200) this.undoStack.shift();
  }
}
