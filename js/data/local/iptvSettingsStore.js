import { createProfileScopedStore } from "./profileScopedStore.js";
import { defaultIptvPlaylists } from "../../core/iptv/defaultPlaylists.js";

const KEY = "iptvSettings";

// Enough room for the shipped regional sources plus a provider of the user's
// own. The render window and per-playlist caching keep the cost bounded.
export const MAX_IPTV_PLAYLISTS = 8;

// Bump to re-seed shipped sources onto every profile (e.g. when a source
// dies and is replaced). Existing user-added playlists are kept.
export const DEFAULTS_SEED_VERSION = 1;

export const IPTV_SETTINGS_DEFAULTS = {
  playlists: [],
  favoriteChannelIds: [],
  hiddenGroups: [],
  groupOrder: [],
  defaultsSeededVersion: 0,
  lastChannelId: "",
  userAgent: "",
  // Two-letter country of the household. Region-locked channels from anywhere
  // else are hidden, since they look identical to broken ones from the sofa.
  // Empty disables the filter.
  homeCountry: "SV",
  // Default to 1080p and above: this build targets a 4K set and lower-quality
  // public feeds look poor on it.
  minQuality: "FHD"
};

const MIN_QUALITY_VALUES = ["ANY", "HD", "FHD", "UHD"];

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  value.forEach((entry) => {
    const normalized = String(entry || "").trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  });
  return output;
}

function normalizePlaylist(value, index) {
  const source = value && typeof value === "object" ? value : {};
  const url = String(source.url ?? source.m3uUrl ?? "").trim();
  if (!url) {
    return null;
  }
  return {
    id: String(source.id || "").trim() || `playlist-${index + 1}`,
    name: String(source.name || "").trim() || `Playlist ${index + 1}`,
    url,
    // Optional XMLTV guide URL for non-Xtream playlists.
    epgUrl: String(source.epgUrl ?? source.epg_url ?? "").trim(),
    enabled: source.enabled !== false
  };
}

function normalizeIptvSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  // Seed the shipped sources exactly once per profile, tracked by a version
  // marker rather than by "is the playlist array empty".
  //
  // Emptiness is not a safe signal: any profile that opened Live TV before
  // these defaults existed already has `playlists: []` persisted, and would be
  // stuck on an empty tab forever. The marker also means a user who
  // deliberately deletes every playlist keeps it that way, because their
  // profile has already been seeded.
  const alreadySeeded = Number(source.defaultsSeededVersion || 0) >= DEFAULTS_SEED_VERSION;
  const existing = Array.isArray(source.playlists) ? source.playlists : [];
  const rawPlaylists = alreadySeeded ? existing : [...existing, ...defaultIptvPlaylists()];
  const playlists = rawPlaylists
    .map(normalizePlaylist)
    .filter(Boolean)
    .slice(0, MAX_IPTV_PLAYLISTS);

  return {
    ...IPTV_SETTINGS_DEFAULTS,
    playlists,
    favoriteChannelIds: normalizeStringList(source.favoriteChannelIds),
    hiddenGroups: normalizeStringList(source.hiddenGroups),
    groupOrder: normalizeStringList(source.groupOrder),
    defaultsSeededVersion: DEFAULTS_SEED_VERSION,
    lastChannelId: String(source.lastChannelId || "").trim(),
    userAgent: String(source.userAgent || "").trim(),
    homeCountry: String(source.homeCountry ?? IPTV_SETTINGS_DEFAULTS.homeCountry ?? "")
      .trim()
      .toUpperCase()
      .slice(0, 2),
    minQuality: MIN_QUALITY_VALUES.includes(String(source.minQuality || "").toUpperCase())
      ? String(source.minQuality).toUpperCase()
      : IPTV_SETTINGS_DEFAULTS.minQuality
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeIptvSettings
});

function toggleInList(list, value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return list;
  }
  return list.includes(normalized)
    ? list.filter((entry) => entry !== normalized)
    : [...list, normalized];
}

export const IptvSettingsStore = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  },

  addPlaylist(playlist, options = {}) {
    const current = store.get();
    if (current.playlists.length >= MAX_IPTV_PLAYLISTS) {
      return current;
    }
    const normalized = normalizePlaylist(playlist, current.playlists.length);
    if (!normalized) {
      return current;
    }
    if (current.playlists.some((entry) => entry.url === normalized.url)) {
      return current;
    }
    return store.set({ playlists: [...current.playlists, normalized] }, options);
  },

  removePlaylist(playlistId, options = {}) {
    const current = store.get();
    return store.set(
      { playlists: current.playlists.filter((entry) => entry.id !== String(playlistId)) },
      options
    );
  },

  setPlaylistEnabled(playlistId, enabled, options = {}) {
    const current = store.get();
    return store.set(
      {
        playlists: current.playlists.map((entry) =>
          entry.id === String(playlistId) ? { ...entry, enabled: Boolean(enabled) } : entry
        )
      },
      options
    );
  },

  toggleFavorite(channelId, options = {}) {
    const current = store.get();
    return store.set(
      { favoriteChannelIds: toggleInList(current.favoriteChannelIds, channelId) },
      options
    );
  },

  isFavorite(channelId) {
    return store.get().favoriteChannelIds.includes(String(channelId || "").trim());
  },

  toggleHiddenGroup(group, options = {}) {
    const current = store.get();
    return store.set({ hiddenGroups: toggleInList(current.hiddenGroups, group) }, options);
  },

  setGroupOrder(groupOrder, options = {}) {
    return store.set({ groupOrder: normalizeStringList(groupOrder) }, options);
  },

  setLastChannelId(channelId, options = {}) {
    return store.set({ lastChannelId: String(channelId || "").trim() }, options);
  },

  setMinQuality(minQuality, options = {}) {
    return store.set({ minQuality: String(minQuality || "ANY").toUpperCase() }, options);
  }
};

export { normalizeIptvSettings };
