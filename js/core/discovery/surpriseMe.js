// Choosing something to watch, on one press.
//
// The problem this solves is not "not enough content" — it is the fifteen
// minutes two people spend scrolling and then watching nothing. So this does not
// produce a shortlist to choose from: it produces one title, and the caller
// plays it. Offering three would recreate the deciding.
//
// The pick is weighted rather than uniform. A random title from a catalogue of
// thousands is usually something nobody wants; a half-finished series is almost
// always a better answer than a film nobody has heard of. Weights encode that,
// and the recent-picks memory stops the same answer twice in a row, which is
// what makes a random button feel broken.

export const SOURCE_CONTINUE = "continue";
export const SOURCE_LIBRARY = "library";
export const SOURCE_CATALOG = "catalog";

// Ratios, not magic numbers: an unfinished episode is roughly six times likelier
// to be wanted than an untouched catalogue title, and something the household
// deliberately saved sits between the two.
export const SOURCE_WEIGHTS = Object.freeze({
  [SOURCE_CONTINUE]: 6,
  [SOURCE_LIBRARY]: 3,
  [SOURCE_CATALOG]: 1
});

// Enough that a run of presses does not repeat, small enough that the pool of a
// modest library is not exhausted into "nothing to suggest".
export const RECENT_MEMORY = 12;

function normalizeCandidate(entry = {}, source = SOURCE_CATALOG) {
  const id = String(entry?.id || entry?.contentId || "").trim();
  if (!id) {
    return null;
  }
  return {
    id,
    source,
    type: String(entry?.type || entry?.contentType || "movie"),
    name: String(entry?.name || entry?.title || "").trim(),
    poster: entry?.poster || entry?.posterUrl || "",
    background: entry?.background || entry?.backdrop || "",
    videoId: entry?.videoId || null,
    season: entry?.season ?? null,
    episode: entry?.episode ?? null,
    // Carried through so the caller can resume rather than restart.
    positionMs: Number(entry?.positionMs || 0) || 0,
    durationMs: Number(entry?.durationMs || 0) || 0
  };
}

/**
 * Builds the weighted pool from everything already on the device.
 *
 * Deliberately offline: a button that has to wait on the network is a button
 * nobody presses twice.
 */
export function buildSurprisePool({ continueWatching = [], library = [], catalog = [] } = {}) {
  const seen = new Set();
  const pool = [];
  const add = (entries, source) => {
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const candidate = normalizeCandidate(entry, source);
      // First source wins: something both saved and half-watched is a
      // continue-watching item, and should carry that weight rather than
      // appearing twice at two different ones.
      if (candidate && !seen.has(candidate.id)) {
        seen.add(candidate.id);
        pool.push(candidate);
      }
    });
  };
  add(continueWatching, SOURCE_CONTINUE);
  add(library, SOURCE_LIBRARY);
  add(catalog, SOURCE_CATALOG);
  return pool;
}

/**
 * Picks one title.
 *
 * @param {Array<object>} pool from {@link buildSurprisePool}
 * @param {object} [options]
 * @param {string[]} [options.recentIds] most recent first; avoided if possible
 * @param {function} [options.random] injectable for tests
 * @returns {object|null} the chosen candidate, or null when there is nothing
 */
export function pickSurprise(pool = [], { recentIds = [], random = Math.random } = {}) {
  const entries = Array.isArray(pool) ? pool.filter(Boolean) : [];
  if (!entries.length) {
    return null;
  }
  const recent = new Set((recentIds || []).slice(0, RECENT_MEMORY));
  // Avoid repeats — unless avoiding them would leave nothing, in which case a
  // repeat beats refusing to answer.
  const fresh = entries.filter((entry) => !recent.has(entry.id));
  const usable = fresh.length ? fresh : entries;

  const weightOf = (entry) => SOURCE_WEIGHTS[entry.source] || SOURCE_WEIGHTS[SOURCE_CATALOG];
  const total = usable.reduce((sum, entry) => sum + weightOf(entry), 0);
  const roll = Number(random());
  const clamped = Number.isFinite(roll) ? Math.max(0, Math.min(1, roll)) : 0;
  let ticket = clamped * total;
  for (const entry of usable) {
    ticket -= weightOf(entry);
    if (ticket <= 0) {
      return entry;
    }
  }
  // Floating point can leave a sliver; the last entry is the correct answer.
  return usable[usable.length - 1];
}

/** The recent-picks list after choosing `id`, newest first and bounded. */
export function rememberSurprise(recentIds = [], id = "") {
  const chosen = String(id || "").trim();
  const existing = Array.isArray(recentIds) ? recentIds : [];
  if (!chosen) {
    return existing.slice(0, RECENT_MEMORY);
  }
  return [chosen, ...existing.filter((entry) => entry !== chosen)].slice(0, RECENT_MEMORY);
}
