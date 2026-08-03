import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetGroqKeyRotationForTests,
  __setBuiltInGroqKeysForTests,
  builtInGroqKeyCount,
  hasBuiltInGroqKeys,
  nextBuiltInGroqKey,
  rotateBuiltInGroqKey
} from "./subtitleAiKeyPool.js";

// The real pool comes from the gitignored local.properties at build time, so it
// is empty under `node --test`. Rotation is exercised against a seeded pool.
const FAKE_KEYS = ["gsk_alpha", "gsk_beta"];

test("an unconfigured build reports no keys instead of handing back a blank one", () => {
  __setBuiltInGroqKeysForTests([]);
  assert.equal(hasBuiltInGroqKeys(), false);
  assert.equal(builtInGroqKeyCount(), 0);
  assert.equal(nextBuiltInGroqKey(), "");
  assert.equal(rotateBuiltInGroqKey(), "");
});

test("round-robins across every built-in key before repeating", () => {
  __setBuiltInGroqKeysForTests(FAKE_KEYS);
  const count = builtInGroqKeyCount();
  const cycle = Array.from({ length: count }, () => nextBuiltInGroqKey());

  assert.equal(new Set(cycle).size, count, "a full cycle must visit each key once");
  cycle.forEach((key) => assert.match(key, /^gsk_/));
  // The next draw wraps to the start.
  assert.equal(nextBuiltInGroqKey(), cycle[0]);
});

test("rotate always yields a usable key, including with a single-key pool", () => {
  __setBuiltInGroqKeysForTests(["gsk_only"]);
  nextBuiltInGroqKey();
  assert.equal(rotateBuiltInGroqKey(), "gsk_only", "rotation must never hand back an empty key");

  // With more than one key, rotating must actually move off the current one.
  __setBuiltInGroqKeysForTests(FAKE_KEYS);
  __resetGroqKeyRotationForTests();
  assert.notEqual(rotateBuiltInGroqKey(), nextBuiltInGroqKey());
});

test("keys are read from the runtime env as a comma-separated list", async () => {
  globalThis.__NUVIO_ENV__ = { SUBTITLE_AI_GROQ_KEYS: " gsk_one , gsk_two ,, " };
  // A fresh import so the module resolves the env at load, as it does on the TV.
  const fresh = await import(`./subtitleAiKeyPool.js?env=${Date.now()}`);
  assert.equal(fresh.builtInGroqKeyCount(), 2, "blank entries and padding are ignored");
  assert.equal(fresh.nextBuiltInGroqKey(), "gsk_one");
  delete globalThis.__NUVIO_ENV__;
});
