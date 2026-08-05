import assert from "node:assert/strict";
import test from "node:test";

import {
  RECENT_MEMORY,
  SOURCE_CATALOG,
  SOURCE_CONTINUE,
  SOURCE_LIBRARY,
  buildSurprisePool,
  pickSurprise,
  rememberSurprise
} from "./surpriseMe.js";

test("a title that is both saved and half-watched counts once, as half-watched", () => {
  const pool = buildSurprisePool({
    continueWatching: [{ contentId: "tt1", title: "Breaking Bad", positionMs: 100 }],
    library: [{ id: "tt1", name: "Breaking Bad" }],
    catalog: [{ id: "tt2", name: "Dune" }]
  });
  assert.equal(pool.length, 2);
  assert.equal(pool[0].source, SOURCE_CONTINUE);
  assert.equal(pool[0].positionMs, 100, "resume position survives so it does not restart");
});

test("entries without an id are unplayable and never enter the pool", () => {
  assert.deepEqual(buildSurprisePool({ catalog: [{ name: "No id" }, {}] }), []);
});

test("nothing to watch yields nothing rather than throwing", () => {
  assert.equal(pickSurprise([]), null);
  assert.equal(pickSurprise(null), null);
});

test("unfinished series are favoured over untouched catalogue titles", () => {
  const pool = [
    { id: "cw", source: SOURCE_CONTINUE },
    { id: "cat", source: SOURCE_CATALOG }
  ];
  // Weighted 6:1, so a ticket anywhere in the first six sevenths is the
  // continue-watching entry.
  assert.equal(pickSurprise(pool, { random: () => 0.5 }).id, "cw");
  assert.equal(pickSurprise(pool, { random: () => 0.99 }).id, "cat");
});

test("weights order the three sources as intended", () => {
  const pool = [
    { id: "a", source: SOURCE_CONTINUE },
    { id: "b", source: SOURCE_LIBRARY },
    { id: "c", source: SOURCE_CATALOG }
  ];
  const counts = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 1000; i += 1) {
    counts[pickSurprise(pool, { random: () => i / 1000 }).id] += 1;
  }
  assert.ok(counts.a > counts.b && counts.b > counts.c, JSON.stringify(counts));
});

test("a recent pick is skipped, so pressing twice gives something new", () => {
  const pool = [
    { id: "a", source: SOURCE_CATALOG },
    { id: "b", source: SOURCE_CATALOG }
  ];
  assert.equal(pickSurprise(pool, { recentIds: ["a"], random: () => 0.5 }).id, "b");
});

test("with everything recently seen it repeats rather than refusing", () => {
  // Refusing to answer is the one thing this button must never do.
  const pool = [{ id: "a", source: SOURCE_CATALOG }];
  assert.equal(pickSurprise(pool, { recentIds: ["a"], random: () => 0.5 }).id, "a");
});

test("the memory is newest-first, deduped and bounded", () => {
  let recent = [];
  for (let i = 0; i < RECENT_MEMORY + 5; i += 1) {
    recent = rememberSurprise(recent, `id-${i}`);
  }
  assert.equal(recent.length, RECENT_MEMORY);
  assert.equal(recent[0], `id-${RECENT_MEMORY + 4}`);

  const reordered = rememberSurprise(["x", "y", "z"], "z");
  assert.deepEqual(reordered, ["z", "x", "y"]);
});

test("a nonsense random value still returns a title", () => {
  const pool = [
    { id: "a", source: SOURCE_CONTINUE },
    { id: "b", source: SOURCE_CATALOG }
  ];
  assert.ok(pickSurprise(pool, { random: () => 0 }));
  assert.ok(pickSurprise(pool, { random: () => 1 }));
  assert.ok(pickSurprise(pool, { random: () => Number.NaN }));
});
