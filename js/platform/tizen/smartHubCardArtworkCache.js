// Remembers which posters have already been composited.
//
// Ingesting a poster costs two network round trips, and the preview rebuilds
// whenever Continue Watching changes — without a cache the same handful of
// posters would be re-ingested on every refresh, for no benefit and against the
// CDN quota. The mapping is stable forever: a poster URL always produces the
// same stored image.
//
// Not profile-scoped, because a poster is a poster whoever is watching.

import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "smartHubCardArtwork";
// Comfortably more than the preview can show (40 tiles) while several profiles
// rotate through it, and small enough to stay well inside the storage quota.
export const MAX_CACHED_ARTWORK = 240;

function read() {
  const stored = LocalStore.get(KEY, null);
  return stored && typeof stored === "object" && stored.byUrl && typeof stored.byUrl === "object"
    ? stored
    : { byUrl: {} };
}

/** The composited artwork uuid for a poster URL, or "" when not ingested yet. */
export function getCachedArtworkUuid(sourceUrl = "") {
  const url = String(sourceUrl || "").trim();
  return url ? String(read().byUrl[url] || "") : "";
}

export function setCachedArtworkUuid(sourceUrl = "", uuid = "") {
  const url = String(sourceUrl || "").trim();
  const value = String(uuid || "").trim();
  if (!url || !value) {
    return;
  }
  const store = read();
  // Re-inserting moves the entry to the end, so eviction drops what has gone
  // longest without being needed rather than what was ingested first.
  delete store.byUrl[url];
  store.byUrl[url] = value;

  const urls = Object.keys(store.byUrl);
  if (urls.length > MAX_CACHED_ARTWORK) {
    urls.slice(0, urls.length - MAX_CACHED_ARTWORK).forEach((key) => delete store.byUrl[key]);
  }
  LocalStore.set(KEY, store);
}

export function clearCachedArtwork() {
  LocalStore.remove(KEY);
}
