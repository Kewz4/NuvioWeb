import assert from "node:assert/strict";
import test from "node:test";

import {
  clearTranslationCache,
  cuesToVtt,
  mergeTranslatedBatch,
  subtitleTranslationLanguageLabel,
  translateSubtitleCues
} from "./subtitleAiTranslator.js";

const CUES = [
  { startMs: 1000, endMs: 2000, text: "Hello there." },
  { startMs: 3000, endMs: 4000, text: "General Kenobi." },
  { startMs: 5000, endMs: 6000, text: "You are a bold one." }
];

test("labels es-419 as Latin American Spanish", () => {
  assert.match(subtitleTranslationLanguageLabel("es-419"), /Latin American Spanish/);
  assert.equal(subtitleTranslationLanguageLabel(""), subtitleTranslationLanguageLabel("es-419"));
});

test("merges a batch answer by index and keeps timings", () => {
  const merged = mergeTranslatedBatch(CUES, {
    lines: [
      { i: 0, t: "Hola." },
      { i: 1, t: "General Kenobi." },
      { i: 2, t: "Eres un atrevido." }
    ]
  });
  assert.deepEqual(
    merged.map((cue) => cue.text),
    ["Hola.", "General Kenobi.", "Eres un atrevido."]
  );
  assert.deepEqual(
    merged.map((cue) => cue.startMs),
    [1000, 3000, 5000]
  );
});

test("falls back to the original text for missing or malformed entries", () => {
  const merged = mergeTranslatedBatch(CUES, {
    lines: [
      { i: 0, t: "Hola." },
      { i: 1, t: "   " },
      { i: 99, t: "out of range" },
      { i: "x", t: "bad index" }
    ]
  });
  assert.deepEqual(
    merged.map((cue) => cue.text),
    ["Hola.", "General Kenobi.", "You are a bold one."]
  );
});

test("falls back entirely when the payload is unusable", () => {
  assert.deepEqual(
    mergeTranslatedBatch(CUES, null).map((cue) => cue.text),
    CUES.map((cue) => cue.text)
  );
});

test("serializes cues into a loadable WebVTT document", () => {
  const vtt = cuesToVtt([{ startMs: 61_500, endMs: 63_000, text: "Hola." }]);
  assert.equal(vtt, "WEBVTT\n\n00:01:01.500 --> 00:01:03.000\nHola.\n");
});

test("produces a valid empty document when there are no cues", () => {
  assert.equal(cuesToVtt([]), "WEBVTT\n\n");
});

test("translates every cue across multiple batches", async () => {
  clearTranslationCache();
  let requests = 0;
  const result = await translateSubtitleCues({
    cues: CUES,
    provider: "gemini",
    apiKey: "key",
    batchSize: 2,
    requestJson: async ({ prompt }) => {
      requests += 1;
      // Echo back an uppercase "translation" for each indexed line present.
      const indices = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((match) => Number(match[1]));
      return { json: { lines: indices.map((i) => ({ i, t: `ES${i}` })) } };
    }
  });

  assert.equal(requests, 2);
  assert.deepEqual(
    result.map((cue) => cue.text),
    ["ES0", "ES1", "ES0"]
  );
});

test("reuses a cached translation instead of calling the model again", async () => {
  clearTranslationCache();
  let requests = 0;
  const options = {
    cues: CUES,
    provider: "gemini",
    apiKey: "key",
    sourceUrl: "https://example.test/sub.srt",
    requestJson: async () => {
      requests += 1;
      return { json: { lines: [{ i: 0, t: "Hola." }] } };
    }
  };

  await translateSubtitleCues(options);
  // The first pass may also sweep up lines the model skipped, so assert the
  // intent — a cached second run costs nothing — rather than a fixed count.
  const afterFirstRun = requests;
  assert.ok(afterFirstRun >= 1);

  await translateSubtitleCues(options);
  assert.equal(requests, afterFirstRun, "cached run must not call the model again");
});

test("stops immediately on an auth failure rather than burning quota", async () => {
  clearTranslationCache();
  let requests = 0;
  await assert.rejects(
    () =>
      translateSubtitleCues({
        cues: CUES,
        provider: "groq",
        apiKey: "bad",
        batchSize: 1,
        requestJson: async () => {
          requests += 1;
          throw new Error("Groq rejected the API key.");
        }
      }),
    /rejected the API key/
  );
  assert.equal(requests, 1);
});

test("keeps original lines when a single batch fails transiently", async () => {
  clearTranslationCache();
  const result = await translateSubtitleCues({
    cues: CUES,
    provider: "gemini",
    apiKey: "key",
    batchSize: 3,
    requestJson: async () => {
      throw new Error("network blip");
    }
  });
  assert.deepEqual(
    result.map((cue) => cue.text),
    CUES.map((cue) => cue.text)
  );
});

test("rejects an empty cue list", async () => {
  await assert.rejects(
    () => translateSubtitleCues({ cues: [], provider: "gemini", apiKey: "key" }),
    /No subtitle lines/
  );
});

test("sweeps up lines the model skipped, using smaller batches", async () => {
  clearTranslationCache();
  const batchSizes = [];
  const result = await translateSubtitleCues({
    cues: CUES,
    provider: "groq",
    apiKey: "key",
    batchSize: 80,
    requestJson: async ({ prompt }) => {
      const indices = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]));
      batchSizes.push(indices.length);
      // First pass translates only the first line; the sweep must catch the rest.
      if (batchSizes.length === 1) {
        return { json: { lines: [{ i: 0, t: "Hola." }] } };
      }
      return { json: { lines: indices.map((i) => ({ i, t: `ES${i}` })) } };
    }
  });

  assert.equal(result[0].text, "Hola.");
  // Lines 1 and 2 were recovered rather than left in English.
  assert.equal(result[1].text, "ES0");
  assert.equal(result[2].text, "ES1");
  assert.equal(batchSizes[0], 3, "first pass sends the whole batch");
  assert.equal(batchSizes[1], 2, "sweep sends only the missed lines");
});

test("a failing sweep leaves the first-pass result intact", async () => {
  clearTranslationCache();
  let calls = 0;
  const result = await translateSubtitleCues({
    cues: CUES,
    provider: "groq",
    apiKey: "key",
    batchSize: 80,
    requestJson: async () => {
      calls += 1;
      if (calls === 1) return { json: { lines: [{ i: 0, t: "Hola." }] } };
      throw new Error("network blip");
    }
  });
  assert.equal(result[0].text, "Hola.");
  assert.equal(result[1].text, CUES[1].text);
  assert.equal(result.length, CUES.length);
});

test("accepts a positional array of strings, the shape small models emit reliably", () => {
  const merged = mergeTranslatedBatch(CUES, {
    lines: ["Hola.", "General Kenobi.", "Eres un atrevido."]
  });
  assert.deepEqual(
    merged.map((cue) => cue.text),
    ["Hola.", "General Kenobi.", "Eres un atrevido."]
  );
  assert.deepEqual(
    merged.map((cue) => cue.startMs),
    [1000, 3000, 5000]
  );
});

test("rejects a positional array of the wrong length rather than misaligning", () => {
  // A short array would shift every later line onto the wrong cue, which is far
  // worse than leaving them untranslated.
  const merged = mergeTranslatedBatch(CUES, { lines: ["Hola.", "General Kenobi."] });
  assert.deepEqual(
    merged.map((cue) => cue.text),
    CUES.map((cue) => cue.text)
  );
});

test("blank entries in a positional array keep the original line", () => {
  const merged = mergeTranslatedBatch(CUES, { lines: ["Hola.", "   ", "Eres un atrevido."] });
  assert.deepEqual(
    merged.map((cue) => cue.text),
    ["Hola.", "General Kenobi.", "Eres un atrevido."]
  );
});
