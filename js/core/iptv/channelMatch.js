// Matching a playlist channel to a guide channel.
//
// Public IPTV playlists and public XMLTV guides are produced by different
// projects and almost never share an id scheme. iptv-org writes "ADN40.mx",
// open-epg writes "adn40.mx", epgshare01 writes "Canal.ADN.40.mx". Exact-id
// matching therefore yields close to nothing, and the guide row stays empty on
// channels that plainly have a guide.
//
// So matching is done on normalized *name* keys, with the tvg-id treated as
// another name candidate. Two keys are produced per value:
//
//   full — accents, annotations and punctuation removed ("Canal 5" -> canal5)
//   core — the same, minus the filler words catalogues disagree about
//          ("Canal 5 HD" -> 5, "Azteca Uno (1080p)" -> aztecauno)
//
// `full` is tried first because it is the stricter of the two; `core` catches
// the common case where one side spells out "Canal"/"TV"/"HD" and the other
// does not. A `core` key shorter than three characters is dropped: "Canal 5"
// collapsing to "5" would collide with every other channel numbered five.

const FILLER_WORDS =
  /\b(canal|canale|channel|tv|television|televisao|el|la|los|las|de|del|the|hd|fhd|uhd|sd|4k|1080p?|720p?|480p?)\b/g;

// "(1080p)", "[Not 24/7]", "(Backup)" and similar annotations.
const ANNOTATIONS = /\([^)]*\)|\[[^\]]*\]/g;

const MIN_CORE_KEY_LENGTH = 3;

function stripDecoration(value = "") {
  return (
    String(value || "")
      .toLowerCase()
      .normalize("NFD")
      // Combining marks, so "canción" and "cancion" agree.
      .replace(/[̀-ͯ]/g, "")
      .replace(ANNOTATIONS, " ")
      // "A+" and "APlus" are the same channel in two catalogues.
      .replace(/\+/g, "plus")
      .replace(/[._&/\\-]/g, " ")
  );
}

function condense(value = "") {
  return String(value || "").replace(/[^a-z0-9]/g, "");
}

/**
 * The `full` and `core` comparison keys for a name or id.
 * @returns {string[]} 0-2 keys, strictest first, never empty strings.
 */
export function channelKeyVariants(value = "") {
  const decorated = stripDecoration(value);
  const full = condense(decorated);
  const core = condense(decorated.replace(FILLER_WORDS, " "));
  const keys = [];
  if (full) {
    keys.push(full);
  }
  if (core && core.length >= MIN_CORE_KEY_LENGTH && core !== full) {
    keys.push(core);
  }
  return keys;
}

/** Single comparison key for a value, or "" — the strictest variant. */
export function normalizeChannelKey(value = "") {
  return channelKeyVariants(value)[0] || "";
}

/**
 * Candidate keys for a playlist channel, best first.
 *
 * The tvg-id may carry a feed suffix ("ADN40.mx@SD") and a country suffix
 * (".mx"); both are stripped so the id compares as a name.
 */
export function channelMatchKeys(channel = {}) {
  const keys = [];
  const push = (value) => {
    channelKeyVariants(value).forEach((key) => {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    });
  };

  const tvgId = String(channel.tvgId || "").trim();
  if (tvgId) {
    const withoutFeed = tvgId.split("@")[0];
    push(withoutFeed.replace(/\.[a-z]{2}$/i, ""));
    push(withoutFeed);
  }
  push(channel.name);
  return keys;
}

/**
 * Index of guide channels keyed for lookup.
 *
 * @param {Map<string, {names: string[]}>} guideChannels id -> declaration
 * @param {Set<string>} [idsWithProgrammes] when given, entries with no
 *   programmes are skipped so they cannot shadow a channel that has a schedule.
 * @returns {Map<string, string>} match key -> guide channel id
 */
export function buildGuideKeyIndex(guideChannels = new Map(), idsWithProgrammes = null) {
  const index = new Map();
  guideChannels.forEach((entry, id) => {
    if (idsWithProgrammes && !idsWithProgrammes.has(id)) {
      return;
    }
    const candidates = [id, id.replace(/\.[a-z]{2}$/i, ""), ...(entry?.names || [])];
    candidates.forEach((candidate) => {
      channelKeyVariants(candidate).forEach((key) => {
        // First writer wins: guides load most-relevant-region first, so an
        // earlier feed's entry is the better answer for an ambiguous name.
        if (!index.has(key)) {
          index.set(key, id);
        }
      });
    });
  });
  return index;
}

/**
 * The guide channel id for a playlist channel, or "" when there is no match.
 *
 * @param {object} channel
 * @param {Map<string,string>} keyIndex normalized key -> guide id
 * @param {Set<string>} [exactIds] guide ids that carry programmes. An exact
 *   tvg-id hit is authoritative, so it is tried before any normalized guess.
 */
export function resolveGuideChannelId(channel = {}, keyIndex = new Map(), exactIds = null) {
  const tvgId = String(channel.tvgId || "").trim();
  if (tvgId && exactIds) {
    if (exactIds.has(tvgId)) {
      return tvgId;
    }
    const withoutFeed = tvgId.split("@")[0];
    if (withoutFeed && exactIds.has(withoutFeed)) {
      return withoutFeed;
    }
  }
  for (const key of channelMatchKeys(channel)) {
    const hit = keyIndex.get(key);
    if (hit) {
      return hit;
    }
  }
  return "";
}
