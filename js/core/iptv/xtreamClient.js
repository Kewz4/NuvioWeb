// Xtream Codes panel support.
//
// Xtream playlists are usually pasted as a get.php URL. Loading them through
// the JSON player_api is much faster than downloading a multi-megabyte M3U on
// TV hardware, and it yields category names plus EPG channel ids that the M3U
// often omits. We therefore go API-first and fall back to M3U text.

import { inferQualityLabel } from "./m3uParser.js";

export const DEFAULT_IPTV_USER_AGENT = "VLC/3.0.20 LibVLC/3.0.20";

function parseUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch (_) {
    return null;
  }
}

/**
 * Extracts Xtream credentials from a playlist URL.
 * @returns {{baseUrl:string, username:string, password:string}|null}
 */
export function parseXtreamInfo(url) {
  const parsed = parseUrl(url);
  if (!parsed) {
    return null;
  }
  const username = parsed.searchParams.get("username") || "";
  const password = parsed.searchParams.get("password") || "";
  if (!username || !password) {
    return null;
  }
  const path = parsed.pathname.toLowerCase();
  const isXtreamPath =
    path.endsWith("/get.php") ||
    path.endsWith("/player_api.php") ||
    path.endsWith("/panel_api.php") ||
    path.endsWith("/xmltv.php");
  if (!isXtreamPath) {
    return null;
  }
  return {
    baseUrl: `${parsed.protocol}//${parsed.host}`,
    username,
    password
  };
}

export function isXtreamPlaylistUrl(url) {
  return Boolean(parseXtreamInfo(url));
}

/** Builds credentials from an explicit host/user/pass login form. */
export function xtreamInfoFromCredentials({ host = "", username = "", password = "" } = {}) {
  const trimmedHost = String(host || "").trim();
  const trimmedUser = String(username || "").trim();
  const trimmedPass = String(password || "").trim();
  if (!trimmedHost || !trimmedUser || !trimmedPass) {
    return null;
  }
  const withScheme = /^https?:\/\//i.test(trimmedHost) ? trimmedHost : `http://${trimmedHost}`;
  const parsed = parseUrl(withScheme);
  if (!parsed) {
    return null;
  }
  return {
    baseUrl: `${parsed.protocol}//${parsed.host}`,
    username: trimmedUser,
    password: trimmedPass
  };
}

export function buildXtreamPlayerApiUrl(info, action, extraParams = {}) {
  const url = new URL(`${info.baseUrl}/player_api.php`);
  url.searchParams.set("username", info.username);
  url.searchParams.set("password", info.password);
  if (action) {
    url.searchParams.set("action", action);
  }
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

/**
 * Live stream URL for a channel. `.m3u8` is requested because HLS is what the
 * TV's player and hls.js can both handle; raw .ts endpoints often will not play
 * in a browser context.
 */
export function buildXtreamStreamUrl(info, streamId, extension = "m3u8") {
  return `${info.baseUrl}/live/${encodeURIComponent(info.username)}/${encodeURIComponent(
    info.password
  )}/${encodeURIComponent(String(streamId))}.${extension}`;
}

export function iptvRequestHeaders(userAgent = "") {
  return {
    Accept: "*/*",
    "User-Agent": String(userAgent || "").trim() || DEFAULT_IPTV_USER_AGENT
  };
}

/**
 * Loads live channels from an Xtream panel.
 *
 * @param {object} options
 * @param {object} options.info      credentials from parseXtreamInfo
 * @param {string} options.playlistId
 * @param {function} options.fetchJson async (url) => parsed JSON
 * @returns {Promise<Array<object>>} channels
 */
export async function fetchXtreamLiveChannels({ info, playlistId = "xtream", fetchJson } = {}) {
  if (!info || typeof fetchJson !== "function") {
    return [];
  }

  const [streams, categories] = await Promise.all([
    fetchJson(buildXtreamPlayerApiUrl(info, "get_live_streams")),
    fetchJson(buildXtreamPlayerApiUrl(info, "get_live_categories")).catch(() => [])
  ]);

  if (!Array.isArray(streams)) {
    return [];
  }

  const groupById = new Map(
    (Array.isArray(categories) ? categories : [])
      .map((category) => [
        String(category?.category_id ?? ""),
        String(category?.category_name ?? "").trim()
      ])
      .filter(([id, name]) => Boolean(id && name))
  );

  const seen = new Set();
  const channels = [];
  streams.forEach((stream) => {
    const streamId = String(stream?.stream_id ?? "").trim();
    if (!streamId) {
      return;
    }
    const id = `${playlistId}:${streamId}`;
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    const name = String(stream?.name ?? "").trim() || "Channel";
    const group = groupById.get(String(stream?.category_id ?? "")) || "Uncategorized";
    channels.push({
      id,
      playlistId,
      name,
      group,
      logo: String(stream?.stream_icon ?? ""),
      tvgId: String(stream?.epg_channel_id ?? ""),
      number: String(stream?.num ?? ""),
      language: "",
      country: "",
      qualityLabel: inferQualityLabel(name, group),
      streamUrl: buildXtreamStreamUrl(info, streamId),
      xtreamStreamId: streamId
    });
  });
  return channels;
}

function decodeMaybeBase64(value = "") {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  // Xtream short-EPG returns base64-encoded titles and descriptions.
  try {
    if (typeof atob === "function") {
      return decodeURIComponent(escape(atob(text)));
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(text, "base64").toString("utf8");
    }
  } catch (_) {
    // Not base64 after all.
  }
  return text;
}

/**
 * Now/next for a single channel via the panel's short EPG endpoint.
 * Used instead of a full XMLTV pass, which is far too slow for big playlists.
 */
export async function fetchXtreamNowNext({ info, streamId, fetchJson, nowMs = Date.now() } = {}) {
  if (!info || !streamId || typeof fetchJson !== "function") {
    return null;
  }
  const payload = await fetchJson(
    buildXtreamPlayerApiUrl(info, "get_short_epg", { stream_id: streamId, limit: 4 })
  ).catch(() => null);

  const listings = Array.isArray(payload?.epg_listings) ? payload.epg_listings : [];
  if (!listings.length) {
    return null;
  }

  const programmes = listings
    .map((entry) => {
      const startMs = Number(entry?.start_timestamp ?? 0) * 1000;
      const endMs = Number(entry?.stop_timestamp ?? 0) * 1000;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }
      return {
        startMs,
        endMs,
        title: decodeMaybeBase64(entry?.title),
        description: decodeMaybeBase64(entry?.description)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.startMs - right.startMs);

  const now = programmes.find((item) => item.startMs <= nowMs && item.endMs > nowMs) || null;
  const next = programmes.find((item) => item.startMs > nowMs) || null;
  return now || next ? { now, next } : null;
}
