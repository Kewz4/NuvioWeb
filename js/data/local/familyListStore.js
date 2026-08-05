// The list everyone in the household shares.
//
// Deliberately NOT profile-scoped, which is the entire point. Personal
// watchlists already exist per profile; what they cannot express is "something
// we said we'd watch together". A shared list is the only one where one person
// adding a title is visible to the other, which is how couples and families
// actually decide what to watch next.
//
// Entries record who added them, so the list can say "Papá added this" — not
// for accounting, but because knowing who suggested something is most of why
// you agree to watch it.

import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const KEY = "familyList";

// Generous, but bounded: this is a list people curate, not a catalogue. Past a
// few hundred it has stopped being a shortlist and the cap is a kindness.
export const MAX_FAMILY_LIST_ITEMS = 200;

function readRaw() {
  const stored = LocalStore.get(KEY, null);
  return Array.isArray(stored?.items) ? stored : { items: [] };
}

function currentProfileId() {
  try {
    return String(ProfileManager.getActiveProfileId() ?? "1");
  } catch (_) {
    return "1";
  }
}

function normalizeEntry(entry = {}) {
  const contentId = String(entry?.contentId || entry?.id || "").trim();
  if (!contentId) {
    return null;
  }
  return {
    contentId,
    contentType: String(entry?.contentType || entry?.type || "movie"),
    title: String(entry?.title || entry?.name || contentId).trim(),
    poster: String(entry?.poster || entry?.posterUrl || ""),
    background: String(entry?.background || entry?.backdrop || ""),
    addedBy: String(entry?.addedBy || "").trim(),
    addedByProfileId: String(entry?.addedByProfileId || "").trim(),
    addedAt: Number(entry?.addedAt) || Date.now()
  };
}

/** Everything on the list, newest first. */
export function getFamilyList() {
  return readRaw()
    .items.map(normalizeEntry)
    .filter(Boolean)
    .sort((left, right) => right.addedAt - left.addedAt);
}

export function isInFamilyList(contentId = "") {
  const id = String(contentId || "").trim();
  return Boolean(id) && readRaw().items.some((entry) => entry?.contentId === id);
}

/**
 * Adds a title, recording who added it.
 *
 * Re-adding an existing title is a no-op rather than a bump: the list is
 * shared, and reordering it under someone else would be confusing.
 */
export function addToFamilyList(entry = {}, { profileName = "", profileId = "" } = {}) {
  const normalized = normalizeEntry({
    ...entry,
    addedBy: profileName || entry?.addedBy || "",
    addedByProfileId: profileId || currentProfileId(),
    addedAt: Date.now()
  });
  if (!normalized) {
    return getFamilyList();
  }
  const store = readRaw();
  if (store.items.some((item) => item?.contentId === normalized.contentId)) {
    return getFamilyList();
  }
  store.items = [normalized, ...store.items].slice(0, MAX_FAMILY_LIST_ITEMS);
  LocalStore.set(KEY, store);
  return getFamilyList();
}

/**
 * Removes a title.
 *
 * Anyone can remove anything. A shared list where only the adder may remove
 * turns "we watched it" into an errand for one particular person.
 */
export function removeFromFamilyList(contentId = "") {
  const id = String(contentId || "").trim();
  if (!id) {
    return getFamilyList();
  }
  const store = readRaw();
  const next = store.items.filter((entry) => entry?.contentId !== id);
  if (next.length !== store.items.length) {
    LocalStore.set(KEY, { items: next });
  }
  return getFamilyList();
}

export function toggleFamilyList(entry = {}, options = {}) {
  const id = String(entry?.contentId || entry?.id || "").trim();
  return isInFamilyList(id) ? removeFromFamilyList(id) : addToFamilyList(entry, options);
}

export function clearFamilyList() {
  LocalStore.remove(KEY);
}
