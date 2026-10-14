# @nostore/core

Tiny framework-agnostic state for JavaScript. Two exports, zero dependencies, no
DOM, no React — plain ESM that runs in Deno, Node, browsers, and workers.

```sh
deno add jsr:@nostore/core
npx jsr add @nostore/core
```

## createStore

```js
import { createStore } from "jsr:@nostore/core";

const store = createStore((set, get) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
  doubleInc: () => {
    get().inc();
    get().inc();
  },
}));

store.getState().inc();

// Subscribe to everything...
const stop = store.subscribe((state, prev) => console.log(state.count));

// ...or to one slice, with an optional equality function.
const stopCount = store.subscribe(
  (s) => s.count,
  (count) => render(count),
);

stop();
```

- `setState(partial, replace?)` merges a partial object (or an updater
  function's result) into the state; `replace = true` swaps the whole state.
- `getState()` returns the current state object.
- `subscribe(listener)` and `subscribe(selector, listener, equalityFn?)` both
  return an unsubscribe function. The selector form only fires when the selected
  slice changes (default comparison: `Object.is`).

## persist

`persist(config, options)` wraps a state creator so its state is mirrored into a
storage adapter and rehydrated on creation.

```js
import { createStore, persist } from "jsr:@nostore/core";

const store = createStore(
  persist(
    (set) => ({
      count: 0,
      inc: () => set((s) => ({ count: s.count + 1 })),
    }),
    {
      name: "counter", // storage key (required)
      version: 1, // format version, default 0
      migrate: (persisted, fromVersion) => ({ ...persisted }),
      // store defaults to globalThis.localStorage; pass `storage` for any
      // adapter with getItem/setItem/removeItem (memoryStorage() for tests).
    },
  ),
);

// Cross-tab: call rehydrate() from your storage event handler.
addEventListener("storage", (e) => {
  if (e.key === "counter") store.persist.rehydrate();
});

store.persist.hasHydrated(); // boot rehydration finished
store.persist.clearStorage(); // drop the persisted key
```

- Functions in the state are actions: they are stripped before writing and come
  back from the config, so only data round-trips through storage.
- A `version` mismatch runs `migrate(persisted, fromVersion)`; without a mapper
  the stale entry is discarded rather than misread.
- `onRehydrateStorage(state)` fires once after boot rehydration.
- Storage failures (quota, privacy mode) never break a state change.

## Tests

```sh
deno task test
```

## License

MIT
