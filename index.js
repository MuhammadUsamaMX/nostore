// @nostore/core — framework-agnostic state, zero dependencies.
//
// Two exports:
//   createStore(config)   — a tiny flux store (set/get/subscribe) with no
//                           framework, DOM or runtime-argument coupling.
//   persist(config, opts) — a middleware that mirrors state into a storage
//                           adapter and rehydrates it (with versions) on boot.
//
// Both are plain ESM with zero dependencies; the only runtime inputs are the
// config function and the storage adapter handed to persist().

/** In-memory Storage adapter. Default for persist() and useful in tests. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    // Storage access can throw (privacy mode, sandboxed iframes) — fall back
    // to memory so a persist()-ed store never crashes at boot.
    return memoryStorage();
  }
}

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

/**
 * persist(config, options) — middleware wrapping a state creator.
 *
 * options:
 *   name       (string, required)  storage key.
 *   storage    (Storage)           adapter with getItem/setItem/removeItem;
 *                                  defaults to globalThis.localStorage, or
 *                                  memoryStorage() when that is unavailable.
 *   version    (number)            persisted format version, default 0.
 *   migrate    (persisted, fromVersion) => state
 *   onRehydrateStorage (callback)  called once after boot rehydration.
 *
 * Only data round-trips: functions in the state are dropped when written and
 * come back from the config on rehydration. The store also exposes
 * `store.persist`:
 *   rehydrate()      re-read storage and merge (call from a storage event
 *                    handler for cross-tab sync).
 *   hasHydrated()    true once boot rehydration finished.
 *   clearStorage()   remove this store's persisted key.
 */
export function persist(config, options = {}) {
  const { name, version = 0, migrate, onRehydrateStorage } = options;
  if (!name) {
    throw new TypeError("persist(config, options): options.name is required");
  }
  const storage = options.storage ?? defaultStorage();

  const read = () => {
    let raw;
    try {
      raw = storage.getItem(name);
    } catch {
      return null; // storage read failures must not break rehydration
    }
    if (raw == null) return null;
    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null; // corrupt payload: start from the initial state
      }
    }
    if (parsed == null || typeof parsed !== "object") return null;
    const savedVersion = typeof parsed.version === "number"
      ? parsed.version
      : 0;
    const savedState = parsed.state;
    if (savedState == null || typeof savedState !== "object") return null;
    if (savedVersion === version) return savedState;
    if (typeof migrate !== "function") return null; // stale entry: discard
    try {
      const migrated = migrate(savedState, savedVersion);
      return migrated && typeof migrated === "object" ? migrated : null;
    } catch {
      return null; // a throwing migration must not break store creation
    }
  };

  const write = (state) => {
    // Functions are actions, not data: drop them before serializing.
    const data = {};
    for (const key of Object.keys(state)) {
      if (typeof state[key] !== "function") data[key] = state[key];
    }
    try {
      storage.setItem(name, JSON.stringify({ version, state: data }));
    } catch {
      // Quota exceeded / privacy mode: the store still works, it just
      // stops persisting this write.
    }
  };

  return (set, get, api) => {
    const persistingSet = (partial, replace) => {
      set(partial, replace);
      write(get());
    };
    api.setState = persistingSet;

    const restored = read();
    const initial = config(persistingSet, get, api);
    const state = restored ? Object.assign({}, initial, restored) : initial;
    // createStore has not assigned its `state` yet, so write the local value
    // instead of get(); the returned state is what createStore adopts.
    write(state);

    let hydrated = true;
    api.persist = {
      hasHydrated: () => hydrated,
      rehydrate: () => {
        const next = read();
        if (next) api.setState(next); // merge: stored keys win
        return hydrated;
      },
      clearStorage: () => {
        try {
          storage.removeItem(name);
        } catch {
          // ignore
        }
      },
    };

    if (typeof onRehydrateStorage === "function") {
      try {
        onRehydrateStorage(state);
      } catch {
        // user callback errors must not break store creation
      }
    }
    return state;
  };
}
