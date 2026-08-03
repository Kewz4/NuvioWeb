// M3U / M3U8 playlist parsing for the IPTV tab.
//
// Modeled on ARVIO's web/lib/iptv.ts. Kept free of browser globals so it can be
// unit tested and so a very large playlist can be parsed off the render path.

import { CATEGORY_ORDER, canonicalCategoryKey } from "./channelCategories.js";

const DIVIDER_NAME_PATTERN = /^[\s\-=_*#~.|<>]*$/;

function attr(line, name) {
  const match = line.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s,]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function firstAttr(line, names = []) {
  for (const name of names) {
    const value = attr(line, name);
    if (value) {
      return value;
    }
  }
  return "";
}

/**
 * Providers pad playlists with cosmetic separator rows ("=== SPORTS ===").
 * They are not playable, so they never become channels.
 */
export function isDividerChannelName(name = "") {
  const value = String(name || "").trim();
  if (!value) {
    return true;
  }
  return DIVIDER_NAME_PATTERN.test(value);
}

export function inferQualityLabel(name = "", group = "") {
  const haystack = `${name} ${group}`.toUpperCase();
  if (/\b(4K|UHD|2160P?)\b/.test(haystack)) return "4K";
  if (/\bFHD\b|\b1080P?\b/.test(haystack)) return "FHD";
  if (/\bHD\b|\b720P?\b/.test(haystack)) return "HD";
  if (/\bSD\b|\b480P?\b/.test(haystack)) return "SD";
  return "";
}

/** Ordered worst-to-best so thresholds can be compared numerically. */
export const QUALITY_RANK = { SD: 1, HD: 2, FHD: 3, "4K": 4 };
export const MIN_QUALITY_OPTIONS = ["ANY", "HD", "FHD", "UHD"];

const MIN_QUALITY_THRESHOLD = { ANY: 0, HD: 2, FHD: 3, UHD: 4 };

/**
 * Filters channels by a minimum quality.
 *
 * Channels whose quality cannot be determined are KEPT: providers frequently
 * omit a resolution marker on perfectly good 1080p feeds, and silently hiding
 * them would look like missing channels.
 */
export function filterChannelsByMinQuality(channels = [], minQuality = "ANY") {
  const threshold = MIN_QUALITY_THRESHOLD[String(minQuality || "ANY").toUpperCase()] ?? 0;
  if (!threshold) {
    return channels;
  }
  return channels.filter((channel) => {
    const rank = QUALITY_RANK[String(channel?.qualityLabel || "").toUpperCase()] || 0;
    return rank === 0 || rank >= threshold;
  });
}

function buildChannelId(streamUrl = "", tvgId = "") {
  const id = String(tvgId || "").trim();
  if (id) {
    return id;
  }
  // Fall back to the stream URL so channels stay stable across reloads even
  // when the provider omits tvg-id.
  return String(streamUrl || "").trim();
}

/**
 * The display title of an `#EXTINF` line.
 *
 * The attribute list ends at the first comma that is NOT inside a quoted value,
 * and everything after it is the title — which may itself contain commas
 * ("CNN, en vivo"). Splitting on the first comma outright breaks on playlists
 * that embed a browser user-agent, because "(KHTML, like Gecko)" puts a comma
 * inside an attribute and the channel ends up named "like Gecko) Chrome/146...".
 */
export function extinfTitle(line = "") {
  const text = String(line || "");
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = "";
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ",") {
      return text.slice(index + 1).trim();
    }
  }
  return "";
}

/**
 * Parses playlist text into channels.
 *
 * @param {string} text
 * @param {string} playlistId namespaces channel ids so multiple playlists merge cleanly
 * @returns {Array<object>} channels
 */
export function parseM3u(text = "", playlistId = "default") {
  const lines = String(text || "").split(/\r?\n/);
  const channels = [];
  const seen = new Set();
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine;
    if (line.startsWith("#EXTINF")) {
      const title = extinfTitle(line);
      pending = {
        name: attr(line, "tvg-name") || title || "Unknown Channel",
        group: attr(line, "group-title") || "Uncategorized",
        logo: attr(line, "tvg-logo"),
        tvgId: attr(line, "tvg-id"),
        number: firstAttr(line, ["tvg-chno", "tvg-ch-number", "channel-number", "ch-number"]),
        language: firstAttr(line, ["tvg-language", "tvg-lang", "language"]),
        country: firstAttr(line, ["tvg-country", "country"]),
        qualityLabel: firstAttr(line, ["quality", "tvg-quality", "resolution"])
      };
      continue;
    }

    if (!pending || !line.trim() || line.startsWith("#")) {
      continue;
    }

    if (isDividerChannelName(pending.name)) {
      pending = null;
      continue;
    }

    const streamUrl = line.trim();
    const id = `${playlistId}:${buildChannelId(streamUrl, pending.tvgId)}`;
    if (seen.has(id)) {
      pending = null;
      continue;
    }
    seen.add(id);
    channels.push({
      id,
      playlistId,
      name: pending.name || "Channel",
      group: pending.group || "Uncategorized",
      logo: pending.logo || "",
      tvgId: pending.tvgId || "",
      number: pending.number || "",
      language: pending.language || "",
      country: pending.country || "",
      qualityLabel: pending.qualityLabel || inferQualityLabel(pending.name, pending.group),
      streamUrl
    });
    pending = null;
  }

  return channels;
}

/**
 * Groups channels into the canonical categories.
 *
 * Keys are canonical category ids, not raw `group-title` strings, so the rail
 * shows eleven stable entries in every playlist instead of a provider's
 * seventy compound tags.
 *
 * `hiddenGroups` accepts either form: it holds whatever the user hid, which may
 * predate the canonical taxonomy.
 */
export function groupChannels(channels = [], { hiddenGroups = [] } = {}) {
  const hidden = new Set(hiddenGroups.map((group) => String(group)));
  const groups = new Map();
  channels.forEach((channel) => {
    const raw = channel.group || "";
    const category = canonicalCategoryKey(raw);
    if (hidden.has(category) || hidden.has(raw)) {
      return;
    }
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category).push(channel);
  });

  // Within a category, cluster by country so a viewer scrolling "Canales
  // generales" sees their own country's channels together rather than
  // interleaved with eight others.
  groups.forEach((list) =>
    list.sort(
      (left, right) =>
        String(left.country || "").localeCompare(String(right.country || "")) ||
        String(left.name || "").localeCompare(String(right.name || ""))
    )
  );
  return groups;
}

/**
 * Orders categories: pinned first (in the user's order), then the canonical
 * order — news and sports lead, the untagged mass sits last. Deliberately not
 * by channel count, which would put a thousand miscellaneous channels above the
 * news.
 */
export function orderGroupNames(groups, groupOrder = []) {
  const pinned = groupOrder.filter((name) => groups.has(name));
  const canonical = CATEGORY_ORDER.filter((name) => groups.has(name) && !pinned.includes(name));
  // Anything a provider produced that is not canonical (an Xtream panel's own
  // category names) keeps its place at the end rather than disappearing.
  const extra = [...groups.keys()]
    .filter((name) => !pinned.includes(name) && !canonical.includes(name))
    .sort((left, right) => groups.get(right).length - groups.get(left).length);
  return [...pinned, ...canonical, ...extra];
}
