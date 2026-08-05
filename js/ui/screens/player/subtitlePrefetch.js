// Preparing the next episode's Spanish subtitles while this one plays.
//
// Generating a full track takes minutes, and the viewer spends those minutes
// staring at a held frame. But when someone is halfway through episode two,
// episode three is entirely predictable — so it can be translated in the
// background and be waiting, complete and cached, before they ever ask for it.
//
// The work reuses the same translator and the same cache the on-demand path
// uses, keyed by subtitle URL, so a prefetched episode simply starts instantly
// instead of showing the progress overlay at all.
//
// Deliberately conservative about when it runs. It is a nicety funded by a
// shared daily quota, so it starts only once the current episode is well
// underway, never runs twice for the same episode, and abandons everything the
// moment the viewer moves on.

// Far enough in that the viewer has clearly settled on this episode, and early
// enough that a long translation still finishes before the credits.
export const PREFETCH_START_FRACTION = 0.25;
export const PREFETCH_MIN_ELAPSED_MS = 4 * 60 * 1000;

// Subtitle providers mix two-letter and three-letter codes freely, and an
// English track labelled "eng" must still be recognised as English.
const THREE_LETTER_CODES = {
  eng: "en",
  spa: "es",
  esp: "es",
  por: "pt",
  fre: "fr",
  fra: "fr",
  ger: "de",
  deu: "de",
  ita: "it"
};

/** Two-letter root for a subtitle language tag, or "". */
export function languageRoot(value) {
  const code = String(value || "")
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return THREE_LETTER_CODES[code] || code;
}

/**
 * Whether the next episode's subtitles are worth preparing now.
 *
 * @param {object} state
 * @param {number} state.positionSeconds current playback position
 * @param {number} state.durationSeconds total length, 0 when unknown
 * @param {boolean} state.hasNextEpisode
 * @param {boolean} state.alreadyStarted
 * @param {boolean} state.generationRunning a foreground generation owns the quota
 */
export function shouldPrefetchNextSubtitles({
  positionSeconds = 0,
  durationSeconds = 0,
  hasNextEpisode = false,
  alreadyStarted = false,
  generationRunning = false
} = {}) {
  if (!hasNextEpisode || alreadyStarted || generationRunning) {
    return false;
  }
  const position = Number(positionSeconds) || 0;
  if (position <= 0) {
    return false;
  }
  const duration = Number(durationSeconds) || 0;
  if (duration > 0) {
    return position / duration >= PREFETCH_START_FRACTION;
  }
  // Live or unknown-length content has no fraction to reach, so fall back to
  // elapsed time rather than never starting.
  return position * 1000 >= PREFETCH_MIN_ELAPSED_MS;
}

/**
 * Picks the subtitle to translate from, for an episode that is not playing.
 *
 * Mirrors the foreground rule — English first, else whatever exists — but works
 * from a plain list rather than the player's state, since the next episode has
 * no player state yet.
 */
export function pickPrefetchSource(subtitles = [], targetLanguage = "es") {
  const usable = (Array.isArray(subtitles) ? subtitles : []).filter(
    (entry) => entry?.url && !entry.aiTranslated
  );
  if (!usable.length) {
    return null;
  }
  const wanted = languageRoot(targetLanguage);
  // A track already in the target language means there is nothing to prepare.
  if (usable.some((entry) => languageRoot(entry.lang) === wanted)) {
    return null;
  }
  return usable.find((entry) => languageRoot(entry.lang) === "en") || usable[0];
}
