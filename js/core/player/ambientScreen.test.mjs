import assert from "node:assert/strict";
import test from "node:test";

import {
  AMBIENT_IDLE_DELAY_MS,
  AMBIENT_ROTATE_MS,
  ambientArtworkIndex,
  buildAmbientArtwork,
  shouldShowAmbient
} from "./ambientScreen.js";

test("a brief pause is not a slideshow", () => {
  assert.equal(shouldShowAmbient({ paused: true, idleMs: 5000 }), false);
  assert.equal(shouldShowAmbient({ paused: true, idleMs: AMBIENT_IDLE_DELAY_MS }), true);
});

test("never while something is playing", () => {
  assert.equal(shouldShowAmbient({ paused: false, idleMs: AMBIENT_IDLE_DELAY_MS * 10 }), false);
});

test("an open menu means someone is present", () => {
  // Pausing to read the subtitle menu must not fade the screen out underneath.
  assert.equal(
    shouldShowAmbient({ paused: true, idleMs: AMBIENT_IDLE_DELAY_MS, dialogOpen: true }),
    false
  );
});

test("it can be turned off", () => {
  assert.equal(
    shouldShowAmbient({ paused: true, idleMs: AMBIENT_IDLE_DELAY_MS, enabled: false }),
    false
  );
});

test("the current title's artwork leads, then recent titles", () => {
  const art = buildAmbientArtwork({
    current: { background: "now.jpg" },
    recent: [{ background: "a.jpg" }, { enrichedMeta: { background: "b.jpg" } }]
  });
  assert.deepEqual(art, ["now.jpg", "a.jpg", "b.jpg"]);
});

test("duplicates and blanks are dropped", () => {
  const art = buildAmbientArtwork({
    current: { background: "same.jpg" },
    recent: [{ background: "same.jpg" }, { background: "" }, {}]
  });
  assert.deepEqual(art, ["same.jpg"]);
});

test("with no artwork at all there is simply nothing to rotate", () => {
  assert.deepEqual(buildAmbientArtwork({}), []);
  assert.equal(ambientArtworkIndex(999999, 0), 0);
});

test("a single image never rotates", () => {
  assert.equal(ambientArtworkIndex(0, 1), 0);
  assert.equal(ambientArtworkIndex(AMBIENT_ROTATE_MS * 5, 1), 0);
});

test("rotation advances on the interval and wraps", () => {
  assert.equal(ambientArtworkIndex(0, 3), 0);
  assert.equal(ambientArtworkIndex(AMBIENT_ROTATE_MS - 1, 3), 0);
  assert.equal(ambientArtworkIndex(AMBIENT_ROTATE_MS, 3), 1);
  assert.equal(ambientArtworkIndex(AMBIENT_ROTATE_MS * 3, 3), 0);
});

test("rotation is slow enough to read as wallpaper, not motion", () => {
  assert.ok(AMBIENT_ROTATE_MS >= 30000, "faster than 30s pulls the eye back");
});
