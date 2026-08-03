import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_SYNC_ADDON_WINDOW_RADIUS,
  computeJumpFallbackDelayMs,
  computeOffsetsFromPairs,
  isNonDialogueCue,
  median,
  runSubtitleAutoSync,
  selectAddonWindow
} from "./subtitleAutoSync.js";

test("treats music stings and bracketed sound cues as non-dialogue", () => {
  assert.equal(isNonDialogueCue("♪ la la la ♪"), true);
  assert.equal(isNonDialogueCue("[SINGING]"), true);
  assert.equal(isNonDialogueCue("(dramatic theme music)"), true);
  assert.equal(isNonDialogueCue("   "), true);
  assert.equal(isNonDialogueCue("Get down!"), false);
  // Bracketed speaker labels are still dialogue-bearing.
  assert.equal(isNonDialogueCue("[JOHN] Get down!"), false);
});

test("median handles odd, even and empty inputs", () => {
  assert.equal(median([300, 100, 200]), 200);
  assert.equal(median([100, 200, 300, 400]), 250);
  assert.equal(median([]), 0);
  assert.equal(median([1500]), 1500);
  assert.equal(median([-400, -200]), -300);
});

test("selects the addon window centred on the nearest cue", () => {
  const cues = Array.from({ length: 100 }, (_, index) => ({
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text: `line ${index}`
  }));

  const window = selectAddonWindow(cues, 50_000);
  assert.equal(window.startIndex, 50 - AUTO_SYNC_ADDON_WINDOW_RADIUS);
  assert.equal(window.endIndex, 50 + AUTO_SYNC_ADDON_WINDOW_RADIUS);
  assert.equal(window.cues.length, AUTO_SYNC_ADDON_WINDOW_RADIUS * 2 + 1);
});

test("clamps the addon window at the start of the file", () => {
  const cues = Array.from({ length: 100 }, (_, index) => ({
    startMs: index * 1000,
    text: `line ${index}`
  }));
  const window = selectAddonWindow(cues, 0);
  assert.equal(window.startIndex, 0);
  assert.equal(window.cues[0].text, "line 0");
});

test("returns an empty window for an empty cue list", () => {
  assert.deepEqual(selectAddonWindow([], 1000), { cues: [], startIndex: 0, endIndex: -1 });
});

test("offset is source minus target, and out-of-range indices are dropped", () => {
  const sourceCues = [{ startMs: 10_000, text: "a" }];
  const targetCues = [
    { startMs: 12_000, text: "x" },
    { startMs: 13_000, text: "y" }
  ];

  const matches = computeOffsetsFromPairs({
    pairs: [
      { source_index: 0, target_index: 0 },
      { source_index: 0, target_index: 1 },
      // Hallucinated indices must not reach the median.
      { source_index: 9, target_index: 0 },
      { source_index: 0, target_index: 42 },
      { source_index: -1, target_index: 0 },
      { source_index: "x", target_index: 0 }
    ],
    sourceCues,
    targetCues
  });

  assert.equal(matches.length, 2);
  assert.deepEqual(
    matches.map((match) => match.offsetMs),
    [-2000, -3000]
  );
});

test("tolerates a malformed pairs payload", () => {
  assert.deepEqual(computeOffsetsFromPairs({ pairs: null, sourceCues: [], targetCues: [] }), []);
  assert.deepEqual(
    computeOffsetsFromPairs({
      pairs: [null, {}],
      sourceCues: [{ startMs: 0 }],
      targetCues: [{ startMs: 0 }]
    }),
    []
  );
});

function buildDeps({ pairsByAttempt, sourceCues }) {
  let attempt = 0;
  const statuses = [];
  return {
    statuses,
    getAttempt: () => attempt,
    options: {
      subtitleUrl: "https://example.test/sub.srt",
      provider: "gemini",
      apiKey: "key",
      onStatus: (status) => statuses.push(status.stage),
      gatherSourceCues: async () => sourceCues,
      downloadSubtitleText: async () =>
        [
          "1",
          "00:00:11,000 --> 00:00:12,000",
          "target zero",
          "",
          "2",
          "00:00:12,000 --> 00:00:13,000",
          "target one",
          "",
          "3",
          "00:00:13,000 --> 00:00:14,000",
          "target two"
        ].join("\n"),
      requestJson: async () => {
        const pairs = pairsByAttempt[attempt] ?? [];
        attempt += 1;
        return { json: { pairs } };
      }
    }
  };
}

test("derives the delay from the median of matched pairs", async () => {
  const { options } = buildDeps({
    // Source line at 10s matches the 11s, 12s and 13s addon lines across the run.
    pairsByAttempt: [
      [
        { source_index: 0, target_index: 0 },
        { source_index: 0, target_index: 1 },
        { source_index: 0, target_index: 2 }
      ]
    ],
    sourceCues: [{ startMs: 10_000, text: "spoken line" }]
  });

  const result = await runSubtitleAutoSync(options);

  assert.equal(result.attemptsUsed, 1);
  assert.deepEqual(result.offsetsMs, [-1000, -2000, -3000]);
  assert.equal(result.delayMs, -2000);
});

test("pools offsets across attempts until the target count is reached", async () => {
  const { options } = buildDeps({
    pairsByAttempt: [
      [{ source_index: 0, target_index: 0 }],
      [{ source_index: 0, target_index: 0 }],
      [{ source_index: 0, target_index: 0 }]
    ],
    sourceCues: [{ startMs: 10_000, text: "spoken line" }]
  });

  const result = await runSubtitleAutoSync(options);

  assert.equal(result.attemptsUsed, 3);
  assert.equal(result.offsetsMs.length, 3);
  assert.equal(result.delayMs, -1000);
});

test("clamps the resulting delay to the allowed range", async () => {
  const { options } = buildDeps({
    pairsByAttempt: [
      [
        { source_index: 0, target_index: 0 },
        { source_index: 0, target_index: 1 },
        { source_index: 0, target_index: 2 }
      ]
    ],
    sourceCues: [{ startMs: 5_000_000, text: "spoken line" }]
  });

  const result = await runSubtitleAutoSync({ ...options, maxDelayMs: 30_000 });
  assert.equal(result.delayMs, 30_000);
});

test("explains the failure when the stream has no embedded subtitle track", async () => {
  const { options } = buildDeps({ pairsByAttempt: [[]], sourceCues: [] });
  await assert.rejects(() => runSubtitleAutoSync(options), /no embedded subtitle track/i);
});

test("filters non-dialogue lines out of the captured source cues", async () => {
  const { options } = buildDeps({
    pairsByAttempt: [[]],
    sourceCues: [{ startMs: 10_000, text: "♪ music ♪" }]
  });
  // Only a music cue was captured, so there is nothing matchable.
  await assert.rejects(() => runSubtitleAutoSync(options), /no embedded subtitle track/i);
});

test("propagates a bad API key immediately instead of retrying", async () => {
  let calls = 0;
  const { options } = buildDeps({
    pairsByAttempt: [[]],
    sourceCues: [{ startMs: 10_000, text: "spoken line" }]
  });
  await assert.rejects(
    () =>
      runSubtitleAutoSync({
        ...options,
        requestJson: async () => {
          calls += 1;
          throw new Error("Gemini rejected the API key.");
        }
      }),
    /rejected the API key/
  );
  assert.equal(calls, 1);
});

test("jump fallback compensates for reaction time against the displayed cue", () => {
  const addonCues = [
    { startMs: 10_000, text: "one" },
    { startMs: 20_000, text: "two" },
    { startMs: 30_000, text: "three" }
  ];

  // User pressed Sync at 25.3s while the 20s cue was on screen and no delay was
  // applied: true moment 25.0s, so the cue needs shifting forward by 5s.
  assert.equal(
    computeJumpFallbackDelayMs({ addonCues, pressedAtMs: 25_300, currentDelayMs: 0 }),
    5000
  );

  assert.equal(computeJumpFallbackDelayMs({ addonCues: [], pressedAtMs: 1000 }), null);
});
