import assert from "node:assert/strict";
import test from "node:test";

// The store reads localStorage through LocalStore, which needs a browser-ish
// global. A minimal stand-in is enough and keeps the test free of a DOM.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};

const {
  MAX_FAMILY_LIST_ITEMS,
  addToFamilyList,
  clearFamilyList,
  getFamilyList,
  isInFamilyList,
  removeFromFamilyList,
  toggleFamilyList
} = await import("./familyListStore.js");

test("a title added by one profile is visible to everyone", () => {
  // The whole point: not profile-scoped.
  clearFamilyList();
  addToFamilyList({ contentId: "tt1", title: "Dune" }, { profileName: "Papá", profileId: "1" });
  const list = getFamilyList();
  assert.equal(list.length, 1);
  assert.equal(list[0].addedBy, "Papá");
  assert.equal(list[0].addedByProfileId, "1");
});

test("adding the same title twice does not duplicate or reorder it", () => {
  clearFamilyList();
  addToFamilyList({ contentId: "tt1", title: "Dune" }, { profileName: "Papá" });
  addToFamilyList({ contentId: "tt2", title: "Sicario" }, { profileName: "Mamá" });
  addToFamilyList({ contentId: "tt1", title: "Dune" }, { profileName: "Mamá" });

  const list = getFamilyList();
  assert.equal(list.length, 2);
  // Still attributed to whoever suggested it first.
  assert.equal(list.find((entry) => entry.contentId === "tt1").addedBy, "Papá");
});

test("anyone can remove anything", () => {
  clearFamilyList();
  addToFamilyList({ contentId: "tt1", title: "Dune" }, { profileName: "Papá", profileId: "1" });
  removeFromFamilyList("tt1");
  assert.deepEqual(getFamilyList(), []);
});

test("toggle adds then removes", () => {
  clearFamilyList();
  toggleFamilyList({ contentId: "tt9", title: "Parasite" }, { profileName: "Ken" });
  assert.equal(isInFamilyList("tt9"), true);
  toggleFamilyList({ contentId: "tt9", title: "Parasite" }, { profileName: "Ken" });
  assert.equal(isInFamilyList("tt9"), false);
});

test("an entry with no id is rejected rather than stored unusable", () => {
  clearFamilyList();
  addToFamilyList({ title: "No id" });
  assert.deepEqual(getFamilyList(), []);
});

test("the list is newest first", () => {
  clearFamilyList();
  addToFamilyList({ contentId: "a", title: "A", addedAt: 1 });
  addToFamilyList({ contentId: "b", title: "B", addedAt: 2 });
  const ids = getFamilyList().map((entry) => entry.contentId);
  assert.equal(ids[0], "b");
});

test("the list is bounded so it stays a shortlist", () => {
  clearFamilyList();
  for (let i = 0; i < MAX_FAMILY_LIST_ITEMS + 10; i += 1) {
    addToFamilyList({ contentId: `id-${i}`, title: `T${i}` });
  }
  assert.equal(getFamilyList().length, MAX_FAMILY_LIST_ITEMS);
});

test("corrupt storage reads as an empty list rather than throwing", () => {
  globalThis.localStorage.setItem("familyList", "not json");
  assert.deepEqual(getFamilyList(), []);
});
