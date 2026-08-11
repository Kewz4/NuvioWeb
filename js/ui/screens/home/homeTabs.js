// What each top-bar tab shows.
//
// The tabs are the home screen with a filter applied, not new screens. That is
// deliberate: one screen object means the TV holds one set of row nodes, one
// navigation model and one scroll controller however many tabs exist, and every
// improvement to the home rows lands on all of them at once.
//
// The type names are the ones the installed addons actually declare, not a
// guess: movie and series from the metadata addons, sport from the sports addon,
// and the anime.* variants that some addons use for the same two kinds of thing.

import { I18n } from "../../../i18n/index.js";

// I18n.t reads options.fallback, so a bare third argument is ignored.
function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

const COLLECTION_TYPE = "collection";

const TABS = {
  series: {
    route: "series",
    prefsScope: "series",
    titleKey: "tab.seriesTitle",
    titleFallback: "Series",
    // An anime series is a series. Addons that split it out would otherwise
    // drop those rows from the only tab where someone would look for them.
    types: ["series", "anime.series"]
  },
  movies: {
    route: "movies",
    prefsScope: "movies",
    titleKey: "tab.moviesTitle",
    titleFallback: "Películas",
    types: ["movie", "anime.movie"]
  },
  sports: {
    route: "sports",
    prefsScope: "sports",
    titleKey: "tab.sportsTitle",
    titleFallback: "Deportes",
    // "events" is what one of the installed addons calls its fixtures; a match
    // is a match whichever word the manifest chose.
    types: ["sport", "sports", "events", "event"]
  }
};

/** The tab a route describes, or null for Home and everything else. */
export function getHomeTab(route = "") {
  return TABS[String(route || "").trim()] || null;
}

export function isHomeTabRoute(route = "") {
  return Boolean(getHomeTab(route));
}

export function homeTabTitle(route = "") {
  const tab = getHomeTab(route);
  return tab ? t(tab.titleKey, {}, tab.titleFallback) : "";
}

/**
 * Whether a catalog of this type belongs on this tab.
 *
 * Matching is case-insensitive and ignores an addon's own prefix, so
 * "Anime.Series" and "series" both land on Series.
 */
export function tabAcceptsType(route = "", type = "") {
  const tab = getHomeTab(route);
  if (!tab) {
    // Home takes everything. It is the one page that is not a filter.
    return true;
  }
  const normalized = String(type || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }
  // A collection is whatever its owner put in it, so no type test can place it.
  // Tabs offer them and let the viewer decide — hidden by default so a tab does
  // not fill with folders nobody asked to see there.
  if (isCollectionEntry({ type: normalized })) {
    return true;
  }
  return tab.types.some((accepted) => accepted.toLowerCase() === normalized);
}

/**
 * Whether a row or catalog entry is a collection.
 *
 * Checked on rowKind first: a built collection row carries rowKind
 * "collection" but a type of "collection_folder", so matching the type alone
 * missed every one of them and the tabs filled with folders.
 */
function isCollectionEntry(entry = {}) {
  if (String(entry?.rowKind || "").toLowerCase() === COLLECTION_TYPE) {
    return true;
  }
  return String(entry?.type || "")
    .toLowerCase()
    .startsWith(COLLECTION_TYPE);
}

/** Collections start hidden on a tab; the viewer turns on the ones they want. */
export function defaultHiddenTabKeys(route = "", entries = []) {
  if (!isHomeTabRoute(route)) {
    return [];
  }
  return (Array.isArray(entries) ? entries : [])
    .filter(isCollectionEntry)
    .map((entry) => String(entry?.homeCatalogKey || entry?.homeCatalogDisableKey || "").trim())
    .filter(Boolean);
}

/**
 * Keeps only the catalogs or rows a tab should show.
 *
 * Always returns a new array, including on Home where nothing is removed.
 * Handing the caller's own array back made the pass-through case share identity
 * with its input, and a caller that emptied one to refill it emptied both.
 */
export function filterByTabType(route = "", entries = []) {
  const list = Array.isArray(entries) ? entries : [];
  if (!isHomeTabRoute(route)) {
    return list.slice();
  }
  return list.filter((entry) => tabAcceptsType(route, entry?.type));
}

/**
 * Whether this route shows the hero and Continue Watching.
 *
 * Home only. A tab is a shelf of one kind of thing, and putting a half-watched
 * film at the top of Deportes — or spending the extra requests a hero costs on
 * every tab switch — would work against both the point and the speed of it.
 */
export function showsHomeChrome(route = "") {
  return !isHomeTabRoute(route);
}
