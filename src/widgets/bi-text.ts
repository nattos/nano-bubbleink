/**
 * <bi-text> -- free-form text, bound to the document channel.
 *
 * The family's only widget that does not edit a number, and the reason it can
 * exist at all is core/binding.ts's TextBinding: a patch name is not a
 * parameter, because a parameter is a float32 in an array a host automates, and
 * nobody draws an automation lane for a name.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HARD PART, AND IT IS NOT THE STYLING
 *
 * INPUT METHODS. While an IME is composing -- Japanese kanji conversion, a
 * dead-key accent, pinyin -- the input element holds a live composition buffer
 * that is NOT yet text. Round-tripping the intermediate `input` events through
 * a store re-renders the host, the re-render reasserts the element's `.value`,
 * and reasserting `.value` destroys the composition mid-word.
 *
 * The tell is that it looks like a performance bug. Type slowly and every
 * composition finishes before the next one starts, so it works; type at speed
 * and characters duplicate and garble. A reviewer who does not use an IME will
 * never see it, and a user who does will see it constantly.
 *
 * Two rules, both ported verbatim from the prior art's editable-text because
 * they were learned the expensive way there:
 *
 *   HOLD WRITES FOR THE COMPOSITION. Nothing reaches the store between
 *   compositionstart and compositionend. The final string commits once.
 *
 *   NEVER BIND .value REACTIVELY. Lit would reassert it on every async render,
 *   and an async render can land mid-composition. The value is reflected
 *   IMPERATIVELY in updated(), only when it actually differs and never while
 *   composing -- which also means ordinary typing does not reset the caret.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO CONTINUOUS EDIT HERE
 *
 * Every other control in the family opens a ContinuousEditHandle so a gesture
 * is one undo point. A text edit is not that shape. It is a DRAFT: the user is
 * holding a candidate string, they can see it, and they will either commit it
 * or throw it away. The draft lives in the input element, which is the one
 * place it is already visible, and the store learns about it once -- on Enter
 * or on blur. Escape reverts and writes nothing.
 *
 * Writing every keystroke through the store so it can be undone
 * keystroke-by-keystroke is the same mistake as one undo entry per pointermove,
 * wearing different clothes.
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { base } from '../theme/base';
import type { TextBinding } from '../core/binding';
import type { Density } from './scalar-base';

@customElement('bi-text')
export class BiText extends LitElement {
  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: calc(2px * var(--bi-scale));
        min-width: 0;
        outline: none;
      }
      .control {
        min-width: 0;
        width: 100%;
        /* The same well every other control is cut into. A text field is where
         * a family most easily slips into looking like a web form, and the
         * defence is that it is made of the same material as the slider's
         * track rather than of whatever the platform's input is made of. */
        background: var(--well-bg);
        border: 1px solid var(--well-edge);
        border-radius: var(--app-r-2);
        color: var(--app-text-color1);
        font: inherit;
        font-size: var(--fs-sm);
        padding: calc(3px * var(--bi-scale)) calc(6px * var(--bi-scale));
        outline: none;
        /* An ancestor may set user-select:none for gesture hygiene; a text
         * field has to put it back or the user cannot select their own text. */
        -webkit-user-select: text;
        user-select: text;
        transition: border-color 120ms linear, background-color 120ms linear;
      }
      .control::placeholder {
        color: var(--app-text-color3);
      }
      .control:hover:not(:focus) {
        border-color: var(--hover-edge);
        background-color: var(--hover-wash);
      }
      .control:focus {
        border-color: var(--juice);
        background: var(--app-bg-sunken);
      }
      textarea.control {
        min-height: calc(64px * var(--bi-scale));
        resize: vertical;
        line-height: 1.45;
        white-space: pre-wrap;
      }
      /* compact drops the name and shrinks to one tight line -- for a strip
       * where the field is captioned by its neighbour. */
      :host([density='compact']) .label { display: none; }
      :host([density='compact']) .control {
        font-size: var(--fs-xs);
        padding: calc(1px * var(--bi-scale)) calc(4px * var(--bi-scale));
      }
      :host([density='expanded']) .control { font-size: var(--fs-md); }
      :host([disabled]) { opacity: 0.42; pointer-events: none; }
    `,
  ];

  @property({ attribute: false }) binding!: TextBinding;
  @property({ type: String }) path = '';
  @property({ type: String }) label = '';
  @property({ type: String }) placeholder = '';
  /** Prose rather than a single line. Reflected so a host can style a column
   * of mixed fields. */
  @property({ type: Boolean, reflect: true }) multiline = false;
  @property({ type: String, reflect: true }) density: Density = 'normal';
  @property({ type: Boolean, reflect: true }) disabled = false;

  @query('.control') private control?: HTMLInputElement | HTMLTextAreaElement;

  /** True between compositionstart and compositionend. See the file header:
   * nothing reaches the store and nothing reasserts `.value` while it is set. */
  private composing = false;
  /** The last value we pushed into the element, so `updated` can tell "the
   * store changed under us" from "the user is typing". */
  private reflected = '';
  /** Escape has reverted; the blur it causes must not commit. Same guard, and
   * the same reason, as ScalarControl's numeric editor. */
  private cancelled = false;

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    const store = this.binding as unknown as { changed?: { subscribe(f: () => void): () => void } };
    this.unsubscribe = store?.changed?.subscribe(() => this.reflect()) ?? null;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  protected updated(_changed: PropertyValues): void {
    this.reflect();
  }

  /** Push the store's value into the element -- imperatively, guarded, and only
   * when it really differs. See the file header. */
  private reflect(): void {
    const el = this.control;
    if (!el || this.composing) return;
    const v = this.binding?.getText(this.path) ?? '';
    if (el.value === v) {
      this.reflected = v;
      return;
    }
    // The element differing because the USER is mid-draft is not a reason to
    // overwrite it. Only adopt a store value that is itself new.
    if (this.reflected !== v) {
      el.value = v;
      this.reflected = v;
    }
  }

  private commit(): void {
    const el = this.control;
    if (!el) return;
    this.reflected = el.value;
    this.binding.setText(this.path, el.value);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Never act on a key the IME is still interpreting -- Enter during a
    // composition means "accept this candidate", not "commit the field".
    if (this.composing || e.isComposing) return;
    e.stopPropagation();
    if (e.key === 'Enter' && !this.multiline) {
      e.preventDefault();
      this.commit();
      this.control?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancelled = true;
      const el = this.control;
      if (el) el.value = this.binding?.getText(this.path) ?? '';
      el?.blur();
    }
  };

  private onBlur = (): void => {
    if (this.cancelled) {
      this.cancelled = false;
      return;
    }
    this.commit();
  };

  private onCompositionStart = (): void => {
    this.composing = true;
  };

  private onCompositionEnd = (): void => {
    this.composing = false;
    // compositionend can fire either side of the terminating `input` event
    // depending on the platform, so the reflect is done here rather than being
    // left to whichever order this browser chose.
    this.reflect();
  };

  render() {
    const spec = this.binding?.textSpec?.(this.path);
    const name = this.label || spec?.name || this.path;
    const multi = this.multiline || spec?.multiline || false;
    const ph = this.placeholder || spec?.placeholder || '';
    const head = this.density === 'compact'
      ? nothing : html`<span class="label">${name}</span>`;
    // Note the absence of `.value=`: binding it is the bug this widget exists
    // to avoid. The element is seeded and updated by reflect().
    return html`
      ${head}
      ${multi
        ? html`<textarea class="control" spellcheck="false" placeholder=${ph}
            ?disabled=${this.disabled} maxlength=${spec?.maxLength ?? 4096}
            @keydown=${this.onKeyDown} @blur=${this.onBlur}
            @compositionstart=${this.onCompositionStart}
            @compositionend=${this.onCompositionEnd}></textarea>`
        : html`<input class="control" type="text" spellcheck="false" placeholder=${ph}
            ?disabled=${this.disabled} maxlength=${spec?.maxLength ?? 256}
            @keydown=${this.onKeyDown} @blur=${this.onBlur}
            @compositionstart=${this.onCompositionStart}
            @compositionend=${this.onCompositionEnd} />`}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'bi-text': BiText;
  }
}
