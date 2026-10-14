// Tests for @nostore/core (PR 1: createStore) — run with `deno test`.
//
// Plain JS on purpose: no transpile step, nothing to keep in sync with a
// tsc invocation. If it runs here it runs on JSR.

import { assertEquals } from "jsr:@std/assert@1";
import { createStore, memoryStorage, persist } from "./index.js";

const config = (set, get) => ({
  count: 0,
  name: "anon",
  inc: () => set((s) => ({ count: s.count + 1 })),
  setName: (name) => set({ name }),
  doubleInc: () => {
    get().inc();
    get().inc();
  },
});

Deno.test("createStore returns working getState", () => {
  const store = createStore(config);
  assertEquals(store.getState().count, 0);
  store.getState().inc();
  assertEquals(store.getState().count, 1);
});

Deno.test("subscribe fires on set and stops after unsubscribe", () => {
  const store = createStore(config);
  let calls = 0;
  const unsub = store.subscribe(() => calls++);
  store.getState().inc();
  assertEquals(calls, 1);
  unsub();
  store.getState().inc();
  assertEquals(calls, 1);
});

Deno.test("set merges partials and accepts updaters", () => {
  const store = createStore(config);
  store.setState({ name: "partial" });
  assertEquals(store.getState().name, "partial");
  assertEquals(store.getState().count, 0); // untouched keys survive
  store.setState((s) => ({ count: s.count + 41 }));
  assertEquals(store.getState().count, 41);
});

Deno.test("set with replace=true swaps the whole state", () => {
  const store = createStore(config);
  store.setState({ count: 7 }, true);
  assertEquals(store.getState().count, 7);
  assertEquals(store.getState().inc, undefined); // replaced wholesale
});

Deno.test("multi-action flow (doubleInc)", () => {
  const store = createStore(config);
  store.getState().doubleInc();
  assertEquals(store.getState().count, 2);
});

Deno.test("subscribe with selector fires only for the selected slice", () => {
  const store = createStore(config);
  let calls = 0;
  let last = null;
  const unsub = store.subscribe(
    (s) => s.count,
    (count) => {
      calls++;
      last = count;
    },
  );

  store.setState({ count: 1 });
  assertEquals(calls, 1);
  assertEquals(last, 1);

  store.setState({ name: "ignored" }); // count unchanged → no fire
  assertEquals(calls, 1);

  unsub();
  store.setState({ count: 2 });
  assertEquals(calls, 1);
});

Deno.test("store runs without DOM globals", () => {
  assertEquals(typeof globalThis.document, "undefined");
  assertEquals(typeof globalThis.window, "undefined");

  const store = createStore(config);
  let fired = false;
  const unsub = store.subscribe(() => {
    fired = true;
  });
  store.getState().inc();
  assertEquals(fired, true);
  unsub();
});

Deno.test("memoryStorage round-trips values", () => {
  const storage = memoryStorage();
  assertEquals(storage.getItem("missing"), null);
  storage.setItem("k", JSON.stringify({ a: 1 }));
  assertEquals(JSON.parse(storage.getItem("k")), { a: 1 });
  storage.removeItem("k");
  assertEquals(storage.getItem("k"), null);
});

Deno.test("persist: state is mirrored and rehydrated on a fresh store", () => {
  const storage = memoryStorage();
  const cfg = (set) => ({
    count: 0,
    inc: () => set((s) => ({ count: s.count + 1 })),
  });

  const store = createStore(persist(cfg, { name: "counter", storage }));
  assertEquals(store.getState().count, 0);
  store.getState().inc();
  assertEquals(store.getState().count, 1);

  // Actions are not data: only the count round-trips through storage.
  const saved = JSON.parse(storage.getItem("counter"));
  assertEquals(saved, { version: 0, state: { count: 1 } });

  // A fresh store with the same key rehydrates instead of resetting.
  const revived = createStore(persist(cfg, { name: "counter", storage }));
  assertEquals(revived.getState().count, 1);
  assertEquals(revived.persist.hasHydrated(), true);
});

Deno.test("persist: cross-tab updates arrive through rehydrate()", () => {
  const storage = memoryStorage();
  const cfg = (set) => ({
    count: 0,
    inc: () => set((s) => ({ count: s.count + 1 })),
  });

  const writer = createStore(persist(cfg, { name: "shared", storage }));
  const reader = createStore(persist(cfg, { name: "shared", storage }));

  let seen = null;
  const unsub = reader.subscribe((s) => s.count, (count) => (seen = count));

  writer.getState().inc(); // another tab wrote the shared key
  reader.persist.rehydrate(); // the storage-event handler calls this
  assertEquals(reader.getState().count, 1);
  assertEquals(seen, 1);

  unsub();
  reader.persist.rehydrate(); // unsubscribed: no notification
  assertEquals(seen, 1);
});

Deno.test("persist: a version mismatch runs migrate()", () => {
  const storage = memoryStorage();
  storage.setItem(
    "app",
    JSON.stringify({ version: 1, state: { count: 5, legacy: true } }),
  );
  const cfg = (set) => ({ count: 0 });

  const store = createStore(
    persist(cfg, {
      name: "app",
      storage,
      version: 2,
      migrate: (persisted, fromVersion) => {
        assertEquals(fromVersion, 1);
        const { legacy: _dropped, ...rest } = persisted;
        return rest;
      },
    }),
  );
  assertEquals(store.getState().count, 5);
  assertEquals("legacy" in store.getState(), false);
});

Deno.test("persist: a version mismatch without migrate discards the entry", () => {
  const storage = memoryStorage();
  storage.setItem(
    "app",
    JSON.stringify({ version: 1, state: { count: 5 } }),
  );
  const cfg = (set) => ({ count: 42 });

  const store = createStore(persist(cfg, { name: "app", storage, version: 2 }));
  assertEquals(store.getState().count, 42); // initial state, not stale data
});

Deno.test("persist: clearStorage drops the persisted key", () => {
  const storage = memoryStorage();
  const cfg = (set) => ({
    count: 0,
    inc: () => set((s) => ({ count: s.count + 1 })),
  });

  const store = createStore(persist(cfg, { name: "gone", storage }));
  store.getState().inc();
  assertEquals(typeof storage.getItem("gone"), "string");
  store.persist.clearStorage();
  assertEquals(storage.getItem("gone"), null);
});
