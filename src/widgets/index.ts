/**
 * The widget surface of the library.
 *
 * Importing this registers every element as a side effect, which is what a
 * custom-element library IS -- a consumer writes <bi-knob> in a template and
 * expects it to exist. The named re-exports are for the things a panel has to
 * name in TypeScript: the class of an element it queries, and the descriptor
 * types (Hint, Series, GroupTab) that are the actual API of the data-carrying
 * widgets.
 *
 * Deep imports still work -- `bubbleink/widgets/bi-knob` pulls one element and its
 * dependencies -- for a plugin that wants three controls and not the family.
 */
import './bi-knob';
import './bi-slider';
import './bi-seg';
import './bi-toggle';
import './bi-number';
import './bi-trigger';
import './bi-encoder';
import './bi-text';
import './bi-card';
import './bi-group';
import './bi-hint';
import './bi-graph';
import './bi-grid';
import './bi-modbar';
import './bi-xy';

export * from './scalar-base';
export * from './graph-series';
export * from './bi-knob';
export * from './bi-slider';
export * from './bi-seg';
export * from './bi-toggle';
export * from './bi-number';
export * from './bi-trigger';
export * from './bi-encoder';
export * from './bi-text';
export * from './bi-card';
export * from './bi-group';
export * from './bi-hint';
export * from './bi-graph';
export * from './bi-grid';
export * from './bi-modbar';
export * from './bi-xy';
