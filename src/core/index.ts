/**
 * Everything a widget stands on that is not a widget: the binding contract, the
 * schema it reads meta from, gestures, motion, formatting, and the small
 * utilities the drawing code shares.
 *
 * `param-store` ships here deliberately. It is not a demo -- it is the
 * reference FieldBinding + TextBinding over one undo stack, and every plugin in
 * the constellation needs exactly that until it is talking to a real host.
 */
export * from './binding';
export * from './anchors';
export * from './schema';
export * from './param-store';
export * from './store';
export * from './format';
export * from './curve';
export * from './drag';
export * from './spring';
export * from './canvas';
export * from './ring';
export * from './stale';
export * from './modrange';
