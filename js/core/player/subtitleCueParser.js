// Shared subtitle cue parsing for SRT, WebVTT and ASS/SSA sources.
//
// The player renders cues through its own VTT pipeline, but the AI auto-sync
// and translation features need plain timestamped lines they can reason about
// without touching the DOM. This module is intentionally free of browser
// globals so it stays unit testable under `node --test`.

const ENTITY_REPLACEMENTS = [
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#0*39;/gi, "'"],
  [/&apos;/gi, "'"],
  [/&nbsp;/gi, " "],
  // Ampersand last so the replacements above cannot be double-decoded.
  [/&amp;/gi, "&"]
];

const TIMESTAMP_PATTERN = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

/** Seconds (float) for an SRT/VTT/ASS timestamp, or NaN when unparseable. */
export function parseSubtitleTimestampSeconds(value = "") {
  const match = String(value || "")
    .trim()
    .match(TIMESTAMP_PATTERN);
  if (!match) {
    return NaN;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  // ASS uses centiseconds ("0:00:12.34"), SRT/VTT use milliseconds. Padding
  // right handles both: "34" -> 340ms, "340" -> 340ms.
  const milliseconds = Number(
    String(match[4] || "0")
      .padEnd(3, "0")
      .slice(0, 3)
  );
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

/** Whole milliseconds for a timestamp, or NaN when unparseable. */
export function parseSubtitleTimestampMs(value = "") {
  const seconds = parseSubtitleTimestampSeconds(value);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : NaN;
}

export function decodeSubtitleEntities(value = "") {
  const text = String(value || "");
  if (!text.includes("&")) {
    return text;
  }
  return ENTITY_REPLACEMENTS.reduce(
    (output, [pattern, replacement]) => output.replace(pattern, replacement),
    text
  );
}

/**
 * Plain dialogue text for a cue body: ASS override blocks, HTML/VTT tags and
 * entities removed.
 *
 * Line breaks INSIDE a cue are preserved. Subtitlers use them deliberately —
 * most importantly for two-speaker cues ("- Line one\n- Line two") — and
 * flattening them puts both speakers on one run-on line, which is markedly
 * harder to read on a TV. Use {@link flattenCueText} when a single line is
 * genuinely wanted, e.g. when formatting a cue for an LLM prompt.
 */
export function stripSubtitleMarkup(value = "") {
  const withBreaks = String(value || "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ");
  const withoutAssOverrides = withBreaks.replace(/\{[^}]*\}/g, "");
  const withoutTags = withoutAssOverrides.replace(/<[^>]*>/g, "");
  return decodeSubtitleEntities(withoutTags)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Collapses a cue to one line, for prompts and comparisons. */
export function flattenCueText(value = "") {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeRawText(rawText = "") {
  return String(rawText || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function looksLikeAss(text = "", sourceUrl = "") {
  if (/\.(ass|ssa)(\?|#|$)/i.test(String(sourceUrl || ""))) {
    return true;
  }
  return /^\s*\[Script Info\]/im.test(text) || /^\s*Dialogue\s*:/im.test(text);
}

function parseAssCues(text = "") {
  const lines = text.split("\n");
  let startFieldIndex = 1;
  let endFieldIndex = 2;
  let textFieldIndex = 9;

  const formatLine = lines.find((line) => /^\s*Format\s*:/i.test(line) && /\bStart\b/i.test(line));
  if (formatLine) {
    const fields = formatLine
      .replace(/^\s*Format\s*:/i, "")
      .split(",")
      .map((field) => field.trim().toLowerCase());
    const startIndex = fields.indexOf("start");
    const endIndex = fields.indexOf("end");
    const textIndex = fields.indexOf("text");
    if (startIndex >= 0) startFieldIndex = startIndex;
    if (endIndex >= 0) endFieldIndex = endIndex;
    if (textIndex >= 0) textFieldIndex = textIndex;
  }

  const cues = [];
  lines.forEach((line) => {
    if (!/^\s*Dialogue\s*:/i.test(line)) {
      return;
    }
    // Text is the final field and may itself contain commas, so only split the
    // fields that precede it.
    const payload = line.replace(/^\s*Dialogue\s*:/i, "");
    const parts = payload.split(",");
    if (parts.length <= textFieldIndex) {
      return;
    }
    const startMs = parseSubtitleTimestampMs(parts[startFieldIndex]);
    const endMs = parseSubtitleTimestampMs(parts[endFieldIndex]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    const cueText = stripSubtitleMarkup(parts.slice(textFieldIndex).join(","));
    if (!cueText) {
      return;
    }
    cues.push({ startMs, endMs, text: cueText });
  });
  return cues;
}

function parseBlockCues(text = "") {
  const cues = [];
  text.split(/\n{2,}/).forEach((block) => {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      return;
    }
    const timingParts = String(lines[timingIndex] || "").split("-->");
    const startMs = parseSubtitleTimestampMs(timingParts[0]);
    const endMs = parseSubtitleTimestampMs(timingParts[1]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    const cueText = stripSubtitleMarkup(lines.slice(timingIndex + 1).join("\n"));
    if (!cueText) {
      return;
    }
    cues.push({ startMs, endMs, text: cueText });
  });
  return cues;
}

/**
 * Timestamped dialogue cues for a subtitle document.
 *
 * @returns {Array<{startMs:number,endMs:number,text:string}>} sorted by start time.
 */
export function parseSubtitleCues(rawText = "", { sourceUrl = "" } = {}) {
  const normalized = normalizeRawText(rawText);
  if (!normalized.trim()) {
    return [];
  }
  const cues = looksLikeAss(normalized, sourceUrl)
    ? parseAssCues(normalized)
    : parseBlockCues(normalized);
  return cues.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}
