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

// A probe that times out is "unknown", not dead, because it is also what a
// congested network looks like. But a channel that has never once answered is
// dead as far as the viewer is concerned, so misses are counted and a channel
// that reaches this many is treated as dead.
export const UNKNOWN_STRIKES_BEFORE_DEAD = 3;

function readRaw() {
  const stored = LocalStore.get(KEY, null);
  if (!stored || typeof stored !== "object") {
    return { dead: {}, strikes: {} };
  }
  return {
    dead: stored.dead && typeof stored.dead === "object" ? stored.dead : {},
    strikes: stored.strikes && typeof stored.strikes === "object" ? stored.strikes : {}
  };
}

/**
 * Records a channel that could not be reached.
 *
 * @returns {boolean} true once it has missed often enough to count as dead.
 */
export function recordChannelMiss(channelId = "", nowMs = Date.now()) {
  const id = String(channelId || "").trim();
  if (!id) {
    return false;
  }
  const store = readRaw();
  const strikes = Number(store.strikes[id] || 0) + 1;
  if (strikes >= UNKNOWN_STRIKES_BEFORE_DEAD) {
    delete store.strikes[id];
    store.dead[id] = nowMs;
    LocalStore.set(KEY, store);
    return true;
  }
  store.strikes[id] = strikes;
  LocalStore.set(KEY, store);
  return false;
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
  const store = readRaw();
  const { dead } = store;
  Object.keys(dead).forEach((id) => {
    if (nowMs - Number(dead[id] || 0) > DEAD_CHANNEL_TTL_MS) {
      delete dead[id];
    }
  });
  ids.forEach((id) => {
    dead[id] = nowMs;
    delete store.strikes[id];
  });

  const entries = Object.entries(dead);
  if (entries.length > MAX_TRACKED_CHANNELS) {
    entries
      .sort((left, right) => Number(left[1]) - Number(right[1]))
      .slice(0, entries.length - MAX_TRACKED_CHANNELS)
      .forEach(([id]) => delete dead[id]);
  }
  LocalStore.set(KEY, store);
}

/** Clears a channel's dead record, e.g. after it played successfully. */
export function markChannelAlive(channelId = "") {
  const id = String(channelId || "").trim();
  if (!id) {
    return;
  }
  const store = readRaw();
  if (id in store.dead || id in store.strikes) {
    delete store.dead[id];
    delete store.strikes[id];
    LocalStore.set(KEY, store);
  }
}

export function clearChannelHealth() {
  LocalStore.remove(KEY);
}
