import assert from "node:assert/strict";
import test from "node:test";

import {
  beginReferenceCueCapture,
  clearAutoSyncSourceCues,
  recordAutoSyncSourceCue,
  selectReferenceEmbeddedTrack
} from "./subtitleAiActions.js";
import { __setBuiltInGroqKeysForTests } from "../../../core/player/subtitleAiKeyPool.js";

// The shipped pool is supplied at build time from the gitignored
// local.properties, so it is empty here; seed it to exercise the fallback.
const BUILT_IN = "gsk_builtin_for_tests";

test("picks the first text track as the timing reference", () => {
  const screen = {
    embeddedSubtitleTracks: [
      { language: "en", bitmapSubtitle: false },
      { language: "es", bitmapSubtitle: false }
    ],
    selectedEmbeddedSubtitleTrackIndex: -1
  };
  assert.equal(selectReferenceEmbeddedTrack(screen).index, 0);
});

test("prefers the track already selected", () => {
  const screen = {
    embeddedSubtitleTracks: [
      { language: "en", bitmapSubtitle: false },
      { language: "es", bitmapSubtitle: false }
    ],
    selectedEmbeddedSubtitleTrackIndex: 1
  };
  assert.equal(selectReferenceEmbeddedTrack(screen).index, 1);
});

test("skips bitmap tracks, which carry images rather than matchable text", () => {
  const screen = {
    embeddedSubtitleTracks: [
      { language: "en", bitmapSubtitle: true },
      { language: "es", bitmapSubtitle: false }
    ],
    selectedEmbeddedSubtitleTrackIndex: -1
  };
  assert.equal(selectReferenceEmbeddedTrack(screen).index, 1);
});

test("returns null when only bitmap tracks or no tracks exist", () => {
  assert.equal(
    selectReferenceEmbeddedTrack({ embeddedSubtitleTracks: [{ bitmapSubtitle: true }] }),
    null
  );
  assert.equal(selectReferenceEmbeddedTrack({ embeddedSubtitleTracks: [] }), null);
  assert.equal(selectReferenceEmbeddedTrack({}), null);
});

test("capture switches to the built-in track and restores the addon subtitle", () => {
  const applied = [];
  const restored = [];
  const screen = {
    embeddedSubtitleTracks: [{ language: "es", bitmapSubtitle: false }],
    selectedEmbeddedSubtitleTrackIndex: -1,
    subtitles: [{ url: "https://addon.test/a.srt" }, { url: "https://addon.test/b.srt" }],
    applyNativeEmbeddedSubtitleTrack: (track, index) => {
      applied.push(index);
      return true;
    },
    applySubtitleEntry: (entry) => restored.push(entry.subtitleIndex)
  };

  const restore = beginReferenceCueCapture(screen, { url: "https://addon.test/b.srt" });
  assert.ok(restore, "capture should start");
  assert.deepEqual(applied, [0]);
  assert.equal(screen.autoSyncCapturingReference, true);

  restore();
  assert.equal(screen.autoSyncCapturingReference, false);
  // The user's own subtitle (index 1) must come back, not the reference track.
  assert.deepEqual(restored, [1]);
});

test("capture reports failure when the built-in track will not activate", () => {
  const screen = {
    embeddedSubtitleTracks: [{ language: "es", bitmapSubtitle: false }],
    applyNativeEmbeddedSubtitleTrack: () => false
  };
  assert.equal(beginReferenceCueCapture(screen, { url: "x" }), null);
  assert.equal(screen.autoSyncCapturingReference, false);
});

test("capture reports failure when there is no built-in text track", () => {
  const screen = { embeddedSubtitleTracks: [], applyNativeEmbeddedSubtitleTrack: () => true };
  assert.equal(beginReferenceCueCapture(screen, { url: "x" }), null);
});

test("reference buffer keeps dialogue, drops noise, and de-duplicates", () => {
  const screen = {};
  clearAutoSyncSourceCues(screen);

  recordAutoSyncSourceCue(screen, "Hello there.", 1000);
  recordAutoSyncSourceCue(screen, "Hello there.", 1200); // repeat of the same line
  recordAutoSyncSourceCue(screen, "♪ music ♪", 2000); // non-dialogue
  recordAutoSyncSourceCue(screen, "   ", 3000); // blank
  recordAutoSyncSourceCue(screen, "General Kenobi.", 4000);
  recordAutoSyncSourceCue(screen, "Not a number", Number.NaN); // unusable timing

  assert.deepEqual(screen.autoSyncSourceCues, [
    { startMs: 1000, text: "Hello there." },
    { startMs: 4000, text: "General Kenobi." }
  ]);
});

test("reference buffer is bounded so a long film cannot grow it without limit", () => {
  const screen = {};
  clearAutoSyncSourceCues(screen);
  for (let i = 0; i < 60; i += 1) {
    recordAutoSyncSourceCue(screen, `line ${i}`, i * 1000);
  }
  assert.equal(screen.autoSyncSourceCues.length, 20);
  // The most recent lines are the ones kept.
  assert.equal(screen.autoSyncSourceCues.at(-1).text, "line 59");
});

test("detects an existing target-language track across tag spellings", async () => {
  const { hasSubtitleInTargetLanguage } = await import("./subtitleAiActions.js");
  // es-MX, spa and plain es all satisfy a request for es-419.
  assert.equal(hasSubtitleInTargetLanguage({ subtitles: [{ lang: "es-MX" }] }, "es-419"), true);
  assert.equal(hasSubtitleInTargetLanguage({ subtitles: [{ lang: "spa" }] }, "es-419"), true);
  assert.equal(
    hasSubtitleInTargetLanguage(
      { subtitles: [], embeddedSubtitleTracks: [{ language: "es" }] },
      "es-419"
    ),
    true
  );
  assert.equal(hasSubtitleInTargetLanguage({ subtitles: [{ lang: "en" }] }, "es-419"), false);
});

test("a track we generated ourselves does not count as an existing source", async () => {
  const { hasSubtitleInTargetLanguage } = await import("./subtitleAiActions.js");
  assert.equal(
    hasSubtitleInTargetLanguage({ subtitles: [{ lang: "es-419", aiTranslated: true }] }, "es-419"),
    false
  );
});

test("prefers English as the translation source", async () => {
  const { pickTranslationSource } = await import("./subtitleAiActions.js");
  const screen = {
    subtitles: [
      { url: "a", lang: "fr" },
      { url: "b", lang: "en" },
      { url: "c", lang: "de" }
    ]
  };
  assert.equal(pickTranslationSource(screen).url, "b");
  // Falls back to whatever exists when there is no English.
  assert.equal(pickTranslationSource({ subtitles: [{ url: "z", lang: "fr" }] }).url, "z");
  assert.equal(pickTranslationSource({ subtitles: [] }), null);
});

test("falls back to the built-in Groq key when the stored provider is Gemini", async () => {
  __setBuiltInGroqKeysForTests([BUILT_IN]);
  const { resolveSubtitleAiCredentials } = await import("./subtitleAiActions.js");
  // Profiles created before Groq became the default still have gemini stored
  // with no key. They must still reach the key that ships with the build.
  const resolved = resolveSubtitleAiCredentials({
    subtitleAiProvider: "gemini",
    subtitleAiGeminiKey: "",
    subtitleAiGroqKey: ""
  });
  assert.equal(resolved.provider, "groq", "must not send a Groq key to Google");
  assert.equal(resolved.apiKey, BUILT_IN);
});

test("a build with no configured key resolves to nothing, not a blank key", async () => {
  __setBuiltInGroqKeysForTests([]);
  const { resolveSubtitleAiCredentials } = await import("./subtitleAiActions.js");
  // The caller shows "add an API key in Settings" on an empty key; handing back
  // "" must not be mistaken for a usable credential.
  assert.equal(
    resolveSubtitleAiCredentials({
      subtitleAiProvider: "gemini",
      subtitleAiGeminiKey: "",
      subtitleAiGroqKey: ""
    }).apiKey,
    ""
  );
});

test("a user-entered key always wins over the built-in one", async () => {
  const { resolveSubtitleAiCredentials } = await import("./subtitleAiActions.js");
  assert.deepEqual(
    resolveSubtitleAiCredentials({
      subtitleAiProvider: "gemini",
      subtitleAiGeminiKey: "AIzaSy-user-key",
      subtitleAiGroqKey: ""
    }),
    { provider: "gemini", apiKey: "AIzaSy-user-key" }
  );
  assert.deepEqual(
    resolveSubtitleAiCredentials({
      subtitleAiProvider: "groq",
      subtitleAiGroqKey: "gsk_user",
      subtitleAiGeminiKey: ""
    }),
    { provider: "groq", apiKey: "gsk_user" }
  );
});

test("falls back to the built-in key when a stored key is revoked", async () => {
  __setBuiltInGroqKeysForTests([BUILT_IN]);
  const { withCredentialFallback } = await import("./subtitleAiActions.js");
  const attempts = [];
  const result = await withCredentialFallback(
    { subtitleAiProvider: "groq", subtitleAiGroqKey: "gsk_revoked", subtitleAiGeminiKey: "" },
    async (credentials) => {
      attempts.push(credentials.apiKey);
      if (credentials.apiKey === "gsk_revoked") {
        throw new Error("Groq rejected the API key.");
      }
      return "translated";
    }
  );

  assert.equal(result, "translated");
  assert.equal(attempts.length, 2, "must retry once with the built-in key");
  assert.equal(attempts[0], "gsk_revoked");
  assert.equal(attempts[1], BUILT_IN);
});

test("does not retry on faults unrelated to credentials", async () => {
  const { withCredentialFallback } = await import("./subtitleAiActions.js");
  let calls = 0;
  await assert.rejects(
    () =>
      withCredentialFallback(
        { subtitleAiProvider: "groq", subtitleAiGroqKey: "gsk_x" },
        async () => {
          calls += 1;
          throw new Error("network blip");
        }
      ),
    /network blip/
  );
  assert.equal(calls, 1, "a transient error must not burn the fallback");
});

test("does not loop when the built-in key itself is the one failing", async () => {
  const { withCredentialFallback, resolveSubtitleAiCredentials } =
    await import("./subtitleAiActions.js");
  const builtIn = resolveSubtitleAiCredentials({
    subtitleAiProvider: "groq",
    subtitleAiGroqKey: "",
    subtitleAiGeminiKey: ""
  }).apiKey;
  let calls = 0;
  await assert.rejects(
    () =>
      withCredentialFallback(
        { subtitleAiProvider: "groq", subtitleAiGroqKey: builtIn, subtitleAiGeminiKey: "" },
        async () => {
          calls += 1;
          throw new Error("Groq rate limit reached.");
        }
      ),
    /rate limit/
  );
  assert.equal(calls, 1, "no point retrying the key that just failed");
});

test("generated tracks use a data: URL that survives the player's revoke sweep", async () => {
  const { toSubtitleDataUrl } = await import("./subtitleAiActions.js");
  const url = toSubtitleDataUrl("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n¡Hola, señor!\n");

  // blob: URLs get revoked by clearMountedExternalSubtitleTracks before the
  // <track> can read them, which left the viewer with zero cues.
  assert.ok(url.startsWith("data:text/vtt;charset=utf-8,"), "must not be a blob: URL");
  const decoded = decodeURIComponent(url.slice("data:text/vtt;charset=utf-8,".length));
  assert.match(decoded, /^WEBVTT/);
  assert.match(decoded, /¡Hola, señor!/, "accented Spanish must survive encoding");
});
