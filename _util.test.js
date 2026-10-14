// Tests for @nostore/core (PR 1: createStore) — run with `deno test`.
//
// Plain JS on purpose: no transpile step, nothing to keep in sync with a
// tsc invocation. If it runs here it runs on JSR.

import { assertEquals } from "jsr:@std/assert@1";
import { createStore } from "./index.js";

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
