// @nostore/core — framework-agnostic state, zero dependencies.
//
// createStore(config): a tiny flux store (set/get/subscribe) with no
// framework, DOM or runtime-argument coupling.

/**
 * Create a store from a state creator.
 *
 *   const store = createStore((set, get) => ({
 *     count: 0,
 *     inc: () => set((s) => ({ count: s.count + 1 })),
 *   }))
 *   store.getState().inc()
 *   const unsub = store.subscribe((s) => s.count, (count) => render(count))
 *
 * subscribe(listener)                       — fire on every state change,
 *                                             returns an unsubscribe function.
 * subscribe(selector, listener, equality)   — fire only when the selected
 *                                             slice changes (default: Object.is).
 */
export function createStore(config) {
  let state;
  const listeners = new Set();

  const setState = (partial, replace) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    if (next == null) return;
    const prev = state;
    state = replace ? next : Object.assign({}, state, next);
    for (const listener of [...listeners]) listener(state, prev);
  };

  const getState = () => state;

  const subscribe = (
    selectorOrListener,
    maybeListener,
    equalityFn = Object.is,
  ) => {
    let listener = selectorOrListener;
    let selector = null;
    if (
      typeof selectorOrListener === "function" &&
      typeof maybeListener === "function"
    ) {
      selector = selectorOrListener;
      listener = maybeListener;
    }
    let lastSlice;
    const wrapped = (next, prev) => {
      if (!selector) return listener(next, prev);
      const slice = selector(next);
      if (!equalityFn(lastSlice, slice)) {
        const prevSlice = lastSlice;
        lastSlice = slice;
        listener(slice, prevSlice);
      }
    };
    listeners.add(wrapped);
    return () => listeners.delete(wrapped);
  };

  const api = { setState, getState, subscribe };
  state = config(setState, getState, api);
  return api;
}
