import assert from "node:assert/strict";
import test from "node:test";

import {
  createProgressEstimator,
  formatRemaining,
  progressPercent
} from "./subtitleGenerationOverlay.js";

test("percent is clamped so a rounding slip cannot overfill the bar", () => {
  assert.equal(progressPercent(0, 900), 0);
  assert.equal(progressPercent(450, 900), 50);
  assert.equal(progressPercent(1000, 900), 100);
  assert.equal(progressPercent(10, 0), 0, "an unknown total is not infinite progress");
});

test("no estimate is offered until there is something to base one on", () => {
  const estimator = createProgressEstimator(0);
  assert.equal(estimator.remainingMs(0, 900), null);
  estimator.record(60, 1000);
  assert.equal(estimator.remainingMs(60, 900), null, "one sample is not a rate");
});

test("projects the remaining time from the observed rate", () => {
  const estimator = createProgressEstimator(0);
  // 60 lines per second.
  estimator.record(60, 1000);
  estimator.record(120, 2000);
  estimator.record(180, 3000);
  assert.equal(estimator.remainingMs(180, 900), (900 - 180) / 0.06);
  assert.equal(estimator.remainingMs(900, 900), 0);
});

test("repeated progress ticks at the same count carry no rate information", () => {
  // Token-budget pacing re-reports the same count while it waits; treating that
  // as elapsed-with-no-progress would drive the estimate towards infinity.
  const estimator = createProgressEstimator(0);
  estimator.record(60, 1000);
  estimator.record(60, 9000);
  estimator.record(60, 20000);
  assert.equal(estimator.rate(), 0, "duplicates are ignored, so no rate is claimed yet");
  estimator.record(120, 21000);
  assert.ok(estimator.rate() > 0);
});

test("the rate window forgets a slow first batch", () => {
  const estimator = createProgressEstimator(0);
  // A cold first batch takes 10s, the rest take 1s each.
  estimator.record(60, 10000);
  for (let index = 1; index <= 8; index += 1) {
    estimator.record(60 + index * 60, 10000 + index * 1000);
  }
  // A lifetime average would still be dragged down by the 10s warm-up.
  const remaining = estimator.remainingMs(540, 900);
  assert.ok(remaining < 7000, `warm-up should not dominate, got ${remaining}ms`);
});

test("durations read as rounded, reassuring text", () => {
  const t = (_key, _params, fallback) => fallback;
  assert.equal(formatRemaining(5000, t), "almost done");
  assert.equal(formatRemaining(45000, t), "about 50 s left");
  assert.equal(formatRemaining(150000, t), "about 3 min left");
  assert.equal(formatRemaining(3900000, t), "about 1 h 5 min left");
  assert.equal(formatRemaining(-1, t), "", "a nonsense duration shows nothing at all");
  assert.equal(formatRemaining(Number.NaN, t), "");
});
