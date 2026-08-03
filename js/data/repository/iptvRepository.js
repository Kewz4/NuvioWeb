// Merges every configured IPTV playlist into a single browsable snapshot.
//
// Caching is in-memory rather than localStorage on purpose: a large provider
// playlist is several megabytes of channels, which would blow the TV's storage
// quota. Re-fetching once per app session is the cheaper trade.

import {
  filterChannelsByMinQuality,
  groupChannels,
  orderGroupNames,
  parseM3u
} from "../../core/iptv/m3uParser.js";
import {
  fetchXtreamLiveChannels,
  fetchXtreamNowNext,
  iptvRequestHeaders,
  parseXtreamInfo
} from "../../core/iptv/xtreamClient.js";
import {
  buildNowNextMap,
  parseXmltv,
  parseXmltvChannels,
  parseXmltvProgrammeChannelIds
} from "../../core/iptv/epgIndex.js";
import { buildGuideKeyIndex, resolveGuideChannelId } from "../../core/iptv/channelMatch.js";
import { defaultGuideSources } from "../../core/iptv/guideSources.js";

export const PLAYLIST_TTL_MS = 6 * 60 * 60 * 1000;
export const EPG_TTL_MS = 3 * 60 * 60 * 1000;
// Past this size the upfront XMLTV pass costs more than the guide is worth on
// TV hardware, so the guide becomes on-demand and the tab still opens fast.
export const LARGE_PLAYLIST_CHANNEL_COUNT = 10000;

// Programmes outside this window around "now" are discarded while parsing. A
// national guide holds a week per channel; the tab only ever renders now and
// next, and keeping the rest is tens of megabytes the TV cannot spare.
const GUIDE_WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const GUIDE_WINDOW_AFTER_MS = 12 * 60 * 60 * 1000;

const channelCache = new Map();
const epgCache = new Map();
const sharedGuideCache = new Map();

function cacheGet(cache, key, ttlMs, nowMs) {
  const entry = cache.get(key);
  if (!entry || nowMs - entry.storedAt > ttlMs) {
    return null;
  }
  return entry.value;
}

function cacheSet(cache, key, value, nowMs) {
  cache.set(key, { value, storedAt: nowMs });
}

export function clearIptvCaches() {
  channelCache.clear();
  epgCache.clear();
  sharedGuideCache.clear();
}

async function defaultFetchText(url, headers) {
  const response = await fetch(url, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

async function defaultFetchJson(url, headers) {
  const text = await defaultFetchText(url, headers);
  return JSON.parse(text);
}

async function loadPlaylistChannels(playlist, { fetchText, fetchJson, headers }) {
  const xtreamInfo = parseXtreamInfo(playlist.url);

  // Xtream panels load API-first: the JSON is far smaller than the equivalent
  // M3U, carries real category names and EPG ids, and yields .m3u8 URLs the
  // player can actually open.
  if (xtreamInfo) {
    try {
      const channels = await fetchXtreamLiveChannels({
        info: xtreamInfo,
        playlistId: playlist.id,
        fetchJson: (url) => fetchJson(url, headers)
      });
      if (channels.length) {
        return channels;
      }
    } catch (_) {
      // Fall through to the M3U representation.
    }
  }

  const text = await fetchText(playlist.url, headers);
  const channels = parseM3u(text, playlist.id);
  if (!channels.length) {
    throw new Error("Playlist contained no channels.");
  }
  return channels;
}

async function loadEpgNowNext(playlist, channels, { fetchText, headers, nowMs }) {
  const epgUrl = String(playlist.epgUrl || "").trim();
  if (!epgUrl) {
    return {};
  }
  const cached = cacheGet(epgCache, epgUrl, EPG_TTL_MS, nowMs);
  const wantedChannelIds = new Set(
    channels.map((channel) => String(channel.tvgId || "").trim()).filter(Boolean)
  );
  const index = cached || parseXmltv(await fetchText(epgUrl, headers), { wantedChannelIds });
  if (!cached) {
    cacheSet(epgCache, epgUrl, index, nowMs);
  }
  // A guide the provider ships with its own playlist shares its id scheme, so
  // tvg-id matching (the default) is exactly right here.
  return buildNowNextMap(channels, index, nowMs);
}

/**
 * Loads one shared community guide and maps it onto the supplied channels.
 *
 * Three passes over the XML, cheapest first, so the expensive one runs against
 * the smallest possible set:
 *   1. `<channel>` declarations and the ids that carry programmes — small.
 *   2. name-match every playlist channel against those declarations.
 *   3. `<programme>` extraction, restricted to the ids step 2 actually matched
 *      and to a window around now.
 *
 * @returns {Promise<{nowNext: object, matched: number}>}
 */
async function loadSharedGuide(source, channels, { fetchText, headers, nowMs }) {
  const cached = cacheGet(sharedGuideCache, source.url, EPG_TTL_MS, nowMs);
  const xml = cached || (await fetchText(source.url, headers));
  if (!cached) {
    cacheSet(sharedGuideCache, source.url, xml, nowMs);
  }

  const idsWithProgrammes = parseXmltvProgrammeChannelIds(xml);
  if (!idsWithProgrammes.size) {
    return { nowNext: {}, matched: 0 };
  }
  const keyIndex = buildGuideKeyIndex(parseXmltvChannels(xml), idsWithProgrammes);

  const guideIdByChannelId = new Map();
  const wantedChannelIds = new Set();
  channels.forEach((channel) => {
    const guideId = resolveGuideChannelId(channel, keyIndex, idsWithProgrammes);
    if (guideId) {
      guideIdByChannelId.set(channel.id, guideId);
      wantedChannelIds.add(guideId);
    }
  });
  if (!wantedChannelIds.size) {
    return { nowNext: {}, matched: 0 };
  }

  const index = parseXmltv(xml, {
    wantedChannelIds,
    windowStartMs: nowMs - GUIDE_WINDOW_BEFORE_MS,
    windowEndMs: nowMs + GUIDE_WINDOW_AFTER_MS
  });
  const nowNext = buildNowNextMap(channels, index, nowMs, (channel) =>
    guideIdByChannelId.get(channel.id)
  );
  return { nowNext, matched: Object.keys(nowNext).length };
}

/**
 * Guide data for channels whose playlist ships no guide of its own.
 *
 * Deliberately separate from `loadIptvSnapshot`: the shared guides are tens of
 * megabytes in total, so the channel list must render first and the guide fill
 * in behind it. Feeds are fetched one at a time and reported as they land.
 *
 * @param {Array<object>} channels channels still missing guide data
 * @param {object} [options] `onPartial(nowNextChunk)` fires per feed.
 * @returns {Promise<object>} merged channelId -> {now, next}
 */
export async function loadSharedGuideData(channels = [], options = {}) {
  const {
    fetchText = defaultFetchText,
    nowMs = Date.now(),
    sources = defaultGuideSources(),
    userAgent = "",
    onPartial = null,
    shouldStop = null
  } = options;

  const headers = iptvRequestHeaders(userAgent);
  let pending = channels.filter((channel) => channel?.streamUrl);
  const merged = {};

  for (const source of sources) {
    if (!pending.length || (typeof shouldStop === "function" && shouldStop())) {
      break;
    }
    try {
      const { nowNext } = await loadSharedGuide(source, pending, { fetchText, headers, nowMs });
      const matchedIds = Object.keys(nowNext);
      if (!matchedIds.length) {
        continue;
      }
      Object.assign(merged, nowNext);
      // Later feeds only need to look at what is still unmatched, which makes
      // each successive pass cheaper.
      const matched = new Set(matchedIds);
      pending = pending.filter((channel) => !matched.has(channel.id));
      if (typeof onPartial === "function") {
        onPartial(nowNext);
      }
    } catch (_) {
      // A guide host being down must never affect the channel list.
    }
  }
  return merged;
}

/**
 * Builds the merged IPTV snapshot.
 *
 * @param {object} settings IptvSettingsStore value
 * @param {object} [deps] injectable fetchers for tests
 * @returns {Promise<{channels:Array, groups:Array, favorites:Array, nowNext:object,
 *   warnings:string[], guideOnDemand:boolean}>}
 */
export async function loadIptvSnapshot(settings = {}, deps = {}) {
  const {
    fetchText = defaultFetchText,
    fetchJson = defaultFetchJson,
    nowMs = Date.now(),
    forceRefresh = false,
    excludeChannelIds = null
  } = deps;

  const headers = iptvRequestHeaders(settings.userAgent);
  const playlists = (settings.playlists || []).filter(
    (playlist) => playlist?.enabled !== false && String(playlist?.url || "").trim()
  );
  const warnings = [];

  const channelSets = await Promise.all(
    playlists.map(async (playlist) => {
      const cacheKey = `${playlist.id}:${playlist.url}`;
      if (!forceRefresh) {
        const cached = cacheGet(channelCache, cacheKey, PLAYLIST_TTL_MS, nowMs);
        if (cached) {
          return cached;
        }
      }
      try {
        const channels = await loadPlaylistChannels(playlist, { fetchText, fetchJson, headers });
        cacheSet(channelCache, cacheKey, channels, nowMs);
        return channels;
      } catch (error) {
        warnings.push(
          `${playlist.name || playlist.url}: ${error?.message || "Could not load playlist"}`
        );
        return [];
      }
    })
  );

  const qualityFiltered = filterChannelsByMinQuality(channelSets.flat(), settings.minQuality);
  // Channels already proven dead never re-enter the list, so a category the
  // viewer scrolled yesterday does not fill back up with broken rows today.
  const excluded =
    excludeChannelIds instanceof Set
      ? excludeChannelIds
      : new Set(Array.isArray(excludeChannelIds) ? excludeChannelIds : []);
  const channels = excluded.size
    ? qualityFiltered.filter((channel) => !excluded.has(channel.id))
    : qualityFiltered;
  const guideOnDemand = channels.length > LARGE_PLAYLIST_CHANNEL_COUNT;

  let nowNext = {};
  if (!guideOnDemand) {
    const perPlaylistNowNext = await Promise.all(
      playlists.map(async (playlist, index) => {
        try {
          return await loadEpgNowNext(playlist, channelSets[index] || [], {
            fetchText,
            headers,
            nowMs
          });
        } catch (_) {
          // A missing guide must never stop channels from listing.
          return {};
        }
      })
    );
    nowNext = Object.assign({}, ...perPlaylistNowNext);
  }

  const favoriteIds = new Set(settings.favoriteChannelIds || []);
  const grouped = groupChannels(channels, { hiddenGroups: settings.hiddenGroups || [] });
  const orderedNames = orderGroupNames(grouped, settings.groupOrder || []);

  return {
    channels,
    favorites: channels.filter((channel) => favoriteIds.has(channel.id)),
    groups: orderedNames.map((name) => ({ name, channels: grouped.get(name) })),
    nowNext,
    warnings,
    guideOnDemand
  };
}

/**
 * Guide data for a single channel, used when the playlist is too large to index
 * the whole XMLTV file upfront.
 */
export async function loadChannelNowNext(channel, settings = {}, deps = {}) {
  const { fetchJson = defaultFetchJson, nowMs = Date.now() } = deps;
  const playlist = (settings.playlists || []).find((entry) => entry.id === channel?.playlistId);
  if (!playlist) {
    return null;
  }
  const info = parseXtreamInfo(playlist.url);
  if (!info || !channel?.xtreamStreamId) {
    return null;
  }
  const headers = iptvRequestHeaders(settings.userAgent);
  return fetchXtreamNowNext({
    info,
    streamId: channel.xtreamStreamId,
    nowMs,
    fetchJson: (url) => fetchJson(url, headers)
  });
}
