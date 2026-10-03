/**
 * The binding contract, which is the part of this library a host has to agree
 * with. Three claims are tested here because all three fail QUIETLY:
 *
 *  - every write is float32, because nano-unit's store is and a client is never
 *    told what was kept (NANO-UNIT-REPORT #11; measured drift 1.8e-8);
 *  - one gesture is one undo point, which is the whole reason
 *    ContinuousEditHandle exists rather than a setValue per pointer move;
 *  - parameters and text share ONE undo stack, because two stacks mean Cmd-Z
 *    sometimes reverts the rename you did three actions ago.
 */
import { describe, expect, it } from 'vitest';
import { ParamStore } from '../src/core/param-store';
import { param } from '../src/core/schema';

const specs = () => [
  param('osc.pitch', { min: 20, max: 20000, init: 440, curve: { kind: 'log', a: 0 } }),
  param('osc.mix', { min: 0, max: 1, init: 0.5, unit: 'percent' }),
];

describe('every write is float32', () => {
  it('quantises on the way in, not at the call site', () => {
    const s = new ParamStore(specs());
    const notRepresentable = 0.1 + 0.2;          // 0.30000000000000004 in f64
    s.setValue('osc.mix', notRepresentable);
    expect(s.getValue('osc.mix')).toBe(Math.fround(notRepresentable));
    expect(s.getValue('osc.mix')).not.toBe(notRepresentable);
  });

  it('reads back the same bits it wrote, so a round-trip is stable', () => {
    const s = new ParamStore(specs());
    s.setValue('osc.mix', 1 / 3);
    const once = s.getValue('osc.mix');
    s.setValue('osc.mix', once);
    expect(s.getValue('osc.mix')).toBe(once);
  });

  it('resolves an unknown path to its init, never to zero', () => {
    // A missing param that silently reads 0 plots a plausible wrong answer.
    const s = new ParamStore(specs());
    expect(s.getValue('osc.pitch')).toBe(Math.fround(440));
  });
});

describe('one gesture is one undo point', () => {
  it('a drag of any length costs exactly one entry', () => {
    const s = new ParamStore(specs());
    const h = s.beginContinuousEdit('osc.mix', s.getValue('osc.mix'));
    for (let i = 0; i <= 100; i++) h.update(i / 100);
    expect(s.undoDepth).toBe(0);          // nothing committed mid-gesture
    h.accept();
    expect(s.undoDepth).toBe(1);
    expect(s.getValue('osc.mix')).toBe(1);
  });

  it('undo returns to before the gesture, not to the last preview', () => {
    const s = new ParamStore(specs());
    const start = s.getValue('osc.mix');
    const h = s.beginContinuousEdit('osc.mix', start);
    h.update(0.1);
    h.update(0.9);
    h.accept();
    s.undo();
    expect(s.getValue('osc.mix')).toBe(start);
    expect(s.undoDepth).toBe(0);
  });

  it('cancel reverts and leaves no trace', () => {
    const s = new ParamStore(specs());
    const start = s.getValue('osc.mix');
    const h = s.beginContinuousEdit('osc.mix', start);
    h.update(0.9);
    h.cancel();
    expect(s.getValue('osc.mix')).toBe(start);
    expect(s.undoDepth).toBe(0);
  });

  it('an XY drag is one entry across both axes', () => {
    const s = new ParamStore(specs());
    const h = s.beginContinuousEditMulti({ 'osc.mix': 0.5, 'osc.pitch': 440 });
    h.update({ 'osc.mix': 0.2, 'osc.pitch': 880 });
    h.accept();
    expect(s.undoDepth).toBe(1);
    s.undo();
    expect(s.getValue('osc.mix')).toBe(Math.fround(0.5));
    expect(s.getValue('osc.pitch')).toBe(Math.fround(440));
  });

  it('a write that changes nothing is not an edit', () => {
    const s = new ParamStore(specs());
    s.setValue('osc.mix', s.getValue('osc.mix'));
    expect(s.undoDepth).toBe(0);
  });
});

describe('text and parameters share one undo stack', () => {
  it('interleaves in the order the user actually did things', () => {
    const s = new ParamStore(specs());
    s.addText('doc.name', 'untitled');

    s.setValue('osc.mix', 0.25);
    s.setText('doc.name', 'bell');
    s.setValue('osc.mix', 0.75);
    expect(s.undoDepth).toBe(3);

    s.undo();                                   // the second knob move
    expect(s.getValue('osc.mix')).toBe(Math.fround(0.25));
    expect(s.getText('doc.name')).toBe('bell');

    s.undo();                                   // the rename
    expect(s.getText('doc.name')).toBe('untitled');
    expect(s.getValue('osc.mix')).toBe(Math.fround(0.25));

    s.undo();                                   // the first knob move
    expect(s.getValue('osc.mix')).toBe(Math.fround(0.5));
    expect(s.undoDepth).toBe(0);
  });

  it('redo replays the same interleaving', () => {
    const s = new ParamStore(specs());
    s.addText('doc.name', 'untitled');
    s.setText('doc.name', 'bell');
    s.setValue('osc.mix', 0.25);
    s.undo();
    s.undo();
    s.redo();
    expect(s.getText('doc.name')).toBe('bell');
    s.redo();
    expect(s.getValue('osc.mix')).toBe(Math.fround(0.25));
  });

  it('a text write that changes nothing is not an edit', () => {
    const s = new ParamStore(specs());
    s.addText('doc.name', 'untitled');
    s.setText('doc.name', 'untitled');
    expect(s.undoDepth).toBe(0);
  });
});

describe('seed is boot state, restore is an edit', () => {
  it('seed leaves the undo stack empty', () => {
    // Otherwise the first Cmd-Z of a session reverts the file you just opened.
    const s = new ParamStore(specs());
    s.seed({ 'osc.mix': 0.82 });
    expect(s.getValue('osc.mix')).toBe(Math.fround(0.82));
    expect(s.undoDepth).toBe(0);
  });

  it('restore is undoable, because a preset button is a thing you did', () => {
    const s = new ParamStore(specs());
    const before = s.snapshot();
    s.restore({ 'osc.mix': 0.1 });
    expect(s.undoDepth).toBe(1);
    s.undo();
    expect(s.getValue('osc.mix')).toBe(before['osc.mix']);
  });
});

describe('the change signal is a SET of listeners', () => {
  it('notifies every subscriber, not just the last one', () => {
    // The nano-lfo bug this discipline exists to prevent: with one slot,
    // whoever subscribed last silently won -- the map kept moving the latent
    // and never repainted, which from outside is a dead control.
    const s = new ParamStore(specs());
    let a = 0;
    let b = 0;
    s.changed.subscribe(() => { a++; });
    s.changed.subscribe(() => { b++; });
    s.setValue('osc.mix', 0.25);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('hands back an unsubscribe that actually detaches', () => {
    const s = new ParamStore(specs());
    let n = 0;
    const off = s.changed.subscribe(() => { n++; });
    s.setValue('osc.mix', 0.25);
    off();
    s.setValue('osc.mix', 0.75);
    expect(n).toBe(1);
    expect(s.changed.size).toBe(0);
  });

  it('survives a listener that unsubscribes itself mid-notify', () => {
    const s = new ParamStore(specs());
    let second = 0;
    const off = s.changed.subscribe(() => off());
    s.changed.subscribe(() => { second++; });
    s.setValue('osc.mix', 0.25);
    expect(second).toBe(1);
  });

  it('stays quiet during a gesture and speaks on accept', () => {
    const s = new ParamStore(specs());
    let n = 0;
    s.changed.subscribe(() => { n++; });
    const h = s.beginContinuousEdit('osc.mix', 0.5);
    h.update(0.6);
    h.update(0.7);
    const mid = n;
    h.accept();
    expect(n).toBeGreaterThan(mid - 1);
    expect(s.undoDepth).toBe(1);
  });
});
