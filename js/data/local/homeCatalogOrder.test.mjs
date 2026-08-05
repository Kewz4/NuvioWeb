import assert from "node:assert/strict";
import test from "node:test";

// HomeCatalogStore persists through LocalStore, which wants a browser-ish
// global. A minimal stand-in keeps this free of a DOM.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const { HomeCatalogStore } = await import("./homeCatalogStore.js");

test("unknown keys are appended by default", () => {
  memory.clear();
  HomeCatalogStore.ensureOrderKeys(["a", "b"]);
  assert.deepEqual(HomeCatalogStore.ensureOrderKeys(["c"]), ["a", "b", "c"]);
});

test("a position puts first-sight keys where they will be noticed", () => {
  memory.clear();
  HomeCatalogStore.ensureOrderKeys(["a", "b"]);
  assert.deepEqual(HomeCatalogStore.ensureOrderKeys(["top"], { position: 0 }), ["top", "a", "b"]);
});

test("a key already in the order is never moved", () => {
  // The whole reason position only applies on first sight: otherwise every
  // reload would drag the row back to the top and undo the user's reordering.
  memory.clear();
  HomeCatalogStore.ensureOrderKeys(["a", "moved", "b"]);
  assert.deepEqual(HomeCatalogStore.ensureOrderKeys(["moved"], { position: 0 }), [
    "a",
    "moved",
    "b"
  ]);
});

test("a position past the end still lands in the order", () => {
  memory.clear();
  HomeCatalogStore.ensureOrderKeys(["a"]);
  assert.deepEqual(HomeCatalogStore.ensureOrderKeys(["z"], { position: 99 }), ["a", "z"]);
});

test("a nonsense position falls back to appending", () => {
  memory.clear();
  HomeCatalogStore.ensureOrderKeys(["a"]);
  assert.deepEqual(HomeCatalogStore.ensureOrderKeys(["b"], { position: Number.NaN }), ["a", "b"]);
});
