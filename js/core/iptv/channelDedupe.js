// Removing duplicate channels across playlists.
//
// The shipped sources overlap heavily by design: "Español (todos)" already
// contains most of what the México, Chile, Colombia, Argentina and España lists
// carry, so merging them naively shows the same channel five or six times in a
// row. That is confusing on its own, and worse for someone scrolling with a
// remote — the list looks broken, and picking "the other one" is a coin flip.
//
// Duplicates are found on two levels:
//
//   1. the same stream URL, which is the same feed by definition;
//   2. the same channel by name and country, which is the overlap case — the
//      Spanish list and the México list both carry "Azteca Uno (1080p)" from
//      different edges.
//
// When several rows collapse, the survivor is chosen rather than taken
// arbitrarily: higher resolution first, then the entry carrying the metadata
// that makes the rest of the tab work (a tvg-id for guide matching, a logo).

import { channelKeyVariants } from "./channelMatch.js";
import { QUALITY_RANK } from "./m3uParser.js";

function normalizeStreamUrl(value = "") {
  const url = String(value || "").trim();
  if (!url) {
    return "";
  }
  // Providers hand out the same feed under http and https, and with or without
  // a trailing slash; neither difference makes it a different channel.
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

/**
 * Identity for the "same channel, different source" case.
 *
 * The country is part of the key on purpose: "Canal 5" exists in México, Chile
 * and Perú as entirely unrelated broadcasters, and collapsing them would hide
 * two real channels rather than a duplicate.
 */
export function channelIdentityKey(channel = {}) {
  const nameKey = channelKeyVariants(channel.name)[0] || "";
  if (!nameKey) {
    return "";
  }
  const country = String(channel.country || "")
    .trim()
    .toLowerCase();
  // Fall back to the tvg-id's country suffix ("AztecaUno.mx" -> "mx") when the
  // playlist omits tvg-country, which iptv-org usually does.
  const suffix = String(channel.tvgId || "")
    .split("@")[0]
    .match(/\.([a-z]{2})$/i);
  return `${nameKey}|${country || (suffix ? suffix[1].toLowerCase() : "")}`;
}

/** How good a candidate is as the surviving row. Higher wins. */
function channelScore(channel = {}) {
  const quality = QUALITY_RANK[String(channel.qualityLabel || "").toUpperCase()] || 0;
  // Quality dominates: a viewer would always rather have the 1080p feed. The
  // rest are tie-breakers that keep the row useful once it is chosen.
  return quality * 100 + (channel.tvgId ? 10 : 0) + (channel.logo ? 1 : 0);
}

/**
 * Collapses duplicate channels, preserving order.
 *
 * @param {Array<object>} channels merged across every playlist
 * @returns {{channels: Array<object>, removed: number}}
 */
export function dedupeChannels(channels = []) {
  const entries = Array.isArray(channels) ? channels.filter(Boolean) : [];
  const bestByKey = new Map();
  const order = [];

  const consider = (key, channel) => {
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, channel);
      order.push(key);
      return;
    }
    if (channelScore(channel) > channelScore(existing.channel ?? existing)) {
      bestByKey.set(key, channel);
    }
  };

  entries.forEach((channel) => {
    const urlKey = normalizeStreamUrl(channel.streamUrl);
    const identityKey = channelIdentityKey(channel);
    // The URL key is authoritative; the identity key only applies when a name
    // could be resolved, so unnamed rows are never merged together.
    consider(urlKey ? `url:${urlKey}` : `id:${channel.id}`, channel);
    if (identityKey) {
      consider(`name:${identityKey}`, channel);
    }
  });

  // A channel survives only if it is the winner of every key it belongs to;
  // otherwise a better duplicate exists and this row is one of the copies.
  const survivors = [];
  const seen = new Set();
  entries.forEach((channel) => {
    const urlKey = normalizeStreamUrl(channel.streamUrl);
    const identityKey = channelIdentityKey(channel);
    const keys = [urlKey ? `url:${urlKey}` : `id:${channel.id}`];
    if (identityKey) {
      keys.push(`name:${identityKey}`);
    }
    if (!keys.every((key) => bestByKey.get(key) === channel)) {
      return;
    }
    if (seen.has(channel.id)) {
      return;
    }
    seen.add(channel.id);
    survivors.push(channel);
  });

  return { channels: survivors, removed: entries.length - survivors.length };
}
