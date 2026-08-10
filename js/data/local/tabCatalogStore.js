// Row preferences for the Series, Películas and Deportes tabs.
//
// Home's preferences live in HomeCatalogStore and are pushed to the account, so
// they are left exactly as they are. Each tab keeps its own order, its own
// hidden rows and its own card shapes here, because a tab is a different view of
// the library and the arrangement that suits a wall of film posters is rarely
// the one that suits live sport.
//
// The exported scope objects deliberately mirror HomeCatalogStore's method
// names. The home screen renders every tab, so it can hold one reference and
// call the same six methods no matter which tab it is showing.

import { createProfileScopedStore } from "./profileScopedStore.js";
import { ROW_LAYOUT_LANDSCAPE, ROW_LAYOUT_POSTER } from "./homeCatalogStore.js";

const KEY = "tabCatalogPrefs";
const ROW_LAYOUTS = [ROW_LAYOUT_POSTER, ROW_LAYOUT_LANDSCAPE];

export const TAB_SCOPE_SERIES = "series";
export const TAB_SCOPE_MOVIES = "movies";
export const TAB_SCOPE_SPORTS = "sports";
export const TAB_SCOPES = [TAB_SCOPE_SERIES, TAB_SCOPE_MOVIES, TAB_SCOPE_SPORTS];

const EMPTY_SCOPE = { order: [], disabled: [], customTitles: {}, rowLayouts: {} };

function unique(array) {
  return Array.from(new Set(array || []));
}

function sameArray(left = [], right = []) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function normalizeStringMap(value = {}, allowed = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value).reduce((accumulator, [key, raw]) => {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(raw || "").trim();
    const permitted = !allowed || allowed.includes(normalizedValue);
    if (normalizedKey && normalizedValue && permitted) {
      accumulator[normalizedKey] = normalizedValue;
    }
    return accumulator;
  }, {});
}

function normalizeScope(value = {}) {
  return {
    order: unique(Array.isArray(value?.order) ? value.order : []).filter(Boolean),
    disabled: unique(Array.isArray(value?.disabled) ? value.disabled : []).filter(Boolean),
    customTitles: normalizeStringMap(value?.customTitles),
    rowLayouts: normalizeStringMap(value?.rowLayouts, ROW_LAYOUTS)
  };
}

function normalizeTabCatalogPrefs(value = {}) {
  return TAB_SCOPES.reduce((accumulator, scope) => {
    accumulator[scope] = normalizeScope(value?.[scope]);
    return accumulator;
  }, {});
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeTabCatalogPrefs
});

function readScope(scope) {
  return store.get()?.[scope] || { ...EMPTY_SCOPE };
}

function writeScope(scope, partial) {
  const all = store.get();
  const next = normalizeScope({ ...(all?.[scope] || {}), ...(partial || {}) });
  store.replaceForProfile(null, { ...all, [scope]: next }, { silentSync: true });
}

/**
 * The preference object for one tab.
 *
 * Shares HomeCatalogStore's method names on purpose — see the note at the top of
 * this file.
 */
function createScopeApi(scope) {
  return {
    scope,

    get() {
      return readScope(scope);
    },

    set(partial) {
      writeScope(scope, partial);
    },

    setOrder(order) {
      writeScope(scope, { order: unique(order || []) });
    },

    isDisabled(key) {
      return readScope(scope).disabled.includes(key);
    },

    toggleDisabled(key) {
      const current = readScope(scope);
      const disabled = current.disabled.includes(key)
        ? current.disabled.filter((entry) => entry !== key)
        : [...current.disabled, key];
      writeScope(scope, { disabled });
    },

    setCustomTitles(customTitles) {
      writeScope(scope, { customTitles: normalizeStringMap(customTitles) });
    },

    /** The shape chosen for a row, or "" when it follows the global setting. */
    getRowLayout(rowKey = "") {
      const key = String(rowKey || "").trim();
      return key ? String(readScope(scope).rowLayouts?.[key] || "") : "";
    },

    /** Sets a row's shape; an empty layout hands the row back to the default. */
    setRowLayout(rowKey = "", layout = "") {
      const key = String(rowKey || "").trim();
      if (!key) {
        return;
      }
      const rowLayouts = { ...(readScope(scope).rowLayouts || {}) };
      if (ROW_LAYOUTS.includes(layout)) {
        rowLayouts[key] = layout;
      } else {
        delete rowLayouts[key];
      }
      writeScope(scope, { rowLayouts });
    },

    /**
     * Adds any unknown keys to this tab's row order.
     *
     * Appends, so a newly installed addon's catalogues land at the end rather
     * than disturbing an arrangement the viewer has already settled on.
     */
    ensureOrderKeys(keys) {
      const current = readScope(scope);
      const saved = unique(current.order).filter(Boolean);
      const savedSet = new Set(saved);
      const missing = unique(keys || []).filter((key) => key && !savedSet.has(key));
      const next = [...saved, ...missing];
      if (!sameArray(current.order, next)) {
        writeScope(scope, { order: next });
      }
      return next;
    },

    reset() {
      writeScope(scope, { ...EMPTY_SCOPE });
    }
  };
}

const SCOPE_APIS = TAB_SCOPES.reduce((accumulator, scope) => {
  accumulator[scope] = createScopeApi(scope);
  return accumulator;
}, {});

/** The preference object for a tab, or null for anything that is not a tab. */
export function getTabCatalogStore(scope = "") {
  return SCOPE_APIS[String(scope || "").trim()] || null;
}
