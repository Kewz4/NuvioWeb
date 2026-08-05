// Player-side glue for AI subtitle auto-sync and translation.
//
// Kept out of playerScreen.js (which is already ~19k lines) and written against
// a small surface of the screen object, so the orchestration stays readable and
// the pure logic underneath remains independently tested.

import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { I18n } from "../../../i18n/index.js";
import { parseSubtitleCues } from "../../../core/player/subtitleCueParser.js";
import { runSubtitleAutoSync, isNonDialogueCue } from "../../../core/player/subtitleAutoSync.js";
import {
  DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE,
  getCachedTranslation,
  cuesToVtt,
  subtitleTranslationLanguageLabel,
  translateSubtitleCues
} from "../../../core/player/subtitleAiTranslator.js";
import { subtitleAiProviderLabel } from "../../../core/player/subtitleAiClient.js";
import { nextBuiltInGroqKey } from "../../../core/player/subtitleAiKeyPool.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { pickPrefetchSource } from "./subtitlePrefetch.js";

const SOURCE_CUE_BUFFER_LIMIT = 20;
const SUBTITLE_DELAY_MIN_MS = -60000;
const SUBTITLE_DELAY_MAX_MS = 60000;

function t(key, params = {}, fallback = "") {
  return I18n.t(key, params, { fallback: fallback || key });
}

/**
 * The API key for the currently selected provider.
 *
 * A key entered in Settings always wins. Otherwise Groq falls back to the
 * built-in household keys so the TV works with no setup at all, which is the
 * whole point for the people actually using it.
 */
export function resolveSubtitleAiCredentials(settings = PlayerSettingsStore.get()) {
  const provider = settings.subtitleAiProvider === "groq" ? "groq" : "gemini";
  const configured = String(
    provider === "groq" ? settings.subtitleAiGroqKey : settings.subtitleAiGeminiKey
  ).trim();
  if (configured) {
    return { provider, apiKey: configured };
  }
  // Fall back to the built-in Groq key even when the stored provider is Gemini.
  //
  // Changing the default provider only affects NEW profiles; anyone who used
  // the app before still has `subtitleAiProvider: "gemini"` persisted with no
  // key, and would otherwise never reach the key that ships with the build.
  const builtIn = nextBuiltInGroqKey();
  return builtIn ? { provider: "groq", apiKey: builtIn } : { provider, apiKey: "" };
}

/** Convenience for callers that only need to know whether a key exists. */
export function activeSubtitleAiKey(settings = PlayerSettingsStore.get()) {
  return resolveSubtitleAiCredentials(settings).apiKey;
}

/**
 * Encodes a generated VTT as a data: URL rather than a blob: URL.
 *
 * Applying a subtitle runs clearMountedExternalSubtitleTracks(), which revokes
 * every entry in externalSubtitleObjectUrls — including the blob we had just
 * created, so the <track> loaded a dead URL and reported readyState 3 with zero
 * cues. A data: URL has no lifecycle to get caught in.
 */
export function toSubtitleDataUrl(vtt) {
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(String(vtt))}`;
}

/** Errors that mean "this credential is unusable", as opposed to a transient fault. */
export function isCredentialFailure(error) {
  return /API key|quota|rate limit/i.test(String(error?.message || error || ""));
}

/**
 * Runs an AI task, falling back to the built-in key if the configured one is
 * dead.
 *
 * A key typed into Settings takes precedence, but keys get revoked and free
 * tiers run dry. Without this, one stale key stored on the TV would disable
 * subtitles permanently for people who will never open Settings to fix it.
 */
export async function withCredentialFallback(settings, run) {
  const primary = resolveSubtitleAiCredentials(settings);
  try {
    return await run(primary);
  } catch (error) {
    const builtIn = nextBuiltInGroqKey();
    const usedBuiltInAlready = primary.apiKey === builtIn || !builtIn;
    if (!isCredentialFailure(error) || usedBuiltInAlready) {
      throw error;
    }
    return run({ provider: "groq", apiKey: builtIn, usedFallback: true });
  }
}

export function isSubtitleAutoSyncAvailable(settings = PlayerSettingsStore.get()) {
  return Boolean(settings.subtitleAiAutoSyncEnabled) && Boolean(activeSubtitleAiKey(settings));
}

export function isSubtitleTranslationAvailable(settings = PlayerSettingsStore.get()) {
  return Boolean(settings.subtitleAiTranslateEnabled) && Boolean(activeSubtitleAiKey(settings));
}

/**
 * Records a cue rendered by the player's built-in/embedded track.
 *
 * `presentationMs` must be true video time. Non-dialogue cues are dropped here
 * so the buffer only ever holds lines an LLM can match on.
 */
export function recordAutoSyncSourceCue(screen, text, presentationMs) {
  const value = String(text || "").trim();
  if (!value || isNonDialogueCue(value)) {
    return;
  }
  const startMs = Number(presentationMs);
  if (!Number.isFinite(startMs)) {
    return;
  }
  if (!Array.isArray(screen.autoSyncSourceCues)) {
    screen.autoSyncSourceCues = [];
  }
  const buffer = screen.autoSyncSourceCues;
  if (buffer.length && buffer[buffer.length - 1].text === value) {
    return;
  }
  buffer.push({ startMs, text: value });
  if (buffer.length > SOURCE_CUE_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - SOURCE_CUE_BUFFER_LIMIT);
  }
}

export function clearAutoSyncSourceCues(screen) {
  screen.autoSyncSourceCues = [];
}

// If not a single reference cue has arrived in this long, the stream almost
// certainly has no usable built-in subtitle track. Bailing out here keeps the
// user from staring at "Calibrating…" for the full gather timeout.
const NO_CUE_ABORT_MS = 45000;

/**
 * Picks a built-in track to harvest correctly-timed reference lines from.
 *
 * Bitmap tracks (PGS/DVB) are skipped: they carry images, not text, so there is
 * nothing for the model to match without OCR.
 */
export function selectReferenceEmbeddedTrack(screen) {
  const tracks = Array.isArray(screen.embeddedSubtitleTracks) ? screen.embeddedSubtitleTracks : [];
  const textTracks = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => track && !track.bitmapSubtitle);
  if (!textTracks.length) {
    return null;
  }
  // Prefer whichever track is already selected, otherwise the first text track:
  // any correctly-timed language works as a timing reference.
  const current = Number(screen.selectedEmbeddedSubtitleTrackIndex);
  return textTracks.find(({ index }) => index === current) || textTracks[0];
}

/**
 * Temporarily renders a built-in track so its cues flow into the reference
 * buffer, and returns a function that restores the user's addon subtitle.
 *
 * Returns null when no usable built-in track exists or activation fails, so the
 * caller can fail fast with an actionable message instead of waiting.
 */
export function beginReferenceCueCapture(screen, addonSubtitle) {
  const reference = selectReferenceEmbeddedTrack(screen);
  if (!reference) {
    return null;
  }

  clearAutoSyncSourceCues(screen);
  screen.autoSyncCapturingReference = true;

  const applied = screen.applyNativeEmbeddedSubtitleTrack?.(reference.track, reference.index);
  if (!applied) {
    screen.autoSyncCapturingReference = false;
    return null;
  }

  return () => {
    screen.autoSyncCapturingReference = false;
    // Put the user's chosen subtitle back exactly as they selected it.
    const subtitleIndex = (screen.subtitles || []).findIndex(
      (entry) => entry && entry.url === addonSubtitle?.url
    );
    if (subtitleIndex >= 0) {
      screen.applySubtitleEntry?.({ subtitleIndex });
    }
  };
}

function waitForSourceCues(screen, { minCount, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const check = () => {
      const buffer = Array.isArray(screen.autoSyncSourceCues) ? screen.autoSyncSourceCues : [];
      const elapsed = Date.now() - startedAt;
      if (buffer.length >= minCount || elapsed >= timeoutMs) {
        resolve(buffer.slice(-minCount));
        return;
      }
      // Waiting for more lines is only worth it once cues are actually flowing.
      if (!buffer.length && elapsed >= NO_CUE_ABORT_MS) {
        resolve([]);
        return;
      }
      if (screen.autoSyncCancelled) {
        resolve([]);
        return;
      }
      screen.autoSyncPollTimer = setTimeout(check, 500);
    };
    check();
  });
}

async function downloadSubtitleText(screen, url) {
  const headers =
    typeof screen.getSubtitleRequestHeaders === "function"
      ? screen.getSubtitleRequestHeaders()
      : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Subtitle download failed (HTTP ${response.status}).`);
  }
  return response.text();
}

function statusMessage(status) {
  const params = { 1: status.attempt, 2: status.maxAttempts };
  switch (status.stage) {
    case "gathering":
      return t("subtitle_auto_sync_gathering", params, "Calibrating with built-in subtitle lines…");
    case "refining":
      return t("subtitle_auto_sync_refining", params, "Refining sync…");
    case "downloading":
      return t("subtitle_auto_sync_downloading", params, "Downloading addon subtitle lines…");
    case "matching":
      return t("subtitle_auto_sync_matching", params, "Matching lines with AI…");
    default:
      return "";
  }
}

/**
 * Runs AI auto-sync for the currently selected addon subtitle and applies the
 * resulting delay to the player.
 */
/**
 * Pins an async AI action to the title it was started on.
 *
 * PlayerScreen is a singleton re-mounted per title, so a run that outlives the
 * viewer's attention would otherwise apply its delay, its track and its toasts
 * to whatever is playing when it lands.
 *
 * @returns {function(): boolean} true while the original title is still mounted
 */
export function pinToCurrentTitle(screen) {
  const mountToken = screen?.playerMountToken ?? null;
  return () =>
    typeof screen?.isActiveMountToken === "function"
      ? screen.isActiveMountToken(mountToken)
      : screen?.playerMountToken === mountToken;
}

export async function runSubtitleAutoSyncForScreen(screen, { subtitleUrl } = {}) {
  const settings = PlayerSettingsStore.get();
  const url = String(subtitleUrl || screen.getActiveAddonSubtitleUrl?.() || "").trim();

  if (!url) {
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_auto_sync_select_addon_track",
        {},
        "Select an addon subtitle track to use Auto Sync."
      )
    );
    return null;
  }
  const { provider, apiKey } = resolveSubtitleAiCredentials(settings);
  if (!apiKey) {
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_ai_key_missing",
        {},
        "Add an API key in Settings > Playback > AI Subtitles first."
      )
    );
    return null;
  }

  screen.autoSyncCancelled = false;
  screen.autoSyncRunning = true;
  const stillSameTitle = pinToCurrentTitle(screen);

  // Reference lines only exist while a built-in track is rendering, so switch to
  // one for the duration of the calibration and restore the user's pick after.
  const addonSubtitle = (screen.subtitles || []).find((entry) => entry && entry.url === url);
  const restoreSubtitle = beginReferenceCueCapture(screen, addonSubtitle || { url });
  if (!restoreSubtitle) {
    screen.autoSyncRunning = false;
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_auto_sync_no_embedded_track",
        {},
        "This stream has no built-in subtitle track, so Auto-Sync cannot calibrate. Use Sync Line instead."
      )
    );
    return null;
  }

  try {
    const result = await runSubtitleAutoSync({
      subtitleUrl: url,
      provider,
      apiKey,
      minDelayMs: SUBTITLE_DELAY_MIN_MS,
      maxDelayMs: SUBTITLE_DELAY_MAX_MS,
      onStatus: (status) => {
        if (stillSameTitle()) {
          screen.showSubtitleAiToast?.(statusMessage(status), { sticky: true });
        }
      },
      gatherSourceCues: ({ minCount, timeoutMs }) =>
        waitForSourceCues(screen, { minCount, timeoutMs }),
      downloadSubtitleText: (target) => downloadSubtitleText(screen, target)
    });

    if (!stillSameTitle()) {
      return null;
    }
    screen.subtitleDelayMs = result.delayMs;
    screen.applySubtitlePresentationSettings?.({ refreshTrackRendering: true });
    screen.schedulePersistPlayerPresentationSettings?.();
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_auto_sync_applied",
        { 1: `${result.delayMs} ms` },
        `Sync applied: ${result.delayMs} ms`
      )
    );
    return result;
  } catch (error) {
    if (!stillSameTitle()) {
      return null;
    }
    const message = String(error?.message || error || "");
    screen.showSubtitleAiToast?.(
      /embedded subtitle track/i.test(message)
        ? t(
            "subtitle_auto_sync_no_embedded_track",
            {},
            "This stream has no built-in subtitle track, so Auto-Sync cannot calibrate. Use Sync Line instead."
          )
        : t("subtitle_auto_sync_failed", { 1: message }, `Auto-sync failed: ${message}`)
    );
    return null;
  } finally {
    if (stillSameTitle()) {
      screen.autoSyncRunning = false;
    }
    if (screen.autoSyncPollTimer) {
      clearTimeout(screen.autoSyncPollTimer);
      screen.autoSyncPollTimer = null;
    }
    // Always hand the user's subtitle back, including on failure.
    try {
      restoreSubtitle();
    } catch (_) {
      // Restoring is best effort; never mask the original outcome.
    }
  }
}

/**
 * Translates the currently selected subtitle track into the configured target
 * language and hands the player a VTT blob URL for it.
 */
export async function runSubtitleTranslationForScreen(screen, { subtitleUrl } = {}) {
  const settings = PlayerSettingsStore.get();
  const url = String(subtitleUrl || screen.getActiveAddonSubtitleUrl?.() || "").trim();
  const targetLanguage = settings.subtitleAiTargetLanguage || DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE;

  if (!url) {
    screen.showSubtitleAiToast?.(
      t("subtitle_timing_select_addon_first", {}, "Select an addon subtitle track first.")
    );
    return null;
  }
  const { provider, apiKey } = resolveSubtitleAiCredentials(settings);
  if (!apiKey) {
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_ai_key_missing",
        {},
        "Add an API key in Settings > Playback > AI Subtitles first."
      )
    );
    return null;
  }

  screen.subtitleTranslationRunning = true;
  try {
    const body = await downloadSubtitleText(screen, url);
    const cues = parseSubtitleCues(body, { sourceUrl: url });
    const translated = await translateSubtitleCues({
      cues,
      provider,
      apiKey,
      targetLanguage,
      sourceUrl: url,
      onProgress: ({ done, total }) =>
        screen.showSubtitleAiToast?.(
          t(
            "subtitle_translate_progress",
            { 1: done, 2: total },
            `Translating ${done} of ${total} lines…`
          ),
          { sticky: true }
        )
    });

    const vtt = cuesToVtt(translated);
    const objectUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
    screen.externalSubtitleObjectUrls?.push?.(objectUrl);
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_translate_done",
        { 1: subtitleTranslationLanguageLabel(targetLanguage) },
        `Translated into ${subtitleTranslationLanguageLabel(targetLanguage)}`
      )
    );
    return { objectUrl, cues: translated, targetLanguage };
  } catch (error) {
    const message = String(error?.message || error || "");
    screen.showSubtitleAiToast?.(
      t("subtitle_translate_failed", { 1: message }, `Translation failed: ${message}`)
    );
    return null;
  } finally {
    screen.subtitleTranslationRunning = false;
  }
}

/** Normalizes a language tag so "es-MX", "spa" and "es-419" compare equal. */
function languageRoot(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase();
  if (!code) {
    return "";
  }
  if (code === "spa" || code === "esp") {
    return "es";
  }
  return code.split(/[-_]/)[0];
}

/**
 * True when the stream already offers a subtitle in the target language, in
 * which case generating one would just waste API calls.
 */
export function hasSubtitleInTargetLanguage(screen, targetLanguage) {
  const wanted = languageRoot(targetLanguage);
  if (!wanted) {
    return true;
  }
  const addonMatch = (screen.subtitles || []).some(
    (entry) => entry && !entry.aiTranslated && languageRoot(entry.lang) === wanted
  );
  const embeddedMatch = (screen.embeddedSubtitleTracks || []).some(
    (track) => languageRoot(track?.language) === wanted
  );
  return addonMatch || embeddedMatch;
}

/** The subtitle to translate from: prefer English, else the first available. */
export function pickTranslationSource(screen) {
  const subtitles = (screen.subtitles || []).filter((entry) => entry?.url && !entry.aiTranslated);
  if (!subtitles.length) {
    return null;
  }
  return subtitles.find((entry) => languageRoot(entry.lang) === "en") || subtitles[0];
}

/**
 * Generates a complete target-language subtitle track for the stream.
 *
 * Playback is held for the duration on purpose: the point of this feature is
 * that the viewer gets full subtitles from the very first line, so letting the
 * episode run while only part of the file exists would defeat it.
 */
export async function generateTargetLanguageSubtitles(screen) {
  const settings = PlayerSettingsStore.get();
  const targetLanguage = settings.subtitleAiTargetLanguage || DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE;
  const label = subtitleTranslationLanguageLabel(targetLanguage);
  // withCredentialFallback re-resolves the provider per attempt, so only the
  // presence of a key matters here.
  const { apiKey } = resolveSubtitleAiCredentials(settings);

  // A full generation takes minutes, so it must not outlive the title it was
  // started on.
  const stillSameTitle = pinToCurrentTitle(screen);

  if (!apiKey) {
    screen.showSubtitleAiToast?.(
      t(
        "subtitle_ai_key_missing",
        {},
        "Add an API key in Settings > Playback > AI Subtitles first."
      )
    );
    return null;
  }

  const source = pickTranslationSource(screen);
  if (!source) {
    screen.showSubtitleAiToast?.(
      t("subtitle_generate_no_source", {}, "This stream has no subtitle track to translate from.")
    );
    return null;
  }

  // Hold playback regardless of who paused it. Opening the subtitle dialog
  // already pauses, so keying off "did WE pause it" left the viewer staring at
  // a frozen frame after generation finished. The brief is explicit: hold the
  // episode, generate, then let it play.
  screen.subtitleGenerationRunning = true;
  screen.holdPlaybackForSubtitleGeneration?.();
  screen.showSubtitleGenerationOverlay?.({ languageLabel: label });

  // The run ends early if the viewer leaves the title or cancels.
  const shouldStop = () => !stillSameTitle() || Boolean(screen.isSubtitleGenerationCancelled?.());

  try {
    const body = await downloadSubtitleText(screen, source.url);
    const cues = parseSubtitleCues(body, { sourceUrl: source.url });
    if (!cues.length) {
      throw new Error(t("subtitle_timing_file_no_lines", {}, "No subtitle lines were found."));
    }

    const translated = await withCredentialFallback(settings, (credentials) =>
      translateSubtitleCues({
        cues,
        provider: credentials.provider,
        apiKey: credentials.apiKey,
        targetLanguage,
        sourceUrl: source.url,
        onProgress: ({ done, total, retrying }) => {
          if (!stillSameTitle()) {
            return;
          }
          screen.updateSubtitleGenerationProgress?.({ done, total, retrying });
        },
        shouldStop
      })
    );

    if (!stillSameTitle()) {
      // The viewer moved on. The work is still cached against this subtitle
      // URL, so returning to the episode reuses it instantly.
      return null;
    }
    if (screen.isSubtitleGenerationCancelled?.()) {
      // Cancelled mid-run: a partial track is worse than none, so the episode
      // simply plays on without it.
      return null;
    }

    const objectUrl = toSubtitleDataUrl(cuesToVtt(translated));
    screen.applyTranslatedSubtitleTrack?.({ objectUrl, targetLanguage });
    screen.showSubtitleAiToast?.(
      t("subtitle_generate_done", { 1: label }, `Subtitles ready in ${label}`)
    );
    return { objectUrl, cues: translated, targetLanguage };
  } catch (error) {
    if (!stillSameTitle()) {
      return null;
    }
    const message = String(error?.message || error || "");
    screen.showSubtitleAiToast?.(
      t("subtitle_generate_failed", { 1: message }, `Could not generate subtitles: ${message}`)
    );
    return null;
  } finally {
    if (stillSameTitle()) {
      screen.subtitleGenerationRunning = false;
      screen.hideSubtitleGenerationOverlay?.();
      screen.releasePlaybackAfterSubtitleGeneration?.();
    }
  }
}

/**
 * Translates the next episode's subtitles in the background.
 *
 * Nothing is applied and nothing is shown: the result lands in the translator's
 * cache, keyed by the subtitle URL, so when the viewer reaches that episode the
 * track is already complete and playback never pauses at all.
 *
 * Every failure here is silent by design. This is speculative work the viewer
 * did not ask for, so a missing subtitle list, a rate limit, or a provider
 * outage should leave no trace — the episode simply generates on demand as it
 * always did.
 *
 * @returns {Promise<boolean>} true when a track was prepared and cached.
 */
export async function prefetchNextEpisodeSubtitles(screen, nextEpisode) {
  const settings = PlayerSettingsStore.get();
  const targetLanguage = settings.subtitleAiTargetLanguage || DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE;
  const { apiKey } = resolveSubtitleAiCredentials(settings);
  if (!apiKey || !nextEpisode) {
    return false;
  }

  const stillSameTitle = pinToCurrentTitle(screen);
  const lookup = screen.buildSubtitleLookupContext?.() || {};
  if (!lookup.id || !lookup.type) {
    return false;
  }

  try {
    const subtitles = await subtitleRepository.getSubtitles(
      lookup.type,
      lookup.id,
      nextEpisode.id || null,
      {
        season: Number(nextEpisode.season ?? lookup.season) || lookup.season,
        episode: Number(nextEpisode.episode ?? 0) || null,
        title: lookup.title,
        year: lookup.year
      }
    );
    const source = pickPrefetchSource(subtitles, targetLanguage);
    if (!source || !stillSameTitle()) {
      return false;
    }

    // Already prepared, by this or an earlier run.
    if (getCachedTranslation(source.url, targetLanguage)) {
      return true;
    }

    const body = await downloadSubtitleText(screen, source.url);
    const cues = parseSubtitleCues(body, { sourceUrl: source.url });
    if (!cues.length || !stillSameTitle()) {
      return false;
    }

    await withCredentialFallback(settings, (credentials) =>
      translateSubtitleCues({
        cues,
        provider: credentials.provider,
        apiKey: credentials.apiKey,
        targetLanguage,
        sourceUrl: source.url,
        // No progress reporting: the viewer is watching something else and must
        // not be told about work they did not request.
        onProgress: () => {},
        // Yields to a foreground generation, which the viewer IS waiting on.
        shouldStop: () => !stillSameTitle() || Boolean(screen.subtitleGenerationRunning)
      })
    );
    return Boolean(getCachedTranslation(source.url, targetLanguage));
  } catch (_) {
    return false;
  }
}

/** Extra rows shown in the in-player subtitle style rail. */
export function subtitleAiStyleControls(screen) {
  const settings = PlayerSettingsStore.get();
  const controls = [];
  if (settings.subtitleAiAutoSyncEnabled) {
    controls.push({
      id: "aiAutoSync",
      label: t("subtitle_auto_sync_button", {}, "AI Auto-Sync"),
      value: screen.autoSyncRunning
        ? "…"
        : activeSubtitleAiKey(settings)
          ? subtitleAiProviderLabel(settings.subtitleAiProvider)
          : t("subtitle_ai_key_not_set", {}, "Not set")
    });
  }
  if (settings.subtitleAiTranslateEnabled) {
    controls.push({
      id: "aiTranslate",
      label: t("subtitle_translate_button", {}, "Translate with AI"),
      value: screen.subtitleTranslationRunning
        ? "…"
        : subtitleTranslationLanguageLabel(settings.subtitleAiTargetLanguage)
    });
  }
  return controls;
}
