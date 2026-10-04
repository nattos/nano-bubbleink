/**
 * The plumbing every scalar control shares.
 *
 * Drag handling, DPR maths and value plumbing are copy-pasted into roughly
 * eight files across nano-lfo with no shared helper, and the result is that the
 * same three behaviours are subtly different in each. This class exists so
 * there is exactly one implementation of:
 *
 *   - reading a value and its spec through a FieldBinding
 *   - a spring that tracks 1:1 while dragging and animates otherwise
 *   - the continuous-edit lifecycle (one gesture, one undo point)
 *   - clock-throttled commits with a trailing flush
 *   - modulation polling
 *   - keyboard jog, with autorepeat coalesced into ONE undo point
 *   - type-to-edit, reset, and the Escape-vs-blur guard
 *
 * Subclasses supply geometry and a render, and convert a pointer position into
 * a normalized [0,1] position on their own axis. Nothing else.
 */
import { LitElement, type PropertyValues } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { PointerDragOp, Throttle } from '../core/drag';
import { Spring } from '../core/spring';
import { FrameLoop, ChangePoller } from '../core/canvas';
import { fromPos, toPos, type ParamSpec } from '../core/schema';
import { formatNumber, parseValue, readingChars, unitOf } from '../core/format';
import type { ContinuousEditHandle, FieldBinding, ModState } from '../core/binding';
import { installLabelAnchors, type FieldAnchors } from '../core/anchors';

export type Density = 'compact' | 'normal' | 'expanded';

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * KEYBOARD JOG, in POSITION space.
 *
 * Same reason the drag is in position space: on a log-curved parameter equal
 * key presses must be equal octaves, or the bottom of the range takes two
 * hundred presses to cross and the top takes four.
 *
 * 2% of the sweep per press is fifty presses end to end -- on a 270-degree
 * knob that is 5.4 degrees, which is a visible move rather than a twitch. Shift
 * is fine at a tenth of that, matching the modifier's meaning everywhere else;
 * PageUp/PageDown are ten coarse steps, so a long range is still crossable.
 */
const JOG_STEP = 0.02;
const JOG_FINE = 0.002;
const JOG_PAGE = 10;

/**
 * How long a jog gesture stays open after the last press.
 *
 * Key AUTOREPEAT is one gesture, not thirty. Holding an arrow key emits a
 * keydown every ~33ms and exactly one keyup, so the obvious implementation --
 * setValue per keydown -- fills the undo stack with a frame-by-frame recording
 * of a press the user experienced as one action. That is precisely the failure
 * ContinuousEditHandle exists to prevent, and it is worth noting that the
 * ported prior art has it: editable-number emits one `input` per jog.
 *
 * So a jog opens a continuous edit and holds it. keyup closes it, which makes
 * three separate taps three undo entries -- correct, they were three actions.
 * This timeout is the backstop for the keyup that never arrives: the window
 * loses focus mid-repeat, or a host swallows the event. Long enough not to
 * split a slow deliberate repeat, short enough that the next edit is not
 * silently merged into this one.
 */
const JOG_IDLE_MS = 600;

/**
 * The smallest type this family will print, in CSS px.
 *
 * Below it, a label is not a small label -- it is a smudge that still costs
 * the space a legible one would have cost. bi-graph found this first with its
 * tick labels at 40% zoom (3.6px, eating a third of the plot for a gutter of
 * grey fuzz); the answer there and here is the same: drop the type and give
 * the space back, so a dense density degrades to a sparser one rather than to
 * an unreadable copy of itself.
 *
 * It is minMark for type. A mark too small to be understood is
 * indistinguishable from a bug.
 */
export const MIN_TYPE_PX = 7;

/** Arrow/page keys, as a signed number of coarse steps. */
const JOG_KEYS: Record<string, number> = {
  ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1,
  PageUp: JOG_PAGE, PageDown: -JOG_PAGE,
};

export abstract class ScalarControl extends LitElement {
  /** The store this control reads and writes. Required -- there is deliberately
   * no standalone value mode, because a widget that can hold its own value is a
   * widget that will eventually disagree with the engine about it. */
  @property({ attribute: false }) binding!: FieldBinding;
  @property({ type: String }) path = '';

  @property({ type: String, reflect: true }) density: Density = 'normal';

  /**
   * RANK -- the visual hierarchy, and the reason a panel of these is readable.
   *
   * Every control in isolation looked good and eight of them together were
   * mud, because they all shouted equally: eight glowing arcs on one surface
   * average out to a wash and the eye has nowhere to land. Density does not fix
   * this -- density is about how much INFORMATION a control shows, and these
   * were all equally loud at every density.
   *
   * So rank is a separate axis, and it is a COUNTERPOINT rather than a dimmer
   * switch. `counter` is not a quieter `lead`; it is the same material with
   * figure and ground exchanged:
   *
   *   lead     juice INSIDE the glass. A filled arc with bloom, a luminous
   *            volume, light coming out of the control.
   *   counter  juice only on the EDGE of the glass. A hairline in a black
   *            channel, an unlit body, light falling across the control.
   *
   * Same vocabulary, inverted, so a group reads as one idea with a subject and
   * its accompaniment rather than as a loud thing next to a faint thing. The
   * house guidance is one or two leads per group and everything else counter.
   */
  @property({ type: String, reflect: true }) rank: 'lead' | 'counter' = 'lead';
  /** Overrides the spec's name, for when the surrounding group already says
   * what this is and repeating it is noise. */
  @property({ type: String }) label = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  /** Reflected so CSS can respond to it. */
  @property({ type: Boolean, reflect: true }) modulated = false;
  /** Multi-target editing: the targets disagree (binding.isMixed). The reading
   * says "many" and the value marks hide -- one target's value drawn as THE
   * value would be a lie. The first edit aligns them all. Reflected for CSS. */
  @property({ type: Boolean, reflect: true }) mixed = false;
  /** The control alone: no name, no reading. For a host that labels it
   *  itself at a size where type would not fit (a hardware surface's cells). */
  @property({ type: Boolean, reflect: true }) bare = false;

  @state() protected editing = false;
  @state() protected mod: ModState | null = null;
  /** Bumped to force a re-render when state outside Lit moves. */
  @state() protected rev = 0;

  @query('.edit') private editEl?: HTMLInputElement;

  /**
   * The handle position, normalized [0,1]. A PLAIN NUMBER, not a spring.
   *
   * This used to be sprung on the `snap` tier, and that was wrong for the
   * reason set out at the top of core/spring.ts: the handle represents a
   * temporal process, so it must show that process at time t and nothing else.
   * Easing it asserts a sweep the parameter never performed -- most visibly on
   * undo, where the dial animates a gesture the user did not make, and on a
   * modulated parameter, where the whole point of the reading is the shape of
   * the signal and a spring reports a smoothed copy of it.
   *
   * So the handle is assigned, never animated. What moves in this family is
   * everything that is not the value.
   */
  protected pos = 0;

  /**
   * Press state, 0 released to 1 held. Chrome -- it encodes no value -- so it
   * is sprung, on `pop`, and allowed the bounce the handle is not.
   *
   * Subclasses decide what it MEANS. It must not mean "scale the control down":
   * a shrink-on-touch is a mobile-game idiom and reads as one. In this family it
   * drives the juice -- the value fill blooms and the glass over it brightens --
   * so the feedback is the material responding rather than the object receding.
   */
  protected readonly press = new Spring(0, 'pop', 1e-3);

  /**
   * Hover state, 0 to 1, on `snap` and with no bounce.
   *
   * Hover and press are ONE CONTINUUM, not two effects, and that is why hover
   * lives here next to press rather than in a :hover rule. The pointer
   * approaches, the control acknowledges it; the pointer presses, the same
   * property goes further. A CSS :hover and a sprung press would move the same
   * material two different ways and the handover between them would be visible.
   *
   * `snap` rather than `pop`: a control that bounces every time the pointer
   * crosses it is a page that will not sit still, and unlike a press, a hover
   * is not something the user decided to do.
   */
  protected readonly hoverS = new Spring(0, 'snap', 1e-3);

  private readonly loop = new FrameLoop((dt) => {
    const moving = this.press.tick(dt) || this.hoverS.tick(dt);
    this.rev++;
    return moving;
  });


  private drag: PointerDragOp | null = null;
  private handle: ContinuousEditHandle | null = null;
  private readonly throttle = new Throttle(16);
  private unsubscribe: (() => void) | null = null;
  private modPoller: ChangePoller<ModState | null> | null = null;
  private editCancelled = false;
  private jogHandle: ContinuousEditHandle | null = null;
  private jogTimer = 0;

  /** Where the gesture started, in position space. */
  protected dragStartPos = 0;

  // ---- subclass hooks ----

  /**
   * Convert a pointer event and its gesture delta into a normalized position.
   *
   * Position space, not value space: on a log-curved parameter equal pixels
   * must be equal octaves, and working in value space makes the bottom of the
   * range unusable while the top is hypersensitive.
   */
  protected abstract positionFor(e: PointerEvent, delta: [number, number]): number;

  /** True to begin tracking from pointerdown rather than after the 5px
   * threshold -- for controls that jump to the cursor on press, where waiting
   * would make the first press feel dead. */
  protected get trackImmediately(): boolean {
    return false;
  }

  // ---- lifecycle ----

  connectedCallback(): void {
    super.connectedCallback();
    if (this.tabIndex < 0) this.tabIndex = 0;
    this.addEventListener('keydown', this.onKeyDown);
    this.addEventListener('keyup', this.onKeyUp);
    this.addEventListener('blur', this.endJog);
    this.addEventListener('contextmenu', this.onContextMenu);
    this.addEventListener('pointerenter', this.onPointerEnter);
    this.addEventListener('pointerleave', this.onPointerLeave);
    // Values live outside Lit, so the control redraws from a subscription
    // rather than waiting to be re-rendered -- see core/store.ts.
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.syncFromStore()) ?? null;
    this.startModPoll();
    this.syncFromStore();
    this.reserveReading();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.onKeyDown);
    this.removeEventListener('keyup', this.onKeyUp);
    this.removeEventListener('blur', this.endJog);
    this.removeEventListener('contextmenu', this.onContextMenu);
    this.removeEventListener('pointerenter', this.onPointerEnter);
    this.removeEventListener('pointerleave', this.onPointerLeave);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.modPoller?.stop();
    this.modPoller = null;
    this.loop.stop();
    // A widget removed mid-gesture must abort it, or the window listeners the
    // drag installed outlive the element that owned them.
    this.drag?.dispose();
    this.endJog();
    this.throttle.cancel();
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('binding') || changed.has('path')) {
      this.syncFromStore();
      this.reserveReading();
    }
  }

  /**
   * Publish the reading's reserved width, once, as a host custom property.
   *
   * On the HOST rather than on the readout span, because two different things
   * need it -- the readout and the type-to-edit box that replaces it -- and
   * they must agree or pressing a digit resizes the control. Inherited as a
   * plain number and turned into a width by `ch` in whichever span uses it, so
   * one reservation serves spans at three different font sizes.
   *
   * Set from the SPEC, so it is computed when the parameter changes and never
   * when its value does. That is the whole point: see readingChars.
   */
  protected reserveReading(): void {
    const s = this.spec;
    if (!s) return;
    const n = readingChars(s);
    this.style.setProperty('--reading-ch', String(n));
    // The editor replaces the number AND its unit -- the readout prints
    // "440.0 Hz" and the box you type into holds "440.0" -- so it needs the
    // width of the whole reading, not of the number. Plus two for the caret
    // and the box's own border, which the readout does not carry.
    const u = unitOf(s);
    this.style.setProperty('--edit-ch', String(n + (u ? u.length + 1 : 0) + 2));
  }

  // ---- state ----

  protected get spec(): ParamSpec | undefined {
    return this.binding?.spec(this.path);
  }

  protected get value(): number {
    return this.binding?.getValue(this.path) ?? 0;
  }

  /** The value the engine is actually using: the modulated one when there is
   * modulation, the set one otherwise. Readouts show this; handles show the set
   * value, and conflating them would leave no way to see the difference. */
  protected get effective(): number {
    return this.mod ? this.mod.value : this.value;
  }

  /** The host's zoom. Read from the live token so there is no second copy. */
  protected get scale(): number {
    return parseFloat(getComputedStyle(this).getPropertyValue('--bi-scale')) || 1;
  }

  /** True when the smallest type in the ramp still resolves -- see MIN_TYPE_PX.
   * Supplementary text (a range, a count, a unit gloss) is gated on this;
   * the VALUE never is, because a control with no reading is not a control. */
  protected get typeLegible(): boolean {
    const xs = parseFloat(getComputedStyle(this).getPropertyValue('--app-fs-xs')) || 9;
    return xs * this.scale >= MIN_TYPE_PX;
  }

  protected get displayName(): string {
    const s = this.spec;
    return this.label || s?.shortName || s?.name || this.path;
  }

  /** Adopt the store's value. One assignment and a repaint -- there is no
   * animation to skip, which is why this no longer takes an `immediate` flag. */
  protected syncFromStore(): void {
    const s = this.spec;
    if (!s) return;
    this.pos = toPos(s, this.value);
    const mixed = this.binding?.isMixed?.(this.path) ?? false;
    if (mixed !== this.mixed) this.mixed = mixed;
    this.rev++;
  }

  /** The reading a readout prints: the effective value, or "many". */
  protected reading(s: ParamSpec): string {
    return this.mixed ? 'many' : formatNumber(s, this.effective);
  }

  private startModPoll(): void {
    if (!this.binding?.getModulation) return;
    this.modPoller = new ChangePoller<ModState | null>(
      () => this.binding.getModulation?.(this.path) ?? null,
      (m) => (m ? `${m.value}|${m.min}|${m.max}|${m.neutral}` : ''),
      (m) => {
        this.mod = m;
        this.modulated = m !== null;
      },
    );
    this.modPoller.start();
  }

  // ---- hover ----

  private onPointerEnter = (): void => {
    if (this.disabled) return;
    this.hoverS.target = 1;
    this.loop.wake();
  };

  private onPointerLeave = (): void => {
    // Not while a gesture is live. PointerDragOp captures, so the pointer
    // leaving the element mid-drag is normal -- and a control that relaxed
    // under the finger because the cursor wandered off it would be a bug the
    // user is actively looking at.
    if (this.drag) return;
    this.hoverS.target = 0;
    this.loop.wake();
  };

  // ---- gestures ----

  protected onPointerDown = (e: PointerEvent): void => {
    if (this.disabled || this.editing || e.button !== 0) return;
    const s = this.spec;
    if (!s) return;
    e.preventDefault();
    this.focus();
    // A jog still open would be silently accepted by the store when this
    // gesture begins, and its handle would then be a stale object we would go
    // on calling accept() on. Close it here, where it is our decision.
    this.endJog();
    this.dragStartPos = toPos(s, this.value);
    this.handle = this.binding.beginContinuousEdit(this.path, this.value);
    this.press.target = 1;
    this.loop.wake();

    this.drag = new PointerDragOp(e, this as unknown as HTMLElement, {
      callMoveImmediately: this.trackImmediately,
      move: (ev, delta) => {
        const next = clamp01(this.positionFor(ev, delta));
        const v = fromPos(s, next);
        // Straight to the pointer. Nothing between the finger and the mark.
        this.pos = next;
        this.rev++;
        // Value writes ride the clock, not rAF: a backgrounded tab stops
        // painting but must not stop committing.
        this.throttle.push(() => this.handle?.update(v));
      },
      accept: () => {
        this.throttle.flush();
        this.handle?.accept();
      },
      cancel: () => {
        this.throttle.cancel();
        this.handle?.cancel();
      },
      complete: () => {
        this.handle = null;
        this.drag = null;
        this.press.target = 0;
        this.loop.wake();
        this.syncFromStore();
      },
    });
  };

  private onContextMenu = (e: MouseEvent): void => {
    if (this.disabled) return;
    e.preventDefault();
    this.reset();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.disabled || this.editing) return;
    const steps = JOG_KEYS[e.key];
    if (steps !== undefined) {
      e.preventDefault();
      this.jog(steps, e.shiftKey);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      this.jogTo(e.key === 'Home' ? 0 : 1);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      this.reset();
    } else if (e.key === 'Enter' || /^[0-9.\-]$/.test(e.key)) {
      e.preventDefault();
      // A digit SEEDS the box; Enter opens it with the current value selected.
      this.openEditor(/^[0-9.\-]$/.test(e.key) ? e.key : undefined);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    // Autorepeat delivers one keyup for the whole run, which is exactly the
    // gesture boundary we want. Shift is not one of them: releasing the
    // modifier mid-repeat changes the step size, it does not end the edit.
    if (JOG_KEYS[e.key] !== undefined || e.key === 'Home' || e.key === 'End') this.endJog();
  };

  /**
   * Move by `steps` coarse increments along the control's own axis.
   *
   * Stepped and enumerated parameters jog by ONE CHOICE rather than by a
   * fraction of the range, because 2% of a four-way enum is nothing and the
   * arrow key would appear dead until the fiftieth press.
   */
  protected jog(steps: number, fine: boolean): void {
    const s = this.spec;
    if (!s) return;
    const here = toPos(s, this.value);
    const n = s.choices ? s.choices.length - 1
      : s.curve.kind === 'stepped' ? Math.max(1, Math.round(s.curve.a))
      : s.unit === 'indexed' ? Math.max(1, Math.round(s.max - s.min))
      : 0;
    const next = n > 0
      ? (Math.round(here * n) + Math.sign(steps)) / n
      : here + steps * (fine ? JOG_FINE : JOG_STEP);
    this.jogTo(next);
  }

  /** Jog to an absolute position. Home/End use this; so does `jog`. */
  private jogTo(pos: number): void {
    const s = this.spec;
    if (!s) return;
    const v = fromPos(s, clamp01(pos));
    // One gesture for the whole autorepeat run -- see JOG_IDLE_MS.
    if (!this.jogHandle) this.jogHandle = this.binding.beginContinuousEdit(this.path, this.value);
    this.jogHandle.update(v);
    this.syncFromStore();
    if (this.jogTimer) clearTimeout(this.jogTimer);
    this.jogTimer = window.setTimeout(this.endJog, JOG_IDLE_MS);
  }

  private endJog = (): void => {
    if (this.jogTimer) {
      clearTimeout(this.jogTimer);
      this.jogTimer = 0;
    }
    const h = this.jogHandle;
    this.jogHandle = null;
    // accept, not cancel: a jog that was never followed up is still an edit the
    // user made. `finish` drops it anyway if the value did not move.
    h?.accept();
  };

  /** Reset to the value the patch shipped with. Each control carries its own
   * default, from its own spec, so a reset can never drift from what the panel
   * actually initialised to. */
  protected reset(): void {
    const s = this.spec;
    if (!s) return;
    this.endJog();
    this.binding.setValue(this.path, s.init);
    this.syncFromStore();
  }

  /** Double-click the readout (the number): type a value. */
  protected onReadoutDblClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (this.disabled || this.editing) return;
    this.openEditor();
  };

  /** Open type-to-edit from outside: a host's "edit this field" command (a
   * double-click on a row, a key on a selected field), the same box a digit
   * or Enter opens. */
  beginInlineEdit(): void {
    if (this.disabled || this.editing) return;
    this.openEditor();
  }

  protected openEditor(seed?: string): void {
    this.editing = true;
    void this.updateComplete.then(() => {
      const el = this.editEl;
      if (!el) return;
      if (seed !== undefined) {
        el.value = seed;
        el.setSelectionRange(seed.length, seed.length);
      } else {
        el.value = formatNumber(this.spec, this.value);
        el.select();
      }
      el.focus();
    });
  }

  /**
   * Escape must revert, and reverting removes the input, which fires its own
   * blur -- and blur commits. Without this flag the revert immediately commits
   * the very text it was cancelling. Clicking away still blurs WITHOUT the
   * flag, and so still commits, which is what clicking away should do.
   */
  protected onEditKey = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitEdit((e.target as HTMLInputElement).value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.editCancelled = true;
      this.editing = false;
      this.focus();
    }
  };

  protected onEditBlur = (e: FocusEvent): void => {
    if (this.editCancelled) {
      this.editCancelled = false;
      return;
    }
    this.commitEdit((e.target as HTMLInputElement).value);
  };

  private commitEdit(text: string): void {
    const v = parseValue(this.spec, text);
    this.editing = false;
    // Unparseable input keeps the old value rather than writing NaN. A control
    // that blanks itself because of a typo has lost the user's setting.
    if (v !== null) this.binding.setValue(this.path, v);
    this.syncFromStore();
    this.focus();
  }
}

/** The anchor contract (core/anchors.ts): the label selects, the pip sits beside it. */
installLabelAnchors(ScalarControl);
export interface ScalarControl extends FieldAnchors {}
