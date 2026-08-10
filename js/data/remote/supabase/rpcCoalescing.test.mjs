import assert from "node:assert/strict";
import test from "node:test";

// SupabaseApi.rpc reaches the network through httpRequest, which reads a stored
// session. Neither exists here, and the point of these tests is not the request
// but how many of them are started — so the environment is stubbed just enough
// for the call to be made, and the resulting failures are swallowed.
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear()
};
globalThis.fetch = () => Promise.reject(new Error("offline in tests"));

const { SupabaseApi } = await import("./supabaseApi.js");

/** Starts a call and detaches its failure, leaving only the promise identity. */
function rpc(name, body) {
  const promise = SupabaseApi.rpc(name, body);
  promise.catch(() => {});
  return promise;
}

test("identical reads in flight share one request", () => {
  // Three parts of the app pull the same settings on every launch. Without this
  // each opens its own round trip — about 400 ms apiece from a TV — for an
  // answer the first one is already waiting on.
  assert.equal(
    rpc("sync_pull_home_catalog_settings", { profileId: "1" }),
    rpc("sync_pull_home_catalog_settings", { profileId: "1" })
  );
});

test("the same read for a different profile is a different question", () => {
  assert.notEqual(
    rpc("sync_pull_home_catalog_settings", { profileId: "1" }),
    rpc("sync_pull_home_catalog_settings", { profileId: "2" })
  );
});

test("writes are never coalesced", () => {
  // A repeated push may well be intended, and folding two into one would lose
  // the second. Only sync_pull_* and get_* are eligible.
  assert.notEqual(rpc("sync_push_library", { items: [] }), rpc("sync_push_library", { items: [] }));
});

test("a settled read is not remembered for the next caller", async () => {
  // This shares a request in flight; it is not a cache. Once the answer has
  // arrived, the next caller must be free to ask again.
  const first = rpc("get_sync_owner", {});
  await first.catch(() => {});
  assert.notEqual(first, rpc("get_sync_owner", {}));
});
