// Remembers which Live TV channels are dead.
//
// Not profile-scoped: whether a public stream answers is a property of the
// internet, not of who is watching, and every profile in the household benefits
// from a channel only being proven dead once.
//
// Only the dead are stored. Storing the living too would triple the size for no
// gain — an unrecorded channel is simply re-probed, which is the correct
// behaviour for one that has come back.

import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "iptvChannelHealth";

// Public IPTV rots in both directions: dead channels come back when a provider
// fixes an edge. A day is long enough that the list stays clean through an
// evening's viewing, and short enough that a recovered channel returns quickly.
export const DEAD_CHANNEL_TTL_MS = 24 * 60 * 60 * 1000;

// A hard cap so a very large provider list cannot fill the TV's storage quota.
// Oldest entries are dropped first; they are also the ones most likely stale.
export const MAX_TRACKED_CHANNELS = 4000;

function readRaw() {
  const stored = LocalStore.get(KEY, null);
  return stored && typeof stored === "object" && stored.dead && typeof stored.dead === "object"
    ? stored
    : { dead: {} };
}

/**
 * Channel ids currently known to be dead.
 * @returns {Set<string>}
 */
export function getDeadChannelIds(nowMs = Date.now()) {
  const { dead } = readRaw();
  const ids = new Set();
  Object.keys(dead).forEach((id) => {
    if (nowMs - Number(dead[id] || 0) <= DEAD_CHANNEL_TTL_MS) {
      ids.add(id);
    }
  });
  return ids;
}

/** Records channels as dead. Expired entries are pruned in the same pass. */
export function markChannelsDead(channelIds = [], nowMs = Date.now()) {
  const ids = (Array.isArray(channelIds) ? channelIds : [channelIds])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  if (!ids.length) {
    return;
  }
  const { dead } = readRaw();
  Object.keys(dead).forEach((id) => {
    if (nowMs - Number(dead[id] || 0) > DEAD_CHANNEL_TTL_MS) {
      delete dead[id];
    }
  });
  ids.forEach((id) => {
    dead[id] = nowMs;
  });

  const entries = Object.entries(dead);
  if (entries.length > MAX_TRACKED_CHANNELS) {
    entries
      .sort((left, right) => Number(left[1]) - Number(right[1]))
      .slice(0, entries.length - MAX_TRACKED_CHANNELS)
      .forEach(([id]) => delete dead[id]);
  }
  LocalStore.set(KEY, { dead });
}

/** Clears a channel's dead record, e.g. after it played successfully. */
export function markChannelAlive(channelId = "") {
  const id = String(channelId || "").trim();
  if (!id) {
    return;
  }
  const { dead } = readRaw();
  if (id in dead) {
    delete dead[id];
    LocalStore.set(KEY, { dead });
  }
}

export function clearChannelHealth() {
  LocalStore.remove(KEY);
}
