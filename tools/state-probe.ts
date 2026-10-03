/**
 * Screenshot an INTERACTION STATE, not just a page load.
 *
 * The press feedback, the drag, the hover -- none of them exist in a plain
 * `--screenshot` capture, which is exactly how an interaction state ships
 * broken: it is never once looked at. This drives real input through CDP and
 * captures the widget mid-gesture.
 *
 *   node tools/state-probe.ts <outDir> [row] [selector]
 *   PROBE_SKIN=ink node tools/state-probe.ts <outDir> linear bi-slider
 *   PROBE_INNER='button:nth-child(4)' ... enumerated bi-seg
 *
 * Requires a headless Chrome with --remote-debugging-port=9333:
 *   chrome --headless=new --remote-debugging-port=9333 \
 *          --user-data-dir=<tmp> about:blank &
 *
 * Writes rest.png, hover.png, press-down.png and press-up.png, in that order.
 * Compare them; the useful check is usually "what MOVED", which a pixel diff
 * answers directly.
 *
 * ALL FOUR MATTER, and rest/hover is the pair that is easiest to get wrong.
 * A plain page capture is a REST shot with no pointer in it, so a hover
 * affordance is invisible to it -- which is exactly how one ships broken or,
 * worse, ships as a number too small to see. press-up is taken after moving the
 * pointer AWAY, so it is a second rest shot: if it does not match rest.png,
 * something latched.
 */
import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';

const OUT = process.argv[2];
const ROW = process.argv[3] || 'rotary';
const SEL = process.argv[4] || 'bi-knob';
const PORT = Number(process.env.CDP_PORT || 9333);
const BASE = process.env.PROBE_URL || 'http://localhost:5190';
const SKIN = process.env.PROBE_SKIN || '';

/**
 * Merge the row (and skin) into whatever query the base URL already carries.
 *
 * This was `${URL}/?row=${ROW}`, which silently produces
 * "http://host/?skin=ink/?row=linear" the moment the base has a query of its
 * own -- a URL the dev server happily serves as the default page. So the probe
 * screenshotted the wrong row and the comparison looked wrong rather than
 * erroring. A tool that lies about what it captured is worse than no tool.
 */
function pageUrl(row: string): string {
  const u = new URL(BASE);
  if (row) u.searchParams.set('row', row);
  if (SKIN) u.searchParams.set('skin', SKIN);
  return u.toString();
}

/** Past the `pop` settle (110ms) so the captured frame is the RESTING held
 * state rather than a point on the way into it -- otherwise the shot varies
 * run to run and cannot be compared against a previous one. */
const SETTLED_MS = 220;

/** Past the hover spring (`snap`, 70ms) and the 90ms CSS colour transitions the
 * flat controls use, with room to spare. */
const HOVER_MS = 280;

(async () => {
  const c = await CDP({ port: PORT });
  const { Page, Runtime, Input, Emulation } = c;
  await Page.enable();
  await Runtime.enable();
  await Emulation.setDeviceMetricsOverride({
    width: Number(process.env.PROBE_W || 760),
    height: Number(process.env.PROBE_H || 300),
    deviceScaleFactor: Number(process.env.PROBE_DSF || 3),
    mobile: false,
  });
  await Page.navigate({ url: pageUrl(ROW) });
  await Page.loadEventFired();
  await new Promise((r) => setTimeout(r, 1500));

  const find = `document.querySelector('bi-gallery').shadowRoot.querySelector('${SEL}')`;
  await Runtime.evaluate({ expression: `${find}.scrollIntoView({ block: 'center' })` });
  await new Promise((r) => setTimeout(r, 400));

  // Pierce both shadow roots: the gallery's, then the widget's own.
  const box = await Runtime.evaluate({
    expression: `(() => {
      const w = ${find};
      const inner = ${JSON.stringify(process.env.PROBE_INNER || '')};
      const t = inner
        ? w.shadowRoot.querySelector(inner)
        : w.shadowRoot.querySelector('.dial, .track, .seg, .row');
      const d = t.getBoundingClientRect();
      const b = w.getBoundingClientRect();
      return JSON.stringify({
        x: d.x + d.width / 2, y: d.y + d.height / 2,
        box: { x: b.x, y: b.y, w: b.width, h: b.height },
      });
    })()`,
    returnByValue: true,
  });
  const probed = JSON.parse(String(box.result.value)) as {
    x: number; y: number;
    box: { x: number; y: number; w: number; h: number };
  };
  const { x, y } = probed;
  // The measured box, written out so a crop can be taken around the control
  // that was actually driven. Cropping by eye is how the last round of these
  // ended up comparing two untouched knobs and calling them identical.
  fs.writeFileSync(`${OUT}/box.json`, JSON.stringify(probed.box));

  const shot = async (name: string) => {
    const s = await Page.captureScreenshot({ format: 'png' });
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, 'base64'));
  };

  await shot('rest');

  // Two moves: the first enters the element, the second gives it a real
  // position inside. One move from (0,0) works, but two is what a pointer
  // actually does and it costs nothing.
  await Input.dispatchMouseEvent({ type: 'mouseMoved', x: x - 4, y: y - 4, pointerType: 'mouse' });
  await Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, HOVER_MS));
  await shot('hover');

  await Input.dispatchMouseEvent({
    type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse',
  });
  await new Promise((r) => setTimeout(r, SETTLED_MS));
  await shot('press-down');

  await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', pointerType: 'mouse' });
  // Off the control entirely, so this is a rest shot rather than a hover one.
  await Input.dispatchMouseEvent({ type: 'mouseMoved', x: 2, y: 2, pointerType: 'mouse' });
  await new Promise((r) => setTimeout(r, 400));
  await shot('press-up');

  await c.close();
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
