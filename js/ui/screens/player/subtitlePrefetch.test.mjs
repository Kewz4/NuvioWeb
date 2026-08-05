import assert from "node:assert/strict";
import test from "node:test";

import {
  PREFETCH_START_FRACTION,
  languageRoot,
  pickPrefetchSource,
  shouldPrefetchNextSubtitles
} from "./subtitlePrefetch.js";

const base = { positionSeconds: 900, durationSeconds: 2700, hasNextEpisode: true };

test("waits until the viewer has clearly settled on this episode", () => {
  assert.equal(shouldPrefetchNextSubtitles({ ...base, positionSeconds: 60 }), false);
  assert.equal(
    shouldPrefetchNextSubtitles({ ...base, positionSeconds: 2700 * PREFETCH_START_FRACTION }),
    true
  );
});

test("does nothing without a next episode", () => {
  assert.equal(shouldPrefetchNextSubtitles({ ...base, hasNextEpisode: false }), false);
});

test("never runs twice for the same episode", () => {
  assert.equal(shouldPrefetchNextSubtitles({ ...base, alreadyStarted: true }), false);
});

test("yields to a generation the viewer is actually waiting on", () => {
  // Both draw on one daily quota; the one holding up playback comes first.
  assert.equal(shouldPrefetchNextSubtitles({ ...base, generationRunning: true }), false);
});

test("unknown length falls back to elapsed time rather than never starting", () => {
  const unknown = { hasNextEpisode: true, durationSeconds: 0 };
  assert.equal(shouldPrefetchNextSubtitles({ ...unknown, positionSeconds: 60 }), false);
  assert.equal(shouldPrefetchNextSubtitles({ ...unknown, positionSeconds: 300 }), true);
});

test("prefers English as the translation source", () => {
  const picked = pickPrefetchSource(
    [
      { url: "a", lang: "fre" },
      { url: "b", lang: "eng" }
    ],
    "es-419"
  );
  assert.equal(picked.url, "b");
});

test("an episode that already has the target language needs no preparation", () => {
  assert.equal(
    pickPrefetchSource(
      [
        { url: "a", lang: "spa" },
        { url: "b", lang: "eng" }
      ],
      "es-419"
    ),
    null
  );
});

test("a track we generated ourselves is never a source", () => {
  assert.equal(pickPrefetchSource([{ url: "a", lang: "es", aiTranslated: true }], "es-419"), null);
  assert.equal(pickPrefetchSource([], "es-419"), null);
});

test("three-letter language codes are understood", () => {
  // Providers mix "en"/"eng" and "es"/"spa"; an English track labelled "eng"
  // must still be recognised, or every episode picks the wrong source.
  assert.equal(languageRoot("eng"), "en");
  assert.equal(languageRoot("spa"), "es");
  assert.equal(languageRoot("es-419"), "es");
  assert.equal(languageRoot("pt-BR"), "pt");
  assert.equal(languageRoot(""), "");
});
