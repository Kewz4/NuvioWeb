// AI subtitle translation.
//
// The parents this build targets need Spanish on every title, but addon
// providers frequently only carry English for newer releases. When no es-419
// track exists we translate an available one, preserving the original timings
// so the result drops straight into the existing VTT renderer.

import { requestSubtitleAiJson } from "./subtitleAiClient.js";

export const DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE = "es-419";

const LANGUAGE_LABELS = {
  "es-419": "Latin American Spanish (español latinoamericano)",
  es: "European Spanish (español de España)",
  en: "English",
  "pt-br": "Brazilian Portuguese (português brasileiro)",
  fr: "French",
  it: "Italian",
  de: "German"
};

// Sized for the WEAKEST model we may fall back to, not the best one. Measured
// on a real 911-cue episode: llama-3.3-70b handles 150-line batches almost
// perfectly, but llama-3.1-8b-instant (the fallback once the 70b hits its daily
// token cap) drops most of them, yielding 23% translated. 60 lines is small
// enough for the 8b model to keep alignment while staying far below Gemini's
// 20-requests-per-day cap. Tokens, not requests, are the binding constraint on
// Groq (100k/day), and batch size barely moves total token count.
export const TRANSLATION_BATCH_SIZE = 60;

const MAX_CACHE_ENTRIES = 8;
const translationCache = new Map();

// Rough tokens a batch costs, used to decide whether the remaining per-minute
// budget can absorb another request. Measured at ~33 tokens per subtitle line
// in and out combined, on the real episode files.
const TOKENS_PER_LINE_ESTIMATE = 33;
const TOKEN_PAUSE_CAP_MS = 65000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the provider's per-minute token bucket to refill when the next
 * batch would not fit.
 *
 * Groq's free tier allows 12,000 tokens/minute while a full episode needs
 * ~31,000, so firing batches back to back guarantees a 429. Pausing on the
 * budget the API itself reports is far more reliable than retrying blindly.
 */
export async function pauseForTokenBudget(
  rateLimit,
  hasMoreWork,
  onProgress = () => {},
  progress = {}
) {
  if (!hasMoreWork || !rateLimit) {
    return 0;
  }
  const { remainingTokens, limitTokens, resetTokensMs } = rateLimit;
  if (!Number.isFinite(remainingTokens) || !Number.isFinite(limitTokens) || limitTokens <= 0) {
    return 0;
  }
  const nextBatchCost = TOKENS_PER_LINE_ESTIMATE * TRANSLATION_BATCH_SIZE;
  if (remainingTokens >= nextBatchCost) {
    return 0;
  }
  const waitMs = Math.min(Math.max(Number(resetTokensMs) || 0, 1000), TOKEN_PAUSE_CAP_MS);
  onProgress({ ...progress, waitingForQuotaMs: waitMs });
  await sleep(waitMs);
  return waitMs;
}

export function subtitleTranslationLanguageLabel(languageCode) {
  const code = String(languageCode || "").trim();
  return LANGUAGE_LABELS[code] || code || LANGUAGE_LABELS[DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE];
}

function cacheKey(sourceUrl, targetLanguage) {
  return `${String(sourceUrl || "")}::${String(targetLanguage || "")}`;
}

export function getCachedTranslation(sourceUrl, targetLanguage) {
  return translationCache.get(cacheKey(sourceUrl, targetLanguage)) || null;
}

export function setCachedTranslation(sourceUrl, targetLanguage, cues) {
  const key = cacheKey(sourceUrl, targetLanguage);
  if (translationCache.has(key)) {
    translationCache.delete(key);
  }
  translationCache.set(key, cues);
  // Subtitle sets are large; keep the map bounded on memory-tight TV hardware.
  while (translationCache.size > MAX_CACHE_ENTRIES) {
    translationCache.delete(translationCache.keys().next().value);
  }
}

export function clearTranslationCache() {
  translationCache.clear();
}

export function buildTranslationPrompt(batch = [], targetLanguageLabel = "") {
  const lines = batch
    .map((cue, index) => `[${index}] ${JSON.stringify(String(cue.text || ""))}`)
    .join("\n");
  return `System:
You are a professional subtitle translator. Translate each numbered subtitle line into ${targetLanguageLabel}.
Rules:
- Return EXACTLY one translation per input line, keeping the same index. Never merge, split, drop or reorder lines.
- Translate naturally for a general audience, using neutral Latin American vocabulary and voseo-free "tú"/"ustedes" forms. Do not use Peninsular Spanish "vosotros".
- Keep it short enough to read on screen. Preserve names, numbers and proper nouns.
- PRESERVE LINE BREAKS EXACTLY. A cue containing a newline is a two-speaker or two-line cue; return the same number of lines, separated by 
, in the same order. Never merge them onto one line.
- Preserve the speaker dash convention: a line starting with "-" keeps its leading "-".
- If a line is a sound effect or music marker, translate it in the same bracket or note style.
- Output ONLY a valid JSON object with one key, "lines", holding a plain array of translated strings IN THE SAME ORDER as the input. The array must have exactly ${batch.length} strings.
- Do not include the index numbers in your output. Do not output markdown, explanations, or any other text.

User:
<lines>
${lines}
</lines>

Expected JSON output format:
{"lines": ["<translation of line 0>", "<translation of line 1>", ...]}`;
}

/**
 * Applies a model's batch answer back onto the batch's cues.
 * Untranslated or malformed entries fall back to the original text so a partial
 * failure degrades to bilingual output rather than missing subtitles.
 */
export function mergeTranslatedBatch(batch = [], payload = null) {
  const byIndex = new Map();
  const entries = Array.isArray(payload?.lines) ? payload.lines : [];

  // Preferred shape is a positional array of strings — small models produce it
  // far more reliably than {"i":N,"t":"..."} objects, which they often emit as
  // syntactically invalid JSON. Positional data is only safe when the count
  // matches exactly, otherwise every line after a drop would be misaligned.
  const positional = entries.every((entry) => typeof entry === "string");
  if (positional && entries.length === batch.length) {
    return batch.map((cue, index) => {
      const text = String(entries[index] ?? "").trim();
      return { ...cue, text: text || cue.text };
    });
  }

  // Indexed shape, still accepted so a stronger model's richer output works.
  entries.forEach((entry, position) => {
    if (typeof entry === "string") {
      return;
    }
    const index = Number(entry?.i ?? position);
    const text = String(entry?.t ?? "").trim();
    if (Number.isInteger(index) && index >= 0 && index < batch.length && text) {
      byIndex.set(index, text);
    }
  });
  return batch.map((cue, index) => ({ ...cue, text: byIndex.get(index) || cue.text }));
}

function formatVttTimestamp(totalMs) {
  const ms = Math.max(0, Math.round(Number(totalMs) || 0));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  const pad = (value, width) => String(value).padStart(width, "0");
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

/**
 * Cue body that is safe to write into a VTT block.
 *
 * Line breaks inside a cue are kept — they carry the two-speaker layout — but a
 * *blank* line would end the block early and swallow every cue after it, and a
 * literal "-->" would be read as a timing line. Both come from model output, so
 * neither can be assumed away.
 */
function sanitizeVttCueBody(value = "") {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/-->/g, "→").trim())
    .filter(Boolean)
    .join("\n");
}

/** Serializes cues back into a WebVTT document the player can load directly. */
export function cuesToVtt(cues = []) {
  const blocks = cues
    .filter((cue) => Number.isFinite(Number(cue?.startMs)) && Number.isFinite(Number(cue?.endMs)))
    .map(
      (cue) =>
        `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}\n${sanitizeVttCueBody(cue.text)}`
    );
  return `WEBVTT\n\n${blocks.join("\n\n")}${blocks.length ? "\n" : ""}`;
}

/**
 * Translates parsed cues into `targetLanguage`, batching requests.
 *
 * @param {object} options
 * @param {Array<{startMs:number,endMs:number,text:string}>} options.cues
 * @param {string} options.provider
 * @param {string} options.apiKey
 * @param {string} [options.targetLanguage]
 * @param {string} [options.sourceUrl]   cache key; omit to skip caching
 * @param {function} [options.onProgress] ({done, total}) => void
 * @param {function} [options.shouldStop] returns true to abandon the run, e.g.
 *   when the viewer has left the title this track was being generated for
 * @param {function} [options.requestJson] override for tests
 * @returns {Promise<Array>} cues with translated text and original timings
 */
export async function translateSubtitleCues({
  cues = [],
  provider,
  apiKey,
  model = "",
  targetLanguage = DEFAULT_SUBTITLE_TRANSLATION_LANGUAGE,
  sourceUrl = "",
  batchSize = TRANSLATION_BATCH_SIZE,
  onProgress = () => {},
  shouldStop = null,
  requestJson = requestSubtitleAiJson
} = {}) {
  const abandoned = () => typeof shouldStop === "function" && shouldStop();
  if (!cues.length) {
    throw new Error("No subtitle lines were found to translate.");
  }

  if (sourceUrl) {
    const cached = getCachedTranslation(sourceUrl, targetLanguage);
    if (cached) {
      onProgress({ done: cues.length, total: cues.length, cached: true });
      return cached;
    }
  }

  const label = subtitleTranslationLanguageLabel(targetLanguage);
  const translated = [];

  let lastRateLimit = null;

  for (let start = 0; start < cues.length; start += batchSize) {
    if (abandoned()) {
      // Stop spending the household's daily quota on a title nobody is
      // watching any more. What is already translated is still cached.
      break;
    }
    const batch = cues.slice(start, start + batchSize);
    let payload = null;
    try {
      const response = await requestJson({
        provider,
        apiKey,
        model,
        prompt: buildTranslationPrompt(batch, label)
      });
      payload = response?.json || null;
      lastRateLimit = response?.rateLimit || null;
    } catch (error) {
      // Auth and rate-limit problems will repeat for every remaining batch, so
      // stop rather than burning the user's quota on guaranteed failures.
      // Auth and quota problems repeat for every remaining batch, so surface
      // them instead of silently handing back a fully untranslated track.
      if (/API key|rate limit|quota/i.test(String(error?.message || ""))) {
        throw error;
      }
      payload = null;
    }
    translated.push(...mergeTranslatedBatch(batch, payload));
    onProgress({ done: Math.min(start + batchSize, cues.length), total: cues.length });
    await pauseForTokenBudget(lastRateLimit, start + batchSize < cues.length, onProgress, {
      done: Math.min(start + batchSize, cues.length),
      total: cues.length
    });
  }

  // Large batches keep the request count inside free-tier daily caps, but the
  // model silently drops a line here and there, which merge falls back to the
  // original for. Sweep those up in one small pass so the viewer is not left
  // with stray English lines mid-episode.
  const missed = [];
  translated.forEach((cue, index) => {
    if (cue.text === cues[index].text && String(cue.text || "").trim()) {
      missed.push(index);
    }
  });

  if (missed.length && missed.length < cues.length && !abandoned()) {
    onProgress({ done: cues.length, total: cues.length, retrying: missed.length });
    // Retry smaller than the first pass. A whole batch usually goes missing
    // because its response hit the output-token ceiling and came back as
    // truncated JSON, so repeating at the same size would fail identically.
    const retryBatchSize = Math.max(20, Math.floor(batchSize / 4));
    for (let start = 0; start < missed.length; start += retryBatchSize) {
      if (abandoned()) {
        break;
      }
      const indices = missed.slice(start, start + retryBatchSize);
      const batch = indices.map((index) => cues[index]);
      try {
        const response = await requestJson({
          provider,
          apiKey,
          model,
          prompt: buildTranslationPrompt(batch, label)
        });
        mergeTranslatedBatch(batch, response?.json || null).forEach((cue, offset) => {
          translated[indices[offset]] = { ...translated[indices[offset]], text: cue.text };
        });
      } catch (error) {
        // A failed sweep just leaves the original lines in place.
        if (/API key/i.test(String(error?.message || ""))) {
          throw error;
        }
        break;
      }
    }
  }

  // Only cache a complete run: a partial track cached under the subtitle URL
  // would be served as "done" on the next attempt, permanently stranding the
  // untranslated tail.
  if (sourceUrl && translated.length === cues.length && !abandoned()) {
    setCachedTranslation(sourceUrl, targetLanguage, translated);
  }
  return translated;
}
