import { defineConfig } from 'vite';

// One page. The gallery is the library's own instrument -- one row per widget,
// ship size beside ~40%, three densities -- and it is the pass/fail check, so
// it ships with the library rather than with any product that consumes it.
//
// A fixed port, because the probes in tools/ address this server by URL and
// vite's default is "the next port that happens to be free". Two restarts in a
// row handed the gallery and the app each other's port, which a probe cannot
// detect -- it screenshots whatever answered. Not strict: if 5190 is taken,
// starting on another port beats not starting.
export default defineConfig({
  server: { port: 5190 },
});
