# bubbleink

The shared widget library: Lit 3 custom elements (`bi-knob`, `bi-slider`, `bi-seg`, `bi-toggle`,
`bi-number`, `bi-trigger`, `bi-encoder`, `bi-text`, `bi-card`, `bi-group`, `bi-hint`, `bi-graph`,
`bi-grid`, `bi-modbar`, `bi-xy`) that speak `FieldBinding` and render a snapshot. No domain
knowledge — a widget knows a `ParamSpec` and a binding, nothing about effects, tracks or MIDI.

Seeded from `nano-hmnx/aal` (October 2026), renamed `aal-*` → `bi-*`, with the crystal skin
removed. aal migrates onto this later.

## Using it

- **Consume as source.** `exports` point at `.ts`; the consumer compiles it (decorators need
  `experimentalDecorators` + `useDefineForClassFields: false`). With a `file:` dependency under
  Vite: keep symlinks resolved (the default — a path left under `node_modules` gets no TS
  transform), `optimizeDeps.exclude: ['bubbleink']`, `resolve.dedupe: ['lit']`, and
  `server.fs.allow` covering this checkout.
- **Stylesheets at document level:** `bubbleink/theme/fonts.css`, then `bubbleink/theme/tokens.css`.
  Shadow roots see the skin only through inherited custom properties.
- **Widgets:** `import 'bubbleink/widgets'` registers them all; `bubbleink/widgets/bi-knob` one.

## Theming

- A **skin** is a token set on `<html data-skin>`. **ink-dark** (opaque inks on black stock) is the
  default and also applies with no attribute; **ink** (paper) is the light one.
- Widgets read **tokens only** — never a literal colour or face. A new skin or an app re-theme is a
  token block, not a code change.
- **Type** is two tokens: `--app-font-data` (JetBrains Mono) and `--app-font-display` (Anybody,
  variable width/weight). `--app-mono` is an alias of the data face. Both faces are bundled in
  `fonts/` (OFL) — never fetched, because consumers run offline.
- **Scale:** `--bi-scale` (one token; the gallery's densities set it).

## Developing

```bash
npm install
npm run dev        # the gallery on :5190 — the pass/fail check for every widget
npm run typecheck
npm test
```
