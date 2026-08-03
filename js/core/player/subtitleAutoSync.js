// AI subtitle auto-sync.
//
// Ported from NuvioTV PR #2817 (PlayerRuntimeControllerSubtitleTiming.kt).
// The idea: the embedded/built-in subtitle track is correctly timed but is
// usually the wrong language. The addon subtitle file is the right language but
// often drifts. So we capture a few built-in lines, ask an LLM which addon lines
// mean the same thing, and derive the delay from the timestamp difference.
//
// Delay semantics (matching the player): a cue whose file time is T is shown at
// video time T + delay. So to display addon cue T at the true moment S when the
// built-in line was spoken, delay = S - T.

import { flattenCueText, parseSubtitleCues } from "./subtitleCueParser.js";
import { requestSubtitleAiJson } from "./subtitleAiClient.js";

export const AUTO_SYNC_SOURCE_LINE_COUNT = 5;
export const AUTO_SYNC_MAX_ATTEMPTS = 3;
export const AUTO_SYNC_TARGET_POOLED_OFFSETS = 3;
export const AUTO_SYNC_CUE_GATHER_TIMEOUT_MS = 600000;
export const AUTO_SYNC_RETRY_CUE_GATHER_TIMEOUT_MS = 30000;
export const AUTO_SYNC_ADDON_WINDOW_RADIUS = 12;
// Human reaction time, subtracted when the user syncs by pressing a key on a
// line they just heard (the non-AI fallback path).
export const AUTO_SYNC_REACTION_COMPENSATION_MS = 300;

const MUSIC_NOTE_CHARS = ["♪", "♫", "♬", "♩"];
const NON_DIALOGUE_BRACKET_KEYWORDS = [
  "music",
  "song",
  "theme",
  "instrumental",
  "singing",
  "humming"
];

/**
 * True for cues that carry no dialogue an LLM could semantically match
 * (music stings, "[SINGING]", "♪ la la ♪").
 */
export function isNonDialogueCue(text = "") {
  const value = String(text || "").trim();
  if (!value) {
    return true;
  }
  if (MUSIC_NOTE_CHARS.some((note) => value.includes(note))) {
    return true;
  }
  const bracketed =
    (value.startsWith("[") && value.endsWith("]")) ||
    (value.startsWith("(") && value.endsWith(")"));
  if (!bracketed) {
    return false;
  }
  const inner = value.slice(1, -1).toLowerCase();
  return NON_DIALOGUE_BRACKET_KEYWORDS.some((keyword) => inner.includes(keyword));
}

/** Median of a numeric list, rounded to a whole millisecond. Returns 0 when empty. */
export function median(values = []) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!sorted.length) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? Math.round(sorted[middle])
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * The slice of addon cues surrounding the current playback moment. Keeping the
 * candidate list small keeps the prompt cheap and stops the model matching a
 * coincidentally similar line an hour away.
 */
export function selectAddonWindow(
  cues = [],
  approxTrueTimeMs = 0,
  radius = AUTO_SYNC_ADDON_WINDOW_RADIUS
) {
  if (!cues.length) {
    return { cues: [], startIndex: 0, endIndex: -1 };
  }
  let nearestIndex = 0;
  let nearestDistance = Infinity;
  cues.forEach((cue, index) => {
    const distance = Math.abs(Number(cue.startMs) - Number(approxTrueTimeMs));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  const startIndex = Math.max(nearestIndex - radius, 0);
  const endIndex = Math.min(nearestIndex + radius, cues.length - 1);
  return { cues: cues.slice(startIndex, endIndex + 1), startIndex, endIndex };
}

function formatIndexedLines(cues = []) {
  // One prompt line per cue: cue text can now contain real line breaks, and an
  // embedded newline would corrupt the [index] listing the model reads.
  return cues
    .map((cue, index) => `[${index}] ${JSON.stringify(flattenCueText(cue.text))}`)
    .join("\n");
}

export function buildAutoSyncPrompt(sourceCues = [], targetCues = []) {
  const sourceLines = formatIndexedLines(sourceCues);
  const targetLines = formatIndexedLines(targetCues);
  return `System:
You are a subtitle synchronization algorithm. Your job is to find semantic matches between source subtitle lines and a target subtitle list.
You must ignore translator credits, sync warnings, or empty lines.
Prefer lines with distinctive, specific wording (names, numbers, uncommon phrases) over short generic lines like "Yes." or "What?", since generic lines are ambiguous to match.
Start with your single most confident source/target match. Then check the OTHER source lines too: for each one you can ALSO confidently match to a specific target line, include it as a separate pair. Only include pairs you genuinely believe are correct — it's fine to return just 1 pair, or up to all ${AUTO_SYNC_SOURCE_LINE_COUNT}, whatever you can actually verify. Do not guess extra pairs just to fill them in.
Note that source and target subtitles are not always split 1-to-1 (one source line can correspond to two target lines or vice versa), so do not assume matches follow any fixed pattern (e.g. do not just add a constant offset to indices) — match each line independently based on its own meaning.
Output ONLY a valid JSON object with a single key "pairs": an array of objects, each with integer keys "source_index" and "target_index".
Do not output markdown, explanations, or any other text.

User:
<source_lines> are consecutive subtitle lines from the built-in track, in chronological order.
<target_lines> are subtitle lines from the addon file, also in chronological order.
Find as many confident source/target matches as you can, starting with your best one.

<source_lines>
${sourceLines}
</source_lines>

<target_lines>
${targetLines}
</target_lines>

Expected JSON output format:
{"pairs": [{"source_index": <integer>, "target_index": <integer>}, ...]}`;
}

/**
 * Per-pair delay offsets for the model's answer, discarding out-of-range indices
 * so a hallucinated index cannot poison the median.
 */
export function computeOffsetsFromPairs({ pairs = [], sourceCues = [], targetCues = [] } = {}) {
  if (!Array.isArray(pairs)) {
    return [];
  }
  const matches = [];
  pairs.forEach((pair) => {
    const sourceIndex = Number(pair?.source_index);
    const targetIndex = Number(pair?.target_index);
    if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex)) {
      return;
    }
    if (sourceIndex < 0 || sourceIndex >= sourceCues.length) {
      return;
    }
    if (targetIndex < 0 || targetIndex >= targetCues.length) {
      return;
    }
    matches.push({
      sourceIndex,
      targetIndex,
      offsetMs: Math.round(
        Number(sourceCues[sourceIndex].startMs) - Number(targetCues[targetIndex].startMs)
      ),
      sourceLine: sourceCues[sourceIndex].text,
      targetLine: targetCues[targetIndex].text
    });
  });
  return matches;
}

function clampDelay(valueMs, minMs, maxMs) {
  return Math.max(minMs, Math.min(maxMs, Math.round(valueMs)));
}

/**
 * Runs the full auto-sync routine.
 *
 * Dependencies are injected so the orchestration is testable without a player.
 *
 * @param {object} options
 * @param {string} options.subtitleUrl            addon subtitle to align
 * @param {function} options.gatherSourceCues     async ({minCount, timeoutMs}) =>
 *   [{startMs, text}] in TRUE video time (caller must back out any applied delay)
 * @param {function} options.downloadSubtitleText async (url) => string
 * @param {string} options.provider               "gemini" | "groq"
 * @param {string} options.apiKey
 * @param {number} options.minDelayMs
 * @param {number} options.maxDelayMs
 * @param {function} [options.onStatus]           progress messages for the UI
 * @param {function} [options.requestJson]        override for tests
 * @returns {Promise<{delayMs:number, offsetsMs:number[], attemptsUsed:number, matches:object[]}>}
 */
export async function runSubtitleAutoSync({
  subtitleUrl,
  gatherSourceCues,
  downloadSubtitleText,
  provider,
  apiKey,
  model = "",
  minDelayMs = -60000,
  maxDelayMs = 60000,
  maxAttempts = AUTO_SYNC_MAX_ATTEMPTS,
  onStatus = () => {},
  requestJson = requestSubtitleAiJson
} = {}) {
  if (typeof gatherSourceCues !== "function" || typeof downloadSubtitleText !== "function") {
    throw new Error("Subtitle auto-sync is missing its player hooks.");
  }

  const pooledOffsets = [];
  const allMatches = [];
  let attemptsUsed = 0;
  let addonCuesCache = null;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsUsed = attempt;
    const gatherTimeoutMs =
      attempt === 1 ? AUTO_SYNC_CUE_GATHER_TIMEOUT_MS : AUTO_SYNC_RETRY_CUE_GATHER_TIMEOUT_MS;

    onStatus(
      attempt === 1
        ? { stage: "gathering", attempt, maxAttempts }
        : { stage: "refining", attempt, maxAttempts }
    );

    let sourceCues = [];
    try {
      sourceCues = await gatherSourceCues({
        minCount: AUTO_SYNC_SOURCE_LINE_COUNT,
        timeoutMs: gatherTimeoutMs
      });
    } catch (error) {
      lastError = error;
      break;
    }

    const usableSourceCues = (sourceCues || [])
      .filter((cue) => cue && Number.isFinite(Number(cue.startMs)))
      .filter((cue) => !isNonDialogueCue(cue.text))
      .slice(-AUTO_SYNC_SOURCE_LINE_COUNT);

    if (!usableSourceCues.length) {
      lastError = new Error(
        "No built-in subtitle lines were captured. This stream may have no embedded subtitle track."
      );
      break;
    }

    if (!addonCuesCache) {
      onStatus({ stage: "downloading", attempt, maxAttempts });
      const body = await downloadSubtitleText(subtitleUrl);
      addonCuesCache = parseSubtitleCues(body, { sourceUrl: subtitleUrl });
      if (!addonCuesCache.length) {
        throw new Error("No subtitle lines were found in this file.");
      }
    }

    // The most recent built-in line approximates "now" in true video time.
    const approxTrueTimeMs = Number(usableSourceCues[usableSourceCues.length - 1].startMs);
    const window = selectAddonWindow(addonCuesCache, approxTrueTimeMs);
    if (!window.cues.length) {
      lastError = new Error("No addon subtitle lines were found near the current position.");
      continue;
    }

    onStatus({ stage: "matching", attempt, maxAttempts });

    // Not wrapped in a retry: a bad key or a hard provider failure will not fix
    // itself on the next attempt, and the caller reports it verbatim.
    const response = await requestJson({
      provider,
      apiKey,
      model,
      prompt: buildAutoSyncPrompt(usableSourceCues, window.cues)
    });

    const matches = computeOffsetsFromPairs({
      pairs: response?.json?.pairs,
      sourceCues: usableSourceCues,
      targetCues: window.cues
    });

    if (!matches.length) {
      lastError = new Error("The AI returned no usable subtitle line matches.");
      continue;
    }

    allMatches.push(...matches);
    pooledOffsets.push(...matches.map((match) => match.offsetMs));

    if (pooledOffsets.length >= AUTO_SYNC_TARGET_POOLED_OFFSETS) {
      break;
    }
  }

  if (!pooledOffsets.length) {
    throw lastError || new Error("Subtitle auto-sync could not determine a delay.");
  }

  return {
    delayMs: clampDelay(median(pooledOffsets), minDelayMs, maxDelayMs),
    offsetsMs: pooledOffsets,
    attemptsUsed,
    matches: allMatches
  };
}

/**
 * Non-AI fallback: the user presses Sync on a line they just heard, so the
 * delay is the gap between that moment and the addon cue nearest to it.
 */
export function computeJumpFallbackDelayMs({
  addonCues = [],
  pressedAtMs = 0,
  currentDelayMs = 0,
  minDelayMs = -60000,
  maxDelayMs = 60000,
  reactionCompensationMs = AUTO_SYNC_REACTION_COMPENSATION_MS
} = {}) {
  if (!addonCues.length) {
    return null;
  }
  const trueMomentMs = Number(pressedAtMs) - reactionCompensationMs;
  // The cue the user is reacting to is the one currently displayed, i.e. the
  // latest cue whose shifted start time has already passed.
  let candidate = null;
  addonCues.forEach((cue) => {
    if (Number(cue.startMs) + Number(currentDelayMs) <= trueMomentMs) {
      candidate = cue;
    }
  });
  if (!candidate) {
    candidate = addonCues[0];
  }
  return clampDelay(trueMomentMs - Number(candidate.startMs), minDelayMs, maxDelayMs);
}
