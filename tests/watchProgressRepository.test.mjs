import test from "node:test";
import assert from "node:assert/strict";
import { unwrapMetaRepositoryResult } from "../js/data/repository/watchProgressRepository.js";

test("unwraps successful metadata repository responses for Continue Watching", () => {
  const meta = {
    id: "tt0133093",
    name: "The Matrix",
    background: "https://images.metahub.space/background/medium/tt0133093/img"
  };

  assert.equal(unwrapMetaRepositoryResult({ status: "success", data: meta }), meta);
  assert.equal(unwrapMetaRepositoryResult(meta), meta);
});

test("rejects failed or malformed metadata repository responses", () => {
  assert.equal(
    unwrapMetaRepositoryResult({ status: "error", message: "Meta not found", code: 404 }),
    null
  );
  assert.equal(unwrapMetaRepositoryResult({ status: "success", data: null }), null);
  assert.equal(unwrapMetaRepositoryResult(null), null);
});
