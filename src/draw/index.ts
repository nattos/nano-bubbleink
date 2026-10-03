/**
 * Pure drawing. No DOM, no component state, no custom properties read here --
 * a caller resolves colour and hands it in. That rule is what lets a texture
 * move between a widget, a worker, and an offscreen canvas without being
 * rewritten, which is the only way it survives the move at all.
 */
export * from './marks';
export * from './modband';
export * from './plot';
export * from './series';
export * from './bud';
